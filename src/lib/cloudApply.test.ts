import { describe, expect, it } from "vitest";
import type { Project } from "../data";
import type { BraveliWorkspaceState } from "../domain/types";
import records from "../../electron/lib/cloud/records.cjs";
import { applyRemote, renameProject, type CloudAppliedState } from "./cloudApply";
import { buildCloudSnapshot } from "./cloudSnapshot";

const { recordsFromSnapshot } = records;
const T = "2026-10-12T10:00:00.000Z";

function sampleState(): CloudAppliedState {
  const projects: Project[] = [{
    id: "shop-1", name: "Shop", path: "/Users/a/Projects/shop", branch: "main", status: "active", accent: "#0a84ff", health: 90,
    openSessions: 1, queuedTasks: 0, lastCommit: "abc", ci: "passing", queue: [], timeline: [],
    sessions: [{
      id: "claude-shop-1-1", name: "Fix cart", agent: "Claude", status: "running", model: "sonnet", branch: "fix-cart",
      worktreePath: "/Users/a/Library/Application Support/Pitwall/worktrees/x/fix-cart", nativeSessionId: "uuid-1", nativeSessionStarted: true,
      task: "Fix cart", progress: 10, tokens: "1k", approvals: 0, risk: "low", files: 2, started: T, logs: ["secret terminal output"],
    }],
  }];
  const braveli: BraveliWorkspaceState = {
    version: 1,
    projects: [{ id: "shop-1", name: "Shop", path: "/Users/a/Projects/shop", defaultBranch: "main", providerIds: ["claude"], createdAt: T, updatedAt: T }],
    tasks: [{ id: "task-1", identifier: "fix-cart", projectId: "shop-1", title: "Fix the cart", description: "It breaks", status: "running", priority: "high", relatedFiles: [], createdAt: T, updatedAt: T } as never],
    contextEntries: [],
    contextSnapshots: [],
    sessions: [{
      id: "claude-shop-1-1", projectId: "shop-1", provider: "claude", taskId: "task-1", type: "implementation" as never, status: "running", model: "sonnet",
      messages: [{ role: "user", content: "Fix the cart", createdAt: T }], contextSnapshotId: "", createdAt: T, updatedAt: T,
    }],
    activity: [{ id: "a1", projectId: "shop-1", type: "task-created", message: "Created", createdAt: T }],
    councilRuns: [],
    compareRuns: [],
  };
  return {
    projects, braveli, taskRuns: [], outcomes: [{ projectId: "shop-1", provider: "claude", model: "sonnet", riskLevel: "low" as never, passed: true, rounds: 1, at: T }],
    customAgents: [{ id: "ca-1", name: "Mine", command: "mine", args: [], createdAt: T } as never], sessionOrder: { "shop-1": ["claude-shop-1-1"] },
  };
}

const emptyState = (): CloudAppliedState => ({
  projects: [], taskRuns: [], outcomes: [], customAgents: [], sessionOrder: {},
  braveli: { version: 1, projects: [], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], councilRuns: [], compareRuns: [] },
});

function recordsOf(state: CloudAppliedState, prefs: Record<string, string> = {}) {
  return recordsFromSnapshot(buildCloudSnapshot({ ...state, prefs, appliedGeneration: 0 }));
}

describe("cloud records round trip", () => {
  it("rebuilds projects, tasks, sessions and the rest on an empty computer", () => {
    const source = sampleState();
    const applied = applyRemote(emptyState(), recordsOf(source, { "braveli-theme": "dark" }));
    expect(applied.projects[0]).toMatchObject({ id: "shop-1", name: "Shop", path: "/Users/a/Projects/shop" });
    expect(applied.braveli.projects[0]).toMatchObject({ id: "shop-1", defaultBranch: "main" });
    expect(applied.braveli.tasks.map((task) => task.title)).toEqual(["Fix the cart"]);
    expect(applied.braveli.activity.map((event) => event.id)).toEqual(["a1"]);
    expect(applied.outcomes).toHaveLength(1);
    expect(applied.customAgents.map((agent) => agent.id)).toEqual(["ca-1"]);
    expect(applied.sessionOrder).toEqual({ "shop-1": ["claude-shop-1-1"] });
    expect(applied.prefs).toEqual({ "braveli-theme": "dark" });
  });

  it("sends the two copies of a session as one record and fans it back out", () => {
    const source = sampleState();
    const sessionRecords = recordsOf(source).filter((record) => record.kind === "session");
    expect(sessionRecords).toHaveLength(1);
    // The workspace copy never got the native id; the record gives it one.
    expect(sessionRecords[0].data.workspace.nativeSessionId).toBe("uuid-1");
    const applied = applyRemote(emptyState(), recordsOf(source));
    expect(applied.projects[0].sessions[0]).toMatchObject({ id: "claude-shop-1-1", nativeSessionId: "uuid-1", logs: [] });
    expect(applied.braveli.sessions[0]).toMatchObject({ id: "claude-shop-1-1", nativeSessionId: "uuid-1" });
  });

  it("never sends terminal output", () => {
    expect(JSON.stringify(recordsOf(sampleState()))).not.toContain("secret terminal output");
  });

  it("shows a session running elsewhere as disconnected, and keeps a local session's own status", () => {
    const applied = applyRemote(emptyState(), recordsOf(sampleState()));
    expect(applied.projects[0].sessions[0].status).toBe("disconnected");
    expect(applied.braveli.sessions[0].status).toBe("disconnected");
    const local = sampleState();
    const again = applyRemote(local, recordsOf(sampleState()));
    expect(again.projects[0].sessions[0].status).toBe("running");
    expect(again.projects[0].sessions[0].logs).toEqual(["secret terminal output"]);
  });

  it("returns the same objects when nothing changed", () => {
    const incoming = recordsOf(sampleState());
    const once = applyRemote(sampleState(), incoming);
    const again = applyRemote(once, incoming);
    expect(again.projects).toBe(once.projects);
    expect(again.braveli).toBe(once.braveli);
    expect(again.outcomes).toBe(once.outcomes);
    expect(again.customAgents).toBe(once.customAgents);
    expect(again.sessionOrder).toBe(once.sessionOrder);
  });

  it("removes what was deleted elsewhere", () => {
    const local = sampleState();
    const applied = applyRemote(local, [{ kind: "task", localId: "task-1", data: null }, { kind: "session", localId: "claude-shop-1-1", data: null }]);
    expect(applied.braveli.tasks).toEqual([]);
    expect(applied.braveli.sessions).toEqual([]);
    expect(applied.projects[0].sessions).toEqual([]);
  });
});

describe("one repository, one project", () => {
  it("gives a local project the identity of the same repository's project from another computer", () => {
    const local = sampleState();
    const renamed = renameProject(local, "shop-1", "shop-remote");
    expect(renamed.projects.map((project) => project.id)).toEqual(["shop-remote"]);
    expect(renamed.braveli.projects.map((project) => project.id)).toEqual(["shop-remote"]);
    expect(renamed.braveli.tasks[0].projectId).toBe("shop-remote");
    expect(renamed.braveli.sessions[0].projectId).toBe("shop-remote");
    expect(renamed.braveli.activity[0].projectId).toBe("shop-remote");
    expect(renamed.outcomes[0].projectId).toBe("shop-remote");
    expect(renamed.sessionOrder).toEqual({ "shop-remote": ["claude-shop-1-1"] });
    // Nothing else changes.
    expect(renamed.projects[0].sessions[0].id).toBe("claude-shop-1-1");
    expect(renameProject(local, "nope", "x")).toBe(local);
  });
});
