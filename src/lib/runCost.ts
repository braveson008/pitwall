import type { TaskRun } from "../domain/contracts";

/**
 * What a task cost, and what the routing avoided.
 *
 * Two rules, because a cost view that is not trustworthy is worse than none —
 * somebody makes a decision on it.
 *
 * It never invents a number. Pitwall reads token counts from what a CLI
 * reports, and not every CLI reports one; a stage with no figure is shown as
 * unknown rather than estimated, because an estimate presented beside a
 * measurement gets read as a measurement.
 *
 * And the saving is a comparison, stated as one. "Premium tokens avoided" is
 * not a fact — it is the difference against a premium model doing the same
 * work, which nobody ran. So it is labelled as the counterfactual it is, and
 * only shown where the actual figures are known.
 */

export interface StageCost {
  stage: "architect" | "implement" | "validate" | "review" | "fix";
  provider: string;
  model: string;
  /** Absent when the CLI reported none, which is common and not an error. */
  tokens?: number;
  /** Relative to a premium implementation of the same stage. 0 for local. */
  relativeCost: number;
  local: boolean;
  durationMs: number;
}

export interface RunCost {
  stages: StageCost[];
  totalTokens: number | null;
  /** Tokens spent on models that bill, i.e. not local. */
  billedTokens: number | null;
  localTokens: number | null;
  /** Stages that reported nothing, so the totals can be read honestly. */
  unmeasuredStages: number;
  wallClockMs: number;
}

export function summariseCost(stages: StageCost[]): RunCost {
  const measured = stages.filter((stage) => typeof stage.tokens === "number");
  const unmeasured = stages.length - measured.length;

  const sum = (list: StageCost[]) => list.reduce((total, stage) => total + (stage.tokens ?? 0), 0);

  return {
    stages,
    // Null rather than a partial sum: adding up half the stages and calling it
    // a total is the kind of number people quote.
    totalTokens: measured.length === stages.length && stages.length > 0 ? sum(measured) : null,
    billedTokens: measured.length ? sum(measured.filter((stage) => !stage.local)) : null,
    localTokens: measured.length ? sum(measured.filter((stage) => stage.local)) : null,
    unmeasuredStages: unmeasured,
    wallClockMs: stages.reduce((total, stage) => total + stage.durationMs, 0),
  };
}

/**
 * What the routing saved, phrased as the comparison it is.
 *
 * Returns null unless every stage reported tokens. A saving computed from
 * half the data would be the most quotable and least true number on the
 * screen.
 */
export function savingAgainstPremium(cost: RunCost): { tokens: number; note: string } | null {
  if (cost.localTokens === null || cost.unmeasuredStages > 0) return null;
  if (cost.localTokens === 0) return null;
  return {
    tokens: cost.localTokens,
    note: "Tokens that ran locally instead of being billed. A premium model doing the same work would have billed for them.",
  };
}

/** Reads the stages out of a run, so the view does not walk the record. */
export function stagesFor(run: TaskRun, tokensBySession: Record<string, number> = {}): StageCost[] {
  const stages: StageCost[] = [];

  if (run.contract) {
    stages.push({
      stage: "architect",
      provider: run.contract.architectProvider,
      model: run.contract.architectModel,
      relativeCost: 1,
      local: false,
      durationMs: 0,
    });
  }

  for (const attempt of run.attempts) {
    stages.push({
      stage: attempt.fixContractId ? "fix" : "implement",
      provider: attempt.provider,
      model: attempt.model,
      tokens: tokensBySession[attempt.sessionId],
      relativeCost: attempt.provider ? 1 : 0,
      local: !attempt.provider,
      durationMs: attempt.finishedAt && attempt.startedAt
        ? Math.max(0, Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt))
        : 0,
    });

    if (attempt.validation) {
      // The cheapest stage there is, and worth showing precisely because it
      // costs nothing: it is the one that stopped a review from being needed.
      stages.push({
        stage: "validate",
        provider: "",
        model: "deterministic",
        tokens: 0,
        relativeCost: 0,
        local: true,
        durationMs: attempt.validation.checks.reduce((total, check) => total + check.durationMs, 0),
      });
    }
  }

  for (const report of run.reports) {
    stages.push({
      stage: "review",
      provider: report.qaProvider,
      model: report.qaModel,
      relativeCost: 1,
      local: false,
      durationMs: 0,
    });
  }

  return stages;
}
