import { describe, expect, it } from "vitest";
import type { SessionStatus } from "../data";
import { scheduleOverlap } from "../domain/schedule";
import {
  isLiveSessionStatus,
  settleSessions,
  statusAfterAttach,
  statusAfterTerminalClosed,
  statusWithoutTerminal,
} from "./sessionSettlement";

describe("statusAfterTerminalClosed", () => {
  it("settles a live record by how its process ended", () => {
    expect(statusAfterTerminalClosed("running", { exitCode: 0 })).toBe("completed");
    expect(statusAfterTerminalClosed("waiting", { exitCode: 1 })).toBe("failed");
    expect(statusAfterTerminalClosed("starting", { stopped: true })).toBe("disconnected");
    expect(statusAfterTerminalClosed("running", {})).toBe("disconnected");
  });

  it("does not overwrite an outcome the agent already reported", () => {
    expect(statusAfterTerminalClosed("failed", { exitCode: 0 })).toBeNull();
    expect(statusAfterTerminalClosed("completed", { exitCode: 1 })).toBeNull();
    expect(statusAfterTerminalClosed("disconnected", { stopped: true })).toBeNull();
  });
});

describe("statusAfterAttach", () => {
  it("is running when a prompt went with the launch", () => {
    expect(statusAfterAttach("completed", true)).toBe("running");
    expect(statusAfterAttach("starting", false)).toBe("running");
  });

  it("does not make a reattached, idle session live again", () => {
    // How restored sessions stayed `running` for days: attaching marked them
    // live, and an agent sitting at its prompt never reports anything.
    expect(statusAfterAttach("completed", false)).toBe("completed");
    expect(statusAfterAttach("failed", false)).toBe("failed");
    expect(statusAfterAttach("disconnected", false)).toBe("completed");
    expect(isLiveSessionStatus(statusAfterAttach("disconnected", false))).toBe(false);
  });

  it("leaves a session that is mid-turn as it is", () => {
    expect(statusAfterAttach("running", false)).toBe("running");
    expect(statusAfterAttach("waiting", false)).toBe("waiting");
  });
});

describe("settling records without a terminal", () => {
  type Row = { id: string; status: SessionStatus; updatedAt: string; taskId?: string };
  const record = (id: string, status: SessionStatus): Row => ({ id, status, updatedAt: "before" });
  const settleOrphans = (sessions: Row[], hasTerminal: (id: string) => boolean) =>
    settleSessions(sessions, (session) => statusWithoutTerminal(session, hasTerminal), { updatedAt: "now" });

  it("settles every live record without a terminal, and only those", () => {
    const sessions = [
      record("orphan", "running"),
      record("attached", "running"),
      record("asking", "waiting"),
      record("done", "completed"),
    ];
    const settled = settleOrphans(sessions, (id) => id === "attached");
    expect(settled.map((item) => item.status)).toEqual(["disconnected", "running", "disconnected", "completed"]);
    expect(settled.map((item) => item.updatedAt)).toEqual(["now", "before", "now", "before"]);
    expect(settled[1]).toBe(sessions[1]);
  });

  it("returns the same array when there is nothing to settle", () => {
    // A new array is a state change, and a state change is a storage write —
    // one that can land over whatever else was just written there.
    const sessions = [record("done", "completed"), record("attached", "running")];
    expect(settleOrphans(sessions, (id) => id === "attached")).toBe(sessions);
    expect(settleSessions(sessions, (session) => session.status)).toBe(sessions);
  });

  it("frees a booking whose last run lost its terminal, without touching one that is live", () => {
    // The overlap guard's own liveness rule, applied to settled records.
    const job = {
      id: "job-1", hour: 8, minute: 0, prompt: "p", projectId: "p1", agent: "Claude", enabled: true,
      everyHours: 1, days: [], lastRunDate: "",
      history: [{ at: "2026-09-22T12:50:00.000Z", outcome: "running", taskId: "task-a" }],
    } as unknown as ScheduleJob;
    const at = Date.parse("2026-09-22T13:04:00.000Z");
    const guard = (sessions: Row[]) =>
      scheduleOverlap(job, (taskId) => sessions.some((item) => item.taskId === taskId && isLiveSessionStatus(item.status)), at).kind;

    const records: Row[] = [{ ...record("s1", "running"), taskId: "task-a" }];
    expect(guard(settleOrphans(records, () => false))).toBe("free");
    // A second agent must not start beside a live one.
    expect(guard(settleOrphans(records, () => true))).toBe("running");
  });
});
