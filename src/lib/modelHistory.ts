import type { BraveliProviderId } from "../domain/types";
import type { RiskLevel } from "../domain/contracts";

/**
 * Which model to trust with an implementation, learned rather than declared.
 *
 * The alternative is a table of model tiers written by hand, and that table is
 * wrong within a month — the same problem as the agent catalogue, except a
 * stale entry here does not show a wrong version number, it routes real work
 * to a model that cannot do it.
 *
 * Pitwall is unusually placed to avoid that. It has the contract, the
 * implementation, the deterministic checks and an independent verdict, for
 * every task, in one repository. That is a closed loop nobody else has: not
 * "how does this model score on a benchmark" but "how often does this model
 * clear review on work that looks like ours, here".
 *
 * ## What this deliberately does not do
 *
 * It does not pick the model. It answers how a model has done, and leaves the
 * choosing to a policy that also knows what the user is willing to spend and
 * where they are willing to send their code. A router that optimises only for
 * measured quality would send everything to the most expensive model that has
 * never failed, which is the behaviour this whole design exists to prevent.
 */

/** One judged attempt, recorded when a review returns a verdict. */
export interface AttemptOutcome {
  projectId: string;
  provider: BraveliProviderId | "";
  model: string;
  riskLevel: RiskLevel;
  /** Whether the review passed it, first time or after fixes. */
  passed: boolean;
  /** How many review rounds it took. One is a first-time pass. */
  rounds: number;
  at: string;
}

export interface ModelRecord {
  provider: BraveliProviderId | "";
  model: string;
  riskLevel: RiskLevel;
  attempts: number;
  passes: number;
  /** Passes that needed no fix round — the number worth routing on. */
  firstTimePasses: number;
  /** Mean review rounds, including the one that passed. */
  averageRounds: number;
}

/**
 * Below this, a rate is an anecdote.
 *
 * Three is not statistics, but the alternative is refusing to say anything
 * until a number nobody reaches in a week of ordinary work. It is enough to
 * notice a model that fails everything, which is the case that matters.
 */
export const MIN_ATTEMPTS_FOR_CONFIDENCE = 3;

const key = (outcome: { provider: string; model: string; riskLevel: string }) =>
  `${outcome.provider}::${outcome.model}::${outcome.riskLevel}`;

/** Folds recorded outcomes into one record per model per risk level. */
export function summarise(outcomes: AttemptOutcome[], projectId?: string): ModelRecord[] {
  const relevant = projectId ? outcomes.filter((outcome) => outcome.projectId === projectId) : outcomes;
  const byKey = new Map<string, ModelRecord & { roundsTotal: number }>();

  for (const outcome of relevant) {
    const existing = byKey.get(key(outcome)) ?? {
      provider: outcome.provider,
      model: outcome.model,
      riskLevel: outcome.riskLevel,
      attempts: 0,
      passes: 0,
      firstTimePasses: 0,
      averageRounds: 0,
      roundsTotal: 0,
    };
    existing.attempts += 1;
    if (outcome.passed) existing.passes += 1;
    if (outcome.passed && outcome.rounds <= 1) existing.firstTimePasses += 1;
    existing.roundsTotal += Math.max(1, outcome.rounds);
    byKey.set(key(outcome), existing);
  }

  return [...byKey.values()]
    .map(({ roundsTotal, ...record }) => ({
      ...record,
      averageRounds: record.attempts ? Number((roundsTotal / record.attempts).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

/**
 * How a model has done here, at this risk level.
 *
 * Falls back to the same model's record at other risk levels before giving
 * up, since a model that clears normal work reliably is evidence about that
 * model even when the question is about a harder task — weaker evidence, and
 * the caller is told which it got.
 */
export function recordFor(
  records: ModelRecord[],
  { provider, model, riskLevel }: { provider: string; model: string; riskLevel: RiskLevel },
): { record?: ModelRecord; confident: boolean; basis: "exact" | "other-risk" | "none" } {
  const exact = records.find(
    (entry) => entry.provider === provider && entry.model === model && entry.riskLevel === riskLevel,
  );
  if (exact) {
    return { record: exact, confident: exact.attempts >= MIN_ATTEMPTS_FOR_CONFIDENCE, basis: "exact" };
  }

  const elsewhere = records.filter((entry) => entry.provider === provider && entry.model === model);
  if (elsewhere.length === 0) return { confident: false, basis: "none" };

  const merged = elsewhere.reduce<ModelRecord>(
    (total, entry) => ({
      ...total,
      attempts: total.attempts + entry.attempts,
      passes: total.passes + entry.passes,
      firstTimePasses: total.firstTimePasses + entry.firstTimePasses,
    }),
    { provider, model, riskLevel, attempts: 0, passes: 0, firstTimePasses: 0, averageRounds: 0 },
  );
  // Never confident on borrowed evidence: it answers a different question.
  return { record: merged, confident: false, basis: "other-risk" };
}

/** The share that cleared review with no fix round. */
export function firstTimeRate(record: ModelRecord | undefined): number | null {
  if (!record || record.attempts === 0) return null;
  return record.firstTimePasses / record.attempts;
}

/**
 * The sentence shown beside a routing choice.
 *
 * A number with no denominator invites more confidence than it has earned, so
 * this always says how many attempts it rests on, and says plainly when it
 * rests on none.
 */
export function describe(
  lookup: ReturnType<typeof recordFor>,
): string {
  const { record, confident, basis } = lookup;
  if (!record || basis === "none") return "No record here yet.";
  const rate = firstTimeRate(record);
  const percent = rate === null ? "—" : `${Math.round(rate * 100)}%`;
  const scope = basis === "other-risk" ? " at other risk levels" : "";
  const caveat = confident ? "" : " — too few attempts to rely on";
  return `Cleared review first time on ${record.firstTimePasses} of ${record.attempts}${scope} (${percent})${caveat}.`;
}
