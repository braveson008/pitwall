/**
 * What the council already knows about the repository, carried between turns.
 *
 * A handoff says what was decided. It does not say where anything is, so every
 * member that picks the work up starts by finding the codebase again: the same
 * greps, the same files opened, the same conventions rediscovered. On a
 * five-turn council the repository gets explored five times, and the exploring
 * is most of what a turn costs — the Architect has already read the files the
 * Implementer is about to go looking for.
 *
 * So the contract between members is extended. Alongside "what I did" a turn
 * hands over a working set: the paths that matter and what is in them, the
 * commands that build and test this project, the conventions it actually
 * follows, and the questions nobody has answered yet. It accumulates, so the
 * fifth member inherits everything the first four found.
 *
 * ## Why this is parsed out of prose rather than requested as JSON
 *
 * Members are CLIs driving a model; asking for a JSON block gets one most of
 * the time and something almost-JSON the rest, and a turn whose handoff fails
 * to parse is a turn lost. Markdown lists are what they already write. A
 * section that is missing or malformed costs its own contents and nothing else.
 */

/** One path the council has already looked at, and what it found there. */
export interface WorkingSetFile {
  path: string;
  /** What is in it and why it matters — the thing worth not rediscovering. */
  note: string;
  /** The turn it was last described on, so later readings win. */
  turn: number;
  /** Which member put it there, so a wrong note can be traced. */
  by: string;
}

export interface WorkingSet {
  files: WorkingSetFile[];
  /** Build, test and run commands, verified by whoever ran them. */
  commands: string[];
  /** How this repository does things, as observed rather than assumed. */
  conventions: string[];
  /** Raised and not yet answered. Cleared by whoever answers them. */
  openQuestions: string[];
  /** Explicitly accepted decisions, rather than proposals inferred from prose. */
  decisions?: string[];
  /** Explicit resolutions prevent a later repeated question from reopening it. */
  resolvedQuestions?: string[];
}

export const emptyWorkingSet = (): WorkingSet => ({
  files: [],
  commands: [],
  conventions: [],
  openQuestions: [],
  decisions: [],
  resolvedQuestions: [],
});

/** Older snapshots lack decision fields; malformed newer fields must not enter prompts. */
export function isWorkingSet(value: unknown): value is WorkingSet {
  if (!value || typeof value !== "object") return false;
  const set = value as WorkingSet;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every((item) => typeof item === "string");
  return Array.isArray(set.files) && set.files.every((file) =>
    file && typeof file.path === "string" && typeof file.note === "string" &&
    Number.isFinite(file.turn) && typeof file.by === "string",
  ) && strings(set.commands) && strings(set.conventions) && strings(set.openQuestions) &&
    (set.decisions === undefined || strings(set.decisions)) &&
    (set.resolvedQuestions === undefined || strings(set.resolvedQuestions));
}

/**
 * Bounds. The working set is injected into every turn's prompt, so it is a
 * recurring cost: unbounded, a long council pays for a hundred-line file list
 * on every hop, which is the problem this exists to solve.
 */
const MAX_FILES = 40;
const MAX_ITEMS = 12;
const MAX_NOTE = 220;

const HEADINGS: Array<{ key: keyof WorkingSet; re: RegExp }> = [
  { key: "files", re: /^#{1,6}\s*working[\s-]*set\b/i },
  { key: "commands", re: /^#{1,6}\s*commands?\b/i },
  { key: "conventions", re: /^#{1,6}\s*conventions?\b/i },
  { key: "openQuestions", re: /^#{1,6}\s*open\s*questions?\b/i },
  { key: "decisions", re: /^#{1,6}\s*(?:accepted\s+)?decisions?\s*:?\s*$/i },
  { key: "resolvedQuestions", re: /^#{1,6}\s*resolved\s*questions?\b/i },
];

/** A markdown list item, with the bullet or number removed. */
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

const clean = (value: string) =>
  value
    .replace(/^`+|`+$/g, "")
    .replace(/\*\*/g, "")
    .trim();

/** Match an explicit resolution despite harmless Markdown or punctuation changes. */
const itemKey = (value: string) => clean(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[?.!]+$/, "");

/** An optional stable label lets a later decision explicitly replace its predecessor. */
const decisionKey = (value: string) => {
  const label = value.match(/^\[([\w.-]+)\]/)?.[1];
  return label ? `id:${label.toLowerCase()}` : `text:${itemKey(value)}`;
};

/**
 * Splits "path — note" into its two halves.
 *
 * The dash forms are tried before the colon, and the colon is only a separator
 * when whitespace follows it. Otherwise `src/App.tsx:3752 — where councils
 * start` splits at the line number and the next member is sent to `src/App.tsx`
 * with "3752 — where councils start" as its description.
 */
const DASH_SEPARATED = /^(\S+)\s+(?:[—–]|--)\s+(.*)$/;
const COLON_SEPARATED = /^(\S+):\s+(.*)$/;

function splitEntry(line: string): { path: string; note: string } | null {
  const match = line.match(DASH_SEPARATED) ?? line.match(COLON_SEPARATED);
  const path = clean(match ? match[1] : line.split(/\s+/)[0] ?? "");
  if (!path || !looksLikePath(path)) return null;
  return { path, note: clean(match?.[2] ?? "").slice(0, MAX_NOTE) };
}

/**
 * Whether a token is a path rather than a sentence.
 *
 * Without this a prose bullet under the heading becomes a file entry, and the
 * next member is told to open a path that does not exist — worse than telling
 * it nothing, because it will go looking.
 */
function looksLikePath(token: string): boolean {
  if (!token || token.length > 200) return false;
  if (/\s/.test(token)) return false;
  return /[/\\]/.test(token) || /\.[A-Za-z0-9]{1,8}(?::\d+)?$/.test(token);
}

/**
 * Reads a working set out of one handoff.
 *
 * Only the sections it recognises; everything else in the handoff is prose for
 * the members and is left alone.
 */
export function parseWorkingSet(handoff: string, turn: number, by: string): WorkingSet {
  const result = emptyWorkingSet();
  let section: keyof WorkingSet | null = null;
  let fence: string | null = null;

  for (const raw of String(handoff || "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const explicit = line.trim().replace(BULLET, "$1").match(/^(DECISION|RESOLVED)\s*:\s*(.+)$/i);
    if (explicit) {
      const list = explicit[1].toUpperCase() === "DECISION" ? result.decisions! : result.resolvedQuestions!;
      const item = clean(explicit[2]).slice(0, MAX_NOTE);
      if (item) list.push(item);
      continue;
    }
    if (/^#{1,6}\s/.test(line.trim())) {
      section = HEADINGS.find((heading) => heading.re.test(line.trim()))?.key ?? null;
      continue;
    }
    if (!section) continue;
    const bullet = line.match(BULLET);
    if (!bullet) continue;
    const item = clean(bullet[1]);
    if (!item) continue;
    if (section === "files") {
      const entry = splitEntry(item);
      if (entry) result.files.push({ ...entry, turn, by });
    } else {
      const list = result[section] as string[];
      if (!list.includes(item)) list.push(item.slice(0, MAX_NOTE));
    }
  }
  return mergeWorkingSet(emptyWorkingSet(), result);
}

/**
 * Folds a turn's findings into what the council already knew.
 *
 * A later reading of a file replaces an earlier one — the member that just had
 * it open knows more than the one that skimmed it three turns ago — but only
 * when it actually says something. An entry with no note does not overwrite a
 * useful one with silence.
 */
export function mergeWorkingSet(base: WorkingSet, next: WorkingSet): WorkingSet {
  const files = new Map<string, WorkingSetFile>();
  for (const file of base.files) files.set(file.path, file);
  for (const file of next.files) {
    const existing = files.get(file.path);
    if (existing && existing.turn > file.turn) continue;
    if (existing && !file.note && existing.note) {
      files.set(file.path, { ...existing, turn: file.turn, by: file.by });
    } else {
      files.set(file.path, file);
    }
  }

  const join = (a: string[], b: string[], identify = itemKey) => {
    const out = new Map<string, string>();
    for (const item of [...a, ...b]) {
      const value = item.trim().slice(0, MAX_NOTE);
      if (!value) continue;
      const key = identify(value);
      out.delete(key);
      out.set(key, value);
    }
    return [...out.values()].slice(-MAX_ITEMS);
  };
  const resolvedQuestions = join(base.resolvedQuestions ?? [], next.resolvedQuestions ?? []);
  const resolved = new Set(resolvedQuestions.map(itemKey));

  return {
    // Most recently described first: that is the part of the map being worked
    // on, and it is what survives the cap.
    files: [...files.values()].sort((a, b) => b.turn - a.turn).slice(0, MAX_FILES),
    commands: join(base.commands, next.commands),
    conventions: join(base.conventions, next.conventions),
    // Silence is not a resolution. Only an explicit resolved question removes it.
    openQuestions: join(base.openQuestions, next.openQuestions).filter((question) => !resolved.has(itemKey(question))),
    decisions: join(base.decisions ?? [], next.decisions ?? [], decisionKey),
    resolvedQuestions,
  };
}

export function isEmptyWorkingSet(set: WorkingSet | null | undefined): boolean {
  if (!set) return true;
  return (
    set.files.length === 0 &&
    set.commands.length === 0 &&
    set.conventions.length === 0 &&
    set.openQuestions.length === 0 &&
    !set.decisions?.length &&
    !set.resolvedQuestions?.length
  );
}

/** The working set as the file every member can open. */
export function renderWorkingSet(set: WorkingSet, taskTitle = ""): string {
  const lines: string[] = ["# Working set"];
  if (taskTitle) lines.push("", `Task: ${taskTitle}`);
  lines.push(
    "",
    "What this council has already established about the repository. Read this",
    "before exploring. These are member observations; inspect the current code",
    "you change and check recorded commands against their output. Add discoveries",
    "to your handoff so nobody has to find them twice.",
  );

  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push("", `## ${title}`, "", ...items.map((item) => `- ${item}`));
  };

  section(
    "Files",
    set.files.map((file) => (file.note ? `\`${file.path}\` — ${file.note}` : `\`${file.path}\``)),
  );
  section("Commands", set.commands);
  section("Conventions", set.conventions);
  section("Accepted decisions", set.decisions ?? []);
  section("Open questions", set.openQuestions);
  section("Resolved questions", set.resolvedQuestions ?? []);

  if (isEmptyWorkingSet(set)) {
    lines.push("", "Nothing established yet — this is the first turn.");
  }
  return `${lines.join("\n")}\n`;
}

/** How much of the working set is inlined into a prompt. */
const PROMPT_FILES = 18;

/**
 * The working set as a sentence inside a turn's prompt.
 *
 * Inlined rather than only referenced by path, because a member told to read a
 * file often does not, and then explores the repository anyway — which is the
 * behaviour this is meant to stop. The file stays as the complete version.
 */
export function formatWorkingSetForPrompt(set: WorkingSet | null | undefined, filePath: string): string {
  if (isEmptyWorkingSet(set) || !set) return "";
  const parts: string[] = [];

  if (set.files.length) {
    const shown = set.files.slice(0, PROMPT_FILES);
    const rest = set.files.length - shown.length;
    parts.push(
      ` The council has already read these files, so open them directly instead of searching for them: ${shown
        .map((file) => (file.note ? `${file.path} (${file.note})` : file.path))
        .join("; ")}${rest > 0 ? `; and ${rest} more in ${filePath}` : ""}.`,
    );
  }
  if (set.commands.length) {
    parts.push(` Commands already established for this project: ${set.commands.join("; ")}.`);
  }
  if (set.conventions.length) {
    parts.push(` Conventions this repository follows, already observed: ${set.conventions.join("; ")}.`);
  }
  if (set.decisions?.length) {
    parts.push(` Accepted decisions carried from explicit handoff decisions: ${set.decisions.join("; ")}.`);
  }
  if (set.openQuestions.length) {
    parts.push(` Still unanswered: ${set.openQuestions.join("; ")}.`);
  }
  parts.push(
    ` Do not re-derive unchanged findings — they are in ${filePath} as well. Verify the current source before changing it and refresh anything contradicted by code or the user's instructions. Explore what is missing,` +
      " and put whatever you find into your handoff's Working set so the next member inherits it.",
  );
  return parts.join("");
}

/**
 * The part of the handoff contract that asks for the working set.
 *
 * Kept as its own string because it is appended to several different prompts —
 * a normal turn, a nudge, the opening debate — and they must ask for the same
 * shape or the parser sees a different one each time.
 */
export function workingSetContract(isFirstTurn: boolean): string {
  const lede = isFirstTurn
    ? " You are the first member to look at this repository, so the map you build is the one everyone after you works from."
    : "";
  return (
    `${lede} In that same handoff file include these sections, as markdown lists:` +
    " `## Working set` — every file you opened or that a later member will need, one per line as" +
    " `path — what is in it and why it matters`;" +
    " `## Commands` — the build, test and run commands you actually ran, verbatim;" +
    " `## Conventions` — how this repository does things, as you observed it rather than as you would expect;" +
    " `## Decisions` — explicitly accepted choices only, with the source or evidence that settled them; use an optional stable [id] to replace an earlier decision with that id;" +
    " `## Open questions` — anything you could not settle." +
    " `## Resolved questions` — repeat the exact question text that was answered; omission does not resolve a question." +
    " Standalone `DECISION:` and `RESOLVED:` lines have the same meaning. Keep proposals in a separate section." +
    " State the next assignment and include actual verification commands, outcomes, and output references in the handoff." +
    " These carry forward to every later turn, so a file you leave out is one the next member has to find again."
  );
}
