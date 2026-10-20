import { describe, expect, it } from "vitest";
import { savingAgainstPremium, stagesFor, summariseCost, type StageCost } from "./runCost";
import type { TaskRun } from "../domain/contracts";

const stage = (over: Partial<StageCost> = {}): StageCost => ({
  stage: "implement", provider: "codex", model: "mini", tokens: 1000,
  relativeCost: 1, local: false, durationMs: 100, ...over,
});

describe("summariseCost", () => {
  it("adds up what was measured", () => {
    const cost = summariseCost([stage({ tokens: 1000 }), stage({ tokens: 500, stage: "review" })]);
    expect(cost.totalTokens).toBe(1500);
    expect(cost.billedTokens).toBe(1500);
  });

  it("keeps local and billed apart", () => {
    const cost = summariseCost([
      stage({ tokens: 8000, local: true, provider: "" }),
      stage({ tokens: 900, stage: "review" }),
    ]);
    expect(cost.localTokens).toBe(8000);
    expect(cost.billedTokens).toBe(900);
  });

  // Adding up half the stages and calling it a total is the kind of number
  // people quote.
  it("refuses to total a run where a stage reported nothing", () => {
    const cost = summariseCost([stage({ tokens: 1000 }), stage({ tokens: undefined })]);
    expect(cost.totalTokens).toBeNull();
    expect(cost.unmeasuredStages).toBe(1);
  });

  it("has no total for a run with no stages", () => {
    expect(summariseCost([]).totalTokens).toBeNull();
  });

  it("adds up the wall clock, which is the cost the user actually feels", () => {
    expect(summariseCost([stage({ durationMs: 400 }), stage({ durationMs: 600 })]).wallClockMs).toBe(1000);
  });
});

describe("savingAgainstPremium", () => {
  it("reports what ran locally, phrased as the comparison it is", () => {
    const saving = savingAgainstPremium(summariseCost([
      stage({ tokens: 8000, local: true, provider: "" }),
      stage({ tokens: 900, stage: "review" }),
    ]));
    expect(saving?.tokens).toBe(8000);
    expect(saving?.note).toContain("would have billed");
  });

  // The most quotable and least true number on the screen.
  it("says nothing when a stage went unmeasured", () => {
    expect(savingAgainstPremium(summariseCost([
      stage({ tokens: 8000, local: true }), stage({ tokens: undefined }),
    ]))).toBeNull();
  });

  it("says nothing when nothing ran locally", () => {
    expect(savingAgainstPremium(summariseCost([stage({ tokens: 1000 })]))).toBeNull();
  });
});

describe("stagesFor", () => {
  const run: TaskRun = {
    id: "r1", taskId: "t1", projectId: "p1", stage: "passed", riskLevel: "normal",
    contract: {
      id: "c1", taskId: "t1", projectId: "p1", task: "t", objective: "o",
      affectedFiles: [], requiredChanges: [], constraints: [], acceptanceCriteria: [],
      requiredTests: [], forbiddenChanges: [], assumptions: [], riskLevel: "normal",
      architectModel: "opus", architectProvider: "claude", createdAt: "2026-08-28T20:00:00Z",
    },
    attempts: [
      {
        id: "a1", contractId: "c1", provider: "", model: "qwen3-coder", role: "implementation",
        sessionId: "s1", startedAt: "2026-08-28T20:00:00Z", finishedAt: "2026-08-28T20:03:00Z",
        validation: { ok: true, ranAt: "2026-08-28T20:03:00Z", checks: [
          { name: "tests", command: "npm test", ok: true, output: "", skipped: false, durationMs: 4200 },
        ] },
      },
      {
        id: "a2", contractId: "c1", fixContractId: "f1", provider: "", model: "qwen3-coder",
        role: "implementation", sessionId: "s2", startedAt: "2026-08-28T20:10:00Z",
      },
    ],
    reports: [{
      id: "q1", contractId: "c1", verdict: "pass", criticalIssues: [], warnings: [],
      acceptanceCriteriaResults: [], requiresArchitectEscalation: false,
      qaModel: "gpt-5.2-codex", qaProvider: "codex", createdAt: "2026-08-28T20:05:00Z",
    }],
    fixContracts: [], qaRounds: 1,
    createdAt: "2026-08-28T20:00:00Z", updatedAt: "2026-08-28T20:12:00Z",
  };

  it("reads every stage out of the record, in kind", () => {
    const kinds = stagesFor(run).map((entry) => entry.stage);
    expect(kinds).toContain("architect");
    expect(kinds).toContain("implement");
    expect(kinds).toContain("validate");
    expect(kinds).toContain("review");
  });

  it("tells a fix apart from a first implementation", () => {
    expect(stagesFor(run).filter((entry) => entry.stage === "fix")).toHaveLength(1);
  });

  it("marks an implementation with no provider as local", () => {
    const implement = stagesFor(run).find((entry) => entry.stage === "implement");
    expect(implement?.local).toBe(true);
    expect(implement?.relativeCost).toBe(0);
  });

  // Worth showing precisely because it costs nothing: it is the stage that
  // stopped a review from being needed.
  it("shows validation as a stage that cost no tokens and took real time", () => {
    const validate = stagesFor(run).find((entry) => entry.stage === "validate");
    expect(validate?.tokens).toBe(0);
    expect(validate?.durationMs).toBe(4200);
  });

  it("takes token counts from the sessions that reported them", () => {
    const stages = stagesFor(run, { s1: 87_000 });
    expect(stages.find((entry) => entry.stage === "implement")?.tokens).toBe(87_000);
    // s2 reported nothing, and is left unmeasured rather than zeroed.
    expect(stages.find((entry) => entry.stage === "fix")?.tokens).toBeUndefined();
  });

  it("measures how long an implementation actually took", () => {
    expect(stagesFor(run).find((entry) => entry.stage === "implement")?.durationMs).toBe(180_000);
  });
});
