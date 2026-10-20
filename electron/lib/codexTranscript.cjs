// A Codex session, read back as a conversation.
//
// Codex writes every session to a rollout file as newline-delimited JSON: the
// user's turns, the assistant's answers, its reasoning summaries and every tool
// call with its output. That file is the CLI's own record of what happened, so
// reading it cannot disagree with the terminal the way a second live process
// can — it is not a second opinion, it is the same one.
//
// Reduced into the entries the transcript already draws for Claude, so one view
// serves both agents.

/** Turns Codex's content arrays into text. */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : String(part?.text ?? "")))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Turns Codex's reasoning summaries into one block.
 *
 * Each summary is a bolded heading of its own — "**Planning the inspection**",
 * "**Confirming the approach**" — so they are joined as separate lines rather
 * than run together into a sentence that was never written.
 */
function summaryText(summary) {
  if (!Array.isArray(summary)) return "";
  return summary.map((part) => String(part?.text ?? "").trim()).filter(Boolean).join("\n");
}

/**
 * Whether a message is one a person wrote.
 *
 * Codex records three roles. `developer` is the harness talking — memory
 * preambles, tool policy, the instructions Pitwall itself supplied — and
 * showing it as though the user had typed it is the difference between a
 * transcript and a transcript you can trust.
 */
function isVisibleRole(role) {
  return role === "user" || role === "assistant";
}

/**
 * The state of a tool call, from Codex's own status plus whether its output
 * ever arrived. A call with no output is still running, however it was marked.
 */
function toolState(status, hasOutput) {
  if (!hasOutput) return "running";
  return String(status || "").toLowerCase() === "failed" ? "error" : "ok";
}

/**
 * One rollout file, reduced to transcript entries.
 *
 * Tool results arrive as their own record, after the call and possibly far
 * after it, so calls are held by `call_id` and filled in when their output
 * turns up — matched by id rather than by position, because interleaved calls
 * do not come back in order.
 */
function parseCodexRollout(lines, { limit = 400 } = {}) {
  const entries = [];
  const callsById = new Map();

  for (const line of Array.isArray(lines) ? lines : String(lines ?? "").split("\n")) {
    const raw = String(line ?? "").trim();
    if (!raw) continue;

    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      continue;
    }
    if (record?.type !== "response_item") continue;

    const payload = record.payload ?? {};
    const at = String(record.timestamp ?? "");

    if (payload.type === "message") {
      if (!isVisibleRole(payload.role)) continue;
      const text = contentText(payload.content);
      if (!text) continue;
      entries.push({
        kind: payload.role === "user" ? "user" : "text",
        id: String(payload.id ?? `msg-${entries.length}`),
        text,
        at,
      });
      continue;
    }

    if (payload.type === "reasoning") {
      const text = summaryText(payload.summary);
      // Reasoning without a summary is an encrypted blob and nothing else.
      if (!text) continue;
      entries.push({ kind: "thinking", id: String(payload.id ?? `rs-${entries.length}`), text, at });
      continue;
    }

    if (payload.type === "custom_tool_call" || payload.type === "function_call") {
      const callId = String(payload.call_id ?? payload.id ?? "");
      const entry = {
        kind: "tool",
        id: String(payload.id ?? (callId || `tool-${entries.length}`)),
        name: String(payload.name ?? "tool"),
        input: payload.input ?? payload.arguments ?? null,
        state: toolState(payload.status, false),
        result: "",
        at,
      };
      if (callId) callsById.set(callId, entry);
      entries.push(entry);
      continue;
    }

    if (payload.type === "custom_tool_call_output" || payload.type === "function_call_output") {
      const callId = String(payload.call_id ?? "");
      const call = callsById.get(callId);
      if (!call) continue;
      call.result = contentText(payload.output);
      call.state = toolState(payload.status ?? "completed", true);
    }
  }

  // The tail. A long session is megabytes and the end is the part anyone reads.
  return entries.slice(-limit);
}

/**
 * The `cwd` a rollout was recorded in.
 *
 * Rollouts are filed by date rather than by project, so the only way to know
 * which ones belong to a repository is to open them and look.
 */
function rolloutCwd(firstLines) {
  for (const line of Array.isArray(firstLines) ? firstLines : []) {
    const raw = String(line ?? "").trim();
    if (!raw) continue;
    try {
      const record = JSON.parse(raw);
      if (record?.type === "session_meta") return String(record.payload?.cwd ?? "");
    } catch {
      // A partial first line is not a reason to give up on the file.
    }
  }
  return "";
}

/**
 * The newest Codex rollout recorded in a directory.
 *
 * Codex files rollouts by date rather than by project, so there is no path to
 * look under — every candidate has to be opened and asked where it ran. Newest
 * first, and only the header is read, so the search stops at the first match
 * rather than parsing megabytes of transcript to find out it was the wrong one.
 *
 * `scanLimit` bounds the work: someone with a year of sessions has thousands of
 * files, and a session Pitwall cares about was written minutes ago.
 */
function findLatestCodexRollout(cwd, { root, fs: fileSystem, path: pathModule, scanLimit = 200 } = {}) {
  const target = String(cwd || "");
  if (!target || !root) return null;

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
      const full = pathModule.join(directory, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          files.push({ file: full, modifiedAt: fileSystem.statSync(full).mtimeMs });
        } catch {
          // Gone between the listing and the stat.
        }
      }
    }
  };
  walk(root, 0);

  files.sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const candidate of files.slice(0, scanLimit)) {
    try {
      // The header is the first record. Reading the whole file to find it would
      // mean parsing every rejected candidate in full.
      const head = fileSystem.readFileSync(candidate.file, "utf8").split("\n", 3);
      if (rolloutCwd(head) === target) return candidate.file;
    } catch {
      // Unreadable is the same as not a match.
    }
  }

  return null;
}

module.exports = {
  parseCodexRollout,
  rolloutCwd,
  findLatestCodexRollout,
  contentText,
  summaryText,
  isVisibleRole,
  toolState,
};
