import type { BraveliProviderId } from "../domain/types";
import type { ImplementationContract, RiskLevel } from "../domain/contracts";
import type { StageContext } from "./stageContext";

/**
 * Where a contract comes from.
 *
 * Everything downstream of this file — the implementer's brief, the reviewer's
 * criteria, the fix contract, the routing decision — reads a contract that
 * until now nothing produced. The types existed and the loop knew what to do
 * with one; there was no author.
 *
 * ## Why the architect writes a file rather than answers in the terminal
 *
 * The same reason the council relay hands off through files. A contract read
 * out of scrolled-back terminal output is a contract subject to whatever else
 * the agent decided to print — banners, tool traces, a summary it repeated.
 * A file has one writer and one reader, and either it is there or it is not.
 *
 * ## Why an unreadable answer produces no contract
 *
 * The same rule as the QA verdict, for the same reason. A half-parsed contract
 * is worse than none: it sends an implementer off with two of the four things
 * it needed and produces work the reviewer rejects for a reason nobody wrote
 * down. If the architect's answer cannot be read, the run stops and says so.
 */

const LINE = /^([A-Z][A-Z-]*)\s*:\s*(.*)$/;

const SECTIONS = [
  "TASK",
  "OBJECTIVE",
  "FILES",
  "REQUIRED-CHANGES",
  "CONSTRAINTS",
  "DO-NOT-CHANGE",
  "ACCEPTANCE-CRITERIA",
  "REQUIRED-TESTS",
  "ASSUMPTIONS",
  "RISK",
] as const;

/** Where the architect leaves its contract, relative to the project. */
export function contractFile(runId: string, revision = 1): string {
  return `.braveli/contracts/${runId}/contract-${revision}.md`;
}

/** Where a reviewer leaves its verdict. Numbered, so rounds do not overwrite. */
export function verdictFile(runId: string, round: number): string {
  return `.braveli/contracts/${runId}/verdict-${round}.md`;
}

/**
 * Tells a stage to put its answer in a file as well as on screen.
 *
 * Appended by the driver rather than built into the briefs, so the briefs stay
 * usable on their own. Reading a verdict out of terminal scrollback means
 * competing with banners, tool traces and whatever else the agent decided to
 * print; a file has one writer and one reader.
 */
export function alsoWriteTo(prompt: string, filePath: string): string {
  return `${prompt}\n\nWRITE YOUR ANSWER TO\n${filePath}\nExactly the shape above, nothing else in the file.`;
}

/**
 * The architect's brief.
 *
 * It is told the request and where to write the answer, and explicitly told
 * not to implement anything — an architect that starts editing files has
 * spent the expensive model on the work the cheap one was going to do.
 */
export function architectContext({
  request,
  filePath,
  repoNotes = "",
}: {
  request: string;
  filePath: string;
  repoNotes?: string;
}): StageContext {
  const sections = [
    `REQUEST\n${request}`,
    repoNotes ? `WHAT IS ALREADY HERE\n${repoNotes}` : "",
    "YOUR JOB\n" +
      [
        "- Read enough of this repository to specify the change precisely.",
        "- Decide the approach. The implementer will not make architectural decisions.",
        "- Write the contract to the file named below. Do not implement anything.",
      ].join("\n"),
    `WRITE THE CONTRACT TO\n${filePath}`,
    // The acceptance criteria are the load-bearing part: they are what the
    // reviewer checks against, and a contract without them cannot be reviewed
    // at all, only admired.
    "FORMAT — use these exact labels, one per line, lists as one item per line:\n" +
      [
        "TASK: one line naming the change",
        "OBJECTIVE: what the user actually wants, in your words",
        "FILES: each file you expect to be touched",
        "REQUIRED-CHANGES: each change, specific enough to implement without guessing",
        "CONSTRAINTS: anything the implementation must not break",
        "DO-NOT-CHANGE: files or behaviour to leave alone, or 'none'",
        "ACCEPTANCE-CRITERIA: each criterion, each independently checkable",
        "REQUIRED-TESTS: tests that must exist afterwards, or 'none'",
        "ASSUMPTIONS: anything you assumed that someone might dispute, or 'none'",
        "RISK: trivial, normal or high",
      ].join("\n"),
    "RULES\n" +
      [
        "- Be specific. 'Handle errors properly' is not a required change.",
        "- Every acceptance criterion must be checkable against the diff by someone who did not write it.",
        "- If the request is ambiguous, state the reading you chose under ASSUMPTIONS rather than asking.",
        "- Do not edit any file except the contract.",
      ].join("\n"),
  ];
  const prompt = sections.filter(Boolean).join("\n\n");
  return { stage: "architect", prompt, includes: ["request"], approxChars: prompt.length };
}

const isNone = (value: string) => !value.trim() || /^(none|n\/a|nothing)\b/i.test(value.trim());

function parseSections(answer: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(LINE);
    if (header && (SECTIONS as readonly string[]).includes(header[1])) {
      current = header[1];
      sections.set(current, header[2].trim() ? [header[2].trim()] : []);
      continue;
    }
    if (!current || !line) continue;
    // Tolerant about how a list is drawn: a model bullets it one time and
    // numbers it the next, and neither is worth failing a contract over.
    sections.get(current)?.push(line.replace(/^[-*\d.)\s]+/, "").trim());
  }
  return sections;
}

function readRisk(value: string): RiskLevel {
  const text = value.toLowerCase();
  if (text.includes("high")) return "high";
  if (text.includes("trivial")) return "trivial";
  // Anything unrecognised is normal rather than trivial: guessing downward
  // sends work to a cheap model with no contract behind it.
  return "normal";
}

export interface ContractDraft {
  contract?: ImplementationContract;
  /** Why it could not be used. Empty when the contract is usable. */
  problems: string[];
}

/**
 * Reads what the architect wrote.
 *
 * Returns problems rather than a partial contract. The fields it insists on
 * are the ones without which a later stage cannot do its job: an objective,
 * something to change, and something to check.
 */
export function parseContract(
  answer: string,
  meta: {
    id: string;
    taskId: string;
    projectId: string;
    architectModel: string;
    architectProvider: BraveliProviderId | "";
    createdAt: string;
    /** Used when the architect gave no TASK line of its own. */
    fallbackTask?: string;
  },
): ContractDraft {
  if (!answer?.trim()) return { problems: ["The architect wrote nothing to the contract file."] };

  const sections = parseSections(answer);
  const list = (key: string) => (sections.get(key) ?? []).filter((line) => line && !isNone(line));
  const text = (key: string) => (sections.get(key) ?? []).join(" ").trim();

  const objective = text("OBJECTIVE");
  const requiredChanges = list("REQUIRED-CHANGES");
  const acceptanceCriteria = list("ACCEPTANCE-CRITERIA");

  const problems: string[] = [];
  if (!objective) problems.push("No OBJECTIVE — nothing states what the change is for.");
  if (!requiredChanges.length) problems.push("No REQUIRED-CHANGES — there is nothing to implement.");
  if (!acceptanceCriteria.length) {
    problems.push("No ACCEPTANCE-CRITERIA — a review would have nothing to check against.");
  }
  if (problems.length) return { problems };

  return {
    problems: [],
    contract: {
      id: meta.id,
      taskId: meta.taskId,
      projectId: meta.projectId,
      task: text("TASK") || meta.fallbackTask || objective,
      objective,
      affectedFiles: list("FILES"),
      requiredChanges,
      constraints: list("CONSTRAINTS"),
      acceptanceCriteria,
      requiredTests: list("REQUIRED-TESTS"),
      forbiddenChanges: list("DO-NOT-CHANGE"),
      assumptions: list("ASSUMPTIONS"),
      riskLevel: readRisk(text("RISK")),
      architectModel: meta.architectModel,
      architectProvider: meta.architectProvider,
      createdAt: meta.createdAt,
    },
  };
}
