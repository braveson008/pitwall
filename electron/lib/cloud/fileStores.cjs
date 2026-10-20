"use strict";
/**
 * The main process's own files as synced records: schedules, watches and
 * their findings, automation settings, voice memory and settings, MCP server
 * bindings and each project's learned memory. Records name projects by id,
 * never by path; a record for a project that is not on this computer yet is
 * parked until it is, then applied.
 */
const fs = require("node:fs");
const path = require("node:path");

const PARKED_KINDS = new Set(["watch", "mcpBindings", "knowledge", "gitCredential"]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

/**
 * @param stores    { schedule, watches, automation, memory, mcp, knowledge, voiceSettingsFile }
 * @param projects  [{ id, path }] — the projects on this computer
 */
/** Whether a synced job or watch is this computer's to run: its own, or one from before it was tied to a computer. */
function runsHere(item, deviceId) {
  return !item?.runsOn || !deviceId || item.runsOn === deviceId;
}

/** Jobs and watches made here are tied to this computer the first time they sync, so another one never runs them too. */
function claimUnowned(stores, deviceId) {
  if (!deviceId) return;
  const jobs = stores.schedule?.list() || [];
  if (jobs.some((job) => !job.runsOn)) stores.schedule.replaceAll(jobs.map((job) => (job.runsOn ? job : { ...job, runsOn: deviceId })));
  const watched = stores.watches?.list();
  if (watched?.watches.some((watch) => !watch.runsOn)) {
    stores.watches.replaceAll({ ...watched, watches: watched.watches.map((watch) => (watch.runsOn ? watch : { ...watch, runsOn: deviceId })) });
  }
}

async function collectFileStoreRecords(stores, projects, { deviceId = null } = {}) {
  claimUnowned(stores, deviceId);
  const records = [];
  for (const job of stores.schedule?.list() || []) records.push({ kind: "schedule", localId: job.id, data: job });
  const watched = stores.watches?.list() || { watches: [], findings: [] };
  for (const { projectPath: _path, ...watch } of watched.watches) records.push({ kind: "watch", localId: watch.id, data: watch });
  for (const finding of watched.findings) records.push({ kind: "finding", localId: finding.id, data: finding });
  if (stores.automation) records.push({ kind: "automationSettings", localId: "all", data: stores.automation.get() });
  if (stores.memory) {
    const { notes, snapshots } = stores.memory.exportAll();
    records.push({ kind: "voiceMemory", localId: "all", data: { notes, snapshots } });
  }
  if (stores.voiceSettingsFile && fs.existsSync(stores.voiceSettingsFile)) {
    records.push({ kind: "voiceSettings", localId: "all", data: readJson(stores.voiceSettingsFile, {}) });
  }
  const bindings = stores.mcp?.exportAll()?.projects || {};
  for (const [projectId, entry] of Object.entries(bindings)) {
    // Whether this computer is signed in to a server is this computer's own; the sign-in itself never travels.
    const bindingsOut = (entry.bindings || []).map(({ authenticatedAt: _signedIn, ...binding }) => binding);
    records.push({ kind: "mcpBindings", localId: projectId, data: { projectId, bindings: bindingsOut } });
  }
  // A project's git sign-in follows it, so the other computer clones and pushes without asking.
  for (const project of projects || []) {
    const credential = stores.credentials?.exportCredential?.({ projectId: project.id, projectPath: project.path });
    if (credential) records.push({ kind: "gitCredential", localId: project.id, data: { projectId: project.id, ...credential } });
  }
  for (const project of projects || []) {
    if (!stores.knowledge || !project.path || !fs.existsSync(project.path)) continue;
    const exported = await stores.knowledge.exportState({ projectPath: project.path });
    if (exported?.ok && (exported.records.length || exported.receipts.length)) {
      records.push({ kind: "knowledge", localId: project.id, fingerprint: exported.fingerprint ? `${project.id}:${exported.fingerprint}` : undefined, data: { projectId: project.id, records: exported.records, receipts: exported.receipts } });
    }
  }
  return records;
}

function createFileStoreApplier({ stores, userDataPath }) {
  const parkedFile = path.join(userDataPath, "cloud", "parked.json");

  function parked() {
    return readJson(parkedFile, []);
  }

  function park(change) {
    const list = parked().filter((item) => !(item.kind === change.kind && item.localId === change.localId));
    list.push(change);
    writeJson(parkedFile, list);
  }

  async function applyOne(change, projectPathFor) {
    const { kind, localId, data } = change;
    if (kind === "schedule") {
      const jobs = stores.schedule.list().filter((job) => job.id !== localId);
      stores.schedule.replaceAll(data ? [...jobs, data] : jobs);
    } else if (kind === "watch" || kind === "finding") {
      const current = stores.watches.list();
      if (kind === "watch") {
        const projectPath = data ? projectPathFor(data.projectId) : null;
        if (data && !projectPath) return park(change);
        const watches = current.watches.filter((watch) => watch.id !== localId);
        stores.watches.replaceAll({ ...current, watches: data ? [...watches, { ...data, projectPath }] : watches });
      } else {
        const findings = current.findings.filter((finding) => finding.id !== localId);
        stores.watches.replaceAll({ ...current, findings: data ? [...findings, data] : findings });
      }
    } else if (kind === "automationSettings" && data) {
      stores.automation.set(data);
    } else if (kind === "voiceMemory" && data) {
      stores.memory.replaceAll(data);
    } else if (kind === "voiceSettings" && data && stores.voiceSettingsFile) {
      writeJson(stores.voiceSettingsFile, data);
    } else if (kind === "mcpBindings" && data) {
      const projectPath = projectPathFor(data.projectId);
      if (!projectPath) return park(change);
      const here = stores.mcp.exportAll()?.projects?.[data.projectId]?.bindings || [];
      const signedIn = (binding) => here.find((item) => item.provider === binding.provider && item.name === binding.name)?.authenticatedAt;
      const bindings = (data.bindings || []).map((binding) => (signedIn(binding) ? { ...binding, authenticatedAt: signedIn(binding) } : binding));
      stores.mcp.replaceProject({ projectId: data.projectId, projectPath, bindings });
    } else if (kind === "gitCredential" && data?.token) {
      const projectPath = projectPathFor(data.projectId);
      if (!projectPath) return park(change);
      stores.credentials?.remember({ projectId: data.projectId, projectPath, host: data.host, kind: data.kind, login: data.login, token: data.token, source: data.source });
    } else if (kind === "knowledge" && data) {
      const projectPath = projectPathFor(data.projectId);
      if (!projectPath || !fs.existsSync(projectPath)) return park(change);
      const result = await stores.knowledge.importState({ projectPath, records: data.records, receipts: data.receipts });
      if (result?.ok === false) park(change);
    }
    return undefined;
  }

  return {
    async apply(changes, projectPathFor) {
      for (const change of changes) await applyOne(change, projectPathFor);
    },
    /** A project arrived on this computer: what was waiting for it goes in now. */
    async releaseParked(projectPathFor) {
      const waiting = parked();
      if (!waiting.length) return;
      writeJson(parkedFile, []);
      for (const change of waiting) await applyOne(change, projectPathFor);
    },
    parked,
    /** The sign-in waiting for a project that isn't on this computer yet: what its clone uses. */
    credentialFor(projectId) {
      return parked().find((change) => change.kind === "gitCredential" && change.data?.projectId === projectId)?.data || null;
    },
    /** A local project took a synced project's id: what names it follows. */
    renameProject(from, to) {
      if (stores.schedule) stores.schedule.replaceAll(stores.schedule.list().map((job) => (job.projectId === from ? { ...job, projectId: to } : job)));
      if (stores.watches) {
        const current = stores.watches.list();
        stores.watches.replaceAll({
          watches: current.watches.map((watch) => (watch.projectId === from ? { ...watch, projectId: to } : watch)),
          findings: current.findings.map((finding) => (finding.projectId === from ? { ...finding, projectId: to } : finding)),
        });
      }
      const binding = stores.mcp?.exportAll()?.projects?.[from];
      if (binding) stores.mcp.replaceProject({ projectId: to, projectPath: binding.projectPath, bindings: binding.bindings });
    },
  };
}

const FILE_STORE_KINDS = new Set(["schedule", "watch", "finding", "automationSettings", "voiceMemory", "voiceSettings", "mcpBindings", "knowledge", "gitCredential"]);

module.exports = { FILE_STORE_KINDS, PARKED_KINDS, collectFileStoreRecords, createFileStoreApplier, runsHere };
