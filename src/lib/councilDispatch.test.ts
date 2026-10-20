import { describe, expect, it } from "vitest";

/**
 * What a turn's dispatch may conclude, and what the relay does about it.
 *
 * This encodes the decision that broke a twelve-turn council: a member's CLI
 * exiting is ordinary, not exceptional. Codex finishes its turn and quits with
 * code 0, leaving a pane that reads `[process exited 0]` and looks fine. The
 * relay treated the failed write into that dead terminal as the end of the run
 * and asked the user to go and start something.
 */
type Dispatch = "sent" | "restarted" | "gated" | "failed";

/** The relay continues when anybody received the turn, however they got it. */
const delivered = (results: Dispatch[]) => results.includes("sent") || results.includes("restarted");

/** It stops and explains only when nobody received it and nobody is being waited on. */
const shouldStop = (results: Dispatch[]) => !delivered(results) && !results.includes("gated");

describe("a turn's delivery", () => {
  it("continues when a member had to be restarted first", () => {
    // The case that was being treated as fatal.
    expect(delivered(["restarted"])).toBe(true);
    expect(shouldStop(["restarted"])).toBe(false);
  });

  it("continues when one panel member was restarted and another was live", () => {
    expect(delivered(["sent", "restarted"])).toBe(true);
  });

  it("waits rather than stops when a pane is asking the user something", () => {
    // A gate is watched and resumes by itself; stopping would discard that.
    expect(shouldStop(["gated"])).toBe(false);
    expect(delivered(["gated"])).toBe(false);
  });

  it("stops only when nothing could be delivered and nothing is pending", () => {
    expect(shouldStop(["failed"])).toBe(true);
    expect(shouldStop(["failed", "failed"])).toBe(true);
  });

  it("does not stop a panel where one voice failed and another spoke", () => {
    // A panel is several members consulted at once; losing one is not the run.
    expect(shouldStop(["failed", "sent"])).toBe(false);
  });
});
