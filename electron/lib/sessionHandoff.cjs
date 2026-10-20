// Handing a session from one agent to another.
//
// The outgoing agent's conversation is on disk in its CLI's own record; the
// incoming agent cannot read that format, and pasting it into the terminal
// would bury the one instruction that matters under pages of history. So it is
// written once, as a file in the worktree, and the new agent is pointed at it.

const fs = require("node:fs");
const path = require("node:path");

const HANDOFF_DIR = ".pitwall";
const TOOL_LINE_MAX = 160;
const TEXT_MAX = 4000;

function clip(text, max) {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function toolSummary(name, input) {
  const detail = typeof input === "string" ? input : input == null ? "" : JSON.stringify(input);
  return clip(oneLine(`${name}${detail ? ` ${detail}` : ""}`), TOOL_LINE_MAX);
}

/** Claude's protocol records, as turns. */
function claudeTurns(records) {
  const turns = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.type !== "user" && record?.type !== "assistant") continue;
    const content = record.message?.content;
    if (typeof content === "string") {
      if (content.trim()) turns.push({ role: record.type === "user" ? "user" : "agent", text: content });
      continue;
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type === "text" && String(part.text ?? "").trim()) {
        turns.push({ role: record.type === "user" ? "user" : "agent", text: part.text });
      } else if (part?.type === "tool_use") {
        turns.push({ role: "tool", text: toolSummary(part.name ?? "tool", part.input) });
      }
      // Tool results are the tool's output, not the conversation; the call says what was done.
    }
  }
  return turns;
}

/** Codex's rollout, already reduced to transcript entries, as turns. */
function codexTurns(entries) {
  const turns = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.kind === "user") turns.push({ role: "user", text: entry.text });
    else if (entry?.kind === "text") turns.push({ role: "agent", text: entry.text });
    else if (entry?.kind === "tool") turns.push({ role: "tool", text: toolSummary(entry.name, entry.input) });
  }
  return turns;
}

/**
 * The handoff, as the incoming agent reads it.
 *
 * The first instruction is kept whatever the cap, because it is what the
 * session is for; the rest is the tail, because the end is where the work is.
 */
function buildHandoff({ fromAgent, toAgent, task, turns = [], gitStatus = "", diffStat = "", maxTurns = 40 }) {
  const firstUser = turns.find((turn) => turn.role === "user");
  const tail = turns.slice(-maxTurns);
  const dropped = turns.length - tail.length;
  const label = { user: "Person", agent: fromAgent, tool: "Tool" };

  const lines = [
    `# Handoff from ${fromAgent} to ${toAgent}`,
    "",
    `You are taking over this session from ${fromAgent}. The worktree, the branch and any uncommitted changes are exactly as ${fromAgent} left them.`,
    "Read this, check the worktree, then wait for the person's next instruction.",
    "",
  ];
  if (task?.title) {
    lines.push("## Task", "", [task.identifier ? `${task.identifier.toUpperCase()}: ` : "", task.title].join(""));
    if (task.description) lines.push("", clip(task.description, TEXT_MAX));
    lines.push("");
  }
  if (firstUser && !tail.includes(firstUser)) {
    lines.push("## How the session started", "", clip(firstUser.text, TEXT_MAX), "");
  }
  lines.push("## Conversation so far", "");
  if (turns.length === 0) {
    lines.push(`${fromAgent}'s conversation could not be read. Rely on the worktree and ask the person what to do next.`, "");
  } else {
    if (dropped > 0) lines.push(`(${dropped} earlier ${dropped === 1 ? "entry" : "entries"} left out.)`, "");
    for (const turn of tail) {
      lines.push(turn.role === "tool" ? `- ${turn.text}` : `**${label[turn.role]}:** ${clip(turn.text, TEXT_MAX)}`, "");
    }
  }
  // Porcelain status leads with a column of spaces that carries meaning, so only blank lines are trimmed.
  const block = (text) => String(text ?? "").replace(/^\n+|\s+$/g, "");
  lines.push("## Worktree", "", "```", block(gitStatus) || "clean", "```", "");
  if (block(diffStat)) lines.push("Uncommitted changes:", "", "```", block(diffStat), "```", "");
  return lines.join("\n");
}

/** A Codex rollout by its conversation id, which Codex puts in the file name. */
function findCodexRolloutById(id, root, { fileSystem = fs } = {}) {
  if (!id || !/^[\w-]+$/.test(id)) return "";
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fileSystem.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(id)) return full;
    }
  }
  return "";
}

/**
 * Writes the next handoff file and keeps the folder out of git.
 *
 * `excludeFile` is git's own path for it (`git rev-parse --git-path
 * info/exclude`), which in a worktree is the shared one, not `.git/info`.
 */
function writeHandoffFile(workspacePath, markdown, { excludeFile = "", fileSystem = fs } = {}) {
  const dir = path.join(workspacePath, HANDOFF_DIR);
  fileSystem.mkdirSync(dir, { recursive: true });
  const taken = new Set(fileSystem.readdirSync(dir));
  let n = 1;
  while (taken.has(`handoff-${n}.md`)) n += 1;
  const relative = `${HANDOFF_DIR}/handoff-${n}.md`;
  fileSystem.writeFileSync(path.join(workspacePath, relative), markdown);
  if (excludeFile) {
    let current = "";
    try { current = fileSystem.readFileSync(excludeFile, "utf8"); } catch { /* git creates it lazily */ }
    if (!current.split("\n").some((line) => line.trim() === `/${HANDOFF_DIR}/`)) {
      fileSystem.mkdirSync(path.dirname(excludeFile), { recursive: true });
      fileSystem.appendFileSync(excludeFile, `${current && !current.endsWith("\n") ? "\n" : ""}/${HANDOFF_DIR}/\n`);
    }
  }
  return relative;
}

module.exports = { buildHandoff, claudeTurns, codexTurns, findCodexRolloutById, writeHandoffFile, HANDOFF_DIR };
