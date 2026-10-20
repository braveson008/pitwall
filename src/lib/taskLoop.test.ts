import { describe, expect, it } from "vitest";
import {
  MAX_LOCAL_REPAIRS,
  canRepairLocally,
  isTerminal,
  needsAttention,
  needsContract,
  needsQaReview,
  nextStage,
} from "./taskLoop";
import type { ImplementationAttempt, QaReport, TaskRun, ValidationResult } from "../domain/contracts";

const validation = (ok: boolean, failing: string[] = []): ValidationResult => ({
  ok,
  ranAt: "2026-08-28T20:00:00Z",
  checks: [
    { name: "typecheck", command: "tsc", ok: ok || !failing.includes("typecheck"), output: "", skipped: false, durationMs: 10 },
    { name: "tests", command: "vitest", ok: ok || !failing.includes("tests"), output: "", skipped: false, durationMs: 10 },
  ],
});

const attempt = (over: Partial<ImplementationAttempt> = {}): ImplementationAttempt => ({
  id: "a1", contractId: "c1", provider: "codex", model: "auto", role: "implementation",
  sessionId: "s1", startedAt: "2026-08-28T20:00:00Z", ...over,
});

const run = (over: Partial<TaskRun> = {}): TaskRun => ({
  id: "r1", taskId: "t1", projectId: "p1", stage: "implementing", riskLevel: "normal",
  contract: { id: "c1" } as TaskRun["contract"],
  attempts: [], reports: [], fixContracts: [], qaRounds: 0,
  createdAt: "2026-08-28T20:00:00Z", updatedAt: "2026-08-28T20:00:00Z", ...over,
});

const report = (over: Partial<QaReport> = {}): QaReport => ({
  id: "q1", contractId: "c1", verdict: "fail", criticalIssues: [], warnings: [],
  acceptanceCriteriaResults: [], requiresArchitectEscalation: false,
  qaModel: "auto", qaProvider: "claude", createdAt: "2026-08-28T20:00:00Z", ...over,
});

describe("needsContract", () => {
  // The full loop on a copy change costs an architect, a reviewer and two
  // handoffs to alter a string.
  it("sends trivial work straight to an implementer", () => {
    expect(needsContract("trivial")).toBe(false);
    expect(needsContract("normal")).toBe(true);
    expect(needsContract("high")).toBe(true);
  });
});

describe("needsQaReview", () => {
  it("reviews an implementation whose checks pass", () => {
    expect(needsQaReview(validation(true), 0)).toBe(true);
  });

  // A failing typecheck is not a matter of opinion, and the review it produces
  // would be about the error rather than the work.
  it("does not spend a review on something that does not compile", () => {
    expect(needsQaReview(validation(false, ["typecheck"]), 0)).toBe(false);
  });

  it("reviews once the implementer has had its attempts and still failed", () => {
    expect(needsQaReview(validation(false, ["typecheck"]), MAX_LOCAL_REPAIRS)).toBe(true);
  });

  // No checks configured is not the same as checks passing.
  it("reviews when there was nothing deterministic to run", () => {
    expect(needsQaReview(undefined, 0)).toBe(true);
  });
});

describe("canRepairLocally", () => {
  it("gives the implementer its budgeted attempts and no more", () => {
    expect(canRepairLocally(validation(false, ["tests"]), 0)).toBe(true);
    expect(canRepairLocally(validation(false, ["tests"]), MAX_LOCAL_REPAIRS - 1)).toBe(true);
    expect(canRepairLocally(validation(false, ["tests"]), MAX_LOCAL_REPAIRS)).toBe(false);
  });

  it("does not offer a repair when nothing is broken", () => {
    expect(canRepairLocally(validation(true), 0)).toBe(false);
    expect(canRepairLocally(undefined, 0)).toBe(false);
  });
});

describe("nextStage", () => {
  it("starts with the architect when there is no contract", () => {
    expect(nextStage(run({ contract: undefined })).stage).toBe("planning");
  });

  it("skips the architect entirely for trivial work", () => {
    expect(nextStage(run({ contract: undefined, riskLevel: "trivial" })).stage).toBe("implementing");
  });

  it("sends a failing check back to the implementer, and says which check", () => {
    const decision = nextStage(run({ attempts: [attempt({ validation: validation(false, ["typecheck"]) })] }));
    expect(decision.stage).toBe("implementing");
    expect(decision.reason).toContain("typecheck");
    expect(decision.escalate).toBe(false);
  });

  it("names every failing check, not just the first", () => {
    const decision = nextStage(run({ attempts: [attempt({ validation: validation(false, ["typecheck", "tests"]) })] }));
    expect(decision.reason).toContain("typecheck");
    expect(decision.reason).toContain("tests");
  });

  it("reviews once the checks are clean", () => {
    expect(nextStage(run({ attempts: [attempt({ validation: validation(true) })] })).stage).toBe("qa-review");
  });

  it("passes when the review accepts it", () => {
    const decision = nextStage(run({ attempts: [attempt({ validation: validation(true) })] }), report({ verdict: "pass" }));
    expect(decision.stage).toBe("passed");
  });

  // A contract the implementation proved wrong is not fixed by implementing
  // it again, however many times.
  it("returns to the architect when the contract itself was wrong", () => {
    const decision = nextStage(
      run({ attempts: [attempt({ validation: validation(true) })] }),
      report({ requiresArchitectEscalation: true }),
    );
    expect(decision.stage).toBe("architecture-escalation");
    expect(decision.escalate).toBe(true);
  });

  // Escalating early costs one good implementation; escalating late costs
  // three cheap ones and three reviews.
  it("escalates the implementation after a single rejection", () => {
    const first = nextStage(run({ attempts: [attempt({ validation: validation(true) })], qaRounds: 0 }), report());
    expect(first.stage).toBe("changes-requested");
    expect(first.escalate).toBe(false);

    const second = nextStage(run({ attempts: [attempt({ validation: validation(true) })], qaRounds: 1 }), report());
    expect(second.stage).toBe("implementer-escalation");
    expect(second.escalate).toBe(true);
  });

  it("keeps moving trivial work through the loop after it has been attempted", () => {
    // The bug this pins: testing for a missing contract on its own returned
    // "implementing" before any later rule was consulted, so trivial work —
    // which has no contract by design — was implemented over and over and
    // never validated, reviewed or finished.
    const attempted = run({
      contract: undefined,
      riskLevel: "trivial",
      attempts: [attempt({ validation: validation(true) })],
    });
    expect(nextStage(attempted).stage).toBe("qa-review");
  });

  it("still sends failing checks on trivial work back to the implementer", () => {
    const broken = run({
      contract: undefined,
      riskLevel: "trivial",
      attempts: [attempt({ validation: validation(false, ["typecheck"]) })],
    });
    expect(nextStage(broken).stage).toBe("implementing");
  });

  // The property worth having: no path reaches "passed" without a verdict.
  it("cannot pass without an independent review", () => {
    for (const state of [
      run({ attempts: [] }),
      run({ attempts: [attempt({ validation: validation(true) })] }),
      run({ attempts: [attempt({ validation: validation(false, ["tests"]) })] }),
      run({ contract: undefined, riskLevel: "trivial" }),
    ]) {
      expect(nextStage(state).stage).not.toBe("passed");
    }
  });
});

describe("stage predicates", () => {
  it("knows which stages a run never leaves on its own", () => {
    expect(isTerminal("passed")).toBe(true);
    expect(isTerminal("blocked")).toBe(true);
    expect(isTerminal("qa-review")).toBe(false);
  });

  it("knows which stages need a person", () => {
    expect(needsAttention("architecture-escalation")).toBe(true);
    expect(needsAttention("implementer-escalation")).toBe(true);
    expect(needsAttention("blocked")).toBe(true);
    expect(needsAttention("passed")).toBe(false);
  });
});
