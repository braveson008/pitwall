import type { FixContract, ImplementationContract, QaReport, ValidationResult } from "../domain/contracts";

/**
 * What each stage is told, and nothing else.
 *
 * This is where the saving is. Pitwall's council gives every member the
 * thread, so the context each one pays for grows with the conversation rather
 * than with the work — by turn twenty the reviewer is reading nineteen turns
 * of other people's reasoning to answer a question about a diff.
 *
 * Each stage here gets a different, smaller thing:
 *
 *   Architect   the request, and what it asked to see of the repository
 *   Implementer the contract, and the files it names
 *   Reviewer    the contract, the diff, and what the checks said
 *   Fixer       the fix contract, and the errors it is answering
 *
 * The reviewer's is the important one. It never receives the thread and never
 * receives the implementer's reasoning, which is not only cheaper but is the
 * only way its verdict means anything: a reviewer told why the implementer
 * believes it is correct is being asked to agree rather than to check.
 */

/** Everything a prompt is built from, before it becomes text. */
export interface StageContext {
  stage: "architect" | "implement" | "review" | "fix";
  /** Rendered prompt. */
  prompt: string;
  /** What it was built from, for the record and for the cost view. */
  includes: string[];
  /** Rough size, so a stage that has grown can be noticed. */
  approxChars: number;
}

const bullet = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

/** Trimmed to the failing lines: a reviewer needs the error, not the run. */
export function failingOutput(validation: ValidationResult | undefined, perCheck = 1600): string {
  if (!validation || validation.ok) return "";
  return validation.checks
    .filter((check) => !check.ok && !check.skipped)
    .map((check) => `${check.name} (${check.command}):\n${check.output.slice(-perCheck)}`)
    .join("\n\n");
}

/**
 * The implementer's brief.
 *
 * The contract and the files it names. Not the thread, not the architect's
 * reasoning — a specification is the output of that reasoning, and sending
 * both is paying twice for one decision.
 */
export function implementerContext(contract: ImplementationContract): StageContext {
  const sections = [
    `TASK\n${contract.task}`,
    `OBJECTIVE\n${contract.objective}`,
    contract.affectedFiles.length ? `FILES LIKELY INVOLVED\n${bullet(contract.affectedFiles)}` : "",
    `REQUIRED CHANGES\n${contract.requiredChanges.map((change, index) => `${index + 1}. ${change}`).join("\n")}`,
    contract.constraints.length ? `CONSTRAINTS\n${bullet(contract.constraints)}` : "",
    contract.forbiddenChanges.length ? `DO NOT CHANGE\n${bullet(contract.forbiddenChanges)}` : "",
    `ACCEPTANCE CRITERIA\n${bullet(contract.acceptanceCriteria)}`,
    contract.requiredTests.length ? `REQUIRED TESTS\n${bullet(contract.requiredTests)}` : "",
    // Said plainly, because the failure this prevents is expensive: an
    // implementer that invents an architecture produces work the reviewer
    // rejects for reasons the implementer could not have known.
    "RULES\n" +
      bullet([
        "Follow this contract exactly. It is the specification, not a suggestion.",
        "Follow the patterns already in this repository.",
        "Do not refactor anything the contract does not name.",
        "Do not make architectural decisions the contract has not made.",
        "If the contract is ambiguous or impossible, say so and stop rather than inventing an approach.",
        "Report anything you could not complete.",
      ]),
  ];
  return build("implement", sections, ["contract"]);
}

/**
 * Briefs for work that never had a contract.
 *
 * Trivial changes skip the architect — `needsContract` says so — because a
 * planning stage costs more than the typo it would plan. They do not skip the
 * review: the loop holds the property that nothing reaches "passed" without a
 * verdict, and a change small enough to skip planning is not automatically a
 * change that was made correctly.
 *
 * So both ends need a version that works from the request itself. The answer
 * shape is identical to the contract-backed reviewer's, because the same
 * parser reads it and a second format would be a second thing to get wrong.
 */
export function directImplementerContext(request: string): StageContext {
  const sections = [
    `TASK\n${request}`,
    "RULES\n" +
      bullet([
        "Make this change and nothing else.",
        "Follow the patterns already in this repository.",
        "Do not refactor anything the task does not name.",
        "If this turns out to be larger than it looks, say so and stop rather than expanding it.",
        "Report anything you could not complete.",
      ]),
  ];
  return build("implement", sections, ["request"]);
}

export function directReviewerContext({
  request,
  diff,
  validation,
  maxDiffChars = 60_000,
}: {
  request: string;
  diff: string;
  validation?: ValidationResult;
  maxDiffChars?: number;
}): StageContext {
  const includes = ["request", "diff"];
  const trimmedDiff = diff.length > maxDiffChars
    ? `${diff.slice(0, maxDiffChars)}\n\n[diff truncated at ${maxDiffChars} characters]`
    : diff;
  const checks = validation
    ? validation.checks
        .map((check) => `${check.name}: ${check.skipped ? "not configured" : check.ok ? "pass" : "FAIL"}`)
        .join("\n")
    : "No deterministic checks were run.";
  if (validation) includes.push("validation");

  const sections = [
    "You are reviewing a small change against the request it was made from. You did not write it.",
    `REQUEST\n${request}`,
    `CHECKS\n${checks}`,
    failingOutput(validation) ? `FAILING OUTPUT\n${failingOutput(validation)}` : "",
    `DIFF\n${trimmedDiff}`,
    "LOOK FOR\n" +
      bullet([
        "Anything the request asked for that is not there.",
        "Changes beyond what was asked.",
        "Logic errors, regressions and unhandled edge cases.",
        "Security problems introduced by this change.",
      ]),
    "ANSWER IN THIS SHAPE\n" +
      "VERDICT: PASS or FAIL\n" +
      "CRITICAL: one line per issue that must be fixed, or 'none'\n" +
      "WARNINGS: one line per issue worth raising, or 'none'\n" +
      "CRITERIA: one line, as 'met' or 'not met', for the request itself\n" +
      "CONTRACT-WRONG: no\n" +
      "FIX: one line per change needed, when the verdict is FAIL",
  ];
  return build("review", sections, includes);
}

/**
 * The reviewer's brief.
 *
 * Deliberately narrow. It answers one question — does this do what the
 * contract asked — against the diff and the checks, and it is given no
 * account of how the implementation went.
 */
export function reviewerContext({
  contract,
  diff,
  validation,
  implementerNotes,
  maxDiffChars = 60_000,
}: {
  contract: ImplementationContract;
  diff: string;
  validation?: ValidationResult;
  /** What the implementer said it could not do. Its claims, not its reasoning. */
  implementerNotes?: string;
  maxDiffChars?: number;
}): StageContext {
  const includes = ["contract", "diff"];
  const trimmedDiff = diff.length > maxDiffChars
    ? `${diff.slice(0, maxDiffChars)}\n\n[diff truncated at ${maxDiffChars} characters]`
    : diff;

  const checks = validation
    ? validation.checks
        .map((check) => `${check.name}: ${check.skipped ? "not configured" : check.ok ? "pass" : "FAIL"}`)
        .join("\n")
    : "No deterministic checks were run.";
  if (validation) includes.push("validation");
  if (implementerNotes?.trim()) includes.push("implementer-notes");

  const sections = [
    "You are reviewing an implementation against the contract it was written from. You did not write either.",
    `CONTRACT\nTask: ${contract.task}\nObjective: ${contract.objective}`,
    `ACCEPTANCE CRITERIA\n${bullet(contract.acceptanceCriteria)}`,
    contract.constraints.length ? `CONSTRAINTS\n${bullet(contract.constraints)}` : "",
    contract.forbiddenChanges.length ? `SHOULD NOT HAVE CHANGED\n${bullet(contract.forbiddenChanges)}` : "",
    `CHECKS\n${checks}`,
    failingOutput(validation) ? `FAILING OUTPUT\n${failingOutput(validation)}` : "",
    implementerNotes?.trim() ? `THE IMPLEMENTER REPORTED\n${implementerNotes.trim()}` : "",
    `DIFF\n${trimmedDiff}`,
    "LOOK FOR\n" +
      bullet([
        "Acceptance criteria that are not met.",
        "Requirements in the contract that were not implemented.",
        "Logic errors, regressions and unhandled edge cases.",
        "Changes outside what the contract asked for.",
        "Constraints that were broken.",
        "Tests that were required and are missing, or that do not test what they claim.",
        "Security problems introduced by this change.",
      ]),
    // A gate that can be talked past by an enthusiastic summary is not a gate,
    // which is why the verdict is a marker rather than a judgement about tone.
    "ANSWER IN THIS SHAPE\n" +
      "VERDICT: PASS or FAIL\n" +
      "CRITICAL: one line per issue that must be fixed, or 'none'\n" +
      "WARNINGS: one line per issue worth raising, or 'none'\n" +
      "CRITERIA: one line per acceptance criterion, as 'met' or 'not met' with a reason\n" +
      "CONTRACT-WRONG: yes only if the contract itself was mistaken, not its implementation\n" +
      "FIX: one line per change needed, when the verdict is FAIL",
  ];
  return build("review", sections, includes);
}

/**
 * The fixer's brief.
 *
 * Only what is still wrong. Resending the original contract in full would
 * cost as much as the first implementation to communicate a subset of it,
 * which is the loop this design exists to avoid.
 */
export function fixerContext({
  fix,
  validation,
}: {
  fix: FixContract;
  validation?: ValidationResult;
}): StageContext {
  const includes = ["fix-contract"];
  if (validation && !validation.ok) includes.push("validation");

  const sections = [
    "A review rejected the previous implementation. Fix exactly these findings.",
    `ISSUES\n${fix.issuesToFix.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`,
    fix.requiredChanges.length ? `REQUIRED CHANGES\n${bullet(fix.requiredChanges)}` : "",
    fix.filesLikelyAffected.length ? `FILES LIKELY AFFECTED\n${bullet(fix.filesLikelyAffected)}` : "",
    fix.constraints.length ? `CONSTRAINTS STILL IN FORCE\n${bullet(fix.constraints)}` : "",
    failingOutput(validation) ? `CURRENT FAILURES\n${failingOutput(validation)}` : "",
    "RULES\n" +
      bullet([
        "Change only what these findings require.",
        "Do not revisit parts of the implementation the review accepted.",
        "Do not refactor while you are here.",
      ]),
  ];
  return build("fix", sections, includes);
}

/** A repair against deterministic failures, with no model having been asked. */
export function repairContext(validation: ValidationResult): StageContext {
  const sections = [
    "The change you just made does not pass the project's own checks. Fix the failures below and nothing else.",
    `FAILURES\n${failingOutput(validation)}`,
    "RULES\n" +
      bullet([
        "Fix only what is failing.",
        "Do not change behaviour that was not the cause.",
        "If a failure is not yours, say so rather than working around it.",
      ]),
  ];
  return build("fix", sections, ["validation"]);
}

function build(stage: StageContext["stage"], sections: string[], includes: string[]): StageContext {
  const prompt = sections.filter(Boolean).join("\n\n");
  return { stage, prompt, includes, approxChars: prompt.length };
}
