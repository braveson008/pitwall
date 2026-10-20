/**
 * How a tool call and a run of tool calls are presented.
 *
 * A call's own arguments are mostly not information. Every Bash command in a
 * worktree session starts with the same eighty characters of `cd "<worktree>"
 * &&`, so a column of them says nothing while filling the width, and truncation
 * lands exactly where the interesting part begins. What a reader wants is the
 * one field that says what this call does — the command, the file, the pattern —
 * with the boilerplate gone.
 */

import type { TranscriptEntry } from "./agentStream";

export type ToolSummary = {
  /** The part worth reading. */
  detail: string;
  /** How to set it: a shell command, a path, or ordinary text. */
  kind: "command" | "path" | "text";
};

const PATH_FIELDS = ["file_path", "path", "notebook_path"];
const TEXT_FIELDS = ["description", "prompt", "query", "url", "pattern", "command"];

/**
 * Drops the setup a command carries before it does anything.
 *
 * Every command in a worktree session opens with the same `cd "<worktree>" &&`,
 * often after a `SCRATCH="…"` or two, and none of it says what the command is
 * for. Stripped one form at a time until nothing more matches, because they
 * chain in any order — and a leftover separator is stripped too: taking
 * `SCRATCH="/x"` out of `SCRATCH="/x" && cd …` used to leave a row that began
 * with a bare `&&`.
 */
export function stripCommandPreamble(command: string) {
  const original = command.trim();
  let text = original;
  const forms = [
    // cd <path> — quoted or not
    /^cd\s+(?:"[^"]*"|'[^']*'|\S+)/,
    // VAR=value
    /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)/,
    // a separator left behind by either of the above
    /^(?:&&|;)/,
  ];

  for (;;) {
    const before = text;
    for (const form of forms) text = text.replace(form, "").trimStart();
    if (text === before) break;
  }

  // A command that was only setup still has to say something.
  return text || original;
}

/** A path shown relative to the session's own directory. */
export function relativePath(value: string, cwd?: string) {
  const path = value.trim();
  if (cwd && path.startsWith(cwd)) {
    const rest = path.slice(cwd.length).replace(/^\/+/, "");
    if (rest) return rest;
  }
  return path;
}

export function summariseTool(name: string, input: unknown, cwd?: string): ToolSummary {
  const fields = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const command = fields.command;
  if (typeof command === "string" && command.trim()) {
    return { detail: stripCommandPreamble(command), kind: "command" };
  }

  for (const field of PATH_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value.trim()) {
      return { detail: relativePath(value, cwd), kind: "path" };
    }
  }

  for (const field of TEXT_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value.trim()) return { detail: value.trim(), kind: "text" };
  }

  // Nothing recognised: say the tool's name rather than a count of arguments.
  // "+1" told the reader there was another field, which is not information.
  return { detail: "", kind: "text" };
}

export type TranscriptGroup =
  | { kind: "entry"; id: string; entry: TranscriptEntry }
  | { kind: "tools"; id: string; tools: Extract<TranscriptEntry, { kind: "tool" }>[]; failed: number; running: boolean };

/**
 * Runs of consecutive tool calls become one group.
 *
 * Six shell rows between two sentences is what made a session unreadable: the
 * prose a reader is following gets pushed apart by work they only need on
 * demand. Collapsed, the thread reads as what the agent said, with the work
 * available in one place — and a group can state up front that something in it
 * failed, which a row of identical lines cannot.
 */
export function groupTranscript(entries: TranscriptEntry[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = [];
  for (const entry of entries) {
    if (entry.kind !== "tool") {
      groups.push({ kind: "entry", id: entry.id, entry });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === "tools") {
      last.tools.push(entry);
      if (entry.state === "error") last.failed += 1;
      if (entry.state === "running") last.running = true;
      continue;
    }
    groups.push({
      kind: "tools",
      id: entry.id,
      tools: [entry],
      failed: entry.state === "error" ? 1 : 0,
      running: entry.state === "running",
    });
  }
  return groups;
}

/** What a collapsed run of calls is called. */
export function describeToolGroup(group: Extract<TranscriptGroup, { kind: "tools" }>) {
  const count = group.tools.length;
  if (count === 1) return group.tools[0].name;
  const names = new Set(group.tools.map((tool) => tool.name));
  const noun = names.size === 1 ? `${[...names][0]} calls` : "tool calls";
  return `${count} ${noun}`;
}

export type TranscriptTurn = {
  id: string;
  /** Who the turn belongs to. */
  role: "you" | "agent";
  /** When it started, if the records said. */
  at?: string;
  groups: TranscriptGroup[];
};

/**
 * The conversation as turns rather than as a stream of events.
 *
 * Without this everything sits at one level — prose, thinking and shell rows all
 * equal — so there is no visible boundary between what was asked and what came
 * back. A reader has to infer the shape of the conversation from its content,
 * which is the difference between reading a chat and reading a log.
 *
 * A turn starts when the user speaks; everything after belongs to the agent
 * until they speak again.
 */
export function groupIntoTurns(entries: TranscriptEntry[]): TranscriptTurn[] {
  const turns: Array<{ id: string; role: TranscriptTurn["role"]; at?: string; entries: TranscriptEntry[] }> = [];

  for (const entry of entries) {
    const role: TranscriptTurn["role"] = entry.kind === "user" ? "you" : "agent";
    const last = turns[turns.length - 1];
    // The user speaking always opens a turn, even after another user turn: two
    // messages in a row are two things said, not one.
    if (!last || last.role !== role || entry.kind === "user") {
      turns.push({ id: entry.id, role, at: entry.at, entries: [entry] });
      continue;
    }
    if (!last.at && entry.at) last.at = entry.at;
    last.entries.push(entry);
  }

  // Grouped once per turn at the end rather than on every entry, so a long
  // session costs one pass instead of one per record.
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    at: turn.at,
    groups: groupTranscript(turn.entries),
  }));
}
