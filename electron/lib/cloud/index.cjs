"use strict";
/**
 * Pitwall Cloud in the main process: the vault, the engine and the IPC the
 * window uses. The window reports its state (`cloud:push-snapshot`) and gets
 * other computers' changes back (`cloud:apply`); the main process's own files
 * are read and written here directly.
 */
const os = require("node:os");
const path = require("node:path");
const { createCloudClient } = require("./client.cjs");
const { createSyncEngine } = require("./engine.cjs");
const {
  advanceJoin, approvalCode, beginApproval, confirmApproval, confirmJoin, createVaultStore, joinWithRecovery, requestJoin, resetVault, setUpVault, vaultFor, vaultStatus,
} = require("./vault.cjs");
const { RENDERER_KINDS, recordsFromSnapshot } = require("./records.cjs");
const { FILE_STORE_KINDS, collectFileStoreRecords, createFileStoreApplier } = require("./fileStores.cjs");
const { applyAttachment, createAttachmentCollector } = require("./attachments.cjs");
const { checkoutProject, remoteOf, safeRemoteUrl } = require("./cloner.cjs");
const { tokenEnvironment } = require("../codeHost.cjs");
const { createContinuity } = require("./continuity.cjs");
const { createHistory } = require("./history.cjs");
const { createPluginSync, readClaudePlugins } = require("./plugins.cjs");
const { createLeaseKeeper } = require("./leases.cjs");
const { deriveKeys, vaultVerifier, verifierOf } = require("./crypto.cjs");
const { defaultProjectsRoot, normaliseRemote } = require("./pathMap.cjs");

const isTokenPath = (value) => typeof value === "string" && value.startsWith("@{");

function deviceName() {
  return os.hostname().replace(/\.local$/, "") || (process.platform === "win32" ? "Windows PC" : "Mac");
}

/**
 * @param deps.readAccount   () => { key, gateway } | null — the signed-in Pitwall account
 * @param deps.stores        () => { schedule, watches, automation, memory, mcp, knowledge, voiceSettingsFile }
 * @param deps.onStoresChanged (kinds:Set<string>) — e.g. re-register the schedule's LaunchAgent
 */
function registerCloud({
  ipcMain, safeStorage, userDataPath, attachmentsRoot, worktreesRoot, readAccount, stores, getMainWindow,
  onStoresChanged = () => {}, log = () => {}, projectsRoot = defaultProjectsRoot(),
  runningSessionIds = () => [], stopSession = async () => {}, exportHermes = async () => null, home = os.homedir(), cliVersion = async () => "",
  readCodexPlugins = async () => [], installPlugin = async () => ({ ok: false }), appVersion = "",
}) {
  const vaultStore = createVaultStore({ userDataPath, safeStorage });
  const applier = createFileStoreApplier({ stores: stores(), userDataPath });
  let snapshot = null;
  // Each batch sent to the window is numbered, and the window echoes the last
  // one it applied with its snapshot. A snapshot taken before the window saw
  // a batch would undo it, so it is ignored until a fresh one arrives.
  let appliedSent = 0;
  let engine = null;
  let engineKey = null;
  let keeper = null;
  let deviceId = null;
  let continuityTimers = [];
  const continuity = createContinuity({
    userDataPath,
    getSnapshot: () => snapshot,
    getEngine: () => engine,
    getKeeper: () => keeper,
    deviceId: () => deviceId,
    deviceName,
    runningSessionIds,
    stopSession,
    notify: (notice) => send("cloud:notice", notice),
    log,
    beforeRelease: async (taskId) => {
      for (const session of snapshot?.braveli?.sessions || []) {
        if (session.taskId === taskId) await history.upload(session.id).catch(() => null);
      }
    },
  });
  // Codex is asked through its CLI, so its answer is kept for a while rather than asked on every push.
  let codexPlugins = { at: 0, list: [] };
  const pluginSync = createPluginSync({
    deviceId: () => deviceId,
    statePath: path.join(userDataPath, "cloud", "plugins.json"),
    readClaude: async () => readClaudePlugins(home),
    readCodex: async () => {
      if (Date.now() - codexPlugins.at > 10 * 60_000) codexPlugins = { at: Date.now(), list: await readCodexPlugins().catch(() => codexPlugins.list) };
      return codexPlugins.list;
    },
    install: installPlugin,
    log,
  });
  // Sessions whose agent ran on this computer since Pitwall started: their conversations go up on quit.
  const ranHere = new Set();
  const history = createHistory({
    userDataPath,
    home,
    getSnapshot: () => snapshot,
    getEngine: () => engine,
    deviceId: () => deviceId,
    deviceName,
    exportHermes,
    localCliVersion: cliVersion,
    diffStat: async (info) => {
      const worktree = info.workspace?.worktreePath;
      if (!worktree || isTokenPath(worktree) || !require("node:fs").existsSync(worktree)) return "";
      return new Promise((resolve) => {
        require("node:child_process").execFile("git", ["-C", worktree, "diff", "--stat", "HEAD"], { timeout: 10_000 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
      });
    },
    notify: (notice) => send("cloud:notice", notice),
    log,
  });
  let lastStatus = { state: "off" };

  const send = (channel, payload) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  function clientFor(account) {
    return createCloudClient({ gateway: account.gateway, key: account.key, appVersion });
  }

  /** Where this computer keeps each project, from the window's own state. */
  function localProjects() {
    const projects = new Map();
    for (const project of snapshot?.projects || []) {
      if (project?.id && project.path && !isTokenPath(project.path)) projects.set(project.id, project.path);
    }
    for (const record of snapshot?.braveli?.projects || []) {
      if (record?.id && record.path && !isTokenPath(record.path) && !projects.has(record.id)) projects.set(record.id, record.path);
    }
    return projects;
  }

  function roots() {
    const list = [...localProjects()].map(([id, root]) => ({ root, token: `project:${id}` }));
    list.push({ root: attachmentsRoot, token: "attachments" }, { root: worktreesRoot, token: "worktrees" }, { root: os.homedir(), token: "home" });
    return list;
  }

  const attachmentCollector = createAttachmentCollector();
  // Local project ids that took a synced project's id this session.
  const renamed = new Map();
  // A project's remote, looked up once in a while rather than on every push.
  const remotes = new Map();
  async function remoteFor(projectPath) {
    const cached = remotes.get(projectPath);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.url;
    const url = safeRemoteUrl(await remoteOf(projectPath).catch(() => ""));
    remotes.set(projectPath, { url, at: Date.now() });
    return url;
  }

  async function collect() {
    if (!snapshot || (snapshot.appliedGeneration ?? 0) < appliedSent) return null;
    const local = localProjects();
    const projects = [...local].map(([id, projectPath]) => ({ id, path: projectPath }));
    const { records: attachments, skipped } = attachmentCollector.collect(snapshot.braveli?.tasks, attachmentsRoot);
    if (skipped.length) log(`cloud: ${skipped.length} attachment(s) over the size limit were not synced`);
    const records = recordsFromSnapshot(snapshot);
    // Where to get the code is what lets another computer check the project out.
    for (const record of records) {
      if (record.kind !== "project" || !local.has(record.localId)) continue;
      const remoteUrl = await remoteFor(local.get(record.localId));
      if (remoteUrl) record.data = { ...record.data, remoteUrl, remote: normaliseRemote(remoteUrl) || undefined };
    }
    return [...records, ...(await collectFileStoreRecords(stores(), projects, { deviceId })), ...attachments, ...continuity.records(), ...history.records(), ...(await pluginSync.records()), ...pluginSync.otherRecords()];
  }

  // ---- projects that are not on this computer yet ---------------------------
  const checkouts = new Map();
  let checkoutQueue = Promise.resolve();

  function wantCheckout(project) {
    if (!project?.id || checkouts.has(project.id) || localProjects().has(project.id)) return;
    if (!isTokenPath(project.path)) return;
    checkouts.set(project.id, "queued");
    send("cloud:project-ready", { projectId: project.id, state: "cloning", name: project.name });
    checkoutQueue = checkoutQueue.then(async () => {
      const credential = applier.credentialFor(project.id);
      const result = await checkoutProject(
        { name: project.name, remoteUrl: project.remoteUrl },
        { projectsRoot, knownPaths: [...localProjects().values()], env: credential ? tokenEnvironment(credential) : {} },
      ).catch((error) => ({ ok: false, code: "error", message: error.message }));
      checkouts.set(project.id, result.ok ? "done" : "failed");
      send("cloud:project-ready", result.ok
        ? { projectId: project.id, state: "ready", path: result.path, action: result.action, name: project.name }
        : { projectId: project.id, state: "failed", code: result.code, message: result.message, name: project.name });
    });
  }

  function checkoutMissing() {
    for (const project of snapshot?.braveli?.projects || []) wantCheckout(project);
  }

  async function apply(changes) {
    const toWindow = [];
    const toFiles = [];
    for (const change of changes) {
      if (RENDERER_KINDS.has(change.kind)) toWindow.push(change);
      else if (FILE_STORE_KINDS.has(change.kind)) toFiles.push(change);
      else if (change.kind === "attachment" && change.data) applyAttachment(attachmentsRoot, change.data);
      else if (change.kind === "wip") continuity.applyRemote([change]);
      else if (change.kind === "transcript") history.applyRemote([change]);
      else if (change.kind === "agentPlugins") void pluginSync.apply([change]).catch((error) => log(`cloud: plugin sync failed: ${error.message}`));
    }
    if (toFiles.length) {
      const projects = localProjects();
      await applier.apply(toFiles, (projectId) => projects.get(projectId) || null);
      // A sign-in arriving for a project whose download failed: try again with it.
      for (const change of toFiles) {
        if (change.kind !== "gitCredential" || checkouts.get(change.localId) !== "failed") continue;
        checkouts.delete(change.localId);
        const project = snapshot?.braveli?.projects?.find((item) => item.id === change.localId);
        if (project) wantCheckout(project);
      }
      onStoresChanged(new Set(toFiles.map((change) => change.kind)));
    }
    // The same repository already a project here under another id: it takes the synced id instead of becoming a second project.
    const local = localProjects();
    for (const change of toWindow) {
      if (change.kind !== "project" || !change.data?.remote || local.has(change.localId)) continue;
      for (const [id, projectPath] of local) {
        if (id === change.localId || renamed.has(id)) continue;
        if (normaliseRemote(await remoteFor(projectPath)) !== change.data.remote) continue;
        renamed.set(id, change.localId);
        applier.renameProject(id, change.localId);
        send("cloud:rename-project", { from: id, to: change.localId });
        break;
      }
    }
    const takenOver = new Set(renamed.values());
    for (const change of toWindow) if (change.kind === "project" && change.data && !takenOver.has(change.localId)) wantCheckout({ ...change.data, id: change.localId });
    if (toWindow.length) {
      appliedSent += 1;
      send("cloud:apply", { generation: appliedSent, changes: toWindow });
    }
  }

  function publish(status) {
    lastStatus = status;
    send("cloud:status", status);
  }

  // Records this computer can't open usually mean the account's key was reset on another computer.
  let checkedUnreadable = 0;
  async function checkVaultStillCurrent(client, vault, unreadable) {
    checkedUnreadable = unreadable;
    const remote = await client.getVault();
    if (!remote.ok || !remote.data.initialised) return;
    if (verifierOf(remote.data.recovery) === vaultVerifier(vault.masterKey)) return;
    stopEngine();
    vaultStore.clear();
    require("node:fs").rmSync(path.join(userDataPath, "cloud", "state.json"), { force: true });
    publish({ state: "off" });
    send("cloud:notice", { tone: "warn", title: "Sync was reset on another computer", message: "Approve this computer again from Account to keep syncing. Nothing here was deleted." });
  }

  function stopEngine() {
    engine?.stop();
    engine = null;
    engineKey = null;
    keeper = null;
    for (const timer of continuityTimers) clearInterval(timer);
    continuityTimers = [];
  }

  async function refresh() {
    const account = readAccount();
    if (!account?.key) {
      stopEngine();
      publish({ state: "off" });
      return "signed-out";
    }
    const client = clientFor(account);
    const vault = vaultFor(vaultStore, account);
    if (!vault) {
      stopEngine();
      return vaultStatus({ account, store: vaultStore, client });
    }
    if (engine && engineKey === `${account.key}:${vault.vaultId}`) return "ready";
    stopEngine();
    const registered = await client.registerDevice(deviceName(), process.platform).catch(() => null);
    deviceId = registered?.data?.device_id ?? deviceId;
    engine = createSyncEngine({ client, vault, stateDir: path.join(userDataPath, "cloud"), collect, apply, roots, log });
    engineKey = `${account.key}:${vault.vaultId}`;
    engine.onStatus((next) => {
      publish(next);
      if (next.unreadable > checkedUnreadable) void checkVaultStillCurrent(client, vault, next.unreadable);
    });
    engine.start();
    keeper = createLeaseKeeper({
      client,
      idKey: deriveKeys(vault.masterKey).idKey,
      runningTasks: continuity.runningTasks,
      knownTasks: continuity.knownTasks,
      onHandoffRequested: (taskId) => void continuity.handOver(taskId).catch((error) => log(`cloud: handover failed: ${error.message}`)),
      onLeases: (leases) => {
        continuity.setLeases(leases);
        send("cloud:leases", leases);
      },
      log,
    });
    const tick = () => void keeper?.tick().catch(() => {});
    continuityTimers = [setInterval(tick, 15_000), setInterval(() => void continuity.saveHeldTasks(), continuity.SAVE_EVERY_MS)];
    for (const timer of continuityTimers) timer.unref?.();
    tick();
    return "ready";
  }

  async function status() {
    const account = readAccount();
    const vault = await refresh();
    const result = { vault, sync: engine ? engine.status() : lastStatus, deviceName: deviceName(), email: account?.email || null };
    if (vault === "ready" && account) {
      const usage = await clientFor(account).usage();
      if (usage.ok) result.usage = usage.data;
    }
    return result;
  }

  ipcMain.handle("cloud:status", status);
  ipcMain.handle("cloud:set-up", async () => {
    const account = readAccount();
    if (!account?.key) return { ok: false, message: "Sign in to your Pitwall account first." };
    try {
      const { recoveryKey } = await setUpVault({ store: vaultStore, client: clientFor(account), email: account.email });
      await refresh();
      return { ok: true, recoveryKey };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle("cloud:join-recovery", async (_event, payload) => {
    const account = readAccount();
    if (!account?.key) return { ok: false, message: "Sign in to your Pitwall account first." };
    const joined = await joinWithRecovery({ store: vaultStore, client: clientFor(account), email: account.email }, String(payload?.recoveryKey || ""));
    if (joined.ok) await refresh();
    return joined;
  });
  ipcMain.handle("cloud:reset", async () => {
    const account = readAccount();
    if (!account?.key) return { ok: false, message: "Sign in to your Pitwall account first." };
    try {
      stopEngine();
      const { recoveryKey } = await resetVault({ store: vaultStore, client: clientFor(account), email: account.email });
      require("node:fs").rmSync(path.join(userDataPath, "cloud", "state.json"), { force: true });
      await refresh();
      return { ok: true, recoveryKey };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle("cloud:turn-off", async () => {
    stopEngine();
    vaultStore.clear();
    require("node:fs").rmSync(path.join(userDataPath, "cloud", "state.json"), { force: true });
    publish({ state: "off" });
    return { ok: true };
  });
  ipcMain.handle("cloud:sync-now", async () => {
    if (!engine) return { ok: false };
    return { ok: await engine.syncNow() };
  });
  ipcMain.handle("cloud:held-deletions", async (_event, payload) => {
    if (!engine) return { ok: false };
    if (payload?.action === "confirm") await engine.confirmHeldDeletions();
    else await engine.restoreHeldDeletions();
    return { ok: true };
  });
  ipcMain.handle("cloud:devices", async () => {
    const account = readAccount();
    return account?.key ? clientFor(account).devices() : { ok: false };
  });
  ipcMain.handle("cloud:remove-device", async (_event, payload) => {
    const account = readAccount();
    return account?.key ? clientFor(account).removeDevice(String(payload?.id || "")) : { ok: false };
  });
  // ---- a new computer asking to be approved --------------------------------
  let pendingJoin = null;
  let joinTimer = null;

  function stopJoinPolling() {
    clearInterval(joinTimer);
    joinTimer = null;
  }

  ipcMain.handle("cloud:join-request", async () => {
    const account = readAccount();
    if (!account?.key) return { ok: false, message: "Sign in to your Pitwall account first." };
    const client = clientFor(account);
    const asked = await requestJoin({ client }, { name: deviceName(), platform: process.platform });
    if (!asked.ok) return asked;
    pendingJoin = asked.pending;
    stopJoinPolling();
    joinTimer = setInterval(async () => {
      if (!pendingJoin) return stopJoinPolling();
      const step = await advanceJoin({ store: vaultStore, client }, pendingJoin).catch((error) => ({ state: "error", message: error.message }));
      send("cloud:join-state", step);
      if (step.state === "joined") {
        pendingJoin = null;
        stopJoinPolling();
        await refresh();
      } else if (step.state === "confirm") {
        // Waits for the person here; the request stays until they answer.
        stopJoinPolling();
      } else if (["expired", "denied", "error", "done"].includes(step.state)) {
        pendingJoin = null;
        stopJoinPolling();
      }
    }, 2000);
    joinTimer.unref?.();
    return { ok: true };
  });
  ipcMain.handle("cloud:join-confirm", async () => {
    const account = readAccount();
    if (!account?.key || !pendingJoin) return { state: "error", message: "Start again." };
    const done = await confirmJoin({ store: vaultStore, client: clientFor(account), email: account.email }, pendingJoin);
    pendingJoin = null;
    if (done.state === "joined") await refresh();
    send("cloud:join-state", done);
    return done;
  });
  ipcMain.handle("cloud:join-cancel", async () => {
    pendingJoin = null;
    stopJoinPolling();
    return { ok: true };
  });

  // ---- this computer approving another ---------------------------------------
  const approvals = new Map();
  let lastAnnounced = "";

  async function announceRequests() {
    const account = readAccount();
    if (!account?.key || !vaultFor(vaultStore, account)) return;
    const listed = await clientFor(account).links();
    if (!listed.ok) return;
    const waiting = listed.data.links.filter((item) => item.state === "waiting" || item.mine);
    const fingerprint = waiting.map((item) => item.link_id).join(",");
    if (fingerprint !== lastAnnounced) {
      lastAnnounced = fingerprint;
      send("cloud:join-requests", waiting);
    }
  }
  const announceTimer = setInterval(() => void announceRequests().catch(() => {}), 10_000);
  announceTimer.unref?.();

  ipcMain.handle("cloud:join-requests", async () => {
    lastAnnounced = "";
    await announceRequests().catch(() => {});
    return { ok: true };
  });
  ipcMain.handle("cloud:approve-join", async (_event, payload) => {
    const account = readAccount();
    if (!account?.key) return { ok: false, message: "Sign in to your Pitwall account first." };
    const client = clientFor(account);
    const linkId = String(payload?.linkId || "");
    const begun = await beginApproval({ client }, linkId);
    if (!begun.ok) return begun;
    approvals.set(linkId, begun.approval);
    // The new computer reveals its key within a poll or two of seeing ours.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const step = await approvalCode({ client }, begun.approval);
      if (step.state === "revealed") return { ok: true, code: step.code };
      if (step.state === "error" || step.state === "expired" || step.state === "denied") return { ok: false, message: step.message || "The other computer stopped asking." };
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { ok: false, message: "The other computer didn't answer. Ask it to try again." };
  });
  ipcMain.handle("cloud:confirm-join", async (_event, payload) => {
    const account = readAccount();
    const approval = approvals.get(String(payload?.linkId || ""));
    if (!account?.key || !approval) return { ok: false, message: "Start the approval again." };
    const done = await confirmApproval({ store: vaultStore, client: clientFor(account) }, approval);
    approvals.delete(approval.linkId);
    lastAnnounced = "";
    void announceRequests().catch(() => {});
    return done;
  });
  ipcMain.handle("cloud:deny-join", async (_event, payload) => {
    const account = readAccount();
    if (!account?.key) return { ok: false };
    const linkId = String(payload?.linkId || "");
    approvals.delete(linkId);
    const denied = await clientFor(account).denyLink(linkId);
    lastAnnounced = "";
    void announceRequests().catch(() => {});
    return { ok: denied.ok };
  });

  ipcMain.on("cloud:push-snapshot", (_event, next) => {
    const before = new Set(snapshot ? localProjects().keys() : []);
    const first = !snapshot;
    snapshot = next;
    const arrived = [...localProjects().keys()].filter((id) => !before.has(id));
    if (first || arrived.length) void applier.releaseParked((projectId) => localProjects().get(projectId) || null);
    // A project that just got a path here: everything that pointed at it can now point at that path.
    if (!first) for (const id of arrived) void engine?.reapplyMentioning(`@{project:${id}}`);
    checkoutMissing();
    engine?.pushSoon();
  });
  ipcMain.handle("cloud:continue-here", async (_event, payload) => continuity.continueHere(String(payload?.taskId || "")));
  ipcMain.handle("cloud:leases", async () => {
    await keeper?.tick().catch(() => {});
    return { ok: Boolean(keeper) };
  });
  ipcMain.handle("cloud:retry-checkout", async (_event, payload) => {
    const id = String(payload?.projectId || "");
    checkouts.delete(id);
    const project = snapshot?.braveli?.projects?.find((item) => item.id === id);
    if (project) wantCheckout(project);
    return { ok: Boolean(project) };
  });

  void refresh().catch(() => {});
  return {
    async beforeAgentStart(payload) {
      if (!engine) return { ok: true };
      const gate = await continuity.beforeAgentStart(payload);
      if (!gate.ok) return gate;
      ranHere.add(payload.sessionId);
      const overrides = await history.prepare({ sessionId: payload.sessionId, cwd: payload.cwd, resumeSession: Boolean(payload.resumeSession) })
        .catch((error) => { log(`cloud: couldn't prepare the conversation: ${error.message}`); return null; });
      return { ok: true, overrides };
    },
    async afterAgentExit(payload) {
      if (!engine) return;
      await history.upload(payload.sessionId, payload).catch((error) => log(`cloud: conversation upload failed: ${error.message}`));
      await continuity.afterAgentExit(payload);
    },
    async beforeQuit() {
      if (!engine) return;
      await Promise.race([
        Promise.all([...ranHere].map((sessionId) => history.upload(sessionId).catch(() => null))),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
      await continuity.beforeQuit();
    },
    resumeFailed: (sessionId, output) => history.resumeFailed(sessionId, output),
    history,
    keeper: () => keeper,
    deviceId: () => deviceId,
    continuity,
    refresh, status, engine: () => engine, localProjects, releaseParked: () => applier.releaseParked((projectId) => localProjects().get(projectId) || null) };
}

module.exports = { registerCloud };
