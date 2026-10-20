import type {
  FixContract,
  ImplementationAttempt,
  ImplementationContract,
  QaReport,
  TaskRun,
  ValidationResult,
} from "../domain/contracts";
import type { BraveliProviderId } from "../domain/types";
import { nextStage, isTerminal, MAX_QA_ROUNDS_BEFORE_ESCALATION } from "./taskLoop";
import {
  implementerContext,
  reviewerContext,
  fixerContext,
  repairContext,
  directImplementerContext,
  directReviewerContext,
} from "./stageContext";
import { architectContext, contractFile, verdictFile, alsoWriteTo } from "./contractDraft";
import { chooseImplementer, type Candidate, type ImplementerPolicy } from "./routing";
import type { ModelRecord } from "./modelHistory";

/**
 * What to do next, and folding what happened back in.
 *
 * The loop, the briefs, the routing and the verdict parsing were each finished
 * and each tested, and nothing called any of them in order. This is the part
 * that does — kept deliberately free of IPC so the whole progression can be
 * tested without starting a process.
 *
 * The split is: this file decides, the caller performs. `decide()` returns an
 * action and never causes one; the `with*` functions fold a completed action
 * back into the run and never inspect the world. A driver that both chose and
 * acted would be untestable exactly where being wrong is most expensive.
 */

export interface RunnerInputs {
  run: TaskRun;
  /** The original request, needed to brief an architect. */
  request: string;
  /** Models Pitwall could actually start a session with right now. */
  candidates: Candidate[];
  /** Measured history, so routing has evidence rather than a guess. */
  records: ModelRecord[];
  policy: ImplementerPolicy;
  /** The strongest model available, used for judgement work. */
  reviewer: { provider: BraveliProviderId | ""; model: string };
  architect: { provider: BraveliProviderId | ""; model: string };
  /** The diff the reviewer judges. Empty until there is an implementation. */
  diff?: string;
}

export type RunnerAction =
  | {
      kind: "start-session";
      stage: "architect" | "implement" | "review" | "fix";
      prompt: string;
      provider: BraveliProviderId | "";
      model: string;
      /** Where the stage must leave its answer, when it writes one. */
      outputFile?: string;
      reason: string;
      /** True when nothing measured supports this model here. */
      speculative?: boolean;
    }
  | { kind: "run-validation"; attemptId: string; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "settled"; reason: string };

const lastAttempt = (run: TaskRun) => run.attempts[run.attempts.length - 1];
const lastReport = (run: TaskRun) => run.reports[run.reports.length - 1];

/**
 * The next thing to do about this run.
 *
 * Reads the loop's decision and turns it into a stage that can actually be
 * started, which is where the routing and the briefs get used.
 */
export function decide(inputs: RunnerInputs): RunnerAction {
  const { run } = inputs;

  if (isTerminal(run.stage) && run.stage !== "changes-requested") {
    return { kind: "settled", reason: `This run is ${run.stage}.` };
  }

  const report = lastReport(run);
  const decision = nextStage(run, run.reports.length ? report : undefined);

  if (decision.stage === "planning") {
    return {
      kind: "start-session",
      stage: "architect",
      prompt: architectContext({ request: inputs.request, filePath: contractFile(run.id) }).prompt,
      provider: inputs.architect.provider,
      model: inputs.architect.model,
      outputFile: contractFile(run.id),
      reason: decision.reason,
    };
  }

  if (decision.stage === "architecture-escalation") {
    return {
      kind: "blocked",
      reason: "The review found the contract itself was wrong. It needs rewriting before more work is spent on it.",
    };
  }

  const attempt = lastAttempt(run);

  // A finished implementation whose checks have not run yet. Deterministic
  // checks come before a reviewer is asked for an opinion, because a review of
  // code that does not compile is a review of the error.
  if (attempt && !attempt.finishedAt) {
    return { kind: "blocked", reason: "Waiting for the current session to finish." };
  }
  if (attempt && !attempt.validation) {
    return { kind: "run-validation", attemptId: attempt.id, reason: "Checks run before anyone is asked to review." };
  }

  if (decision.stage === "qa-review") {
    // Trivial work has no contract by design, and is still reviewed: the loop
    // holds that nothing reaches "passed" without a verdict. It is judged
    // against the request instead.
    const prompt = run.contract
      ? reviewerContext({
          contract: run.contract,
          diff: inputs.diff ?? "",
          validation: attempt?.validation,
        }).prompt
      : directReviewerContext({
          request: inputs.request,
          diff: inputs.diff ?? "",
          validation: attempt?.validation,
        }).prompt;
    const file = verdictFile(run.id, run.reports.length + 1);
    return {
      kind: "start-session",
      stage: "review",
      prompt: alsoWriteTo(prompt, file),
      provider: inputs.reviewer.provider,
      model: inputs.reviewer.model,
      outputFile: file,
      reason: decision.reason,
    };
  }

  if (decision.stage === "implementing" || decision.stage === "changes-requested" || decision.stage === "implementer-escalation") {
    // A contract is required for everything except trivial work, which the
    // loop deliberately sends straight to an implementer with the checks as
    // its gate. Refusing that case would have made `needsContract` a setting
    // with no path behind it.
    if (!run.contract && run.riskLevel !== "trivial") {
      return { kind: "blocked", reason: "No contract to implement." };
    }

    const choice = chooseImplementer({
      candidates: inputs.candidates,
      records: inputs.records,
      policy: inputs.policy,
      riskLevel: run.riskLevel,
      escalate: decision.escalate,
    });
    if (!choice.candidate) return { kind: "blocked", reason: choice.reason };

    // A failing check is answered by the errors themselves, not by another
    // copy of the contract: the implementer has already read that.
    const repairing = attempt?.validation && !attempt.validation.ok;
    if (repairing) {
      return {
        kind: "start-session",
        stage: "implement",
        prompt: repairContext(attempt!.validation!).prompt,
        provider: choice.candidate.provider,
        model: choice.candidate.model,
        reason: decision.reason,
        speculative: choice.speculative,
      };
    }

    const rejection = report && report.verdict === "fail" ? report : undefined;
    if (rejection) {
      const fix = run.fixContracts[run.fixContracts.length - 1];
      if (!fix) return { kind: "blocked", reason: "A rejection with no fix contract to answer it." };
      return {
        kind: "start-session",
        stage: "fix",
        prompt: fixerContext({ fix, validation: attempt?.validation }).prompt,
        provider: choice.candidate.provider,
        model: choice.candidate.model,
        reason: `${decision.reason} ${choice.reason}`,
        speculative: choice.speculative,
      };
    }

    return {
      kind: "start-session",
      stage: "implement",
      prompt: run.contract
        ? implementerContext(run.contract).prompt
        : directImplementerContext(inputs.request).prompt,
      provider: choice.candidate.provider,
      model: choice.candidate.model,
      reason: choice.reason,
      speculative: choice.speculative,
    };
  }

  return { kind: "settled", reason: decision.reason };
}

/* ── folding what happened back into the run ───────────────────────── */

export function withContract(run: TaskRun, contract: ImplementationContract, at: string): TaskRun {
  return {
    ...run,
    contract,
    // The architect looked at the code; its judgement replaces the guess made
    // from the request's wording.
    riskLevel: contract.riskLevel,
    stage: "contract-ready",
    updatedAt: at,
  };
}

export function withAttempt(run: TaskRun, attempt: ImplementationAttempt): TaskRun {
  return { ...run, attempts: [...run.attempts, attempt], stage: "implementing", updatedAt: attempt.startedAt };
}

export function withAttemptFinished(run: TaskRun, attemptId: string, at: string): TaskRun {
  return {
    ...run,
    attempts: run.attempts.map((item) => (item.id === attemptId ? { ...item, finishedAt: at } : item)),
    updatedAt: at,
  };
}

export function withValidation(run: TaskRun, attemptId: string, validation: ValidationResult): TaskRun {
  return {
    ...run,
    attempts: run.attempts.map((item) => (item.id === attemptId ? { ...item, validation } : item)),
    stage: validation.ok ? "validating" : "implementing",
    updatedAt: validation.ranAt,
  };
}

/**
 * Records a verdict and moves the run to wherever it now belongs.
 *
 * `qaRounds` counts rejections rather than reviews: a run that passed first
 * time has been reviewed once and rejected never, and the escalation lever is
 * about rejections.
 */
export function withReport(run: TaskRun, report: QaReport, fix?: FixContract): TaskRun {
  const rejected = report.verdict === "fail";
  const qaRounds = rejected ? run.qaRounds + 1 : run.qaRounds;
  const next: TaskRun = {
    ...run,
    reports: [...run.reports, report],
    fixContracts: fix ? [...run.fixContracts, fix] : run.fixContracts,
    qaRounds,
    attempts: run.attempts.map((item, index) =>
      index === run.attempts.length - 1 ? { ...item, outcome: rejected ? "failed" : "passed" } : item,
    ),
    updatedAt: report.createdAt,
    stage: run.stage,
  };

  if (!rejected) return { ...next, stage: "passed" };
  if (report.requiresArchitectEscalation) return { ...next, stage: "architecture-escalation" };
  if (qaRounds > MAX_QA_ROUNDS_BEFORE_ESCALATION) return { ...next, stage: "implementer-escalation" };
  return { ...next, stage: "changes-requested" };
}

export function withBlocked(run: TaskRun, at: string): TaskRun {
  return { ...run, stage: "blocked", updatedAt: at };
}

/** A fresh run, before anything has looked at the code. */
export function startRun({
  id,
  taskId,
  projectId,
  riskLevel,
  at,
}: {
  id: string;
  taskId: string;
  projectId: string;
  riskLevel: TaskRun["riskLevel"];
  at: string;
}): TaskRun {
  return {
    id,
    taskId,
    projectId,
    stage: "planning",
    riskLevel,
    attempts: [],
    reports: [],
    fixContracts: [],
    qaRounds: 0,
    createdAt: at,
    updatedAt: at,
  };
}
