"use strict";
/**
 * Agent conversations that follow their task to another computer.
 *
 * Only conversations Pitwall started are synced, and only for projects whose
 * "sync agent history" is on. Each is uploaded when its agent stops, when the
 * task is handed over, and when Pitwall quits; only its new bytes travel.
 * Before a session's agent starts on another computer, its conversation is
 * written where that CLI looks, so `--resume` continues it. When that isn't
 * possible (another CLI, an unchecked version, a failed resume) the agent
 * starts fresh with a written summary instead, and the person is told which.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { locateTranscript, supported, transplant } = require("./transcripts.cjs");
const { buildHandoffBrief, messagesFromTranscript } = require("./handoffBrief.cjs");

const CLI_FOR_AGENT = { Claude: "claude", Codex: "codex", Hermes: "hermes" };
const AGENT_NAMES = { claude: "Claude", codex: "Codex", hermes: "Hermes" };
const RESUME_FAILED = /No conversation found|no rollout found|Session .* not found|could not find session/i;

function createHistory({ userDataPath, home, getSnapshot, getEngine, deviceId, deviceName, exportHermes = async () => null, diffStat = async () => "", localCliVersion = async () => "", notify, log = () => {} }) {
  const file = path.join(userDataPath, "cloud", "history.json");
  let saved = { manifests: {}, uploaded: {}, transplanted: {}, failed: {} };
  try {
    saved = { ...saved, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    // Nothing synced yet.
  }
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved));
  };

  /** What is known of a session: from the window's state, else from what the agent was started with. */
  function sessionInfo(sessionId, hint = {}) {
    const snapshot = getSnapshot();
    const workspace = snapshot?.braveli?.sessions?.find((session) => session.id === sessionId);
    let agentSession = null;
    let projectId = workspace?.projectId;
    for (const project of snapshot?.projects || []) {
      const found = project.sessions?.find((session) => session.id === sessionId);
      if (found) {
        agentSession = found;
        projectId ||= project.id;
      }
    }
    const project = snapshot?.braveli?.projects?.find((item) => item.id === projectId);
    const task = snapshot?.braveli?.tasks?.find((item) => item.id === workspace?.taskId);
    projectId ||= hint.projectId;
    return {
      projectId,
      task: task || snapshot?.braveli?.tasks?.find((item) => item.id === hint.taskId),
      workspace: workspace || (hint.taskId ? { taskId: hint.taskId, worktreePath: hint.cwd, messages: [] } : undefined),
      cli: CLI_FOR_AGENT[agentSession?.agent] || (workspace?.provider in AGENT_NAMES ? workspace.provider : null) || CLI_FOR_AGENT[hint.agent] || null,
      nativeId: agentSession?.nativeSessionId || workspace?.nativeSessionId || hint.nativeSessionId || null,
      syncHistory: (snapshot?.braveli?.projects?.find((item) => item.id === projectId) ?? project)?.cloudHistory !== false,
    };
  }

  async function upload(sessionId, hint) {
    const info = sessionInfo(sessionId, hint);
    const engine = getEngine();
    if (!engine || !info.cli || !info.nativeId || !info.syncHistory) return null;
    let files;
    let version = "";
    let cwd = null;
    if (info.cli === "hermes") {
      const exported = await exportHermes({ nativeId: info.nativeId, projectId: info.projectId }).catch(() => null);
      if (!exported) return null;
      files = [{ rel: "hermes.jsonl", bytes: Buffer.from(exported) }];
    } else {
      const found = locateTranscript({ cli: info.cli, nativeId: info.nativeId, home });
      if (!found) return null;
      version = found.version;
      cwd = found.cwd;
      files = found.files.map((entry) => ({ rel: entry.rel, abs: entry.abs }));
    }
    const listed = [];
    for (const entry of files) {
      const bytes = entry.bytes ?? fs.readFileSync(entry.abs);
      const key = `${info.nativeId}/${entry.rel}`;
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (saved.uploaded[key] !== digest) {
        const stored = await engine.putBlob("transcript", key, bytes);
        if (!stored?.ok) {
          log(`cloud: a conversation couldn't be uploaded: ${stored?.message || "unknown"}`);
          return null;
        }
        saved.uploaded[key] = digest;
      }
      listed.push({ rel: entry.rel, size: bytes.length });
    }
    // The working directory is inside the conversation's own bytes, not in the
    // manifest, which (like every record) carries no paths.
    await engine.putBlob("transcript-meta", info.nativeId, Buffer.from(JSON.stringify({ cwd })));
    saved.manifests[sessionId] = {
      sessionId, taskId: info.workspace?.taskId || null, projectId: info.projectId, cli: info.cli, nativeId: info.nativeId, version,
      files: listed, device: deviceId(), deviceName: deviceName(), at: new Date().toISOString(),
    };
    persist();
    // Synced now, not after the usual pause: the task may be handed over the moment its agent stops.
    await engine.syncNow().catch(() => false);
    return saved.manifests[sessionId];
  }

  async function fetchFiles(manifest) {
    const engine = getEngine();
    const files = [];
    for (const entry of manifest.files) {
      const bytes = await engine.getBlob("transcript", `${manifest.nativeId}/${entry.rel}`);
      if (!bytes) return null;
      files.push({ rel: entry.rel, bytes });
    }
    return files;
  }

  async function brief(manifest, files, info) {
    const main = files?.find((entry) => entry.rel.endsWith(".jsonl") && !entry.rel.includes("/subagents/")) || files?.[0];
    const messages = main
      ? messagesFromTranscript(manifest.cli, main.bytes.toString("utf8"))
      : (info.workspace?.messages || []).filter((message) => message.role !== "system").slice(-12).map((message) => ({ role: message.role, text: message.content }));
    return buildHandoffBrief({
      task: info.task,
      messages,
      diffStat: await diffStat(info).catch(() => ""),
      device: manifest.deviceName || "another computer",
      at: manifest.at ? new Date(manifest.at).toLocaleString() : null,
    });
  }

  /**
   * Before a session's agent starts here. Returns overrides for the launch:
   * nothing, a resume of the transplanted conversation, or a fresh start with
   * a summary.
   */
  async function prepare({ sessionId, cwd, resumeSession }) {
    const manifest = saved.manifests[sessionId];
    if (process.env.PITWALL_CLOUD_DEBUG) log(`cloud: prepare ${sessionId} resume=${resumeSession} manifest=${manifest ? `${manifest.device}@${manifest.at}` : "none"} me=${deviceId()} transplanted=${saved.transplanted[sessionId] || ""} failed=${Boolean(saved.failed[sessionId])}`);
    if (!resumeSession || !manifest || manifest.device === deviceId() || !getEngine()) return null;
    const info = sessionInfo(sessionId);
    const agent = AGENT_NAMES[manifest.cli] || "agent";
    const from = manifest.deviceName || "another computer";
    const key = `${manifest.nativeId}@${manifest.at}`;
    if (saved.transplanted[sessionId] === key && !saved.failed[sessionId]) return null;
    const files = await fetchFiles(manifest);
    // Both ends must be versions the move was checked against: the one that wrote it, and the one that will read it here.
    const hereVersion = files && (manifest.cli === "claude" || manifest.cli === "codex") ? await localCliVersion(manifest.cli).catch(() => "") : "";
    if (!saved.failed[sessionId] && files && (manifest.cli === "claude" || manifest.cli === "codex") && supported(manifest.cli, manifest.version) && supported(manifest.cli, hereVersion)) {
      const meta = await getEngine().getBlob("transcript-meta", manifest.nativeId);
      const fromCwd = meta ? JSON.parse(meta.toString("utf8")).cwd : null;
      // The CLI names its folder after the physical path it runs in (macOS's /var is /private/var).
      let here = cwd;
      try {
        here = fs.realpathSync(cwd);
      } catch {
        // Not created yet: the CLI will see it as given.
      }
      const moved = transplant({ cli: manifest.cli, version: manifest.version, files, from: fromCwd, to: here, home });
      if (moved.ok) {
        saved.transplanted[sessionId] = key;
        persist();
        notify({ tone: "info", title: `Resumed your ${agent} conversation from ${from}`, message: info.task?.title || "It continues where it stopped." });
        return { cloudTransplanted: true };
      }
      log(`cloud: couldn't move the conversation (${moved.reason})`);
    }
    const text = await brief(manifest, files, info);
    delete saved.failed[sessionId];
    saved.transplanted[sessionId] = key;
    persist();
    notify({
      tone: "warn",
      title: `Started a new ${agent} session with a summary of the one on ${from}`,
      message: "Its history couldn't be resumed on this computer, so the agent was given what it needs to carry on.",
    });
    return {
      resumeSession: false,
      nativeSessionStarted: false,
      // Claude takes the id it should use; Codex and Hermes name theirs.
      nativeSessionId: manifest.cli === "claude" ? crypto.randomUUID() : "",
      initialPrompt: text,
    };
  }

  return {
    records: () => Object.values(saved.manifests).map((manifest) => ({ kind: "transcript", localId: manifest.sessionId, data: manifest })),
    applyRemote(changes) {
      for (const change of changes) {
        if (change.data) saved.manifests[change.localId] = change.data;
        else delete saved.manifests[change.localId];
      }
      persist();
    },
    upload,
    prepare,
    /** The CLI refused the moved conversation: next start uses a summary. */
    resumeFailed(sessionId, output) {
      if (!RESUME_FAILED.test(String(output || ""))) return false;
      saved.failed[sessionId] = true;
      persist();
      return true;
    },
    RESUME_FAILED,
  };
}

module.exports = { createHistory };
