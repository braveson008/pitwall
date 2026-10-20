import type { BraveliProviderId, BraveliSessionType } from "./types";

/**
 * The artifacts a task passes between the agents working it.
 *
 * Pitwall's council already routes turns and verifies the result, but
 * everything travelling between members is prose in a thread, which has two
 * costs. Every member reads the whole thread, so the context each one pays
 * for grows with the conversation rather than with the work. And nothing is
 * inspectable afterwards: when a run goes wrong there is no record of what
 * was asked for, only a transcript of what was said.
 *
 * These are the same information as structured objects. A contract says what
 * to build, a report says whether it was built, and a fix contract says what
 * is still missing — each carrying only what its reader needs.
 *
 * ## Why this is not just an optimisation
 *
 * The compression is the point, but the traceability is the reason. "Here is
 * the contract, here is the diff, here is why it was rejected" is what makes
 * several models working on one task legible instead of mysterious. A cost
 * saving nobody can audit is a claim; a rejected contract is evidence.
 */

/** Where a task is in the Architect → Implementer → QA loop. */
export type TaskStage =
  | "planning"
  | "contract-ready"
  | "implementing"
  | "validating"
  | "qa-review"
  | "passed"
  | "changes-requested"
  | "blocked"
  | "architecture-escalation"
  | "implementer-escalation";

/**
 * How much judgement a task needs, which is not how much code it needs.
 *
 * The distinction the whole design rests on: "replace session state with an
 * event-sourced model" is high reasoning and ordinary implementation once the
 * schema is decided. Spending premium tokens on the volume rather than the
 * judgement is the waste this is meant to avoid.
 */
export type RiskLevel = "trivial" | "normal" | "high";

export interface ImplementationContract {
  id: string;
  taskId: string;
  projectId: string;
  /** One line: what is being built. */
  task: string;
  /** What the user actually wants, in the Architect's words. */
  objective: string;
  affectedFiles: string[];
  requiredChanges: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  requiredTests: string[];
  /** Files the implementer must leave alone, when that matters. */
  forbiddenChanges: string[];
  /** Anything the Architect assumed that a reader should be able to dispute. */
  assumptions: string[];
  riskLevel: RiskLevel;
  /** Who wrote it, so a bad contract can be traced to its author. */
  architectModel: string;
  architectProvider: BraveliProviderId | "";
  createdAt: string;
}

export interface QaReport {
  id: string;
  contractId: string;
  verdict: "pass" | "fail";
  /** Things that must change before this can be accepted. */
  criticalIssues: string[];
  /** Things worth saying that do not block. */
  warnings: string[];
  /** One entry per acceptance criterion, in the contract's order. */
  acceptanceCriteriaResults: Array<{ criterion: string; met: boolean; note: string }>;
  /**
   * True when the implementation revealed that the contract itself was wrong.
   *
   * The one signal that sends work back to the Architect rather than round the
   * fix loop again — without it, a bad contract is implemented repeatedly and
   * rejected repeatedly, which is the most expensive failure this design has.
   */
  requiresArchitectEscalation: boolean;
  qaModel: string;
  qaProvider: BraveliProviderId | "";
  createdAt: string;
}

export interface FixContract {
  id: string;
  parentContractId: string;
  reportId: string;
  issuesToFix: string[];
  filesLikelyAffected: string[];
  requiredChanges: string[];
  /** Carried from the parent: a fix that breaks a constraint is not a fix. */
  constraints: string[];
  acceptanceCriteria: string[];
  createdAt: string;
}

/** One attempt at a contract by one model, and how it went. */
export interface ImplementationAttempt {
  id: string;
  contractId: string;
  /** The fix contract this attempt answers, when it is not the first. */
  fixContractId?: string;
  provider: BraveliProviderId | "";
  model: string;
  role: BraveliSessionType;
  sessionId: string;
  /** Set once the attempt has been judged. */
  outcome?: "passed" | "failed" | "abandoned";
  /** Deterministic checks, which run before anything is asked of a model. */
  validation?: ValidationResult;
  startedAt: string;
  finishedAt?: string;
}

/** What the cheap checks said. */
export interface ValidationResult {
  ok: boolean;
  /** HEAD at the start of validation; older records may not have it. */
  revision?: string;
  worktreeDirty?: boolean;
  checks: Array<{
    name: string;
    command: string;
    ok: boolean;
    /** Bounded command output, including successful checks. */
    output: string;
    skipped: boolean;
    durationMs: number;
  }>;
  ranAt: string;
}

/** The record of one task moving through the loop. */
export interface TaskRun {
  id: string;
  taskId: string;
  projectId: string;
  stage: TaskStage;
  riskLevel: RiskLevel;
  contract?: ImplementationContract;
  attempts: ImplementationAttempt[];
  reports: QaReport[];
  fixContracts: FixContract[];
  /**
   * How many times QA has rejected this. The escalation lever: one failed
   * round buys a better implementer, because the cost of escalating early is
   * a single good implementation and the cost of escalating late is three
   * rounds of a cheap one plus three reviews.
   */
  qaRounds: number;
  createdAt: string;
  updatedAt: string;
}
