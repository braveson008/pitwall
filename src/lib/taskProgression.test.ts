import { describe, expect, it } from "vitest";
import { shouldMoveToReview } from "./taskProgression";
import type { BraveliSessionStatus, BraveliTaskStatus } from "../domain/types";

const task = (status: BraveliTaskStatus = "running") => ({ id: "t1", status });
const session = (id: string, status: BraveliSessionStatus, taskId = "t1") => ({ id, taskId, status });

describe("shouldMoveToReview", () => {
  it("moves the task when the only session finishes", () => {
    expect(shouldMoveToReview(task(), [session("s1", "completed")], "s1")).toBe(true);
  });

  it("waits while another agent on the same task is still working", () => {
    // A Council's architect finishing is not the council finishing.
    const sessions = [session("s1", "completed"), session("s2", "running")];
    expect(shouldMoveToReview(task(), sessions, "s1")).toBe(false);
  });

  it("counts a session waiting on the user as still working", () => {
    const sessions = [session("s1", "completed"), session("s2", "waiting")];
    expect(shouldMoveToReview(task(), sessions, "s1")).toBe(false);
  });

  it("counts a session still starting as still working", () => {
    const sessions = [session("s1", "completed"), session("s2", "starting")];
    expect(shouldMoveToReview(task(), sessions, "s1")).toBe(false);
  });

  it("moves the task once every other session has stopped", () => {
    const sessions = [session("s1", "completed"), session("s2", "completed"), session("s3", "failed")];
    expect(shouldMoveToReview(task(), sessions, "s1")).toBe(true);
  });

  it("ignores sessions belonging to other tasks", () => {
    const sessions = [session("s1", "completed"), session("s2", "running", "t2")];
    expect(shouldMoveToReview(task(), sessions, "s1")).toBe(true);
  });

  for (const status of ["backlog", "ready", "review", "completed", "cancelled"] as BraveliTaskStatus[]) {
    it(`leaves a ${status} task alone`, () => {
      expect(shouldMoveToReview(task(status), [session("s1", "completed")], "s1")).toBe(false);
    });
  }

  it("does not depend on the finished session appearing in the list", () => {
    // The record may already have been pruned by the time this is asked.
    expect(shouldMoveToReview(task(), [], "s1")).toBe(true);
  });
});
