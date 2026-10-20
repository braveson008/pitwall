import type { RiskLevel } from "../domain/contracts";
import type { BraveliProviderId } from "../domain/types";
import { firstTimeRate, recordFor, type ModelRecord } from "./modelHistory";

/**
 * Choosing who does the work.
 *
 * Three inputs, and the order matters. Policy first, because it is the
 * user's decision and no measurement overrules it — a project that may not
 * leave the machine may not leave the machine, however well a cloud model
 * scores. Then measured history, because it is the only evidence about this
 * codebase. Then cost, to break ties.
 *
 * The router never picks the best model. It picks the cheapest one there is
 * reason to believe can do this job, which is a different question and the
 * one the whole design is about.
 */

/** What the user is willing to spend, and where their code may go. */
export type ImplementerPolicy =
  /** Cheapest that the evidence supports, wherever it runs. */
  | "cheapest"
  /** Cheapest, but nothing leaves this machine. */
  | "local-only"
  /** Always the strongest available; the loop still applies. */
  | "always-premium";

/** One model Pitwall could hand an implementation to. */
export interface Candidate {
  provider: BraveliProviderId | "";
  model: string;
  /** Rough cost per implementation, relative — 0 for anything local. */
  relativeCost: number;
  /** True when inference happens on this machine. */
  local: boolean;
  /** Whether Pitwall can actually start a session with it today. */
  drivable: boolean;
}

export interface RoutingChoice {
  candidate: Candidate | null;
  /** Shown to the user beside the choice. Never a bare model name. */
  reason: string;
  /** True when nothing measured supports this and it is a first try. */
  speculative: boolean;
}

/**
 * The share of first-time passes below which a model is not worth routing
 * work to, even though it is cheap.
 *
 * A model that clears review half the time costs two implementations and two
 * reviews per task. At that point the cheap model is not cheap: the reviews
 * are premium and there are twice as many of them.
 */
export const MIN_FIRST_TIME_RATE = 0.5;

/**
 * Who should implement this.
 *
 * High risk does not automatically mean an expensive implementer — that is
 * the distinction the design rests on. A precise contract can make a hard
 * task an ordinary implementation, so risk raises the bar on *evidence*
 * rather than forcing a model: at high risk an unmeasured model is not
 * guessed at, where at normal risk it is worth one attempt.
 */
export function chooseImplementer({
  candidates,
  records,
  policy,
  riskLevel,
  escalate,
}: {
  candidates: Candidate[];
  records: ModelRecord[];
  policy: ImplementerPolicy;
  riskLevel: RiskLevel;
  /** Set after a rejection: the previous choice was not good enough. */
  escalate?: boolean;
}): RoutingChoice {
  const usable = candidates.filter((candidate) => candidate.drivable);
  const allowed = policy === "local-only" ? usable.filter((candidate) => candidate.local) : usable;

  if (allowed.length === 0) {
    return {
      candidate: null,
      reason: policy === "local-only"
        ? "No local model is installed and this project may not leave the machine."
        : "No agent is installed that Pitwall can drive.",
      speculative: false,
    };
  }

  const strongest = [...allowed].sort((a, b) => b.relativeCost - a.relativeCost)[0];

  if (policy === "always-premium") {
    return { candidate: strongest, reason: "This project always uses its strongest model.", speculative: false };
  }

  // A rejection is evidence about the model that was rejected, so the answer
  // is a better one rather than another go at the same one.
  if (escalate) {
    return {
      candidate: strongest,
      reason: "The previous implementation was rejected, so the fix goes to the strongest available model.",
      speculative: false,
    };
  }

  const ranked = [...allowed].sort((a, b) => a.relativeCost - b.relativeCost);
  // Whether anything cheaper was passed over for having measurably failed
  // here, so the sentence can say that rather than claiming this was simply
  // the cheapest thing available.
  let skippedForRecord = false;

  for (const candidate of ranked) {
    const lookup = recordFor(records, { provider: candidate.provider, model: candidate.model, riskLevel });
    const rate = firstTimeRate(lookup.record);

    if (lookup.confident && rate !== null) {
      if (rate >= MIN_FIRST_TIME_RATE) {
        return {
          candidate,
          reason: `Cleared review first time on ${lookup.record!.firstTimePasses} of ${lookup.record!.attempts} here.`,
          speculative: false,
        };
      }
      skippedForRecord = true;
      continue;                                   // measured, and not good enough
    }

    // Nothing measured. Worth one attempt at ordinary work — that is how the
    // record gets made — but not on something high risk, where the cost of
    // being wrong is a rejected implementation of the thing that mattered.
    if (riskLevel !== "high") {
      return {
        candidate,
        reason: skippedForRecord
          ? "Cheaper models have not cleared review here; trying this one, which has no record yet."
          : "No record here yet — trying the cheapest model once to find out.",
        speculative: true,
      };
    }
  }

  return {
    candidate: strongest,
    reason: riskLevel === "high"
      ? "High risk, and nothing cheaper has a record here."
      : "No cheaper model has cleared review here often enough.",
    speculative: false,
  };
}

/**
 * How much judgement a request needs, before anyone has looked at the code.
 *
 * Deliberately crude, and it only ever raises. Getting this wrong upward
 * costs one unnecessary architect; getting it wrong downward sends a
 * migration to a cheap model with no contract. The words are a first pass —
 * the architect's own risk assessment overrules it once one exists.
 */
const HIGH_RISK_WORDS = /\b(auth|authentication|authorization|security|credential|token|password|migrat|schema change|concurren|race|payment|billing|encrypt|permission)\w*/i;
const TRIVIAL_WORDS = /\b(typo|copy|wording|rename|comment|whitespace|format|bump|changelog)\b/i;

export function classifyRequest(request: string, affectedFileCount = 0): RiskLevel {
  const text = String(request || "");
  if (HIGH_RISK_WORDS.test(text)) return "high";
  if (affectedFileCount > 8) return "high";
  // Only short, single-file requests are trivial; "rename the auth cookie" is
  // caught above and stays high.
  if (TRIVIAL_WORDS.test(text) && text.length < 120 && affectedFileCount <= 1) return "trivial";
  return "normal";
}
