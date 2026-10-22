const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidSessionUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

// Hermes names its sessions by start time plus a short hex suffix:
// 20261006_224344_f695b1.
const HERMES_SESSION_PATTERN = /^\d{8}_\d{6}_[0-9a-f]{6}$/;

function isValidHermesSessionId(value) {
  return HERMES_SESSION_PATTERN.test(String(value || "").trim());
}

/**
 * The session id Hermes prints in its startup banner, so a restart can resume
 * the conversation. Hermes cannot be handed an id up front, and the banner is
 * the one place it is shown before the first turn finishes.
 */
function findHermesSessionId(text) {
  const match = String(text || "").match(/Session:\s*(\d{8}_\d{6}_[0-9a-f]{6})\b/);
  return match ? match[1] : null;
}

function claudeProjectDirectory(cwd, homeDir = os.homedir()) {
  const projectKey = path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(homeDir, ".claude", "projects", projectKey);
}

function findLatestClaudeSessionId(cwd, homeDir = os.homedir()) {
  try {
    const directory = claudeProjectDirectory(cwd, homeDir);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => ({
        id: entry.name.slice(0, -".jsonl".length),
        modifiedAt: fs.statSync(path.join(directory, entry.name)).mtimeMs,
      }))
      .filter((entry) => isValidSessionUuid(entry.id))
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The Codex conversation a session started, read from the rollout Codex
 * writes for it: the newest one recorded in `cwd` that began after `sinceMs`
 * and that no other session has already claimed. Codex cannot be handed an
 * id up front the way Claude can, so it is found after the fact.
 */
function findCodexSessionSince(cwd, sinceMs, { root = path.join(os.homedir(), ".codex", "sessions"), claimed = new Set(), fileSystem = fs } = {}) {
  const target = path.resolve(String(cwd || ""));
  const files = [];
  const walk = (directory, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fileSystem.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const modifiedAt = fileSystem.statSync(full).mtimeMs;
          if (modifiedAt >= sinceMs) files.push({ file: full, modifiedAt });
        } catch {
          // Gone between the listing and the stat.
        }
      }
    }
  };
  walk(root, 0);
  files.sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const candidate of files.slice(0, 50)) {
    try {
      const header = JSON.parse(fileSystem.readFileSync(candidate.file, "utf8").split("\n", 1)[0]);
      if (header?.type !== "session_meta") continue;
      const id = String(header.payload?.id || header.payload?.session_id || "");
      const started = Date.parse(header.payload?.timestamp || header.timestamp || "") || candidate.modifiedAt;
      if (!isValidSessionUuid(id) || claimed.has(id) || started < sinceMs - 2000) continue;
      if (path.resolve(String(header.payload?.cwd || "")) === target) return id;
    } catch {
      // A partial or unreadable header is not a match.
    }
  }
  return null;
}

function applyNativeSessionLaunch(launch, payload, cwd, homeDir = os.homedir()) {
  if (launch && payload?.agent === "Codex") {
    // Resuming is the only thing Codex is told: it names its own conversations.
    const id = isValidSessionUuid(payload?.nativeSessionId) ? String(payload.nativeSessionId) : null;
    if (!payload?.resumeSession || !id || launch.args[0] === "resume") {
      return { ...launch, nativeSessionId: null, nativeSessionMode: "none" };
    }
    const args = ["resume", id, ...launch.args];
    return { ...launch, args, display: [launch.command, ...args].join(" "), nativeSessionId: id, nativeSessionMode: "resume" };
  }
  if (launch && payload?.agent === "Hermes") {
    // `chat` must stay first: Hermes's flags belong to the subcommand.
    if (!payload?.resumeSession || launch.args.some((arg) => ["--resume", "-r", "--continue", "-c"].includes(arg))) {
      return { ...launch, nativeSessionId: null, nativeSessionMode: "none" };
    }
    const id = isValidHermesSessionId(payload?.nativeSessionId) ? String(payload.nativeSessionId) : null;
    // `--in` scopes "latest" to this folder; without it Hermes picks the newest
    // session anywhere on the machine.
    const resumeArgs = id ? ["--resume", id] : ["--resume", "latest", "--in", cwd];
    const args = [...launch.args, ...resumeArgs];
    return { ...launch, args, display: [launch.command, ...args].join(" "), nativeSessionId: id, nativeSessionMode: id ? "resume" : "continue" };
  }
  if (!launch || payload?.agent !== "Claude") {
    return { ...launch, nativeSessionId: null, nativeSessionMode: "none" };
  }

  const existingFlag = launch.args.some((arg) =>
    ["--session-id", "--resume", "-r", "--continue", "-c"].includes(arg),
  );
  if (existingFlag) {
    return { ...launch, nativeSessionId: null, nativeSessionMode: "custom" };
  }

  let nativeSessionId = isValidSessionUuid(payload?.nativeSessionId)
    ? String(payload.nativeSessionId)
    : null;
  let nativeArgs = [];
  let nativeSessionMode = "none";

  if (payload?.resumeSession) {
    nativeSessionId = nativeSessionId || findLatestClaudeSessionId(cwd, homeDir);
    nativeArgs = nativeSessionId ? ["--resume", nativeSessionId] : ["--continue"];
    nativeSessionMode = nativeSessionId ? "resume" : "continue";
  } else if (nativeSessionId) {
    nativeArgs = ["--session-id", nativeSessionId];
    // One line: under Windows' cmd a line break ends the command, and every argument after it is lost.
    const name = String(payload?.sessionName || "").replace(/\s+/g, " ").trim();
    if (name) nativeArgs.push("--name", name);
    nativeSessionMode = "create";
  }

  const args = [...nativeArgs, ...launch.args];
  return {
    ...launch,
    args,
    display: [launch.command, ...args].join(" "),
    nativeSessionId,
    nativeSessionMode,
  };
}

/**
 * Claude and Codex accept the first user turn as a positional argument, Hermes
 * as `-q`.
 * Supplying it at process launch is materially safer than typing into a TUI
 * that may still be loading plugins or MCP servers: the CLI owns the prompt
 * from its first instruction and cannot lose it during startup.
 *
 * Other and custom agents keep the terminal-write fallback until their CLI
 * contract is known. The display command intentionally omits user/task text.
 */
function applyInitialPromptLaunch(launch, payload, options = {}) {
  const prompt = String(payload?.initialPrompt || "").trim();
  if (!prompt) return { ...launch, initialPromptMode: "none" };
  // On Windows an npm-installed CLI is a .cmd shim started through cmd, which
  // ends the command at a line break; such a prompt is typed in instead.
  if (options.canPassArgument && !options.canPassArgument(prompt, launch)) {
    return { ...launch, initialPromptMode: "terminal" };
  }
  if (payload?.agent === "Hermes") {
    // On a real TTY `-q` seeds an interactive session rather than answering
    // and exiting. Checked in a PTY on 0.21.5.
    return { ...launch, args: [...launch.args, "-q", prompt], initialPromptMode: "argument" };
  }
  if (!["Claude", "Codex"].includes(payload?.agent)) {
    return { ...launch, initialPromptMode: "terminal" };
  }

  return {
    ...launch,
    args: [...launch.args, prompt],
    initialPromptMode: "argument",
  };
}

/**
 * The conversation a resumed session already holds.
 *
 * `--resume` restores the history inside the agent's own context, but the
 * stream only reports what happens next — so a chat opened on a resumed session
 * renders empty while the agent is plainly aware of everything said before. The
 * CLI keeps that history as newline-delimited records, in the same
 * `{type, message}` shape the stream uses, which is why they can be replayed
 * through the same reducer.
 *
 * `limit` bounds what is read back: a long session is megabytes, and the tail
 * is the part anyone is going to look at.
 */
/**
 * The session file this project is currently being written to.
 *
 * Which file that is can change under a running terminal: a resume that does
 * not take, a compaction that starts a fresh session, a restart. Resolving it
 * once and holding on leaves a follower watching a file nothing appends to any
 * more — the conversation still renders, it just stops moving.
 *
 * `preferredId` wins only while it is still the newest; otherwise the newest
 * file is the live one.
 */
function findActiveClaudeSession(cwd, preferredId, homeDir = os.homedir()) {
  const latest = findLatestClaudeSessionId(cwd, homeDir);
  if (!preferredId || !isValidSessionUuid(preferredId)) return latest;
  // Nothing on disk means no conversation to follow. Handing back the
  // preferred id would name a session that does not exist, and the mirror
  // would report itself as following something.
  if (!latest) return null;
  if (latest === preferredId) return preferredId;
  try {
    const preferredAt = fs.statSync(claudeSessionFile(cwd, preferredId, homeDir)).mtimeMs;
    const latestAt = fs.statSync(claudeSessionFile(cwd, latest, homeDir)).mtimeMs;
    return latestAt > preferredAt ? latest : preferredId;
  } catch {
    return latest;
  }
}

function claudeSessionFile(cwd, sessionId, homeDir = os.homedir()) {
  return path.join(claudeProjectDirectory(cwd, homeDir), `${sessionId}.jsonl`);
}

/**
 * Conversation records appended since `offset` bytes, with the new offset.
 *
 * The file is being appended to by a live CLI, so it is read forward from where
 * the last read stopped rather than re-read whole: a long session is megabytes,
 * and re-sending all of it on every append would be both slow and a stream of
 * duplicates. A trailing partial line is left for next time by rewinding to the
 * last newline — half a record parses as nothing and would otherwise be lost.
 */
function readClaudeSessionSince(cwd, sessionId, offset = 0, { homeDir = os.homedir() } = {}) {
  if (!isValidSessionUuid(sessionId)) return { records: [], offset };
  try {
    const file = claudeSessionFile(cwd, sessionId, homeDir);
    const size = fs.statSync(file).size;
    // Truncated or replaced under us: start again rather than read garbage.
    if (size < offset) return readClaudeSessionSince(cwd, sessionId, 0, { homeDir });
    if (size === offset) return { records: [], offset };

    const handle = fs.openSync(file, "r");
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, offset);
    fs.closeSync(handle);

    const text = buffer.toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) return { records: [], offset };
    const complete = text.slice(0, lastNewline);

    return { records: parseSessionLines(complete.split("\n")), offset: offset + Buffer.byteLength(complete, "utf8") + 1 };
  } catch {
    return { records: [], offset };
  }
}

/**
 * The conversation records in a run of lines.
 *
 * A prompt typed while the agent is busy is queued, and a queued prompt is not
 * a conversation record — it lands as its own operation and becomes a turn only
 * once the agent reaches it. Dropping those is why a queued message appeared in
 * the terminal and nowhere else.
 */
function parseSessionLines(lines) {
  const records = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      continue;
    }
    // Sidechains are subagent work. They belong to a tool call, not to the
    // conversation, and interleaving them reads as the agent talking over itself.
    if (record?.isSidechain) continue;
    if (record?.type === "queue-operation") {
      records.push({ type: record.type, operation: record.operation, content: record.content });
      continue;
    }
    if (record?.type !== "user" && record?.type !== "assistant") continue;
    records.push({ type: record.type, uuid: record.uuid, timestamp: record.timestamp, message: record.message });
  }
  return records;
}

function readClaudeSessionRecords(cwd, sessionId, { homeDir = os.homedir(), limit = 400 } = {}) {
  if (!isValidSessionUuid(sessionId)) return [];
  try {
    const file = claudeSessionFile(cwd, sessionId, homeDir);
    // The tail: a long session is megabytes and the end is the part anyone
    // reads. Same parser as the incremental path, so both agree on what counts.
    return parseSessionLines(fs.readFileSync(file, "utf8").split("\n")).slice(-limit);
  } catch {
    return [];
  }
}

module.exports = {
  findCodexSessionSince,
  applyInitialPromptLaunch,
  applyNativeSessionLaunch,
  claudeProjectDirectory,
  findLatestClaudeSessionId,
  isValidSessionUuid,
  isValidHermesSessionId,
  findHermesSessionId,
  claudeSessionFile,
  findActiveClaudeSession,
  readClaudeSessionRecords,
  readClaudeSessionSince,
};
