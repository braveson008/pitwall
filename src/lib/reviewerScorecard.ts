import type { PitwallPairDecision, PitwallTask } from "../domain/types";

export type ScoreLine = { model: string; decided: number; agreed: number; missed: number; stricter: number };

export type ReviewerScorecard = ScoreLine & {
  /** Tasks it reviewed. */
  reviewed: number;
  /** Times it sent work back to the agent before it reached the person. */
  caught: number;
  byModel: ScoreLine[];
};

const empty = (model: string): ScoreLine => ({ model, decided: 0, agreed: 0, missed: 0, stricter: 0 });

function count(line: ScoreLine, decision: PitwallPairDecision) {
  line.decided += 1;
  if (decision.reviewer === "approved" && decision.lead === "sent-back") line.missed += 1;
  else if (decision.reviewer === "open-points" && decision.lead === "approved") line.stricter += 1;
  else line.agreed += 1;
}

/**
 * How a reviewer's verdicts compared with what the person then decided.
 *
 * Missed: it approved, and the person sent the work back. Stricter: it held
 * the work back, and the person approved it as it was. Agreed: either way, the
 * person decided as it had. Its catches are the rounds it sent back to the
 * agent, which the person never had to see.
 */
export function reviewerScorecard(tasks: readonly PitwallTask[], reviewer: string, projectId?: string): ReviewerScorecard {
  const total: ReviewerScorecard = { ...empty("all"), reviewed: 0, caught: 0, byModel: [] };
  const byModel = new Map<string, ScoreLine>();
  for (const task of tasks) {
    const pair = task.pair;
    if (!pair || pair.reviewer !== reviewer || (projectId && task.projectId !== projectId)) continue;
    const rounds = pair.rounds ?? [];
    if (rounds.length) total.reviewed += 1;
    total.caught += rounds.filter((round) => round.verdict === "request_changes").length;
    for (const decision of pair.decisions ?? []) {
      count(total, decision);
      const model = decision.model || "default";
      if (!byModel.has(model)) byModel.set(model, empty(model));
      count(byModel.get(model)!, decision);
    }
  }
  total.byModel = [...byModel.values()].sort((a, b) => b.decided - a.decided);
  return total;
}
