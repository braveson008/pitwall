import { describe, expect, it } from "vitest";
import type { AgentSession } from "../data";
import type { BraveliSession, BraveliTask } from "../domain/types";
import { selectTaskWorkspace } from "./taskWorkspace";

const task = { id: "task-1", identifier: "eng-412", worktree: "eng-412" } as BraveliTask;

describe("selectTaskWorkspace", () => {
  it("prefers the checkout already owned by a task session", () => {
    expect(selectTaskWorkspace({
      task,
      projectPath: "/repo",
      sessions: [{ id: "session-1", worktreePath: "/managed/eng-412" } as AgentSession],
      runs: [{ id: "session-1", taskId: "task-1" } as BraveliSession],
      worktrees: [{ path: "/managed/eng-412", branch: "session-branch" }, { path: "/other", branch: "eng-412" }],
    })).toEqual({ path: "/managed/eng-412", fallback: false });
  });

  it("does not trust a stale session checkout path", () => {
    expect(selectTaskWorkspace({
      task,
      projectPath: "/repo",
      sessions: [{ id: "session-1", worktreePath: "/removed/eng-412" } as AgentSession],
      runs: [{ id: "session-1", taskId: "task-1" } as BraveliSession],
      worktrees: [{ path: "/live/eng-412", branch: "eng-412" }],
    })).toEqual({ path: "/live/eng-412", fallback: false });
  });

  it("matches a branch and explicitly reports project-root fallback", () => {
    const base = { task, projectPath: "/repo", sessions: [], runs: [] };
    expect(selectTaskWorkspace({ ...base, worktrees: [{ path: "/worktrees/eng-412", branch: "eng-412" }] })).toEqual({ path: "/worktrees/eng-412", fallback: false });
    expect(selectTaskWorkspace({ ...base, worktrees: [] })).toEqual({ path: "/repo", fallback: true });
  });
});
