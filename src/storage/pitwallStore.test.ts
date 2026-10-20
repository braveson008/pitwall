import { describe, expect, it } from "vitest";
import { normalizeSessionStatus, normalizeTask } from "./pitwallStore";
import type { PitwallTask } from "../domain/types";

describe("normalizeSessionStatus", () => {
  it("migrates legacy session labels without losing their meaning", () => {
    expect(normalizeSessionStatus("paused")).toBe("waiting");
    expect(normalizeSessionStatus("idle")).toBe("completed");
    expect(normalizeSessionStatus("blocked")).toBe("failed");
  });

  it("keeps current lifecycle states and quarantines unknown values", () => {
    expect(normalizeSessionStatus("starting")).toBe("starting");
    expect(normalizeSessionStatus("disconnected")).toBe("disconnected");
    expect(normalizeSessionStatus("mystery")).toBe("disconnected");
  });
});

describe("normalizeTask", () => {
  it("gives a task saved or synced without related files an empty list, so the review screen can count them", () => {
    const bare = { id: "t", title: "Ship it", status: "review" } as unknown as PitwallTask;
    expect(normalizeTask(bare).relatedFiles).toEqual([]);
    const kept = { ...bare, relatedFiles: ["a.ts"] } as PitwallTask;
    expect(normalizeTask(kept)).toBe(kept);
  });
});
