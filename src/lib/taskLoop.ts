import type { QaReport, RiskLevel, TaskRun, TaskStage, ValidationResult } from "../domain/contracts";

/**
 * What happens next, and who pays for it.
 *
 * The loop is Architect → Implementer → validation → QA, and every edge in it
 * is a decision about money: whether to ask a model at all, whether the cheap
 * one gets another go, and when to stop asking and hand the work to something
 * better. Those decisions are here, as functions over a record, rather than
 * spread through the code that runs the agents — so they can be argued with,
 * and tested without starting anything.
 */

/**
 * How many times a cheap implementer may answer its own deterministic
 * failures before a model is asked to look.
 *
 * A typecheck error is usually a typecheck error. Sending one to a premium
 * reviewer is paying for judgement on something that needs none. Two, because
 * the first retry catches the ordinary case and the second catches the one
 * where the first fix introduced a new error; a third would mostly be a model
 * failing the same way again.
 */
export const MAX_LOCAL_REPAIRS = 2;

/**
 * How many QA rejections before the implementation is escalated.
 *
 * One. Not because a second attempt never succeeds, but because of what each
 * mistake costs: escalating early buys a single better implementation, and
 * escalating late buys three cheap implementations, three reviews, and the
 * time of all six. When the contract is precise the cheap model passes first
 * time; when it is not, more attempts at it is the wrong lever.
 */
export const MAX_QA_ROUNDS_BEFORE_ESCALATION = 1;

/** What the loop should do next, and why. */
export interface LoopDecision {
  stage: TaskStage;
  /** Shown to the user and stored on the run. Never a bare state name. */
  reason: string;
  /** True when the next step should use a stronger model than the last. */
  escalate: boolean;
}

/**
 * Whether a task needs a contract at all.
 *
 * The full loop on a copy change costs an Architect, a reviewer and two
 * handoffs to alter a string. Trivial work goes straight to an implementer
 * and is caught by the deterministic checks, which are free.
 */
export function needsContract(risk: RiskLevel): boolean {
  return risk !== "trivial";
}

/**
 * Whether a premium reviewer should look at this, or whether the cheap checks
 * have already answered the question.
 *
 * A failing test suite is not a matter of opinion. Asking a model to review an
 * implementation that does not compile spends judgement on something a
 * compiler already decided, and the review it writes will be about the error
 * rather than the work.
 */
export function needsQaReview(validation: ValidationResult | undefined, repairs: number): boolean {
  if (!validation) return true;
  if (validation.ok) return true;
  // Still failing after the implementer has had its attempts: a model should
  // look, because this is no longer an ordinary error.
  return repairs >= MAX_LOCAL_REPAIRS;
}

/** Whether the implementer gets to answer its own deterministic failure. */
export function canRepairLocally(validation: ValidationResult | undefined, repairs: number): boolean {
  if (!validation || validation.ok) return false;
  return repairs < MAX_LOCAL_REPAIRS;
}

/**
 * The next stage, given where the run is and what just happened.
 *
 * Written as one function over the whole record rather than as transitions
 * scattered through the runner, because the interesting property — that a run
 * cannot loop forever, and cannot pass without an independent verdict — is
 * only checkable if the rules are in one place.
 */
export function nextStage(run: TaskRun, report?: QaReport): LoopDecision {
  const latest = run.attempts[run.attempts.length - 1];
  const repairs = countRepairs(run);

  // Only the absence of a contract that is still wanted stops the run here.
  // Testing `!run.contract` on its own short-circuited every later rule for
  // trivial work, which has no contract by design: it answered "implementing"
  // however many attempts had already been made, so a trivial task could be
  // implemented repeatedly and never validated, reviewed or finished.
  if (!run.contract && needsContract(run.riskLevel)) {
    return { stage: "planning", reason: "No contract yet — the architect goes first.", escalate: false };
  }

  if (!latest) {
    return {
      stage: "implementing",
      reason: run.contract ? "Contract is ready." : "Trivial change; deterministic checks are the gate.",
      escalate: false,
    };
  }

  if (latest.validation && !latest.validation.ok) {
    if (canRepairLocally(latest.validation, repairs)) {
      return {
        stage: "implementing",
        reason: `${failedCheckNames(latest.validation)} failed — the implementer gets attempt ${repairs + 2} of ${MAX_LOCAL_REPAIRS + 1}.`,
        escalate: false,
      };
    }
    return {
      stage: "qa-review",
      reason: `${failedCheckNames(latest.validation)} still failing after ${repairs} repair attempts.`,
      escalate: false,
    };
  }

  if (!report) {
    return { stage: "qa-review", reason: "Checks pass; an independent review decides.", escalate: false };
  }

  if (report.verdict === "pass") {
    return { stage: "passed", reason: "Review accepted the implementation.", escalate: false };
  }

  // A contract the implementation proved wrong is not fixed by implementing it
  // again, however many times.
  if (report.requiresArchitectEscalation) {
    return {
      stage: "architecture-escalation",
      reason: "The review found the contract itself was wrong, not its implementation.",
      escalate: true,
    };
  }

  if (run.qaRounds >= MAX_QA_ROUNDS_BEFORE_ESCALATION) {
    return {
      stage: "implementer-escalation",
      reason: `Rejected ${run.qaRounds + 1} times — a stronger model takes the fix.`,
      escalate: true,
    };
  }

  return { stage: "changes-requested", reason: "Review asked for changes.", escalate: false };
}

/** Repairs the implementer has already attempted against this contract. */
function countRepairs(run: TaskRun): number {
  return Math.max(0, run.attempts.filter((attempt) => !attempt.fixContractId).length - 1);
}

function failedCheckNames(validation: ValidationResult): string {
  const failed = validation.checks.filter((check) => !check.ok && !check.skipped).map((check) => check.name);
  if (failed.length === 0) return "Validation";
  if (failed.length === 1) return failed[0];
  return `${failed.slice(0, -1).join(", ")} and ${failed[failed.length - 1]}`;
}

/** Stages from which a run will never move again without a person. */
export function isTerminal(stage: TaskStage): boolean {
  return stage === "passed" || stage === "blocked";
}

/** Stages that mean somebody has to decide something. */
export function needsAttention(stage: TaskStage): boolean {
  return stage === "blocked" || stage === "architecture-escalation" || stage === "implementer-escalation";
}
