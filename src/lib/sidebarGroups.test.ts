import { describe, expect, it } from "vitest";
import type { Project } from "../data";
import type { PitwallCouncilRun, PitwallTask } from "../domain/types";
import { buildSidebarGroups, relativeTime } from "./sidebarGroups";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function task(partial: Partial<PitwallTask>): PitwallTask {
  return { id: "t", projectId: "p", title: "Task", description: "", status: "ready", priority: "medium", assignedAgent: "claude", relatedFiles: [], worktree: "", createdAt: ago(60), updatedAt: ago(5), ...partial } as PitwallTask;
}

function session(partial: Record<string, unknown>) {
  return { id: "s", name: "Session", task: "", agent: "Claude", status: "running", started: ago(5), branch: "main", ...partial } as never;
}

function project(sessions: Project["sessions"] = [], id = "p", name = "payments"): Project {
  return { id, name, path: `/${id}`, branch: "main", sessions } as unknown as Project;
}

describe("sidebar groups", () => {
  it("has two lists: every session in Working, and tasks in review in Review", () => {
    const groups = buildSidebarGroups({
      tasks: [
        task({ id: "a", identifier: "pay-7", title: "Add the step helpers", status: "review", pair: { reviewer: "hermes", maxRounds: 2, round: 2, state: "approved" } }),
        task({ id: "b", title: "Retry webhooks", status: "running" }),
        task({ id: "d", title: "Export CSV", status: "ready" }),
        task({ id: "e", title: "Shipped", status: "completed" }),
      ],
      projects: [project([
        session({ id: "sa", name: "Add the step helpers", status: "idle" }),
        session({ id: "sb", name: "Retry webhooks", status: "running" }),
        session({ id: "sc", name: "Quick question", status: "failed" }),
      ])],
      links: [{ id: "sa", taskId: "a" }, { id: "sb", taskId: "b" }],
      projectFilter: "",
      now: NOW,
    });
    expect(groups.map((group) => group.name)).toEqual(["Working", "Review"]);
    expect(groups[0].rows.map((row) => row.title)).toEqual(["Add the step helpers", "Retry webhooks", "Quick question"]);
    expect(groups[1].rows).toEqual([expect.objectContaining({ key: "PAY-7", needsYou: true, status: "Approved by the reviewer", sessionId: "sa", when: "5m" })]);
  });

  it("keeps sessions in the order the person put them, not by state", () => {
    const groups = buildSidebarGroups({
      tasks: [],
      projects: [project([session({ id: "a", name: "A" }), session({ id: "b", name: "B", status: "waiting" }), session({ id: "c", name: "C" })])],
      sessionOrder: { p: ["c", "a"] },
      projectFilter: "",
      now: NOW,
    });
    expect(groups[0].rows.map((row) => row.title)).toEqual(["C", "A", "B"]);
    expect(groups[0].rows[2].needsYou).toBe(true);
  });

  it("puts back a name that was saved cut short", () => {
    const groups = buildSidebarGroups({
      tasks: [task({ id: "a", title: "Handle the object type in the picker" })],
      projects: [project([session({ id: "s", name: "Handle the object t… · Implementer" })])],
      links: [{ id: "s", taskId: "a" }],
      projectFilter: "",
      now: NOW,
    });
    expect(groups[0].rows[0].title).toBe("Handle the object type in the picker · Implementer");
  });

  it("shows a Council as one row that speaks for its liveliest member", () => {
    const run = { id: "r", projectId: "p", name: "Paging council", prompt: "", createdAt: ago(3), responses: [{ sessionId: "m1" }, { sessionId: "m2" }] } as unknown as PitwallCouncilRun;
    const groups = buildSidebarGroups({
      tasks: [],
      projects: [project([session({ id: "m1", status: "idle" }), session({ id: "m2", status: "waiting" }), session({ id: "x", name: "Solo" })])],
      councilRuns: [run],
      projectFilter: "",
      now: NOW,
    });
    expect(groups[0].rows.map((row) => row.title)).toEqual(["Solo", "Paging council"]);
    expect(groups[0].rows[1]).toMatchObject({ kind: "council", councilRunId: "r", sessionId: "m2", needsYou: true, status: "Council of 2" });
  });

  it("shows a session being created first in Working, in its own project only", () => {
    const groups = buildSidebarGroups({
      tasks: [],
      projects: [project([session({ id: "a", name: "A" })]), project([], "q", "docs")],
      starting: [{ id: "starting-1", projectId: "p", title: "Fix the picker", agent: "Codex" }, { id: "starting-2", projectId: "q", title: "Docs", agent: "Claude" }],
      projectFilter: "p",
      now: NOW,
    });
    expect(groups[0].rows.map((row) => [row.kind, row.title])).toEqual([["starting", "Fix the picker"], ["session", "A"]]);
    expect(groups[0].rows[0].status).toBe("Codex");
  });

  it("filters to one project", () => {
    const groups = buildSidebarGroups({
      tasks: [task({ id: "a", projectId: "q", status: "review" })],
      projects: [project([session({ id: "s1" })]), project([session({ id: "s2" })], "q", "docs")],
      projectFilter: "p",
      now: NOW,
    });
    expect(groups).toEqual([{ name: "Working", rows: [expect.objectContaining({ sessionId: "s1" })] }]);
  });

  it("is empty when there is nothing to show", () => {
    expect(buildSidebarGroups({ tasks: [task({ status: "ready" })], projects: [project()], projectFilter: "", now: NOW })).toEqual([]);
  });

  it("reads time the way a list does", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("now");
    expect(relativeTime(NOW - 6 * 60_000, NOW)).toBe("6m");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d");
    expect(relativeTime(0, NOW)).toBe("");
  });
});
