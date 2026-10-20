import { describe, expect, it } from "vitest";
import type { PitwallTask } from "../domain/types";
import {
  formatChangeRequestPrompt,
  isUsableRequest,
  makeChangeRequest,
  markDelivered,
  pendingRequests,
  statusAfterRequest,
  type ChangeRequest,
  type TaskWithRequests,
} from "./changeRequests";

const NOW = "2026-08-25T12:00:00.000Z";
const LATER = "2026-08-25T12:30:00.000Z";

const task = (extra: Partial<TaskWithRequests> = {}): TaskWithRequests =>
  ({
    id: "t1", identifier: "pay-118", projectId: "p1", title: "Totals are a penny short",
    description: "", status: "review", priority: "medium", assignedAgent: "claude",
    relatedFiles: [], worktree: "pay-118", createdAt: NOW, updatedAt: NOW,
    ...extra,
  }) as TaskWithRequests;

const request = (id: string, body: string, deliveredAt: string | null = null): ChangeRequest =>
  ({ id, body, createdAt: NOW, deliveredAt });

describe("isUsableRequest", () => {
  it("rejects nothing at all", () => {
    expect(isUsableRequest("")).toBe(false);
    expect(isUsableRequest("   \n\t ")).toBe(false);
  });

  it("accepts anything with words in it", () => {
    expect(isUsableRequest("Use minor units here")).toBe(true);
  });
});

describe("makeChangeRequest", () => {
  it("trims, so stray whitespace is not sent to an agent as instruction", () => {
    expect(makeChangeRequest("  fix rounding  ", NOW, "r1")).toEqual({
      id: "r1", body: "fix rounding", createdAt: NOW, deliveredAt: null,
    });
  });
});

describe("pendingRequests", () => {
  it("is empty for a task that has never had one", () => {
    expect(pendingRequests(task())).toEqual([]);
  });

  it("returns only what no agent has been shown", () => {
    const t = task({ changeRequests: [request("a", "one", NOW), request("b", "two")] });
    expect(pendingRequests(t).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("markDelivered", () => {
  it("stamps only the ones named", () => {
    const t = task({ changeRequests: [request("a", "one"), request("b", "two")] });
    const after = markDelivered(t, ["a"], LATER);
    expect(after[0].deliveredAt).toBe(LATER);
    expect(after[1].deliveredAt).toBeNull();
  });

  it("does not re-stamp one already delivered, which would lose when it happened", () => {
    const t = task({ changeRequests: [request("a", "one", NOW)] });
    expect(markDelivered(t, ["a"], LATER)[0].deliveredAt).toBe(NOW);
  });
});

describe("formatChangeRequestPrompt", () => {
  it("says nothing when there is nothing to say", () => {
    expect(formatChangeRequestPrompt(task(), [])).toBe("");
  });

  it("does not number a single request", () => {
    const prompt = formatChangeRequestPrompt(task(), [request("a", "Use minor units")]);
    expect(prompt).toContain("asked for one change");
    expect(prompt).not.toContain("1. Use minor units");
    expect(prompt).toContain("Use minor units");
  });

  it("numbers several so they can be answered individually", () => {
    const prompt = formatChangeRequestPrompt(task(), [request("a", "First"), request("b", "Second")]);
    expect(prompt).toContain("asked for 2 changes");
    expect(prompt).toContain("1. First");
    expect(prompt).toContain("2. Second");
  });

  it("names the branch so the agent does not go looking elsewhere", () => {
    expect(formatChangeRequestPrompt(task(), [request("a", "x")])).toContain("`pay-118`");
  });

  it("omits the branch line when a task has no worktree", () => {
    const prompt = formatChangeRequestPrompt(task({ worktree: "" }), [request("a", "x")]);
    expect(prompt).not.toContain("branch");
  });

  it("asks for the change and nothing else", () => {
    expect(formatChangeRequestPrompt(task(), [request("a", "x")])).toContain(
      "Change only what was asked for",
    );
  });

  it("falls back to the title when a task has no identifier", () => {
    const prompt = formatChangeRequestPrompt(task({ identifier: undefined }), [request("a", "x")]);
    expect(prompt).toContain("Totals are a penny short");
  });
});

describe("statusAfterRequest", () => {
  it("goes back to running when an agent was actually told", () => {
    expect(statusAfterRequest(true)).toBe("running");
  });

  it("queues when nothing was listening, rather than leaving it looking finished", () => {
    expect(statusAfterRequest(false)).toBe("ready");
  });

  it("never leaves the task in review", () => {
    const outcomes: PitwallTask["status"][] = [statusAfterRequest(true), statusAfterRequest(false)];
    expect(outcomes).not.toContain("review");
  });
});

describe("a request about one file", () => {
  it("names the file, so the agent does not have to find it", () => {
    const prompt = formatChangeRequestPrompt(task(), [
      { ...request("a", "Round before converting, not after."), filePath: "src/pricing/totals.ts" },
    ]);
    expect(prompt).toContain("`src/pricing/totals.ts`");
    expect(prompt).toContain("Round before converting, not after.");
  });

  it("puts the file on its own line rather than burying it in prose", () => {
    const prompt = formatChangeRequestPrompt(task(), [
      { ...request("a", "First sentence. Second sentence."), filePath: "src/a.ts" },
    ]);
    expect(prompt).toContain("In `src/a.ts`:\nFirst sentence.");
  });

  it("still handles a request about the change as a whole", () => {
    const prompt = formatChangeRequestPrompt(task(), [request("a", "Split this into two commits.")]);
    expect(prompt).not.toContain("In `");
    expect(prompt).toContain("Split this into two commits.");
  });

  it("mixes per-file and whole-change requests in one numbered list", () => {
    const prompt = formatChangeRequestPrompt(task(), [
      { ...request("a", "Use minor units."), filePath: "src/a.ts" },
      request("b", "Add a test for the empty basket."),
    ]);
    expect(prompt).toContain("1. In `src/a.ts`:");
    expect(prompt).toContain("2. Add a test for the empty basket.");
  });

  it("records the file on the request itself", () => {
    expect(makeChangeRequest("x", NOW, "r1", "src/a.ts").filePath).toBe("src/a.ts");
    expect(makeChangeRequest("x", NOW, "r1").filePath).toBeUndefined();
  });
});
