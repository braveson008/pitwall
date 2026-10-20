import type { PitwallTask } from "../domain/types";
import type { ValidationResult } from "../domain/contracts";
import { trackerHtmlToMarkdown } from "./markdown";

/**
 * A pull or merge request written the way a careful person writes one.
 *
 * The title carries the ticket key so trackers link it; the description says
 * what changed and why, lists the changes, says how it was checked and points
 * at the ticket. Where the repository has its own template, the template's
 * sections are filled instead, because a team's template is its standard.
 *
 * Nothing here says who or what wrote the change. Agents leave
 * "Generated with …" lines and Co-Authored-By trailers in commit messages and
 * summaries, and those are removed rather than carried into the request.
 */

export interface RequestDraftInput {
  task: Pick<PitwallTask, "identifier" | "title" | "description" | "source" | "completionSummary">;
  /** Commit subjects on the branch, oldest first. */
  commits: string[];
  /** Changed paths, as the branch differs from its base. */
  files: string[];
  checks?: ValidationResult;
  /** The repository's own request template, when it has one. */
  template?: string;
  /** Prose written from the actual change, which outranks what is inferred. */
  written?: WrittenRequest;
}

/** What a writer that read the change said about it. */
export interface WrittenRequest {
  summary: string;
  changes: string[];
  testing: string[];
  commitSubject?: string;
  commitBody?: string;
}

/**
 * Text Pitwall puts on a task when it has nothing better. It describes
 * Pitwall, not the work, and must never become a request's summary.
 */
const PLACEHOLDER_DESCRIPTIONS = [/^imported from connected work\.?$/i, /^no description(?: yet)?\.?$/i];

function isPlaceholder(text: string) {
  const trimmed = String(text || "").trim();
  return !trimmed || PLACEHOLDER_DESCRIPTIONS.some((pattern) => pattern.test(trimmed));
}

export interface RequestDraft {
  title: string;
  body: string;
}

const WATERMARK = [
  /generated (?:with|by|using)\b.*\b(?:claude|codex|gpt|copilot|cursor|gemini|aider|ai|agent|llm)\b/i,
  /\b(?:claude|codex|copilot|cursor|gemini|aider)\s*code\b.*\b(?:generated|written|authored)\b/i,
  /^co-authored-by:/i,
  /^(?:signed-off-by|assisted-by|generated-by):.*\b(?:claude|codex|copilot|gemini|cursor|ai|bot|agent|anthropic|openai)\b/i,
  /noreply@anthropic\.com|users\.noreply\.github\.com.*\b(?:claude|codex|copilot)\b/i,
  /^\s*🤖/u,
];

/** Lines that only say who or what wrote the work. */
export function stripWatermarks(text: string): string {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !WATERMARK.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "[shop-1936] fix(x): Thing" style noise off the front of a commit subject. */
function cleanSubject(subject: string) {
  return stripWatermarks(subject).replace(/\s+/g, " ").trim();
}

/** A summary is the agent's own words only if it reported them; derived ones narrate Pitwall's bookkeeping. */
function reportedSummary(task: RequestDraftInput["task"]) {
  const summary = task.completionSummary;
  if (!summary || summary.source !== "agent") return null;
  return summary;
}

/** Local filesystem paths say nothing to a reviewer and leak a machine's layout. */
function withoutLocalPaths(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/(?:^|\s)(?:\/Users\/|\/home\/|[A-Z]:\\Users\\|~\/Library\/)/.test(line))
    .join("\n")
    .trim();
}

export function requestTitle(task: RequestDraftInput["task"]): string {
  const title = stripWatermarks(task.title).replace(/\s+/g, " ").trim() || "Untitled change";
  const key = String(task.identifier || "").trim().toUpperCase();
  if (!key) return title;
  // A title that already opens with its key is not given it twice.
  const keyPattern = new RegExp(`^\\[?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?[:\\s-]*`, "i");
  return `${key}: ${title.replace(keyPattern, "").trim() || title}`;
}

function firstParagraph(markdown: string, limit = 600) {
  if (isPlaceholder(markdown)) return "";
  const text = withoutLocalPaths(stripWatermarks(trackerHtmlToMarkdown(markdown)));
  const paragraph = text.split(/\n\s*\n/).map((part) => part.trim()).find((part) => part && !/^#/.test(part)) || "";
  return paragraph.length > limit ? `${paragraph.slice(0, limit - 1).trimEnd()}…` : paragraph;
}

interface Sections {
  summary: string;
  changes: string;
  testing: string;
  ticket: string;
}

function sections(input: RequestDraftInput): Sections {
  const { task } = input;
  const reported = reportedSummary(task);
  const written = input.written;
  const clean = (text: string) => withoutLocalPaths(stripWatermarks(text));

  const summary =
    (written ? clean(written.summary) : "") ||
    (reported ? clean(reported.what) : "") ||
    firstParagraph(task.description || "") ||
    requestTitle(task);

  const changeLines: string[] = [];
  for (const line of written?.changes ?? []) {
    const text = clean(line).replace(/^[-*]\s+/, "");
    if (text) changeLines.push(`- ${text}`);
  }
  if (!changeLines.length && reported?.how) {
    const how = withoutLocalPaths(stripWatermarks(reported.how));
    for (const line of how.split(/\r?\n/).map((part) => part.replace(/^[-*]\s+/, "").trim()).filter(Boolean)) {
      changeLines.push(`- ${line}`);
    }
  }
  if (!changeLines.length) {
    const subjects = [...new Set(input.commits.map(cleanSubject).filter(Boolean))];
    for (const subject of subjects.slice(0, 12)) changeLines.push(`- ${subject}`);
  }
  const files = input.files.filter(Boolean);
  if (files.length) {
    const shown = files.slice(0, 15).map((file) => `\`${file}\``).join(", ");
    changeLines.push(`- Files: ${shown}${files.length > 15 ? `, and ${files.length - 15} more` : ""}`);
  }

  const testing: string[] = [];
  const ran = input.checks?.checks.filter((check) => !check.skipped) ?? [];
  for (const check of ran) testing.push(`- \`${check.command}\` — ${check.ok ? "passed" : "failed"}`);
  for (const step of written?.testing ?? []) {
    const text = clean(step).replace(/^(?:[-*]\s+)?(?:\[[ xX]\]\s+)?/, "");
    if (text) testing.push(`- [ ] ${text}`);
  }
  if (!testing.length) testing.push("- [ ] Checked locally");

  const url = task.source?.kind === "mcp" ? task.source.url : undefined;
  const key = String(task.identifier || "").trim().toUpperCase();
  const ticket = url ? `[${key || "Ticket"}](${url})` : key ? key : "";

  return {
    summary,
    changes: changeLines.join("\n") || "- See the commits on this branch",
    testing: testing.join("\n"),
    ticket,
  };
}

// Most specific first: "How to test" is about testing before it is about "how",
// and "What changed" is the changes before it is a "what".
const SECTION_FOR_HEADING: Array<[RegExp, keyof Sections]> = [
  [/\b(?:test|testing|tested|verification|verify|qa)\b/i, "testing"],
  [/\b(?:ticket|issues?|jira|linear|links?|related|references?|closes|fixes)\b/i, "ticket"],
  [/\b(?:changes?|changed|implementation|how|details?)\b/i, "changes"],
  [/\b(?:summary|description|what|overview|context|why|motivation|purpose)\b/i, "summary"],
];

/**
 * The repository's template with Pitwall's facts under each heading it
 * recognises. A section it does not recognise keeps the template's own words —
 * a checklist the team expects ticked by a person is not Pitwall's to tick.
 */
function fillTemplate(template: string, facts: Sections): string {
  const lines = stripWatermarks(template).split(/\r?\n/);
  const out: string[] = [];
  const used = new Set<keyof Sections>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    out.push(line);
    index += 1;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (!heading) continue;
    const key = SECTION_FOR_HEADING.find(([pattern]) => pattern.test(heading[1]))?.[1];
    if (!key || used.has(key) || !facts[key]) continue;

    // The template's placeholder under this heading — comments, blank lines,
    // a lone prompt — gives way to the facts; anything with real structure
    // (a checklist, a table) is kept after them.
    const body: string[] = [];
    while (index < lines.length && !/^#{1,6}\s+/.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    const kept = body.filter((part) => /^\s*(?:[-*]\s+\[[ xX]\]|\|)/.test(part));
    out.push("", facts[key], ...(kept.length ? ["", ...kept] : []), "");
    used.add(key);
  }
  return out
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function composeRequest(input: RequestDraftInput): RequestDraft {
  const facts = sections(input);
  const title = requestTitle(input.task);
  if (input.template?.trim()) return { title, body: fillTemplate(input.template, facts) };

  const body = [
    "## Summary",
    "",
    facts.summary,
    "",
    "## Changes",
    "",
    facts.changes,
    "",
    "## How to test",
    "",
    facts.testing,
    ...(facts.ticket ? ["", "## Ticket", "", facts.ticket] : []),
  ].join("\n");
  return { title, body: stripWatermarks(body) };
}

/**
 * The message for committing work left uncommitted: the ticket key and a
 * subject in the imperative, then why. A conventional message — the team's
 * history reads like any other commit — and nothing naming what helped.
 */
export function commitMessage(task: RequestDraftInput["task"], written?: WrittenRequest): string {
  const key = String(task.identifier || "").trim().toUpperCase();
  const fallback = stripWatermarks(task.title).replace(/^(?:\[[^\]]*\]\s*)+/, "").replace(/\s+/g, " ").trim();
  let subject = stripWatermarks(written?.commitSubject || "").replace(/\s+/g, " ").replace(/\.$/, "").trim() || fallback || "Update";
  if (key) {
    const keyPattern = new RegExp(`^\\[?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]?[:\\s-]*`, "i");
    subject = `${key}: ${subject.replace(keyPattern, "")}`;
  }
  const body = withoutLocalPaths(stripWatermarks(written?.commitBody || ""));
  return body ? `${subject}\n\n${body}` : subject;
}
