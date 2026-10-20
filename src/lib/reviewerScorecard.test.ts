import { describe, expect, it } from "vitest";
import type { PitwallTask } from "../domain/types";
import { reviewerScorecard } from "./reviewerScorecard";

const at = "2026-10-07T12:00:00Z";
function task(id: string, pair: Partial<NonNullable<PitwallTask["pair"]>>, projectId = "p"): PitwallTask {
  return { id, projectId, title: id, pair: { reviewer: "hermes", maxRounds: 3, round: 1, state: "approved", ...pair } } as PitwallTask;
}
const round = (verdict: "approve" | "request_changes", model = "free/small") => ({ round: 1, verdict, summary: "", comments: [], at, model });

describe("a reviewer's track record", () => {
  it("compares its verdicts with what the person decided, per model", () => {
    const card = reviewerScorecard([
      task("agreed", { rounds: [round("request_changes"), round("approve")], decisions: [{ at, lead: "approved", reviewer: "approved", model: "free/small" }] }),
      task("missed", { rounds: [round("approve")], decisions: [{ at, lead: "sent-back", reviewer: "approved", model: "free/small" }] }),
      task("stricter", { rounds: [round("request_changes", "frontier")], decisions: [{ at, lead: "approved", reviewer: "open-points", model: "frontier" }] }),
      task("agreed-hold", { rounds: [round("request_changes", "frontier")], decisions: [{ at, lead: "sent-back", reviewer: "open-points", model: "frontier" }] }),
      task("undecided", { rounds: [round("approve")] }),
      task("other-reviewer", { reviewer: "claude", rounds: [round("approve")], decisions: [{ at, lead: "approved", reviewer: "approved" }] }),
      task("other-project", { rounds: [round("approve")], decisions: [{ at, lead: "sent-back", reviewer: "approved" }] }, "q"),
    ], "hermes", "p");
    expect(card).toMatchObject({ reviewed: 5, caught: 3, decided: 4, agreed: 2, missed: 1, stricter: 1 });
    expect(card.byModel).toEqual([
      { model: "free/small", decided: 2, agreed: 1, missed: 1, stricter: 0 },
      { model: "frontier", decided: 2, agreed: 1, missed: 0, stricter: 1 },
    ]);
  });

  it("is empty before anything was reviewed", () => {
    expect(reviewerScorecard([], "hermes")).toMatchObject({ reviewed: 0, caught: 0, decided: 0, byModel: [] });
  });
});
