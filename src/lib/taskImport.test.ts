import { describe, expect, it } from "vitest";
import type { PitwallTask } from "../domain/types";
import {
  allocateImportedTaskIdentifier,
  flattenMcpTaskSources,
  groupImportCandidates,
  summariseImportGroup,
  importedTaskIdentity,
  mapExternalTaskStatus,
  mcpTaskIdentity,
  mcpTaskSourceLabel,
  planTrackerSync,
  summariseTrackerSync,
  sortMcpTaskSources,
} from "./taskImport";

describe("allocateImportedTaskIdentifier", () => {
  it("turns a tracker key into a valid unique branch identifier", () => {
    const used = new Set(["eng-412"]);
    expect(allocateImportedTaskIdentifier({ id: "ENG-412", title: "Fix parser" }, used)).toBe("eng-412-2");
    expect(allocateImportedTaskIdentifier({ title: "Add Jira import!" }, used)).toBe("add-jira-import");
  });

  it("falls back when the tracker identity cannot form a branch", () => {
    expect(allocateImportedTaskIdentifier({ id: "🎯", title: "Ignored" }, new Set())).toBe("imported-task");
  });
});

describe("MCP task identity", () => {
  it("matches a stored imported task to the same remote item", () => {
    const stored = {
      title: "Fix parser",
      source: { kind: "mcp", name: "Linear", externalId: "ENG-412" },
    } as PitwallTask;
    expect(importedTaskIdentity(stored)).toBe(mcpTaskIdentity("claude", "linear", { id: "eng-412", title: "Changed" }));
  });

  it("keeps equal tracker ids distinct when different providers own them", () => {
    const candidate = { id: "ENG-412", title: "Fix parser" };
    expect(mcpTaskIdentity("claude", "linear", candidate)).not.toBe(mcpTaskIdentity("codex", "linear", candidate));
  });
});

describe("flattenMcpTaskSources", () => {
  it("flattens providers, deduplicates provider rows, and humanizes plugin names", () => {
    const source = { name: "plugin:atlassian:atlassian", target: "https://mcp.atlassian.com", transport: "HTTP", status: "connected", statusText: "Connected" } as McpServerInfo;
    const result = flattenMcpTaskSources({
      claude: { ok: true, provider: "claude", installed: true, supported: true, servers: [source, source] },
      codex: { ok: true, provider: "codex", installed: true, supported: true, servers: [{ ...source, status: "needs-auth" }] },
    });
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.key)).toEqual([
      "claude::plugin:atlassian:atlassian",
      "codex::plugin:atlassian:atlassian",
    ]);
    expect(result[0]).toMatchObject({ label: "Atlassian", importSupported: true });
    expect(result[1]).toMatchObject({ label: "Atlassian", importSupported: false });
    expect(mcpTaskSourceLabel("github-issues")).toBe("GitHub Issues");
  });

  it("asks a remote source with no login for this project to connect, instead of borrowing another project's", () => {
    const atlassian = { name: "atlassian", target: "https://mcp.atlassian.com/v2/mcp", transport: "HTTP", status: "connected", statusText: "Connected" } as McpServerInfo;
    const local = { name: "files", target: "npx server-files", transport: "STDIO", status: "connected", statusText: "Connected" } as McpServerInfo;
    const [unbound, stdio] = flattenMcpTaskSources({
      claude: { ok: true, provider: "claude", installed: true, supported: true, servers: [atlassian, local], authProfiles: [] },
    });
    expect(unbound).toMatchObject({ name: "atlassian", status: "needs-auth", statusText: "not connected for this project" });
    expect(stdio).toMatchObject({ name: "files", status: "connected" });

    const [bound] = flattenMcpTaskSources({
      claude: {
        ok: true, provider: "claude", installed: true, supported: true, servers: [atlassian],
        authProfiles: [{ provider: "claude", name: "atlassian", alias: "pitwall_atlassian_x", target: atlassian.target, transport: "http", authenticatedAt: "2026-10-01T00:00:00.000Z", scope: "SHOP", updatedAt: "" }],
      },
    });
    expect(bound).toMatchObject({ name: "atlassian", status: "connected", scope: "SHOP" });
  });
});

describe("sortMcpTaskSources", () => {
  it("keeps every source visible while prioritizing likely work trackers", () => {
    const sources = [
      { name: "plugin:figma:figma", target: "https://mcp.figma.com/mcp", transport: "HTTP", status: "connected", statusText: "Connected" },
      { name: "linear", target: "https://mcp.linear.app/mcp", transport: "HTTP", status: "needs-auth", statusText: "Needs authentication" },
      { name: "filesystem", target: "npx server-files", transport: "STDIO", status: "configured", statusText: "Configured" },
    ] as McpServerInfo[];
    expect(sortMcpTaskSources(sources).map((source) => source.name)).toEqual([
      "linear",
      "plugin:figma:figma",
      "filesystem",
    ]);
  });
});

describe("mapExternalTaskStatus", () => {
  it.each([
    ["Backlog", "backlog"],
    ["Todo", "ready"],
    ["In Progress", "running"],
    ["In-Progress", "running"],
    ["QA / Testing", "review"],
    ["Done", "completed"],
    ["Canceled", "cancelled"],
  ])("maps %s into Pitwall's %s lane", (external, expected) => {
    expect(mapExternalTaskStatus(external)).toBe(expected);
  });

  it("keeps unknown or missing workflow states actionable", () => {
    expect(mapExternalTaskStatus("Awaiting design")).toBe("ready");
    expect(mapExternalTaskStatus()).toBe("ready");
  });
});

describe("groupImportCandidates", () => {
  const task = (group: string, status: string, id: string) => ({ id, title: id, group, status });

  // Eighteen items arrived as one flat list from a board with nine columns
  // across two sprints and a backlog. None of that survived the trip.
  it("puts each item under the sprint it is scheduled into", () => {
    const groups = groupImportCandidates([
      task("Sprint 42", "To Do", "A-1"),
      task("Backlog", "To Do", "A-2"),
      task("Sprint 42", "Blocked", "A-3"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Sprint 42", "Backlog"]);
    expect(groups[0].tasks).toHaveLength(2);
  });

  // A backlog is real work and belongs in the list. It just does not belong
  // first, above the sprint being worked on this week.
  it("puts the backlog last however it arrived", () => {
    const groups = groupImportCandidates([task("Backlog", "To Do", "A-1"), task("Sprint 42", "To Do", "A-2")]);
    expect(groups.map((group) => group.label)).toEqual(["Sprint 42", "Backlog"]);
    expect(groups[1].isBacklog).toBe(true);
  });

  it("recognises a backlog however the tracker spells it", () => {
    expect(groupImportCandidates([task("back log", "To Do", "A-1")])[0].isBacklog).toBe(true);
    expect(groupImportCandidates([task("BACKLOG", "To Do", "A-1")])[0].isBacklog).toBe(true);
  });

  // A tracker with no sprints is grouped by its columns instead — those are
  // its board. Only one that reports neither gets a heading of our own, and
  // "Unscheduled" would be a claim about a distinction it does not make.
  it("falls back to columns before inventing a heading", () => {
    expect(groupImportCandidates([{ id: "A-1", title: "A-1", status: "Open" }])[0].label).toBe("Open");
  });

  it("only names the group itself when the tracker reports neither", () => {
    const groups = groupImportCandidates([{ id: "A-1", title: "A-1" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Assigned to you");
    expect(groups[0].isBacklog).toBe(false);
  });

  it("keeps the order the tracker returned, which is most recent first", () => {
    const groups = groupImportCandidates([task("Sprint 41", "To Do", "A-1"), task("Sprint 42", "To Do", "A-2")]);
    expect(groups.map((group) => group.label)).toEqual(["Sprint 41", "Sprint 42"]);
  });

  it("survives nothing", () => {
    expect(groupImportCandidates([])).toEqual([]);
  });
});

describe("summariseImportGroup", () => {
  // The columns are the useful part: it is what says whether a sprint is
  // starting or nearly finished.
  it("counts the tracker's own columns, commonest first", () => {
    expect(
      summariseImportGroup([
        { title: "a", status: "To Do" },
        { title: "b", status: "Blocked" },
        { title: "c", status: "To Do" },
      ]),
    ).toBe("2 To Do · 1 Blocked");
  });

  it("spells a column the way the tracker spells it", () => {
    expect(summariseImportGroup([{ title: "a", status: "Ready for QA" }])).toBe("1 Ready for QA");
  });

  it("falls back to a count when nothing reports a column", () => {
    expect(summariseImportGroup([{ title: "a" }, { title: "b" }])).toBe("2 items");
    expect(summariseImportGroup([{ title: "a" }])).toBe("1 item");
  });
});

describe("grouping across trackers that organise work differently", () => {
  // Jira schedules into sprints and Linear into cycles, so that is the board.
  it("groups a Linear cycle the way it groups a Jira sprint", () => {
    const groups = groupImportCandidates([
      { id: "L-1", title: "a", group: "Cycle 12", status: "In Progress" },
      { id: "L-2", title: "b", group: "Cycle 12", status: "Todo" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Cycle 12");
  });

  // A GitHub Projects kanban, a Trello board and an Asana section list have no
  // sprint at all — there the columns are the board, and one heading over
  // everything throws away the only structure the tool has.
  it("groups a board with no sprints by its columns instead", () => {
    const groups = groupImportCandidates([
      { id: "#12", title: "a", status: "In Progress" },
      { id: "#18", title: "b", status: "Todo" },
      { id: "#21", title: "c", status: "Todo" },
    ]);
    expect(groups.map((group) => group.label)).toEqual(["In Progress", "Todo"]);
    expect(groups[1].tasks).toHaveLength(2);
  });

  // A column literally called Backlog is a backlog whichever axis it arrived
  // on, and belongs at the bottom either way.
  it("sinks a Backlog column as readily as a Backlog sprint", () => {
    const groups = groupImportCandidates([
      { id: "#30", title: "a", status: "Backlog" },
      { id: "#12", title: "b", status: "In Progress" },
    ]);
    expect(groups.map((group) => group.label)).toEqual(["In Progress", "Backlog"]);
  });

  // One item scheduled is enough to say the tracker has the concept; the rest
  // are simply not in a sprint.
  it("uses sprints as soon as any item reports one", () => {
    const groups = groupImportCandidates([
      { id: "A-1", title: "a", group: "Sprint 42", status: "To Do" },
      { id: "A-2", title: "b", group: "", status: "To Do" },
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Sprint 42", "Assigned to you"]);
  });

  // "Todo — 2 Todo" says nothing.
  it("does not restate a column under its own heading", () => {
    const [group] = groupImportCandidates([
      { id: "#1", title: "a", status: "Todo" },
      { id: "#2", title: "b", status: "Todo" },
    ]);
    expect(summariseImportGroup(group.tasks, group)).toBe("2 items");
  });

  it("still counts the columns inside a sprint", () => {
    const [group] = groupImportCandidates([
      { id: "A-1", title: "a", group: "Sprint 42", status: "To Do" },
      { id: "A-2", title: "b", group: "Sprint 42", status: "Blocked" },
    ]);
    expect(summariseImportGroup(group.tasks, group)).toBe("1 Blocked · 1 To Do");
  });
});

describe("planTrackerSync", () => {
  const source = { provider: "claude", name: "atlassian", target: "DELTA" };
  const known = (over: Partial<PitwallTask> = {}): PitwallTask => ({
    id: "task-1",
    projectId: "p",
    identifier: "acme-2581",
    title: "Show prize name columns",
    description: "Original description",
    status: "running",
    priority: "medium",
    assignedAgent: "codex",
    relatedFiles: [],
    worktree: "acme-2581",
    source: { kind: "mcp", name: "atlassian", provider: "claude", target: "DELTA", externalId: "ACME-2581", url: "https://x/ACME-2581", status: "In Progress" },
    createdAt: "",
    updatedAt: "",
    ...over,
  });

  it("adds a ticket nobody has imported yet", () => {
    const plan = planTrackerSync({
      tasks: [known()],
      candidates: [{ id: "ACME-2600", title: "New ticket", status: "To Do" }],
      source,
    });
    expect(plan.added.map((candidate) => candidate.id)).toEqual(["ACME-2600"]);
    expect(plan.updates).toEqual([]);
  });

  it("never writes the board column, the agent, or the worktree of a task you started", () => {
    // The column is seeded from the tracker on import and owned by Pitwall
    // afterwards. A ticket someone moved on Jira must not pull a running task
    // out from under a council.
    const plan = planTrackerSync({
      tasks: [known()],
      candidates: [{ id: "ACME-2581", title: "Show prize name columns", status: "Done" }],
      source,
    });
    expect(plan.added).toEqual([]);
    const patch = plan.updates[0]?.patch ?? {};
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("assignedAgent");
    expect(patch).not.toHaveProperty("worktree");
    expect(patch.source?.status).toBe("Done");
  });

  it("refreshes the fields the tracker owns", () => {
    const plan = planTrackerSync({
      tasks: [known()],
      candidates: [{ id: "ACME-2581", title: "Renamed upstream", description: "Rewritten", url: "https://x/new", status: "In Progress" }],
      source,
    });
    expect(plan.updates[0].patch.title).toBe("Renamed upstream");
    expect(plan.updates[0].patch.description).toBe("Rewritten");
    expect(plan.updates[0].patch.source?.url).toBe("https://x/new");
  });

  it("says nothing when nothing changed, so a quiet board writes no state", () => {
    const plan = planTrackerSync({
      tasks: [known()],
      candidates: [{ id: "ACME-2581", title: "Show prize name columns", description: "Original description", url: "https://x/ACME-2581", status: "In Progress" }],
      source,
    });
    expect(plan.added).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("leaves tasks from other sources and other projects alone", () => {
    const other = known({ id: "task-2", source: { kind: "mcp", name: "linear", provider: "claude", externalId: "LIN-9" } });
    const plan = planTrackerSync({
      tasks: [known(), other],
      candidates: [{ id: "LIN-9", title: "Changed elsewhere", status: "Done" }],
      source,
    });
    // LIN-9 belongs to a different source, so it reads as a new ticket here
    // rather than as an update to a task this source does not own.
    expect(plan.updates).toEqual([]);
    expect(plan.added.map((candidate) => candidate.id)).toEqual(["LIN-9"]);
  });
});

describe("summariseTrackerSync", () => {
  const source = { provider: "claude", name: "atlassian", target: "" };

  it("says what arrived", () => {
    expect(summariseTrackerSync({ source, candidates: 22, added: 3, updated: 1 }))
      .toBe("Atlassian: 3 new tasks, 1 updated, from 22 open items.");
  });

  it("says nothing arrived and why that is not a failure", () => {
    // The silence is the whole problem being fixed: a run that found nothing
    // and a run that never happened used to look identical.
    expect(summariseTrackerSync({ source, candidates: 22, added: 0, updated: 0 }))
      .toBe("Atlassian: nothing new, from 22 open items.");
  });

  it("carries the reason a run could not read the source", () => {
    expect(summariseTrackerSync({ source, error: "atlassian is not connected to claude for this project" }))
      .toBe("Atlassian: could not be read — atlassian is not connected to claude for this project.");
  });

  it("distinguishes an empty board from a failure", () => {
    expect(summariseTrackerSync({ source, candidates: 0, added: 0, updated: 0 }))
      .toBe("Atlassian: the source returned no open items.");
  });

  it("counts one of a thing as one, not as a plural", () => {
    expect(summariseTrackerSync({ source, candidates: 1, added: 1, updated: 0 }))
      .toBe("Atlassian: 1 new task, from 1 open item.");
  });
});
