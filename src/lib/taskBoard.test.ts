import { describe, expect, it } from "vitest";
import type { PitwallTask, PitwallTaskStatus } from "../domain/types";
import { buildBoard, columnFor, columnRank, localStateLabel, normaliseStatus, showsLocalState } from "./taskBoard";

const task = (over: Partial<PitwallTask> & { id: string }): PitwallTask =>
  ({
    projectId: "p",
    identifier: over.id,
    title: "a task",
    description: "",
    status: "ready" as PitwallTaskStatus,
    priority: "medium",
    assignedAgent: "",
    relatedFiles: [],
    worktree: "",
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as PitwallTask;

describe("columnFor", () => {
  it("uses the tracker's status for an imported task", () => {
    // Everything imported used to land in one "Ready" pile, so tickets Jira knew
    // as four different states arrived indistinguishable.
    expect(columnFor(task({ id: "1", source: { kind: "mcp", status: "Ready for QA" } }))).toBe("Ready for QA");
  });

  it("rewrites a machine spelling but leaves a human one alone", () => {
    expect(columnFor(task({ id: "1", source: { kind: "mcp", status: "READY_FOR_QA" } }))).toBe("Ready for qa");
    expect(columnFor(task({ id: "2", source: { kind: "mcp", status: "in-progress" } }))).toBe("In progress");
    // "Ready for QA" is how the team writes it, acronym included.
    expect(columnFor(task({ id: "3", source: { kind: "mcp", status: "Ready for QA" } }))).toBe("Ready for QA");
  });

  it("prefers where the card was dragged to", () => {
    // Pitwall owns the column once it has been moved; the ticket is untouched,
    // so the column must not keep claiming to be the tracker's word.
    expect(
      columnFor(task({ id: "1", boardColumn: "Failed on prod", source: { kind: "mcp", status: "Backlog" } })),
    ).toBe("Failed on prod");
  });

  it("falls back to Pitwall's own state for a local task", () => {
    expect(columnFor(task({ id: "1", status: "running" }))).toBe("In progress");
    expect(columnFor(task({ id: "2", status: "review" }))).toBe("Review");
  });
});

describe("buildBoard", () => {
  it("orders columns along the pipeline rather than alphabetically", () => {
    const board = buildBoard([
      task({ id: "1", source: { kind: "mcp", status: "Done" } }),
      task({ id: "2", source: { kind: "mcp", status: "Backlog" } }),
      task({ id: "3", source: { kind: "mcp", status: "Ready for QA" } }),
      task({ id: "4", source: { kind: "mcp", status: "To Do" } }),
    ]);
    expect(board.map((column) => column.name)).toEqual(["Backlog", "To Do", "Ready for QA", "Done"]);
  });

  it("keeps a column a team invented rather than dropping it", () => {
    const board = buildBoard([
      task({ id: "1", source: { kind: "mcp", status: "Backlog" } }),
      task({ id: "2", source: { kind: "mcp", status: "Awaiting design" } }),
      task({ id: "3", source: { kind: "mcp", status: "Done" } }),
    ]);
    expect(board.map((column) => column.name)).toEqual(["Backlog", "Awaiting design", "Done"]);
  });

  it("groups tasks into their columns", () => {
    const board = buildBoard([
      task({ id: "1", source: { kind: "mcp", status: "Backlog" } }),
      task({ id: "2", source: { kind: "mcp", status: "Backlog" } }),
      task({ id: "3", source: { kind: "mcp", status: "Done" } }),
    ]);
    expect(board.map((column) => column.tasks.length)).toEqual([2, 1]);
  });

  it("keeps an emptied column on the board", () => {
    // Otherwise dragging the last card out of a column takes the column with it,
    // and there is nowhere to put the card back.
    const board = buildBoard([task({ id: "1", source: { kind: "mcp", status: "Done" } })], ["Backlog", "Done"]);
    expect(board.map((column) => column.name)).toEqual(["Backlog", "Done"]);
    expect(board[0].tasks).toEqual([]);
  });

  it("does not put the tracker's column and Pitwall's own side by side", () => {
    // The exact case the board was showing: Jira says "In Progress", Pitwall
    // calls its own state "In progress", and the two differ by one letter.
    const board = buildBoard(
      [task({ id: "1", source: { kind: "mcp", status: "In Progress" } })],
      ["Ready", "In progress", "Review", "Done"],
    );
    expect(board.filter((column) => /in.?progress/i.test(column.name))).toHaveLength(1);
    // And the tracker's spelling is the one shown.
    expect(board.find((column) => /in.?progress/i.test(column.name))?.name).toBe("In Progress");
  });

  it("lets a tracker's stage stand in for Pitwall's at the same point", () => {
    // "Code review" is the team's name for the stage Pitwall calls "Review".
    // Both columns meant the same thing and one of them was always empty.
    const board = buildBoard(
      [task({ id: "1", source: { kind: "mcp", status: "Code review" } })],
      ["Review"],
    );
    expect(board.map((column) => column.name)).toEqual(["Code review"]);
  });

  it("keeps two columns a team actually has, even unrecognised ones", () => {
    // Discovery and Awaiting design are both unranked. Merging them because
    // they score the same would throw away a distinction the team draws.
    const board = buildBoard([
      task({ id: "1", source: { kind: "mcp", status: "Discovery" } }),
      task({ id: "2", source: { kind: "mcp", status: "Awaiting design" } }),
    ], ["Ready"]);
    expect(board.map((column) => column.name)).toContain("Discovery");
    expect(board.map((column) => column.name)).toContain("Awaiting design");
  });

  it("still offers Pitwall's own columns to a project with no tracker", () => {
    const board = buildBoard([], ["Ready", "In progress", "Review", "Done"]);
    expect(board.map((column) => column.name)).toEqual(["Ready", "In progress", "Review", "Done"]);
  });

  it("gathers tasks that differ only in how the status was capitalised", () => {
    const board = buildBoard([
      task({ id: "1", source: { kind: "mcp", status: "In Progress" } }),
      task({ id: "2", source: { kind: "mcp", status: "in progress" } }),
    ]);
    expect(board).toHaveLength(1);
    expect(board[0].tasks).toHaveLength(2);
  });

  it("says nothing about nothing", () => {
    expect(buildBoard([])).toEqual([]);
  });
});

describe("columnRank", () => {
  it("recognises the same stage however a tracker spells it", () => {
    expect(columnRank("To Do")).toBe(columnRank("todo"));
    expect(columnRank("Selected for development")).toBe(columnRank("To Do"));
    expect(columnRank("Backlog")).toBeLessThan(columnRank("In Progress"));
    expect(columnRank("In Progress")).toBeLessThan(columnRank("Done"));
  });

  it("matches stage words, not letters inside other words", () => {
    // "pr" inside "prod" ranked "Failed on prod" as review, and "open" inside
    // "Reopened" ranked it as to-do.
    expect(columnRank("Failed on prod")).toBe(columnRank("Blocked"));
    expect(columnRank("Reopened")).toBe(columnRank("Blocked"));
    expect(columnRank("In production")).toBeGreaterThan(columnRank("Code review"));
    expect(columnRank("PR raised")).toBe(columnRank("Review"));
    expect(columnRank("Opened")).toBe(columnRank("To Do"));
    expect(columnRank("New")).toBe(columnRank("To Do"));
  });

  it("sorts an unknown stage between review and done rather than dropping it", () => {
    expect(columnRank("Awaiting design")).toBeGreaterThan(columnRank("Backlog"));
    expect(columnRank("Awaiting design")).toBeLessThan(columnRank("Done"));
  });
});

describe("showsLocalState", () => {
  it("says what Pitwall is doing when the column does not", () => {
    // A card parked in Jira's Backlog with a run going is exactly the case a
    // reader needs told.
    expect(showsLocalState(task({ id: "1", status: "running", source: { kind: "mcp", status: "Backlog" } }))).toBe(true);
  });

  it("stays quiet when the column already says it", () => {
    expect(showsLocalState(task({ id: "1", status: "running", boardColumn: "In progress" }))).toBe(false);
    expect(showsLocalState(task({ id: "2", status: "ready", source: { kind: "mcp", status: "Backlog" } }))).toBe(false);
  });
});

describe("normaliseStatus", () => {
  it("rewrites an identifier into something readable", () => {
    expect(normaliseStatus("READY_FOR_QA")).toBe("Ready for qa");
    expect(normaliseStatus("failed-on-prod")).toBe("Failed on prod");
  });

  it("leaves a label a person wrote exactly as they wrote it", () => {
    // Title-casing turned "Ready for QA" into "Ready For Qa" — wrong, and rude
    // about the team's acronym.
    expect(normaliseStatus("Ready for QA")).toBe("Ready for QA");
    expect(normaliseStatus("Failed on prod")).toBe("Failed on prod");
    expect(normaliseStatus("  Awaiting   design ")).toBe("Awaiting design");
  });
});

describe("localStateLabel", () => {
  it("says Pitwall's state plainly", () => {
    expect(localStateLabel("running")).toBe("In progress");
    expect(localStateLabel("completed")).toBe("Done");
  });
});
