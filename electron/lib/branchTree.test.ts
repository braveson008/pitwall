import { describe, expect, it } from "vitest";
import {
  DRIFT_WARNING,
  STATE_LABEL,
  STATE_NOTE,
  branchState,
  buildBranchTree,
  fileOverlaps,
  parseDivergence,
  parseRefs,
} from "./branchTree.cjs";

const branch = (over: Record<string, unknown> = {}) => ({
  name: "task/rate-limit",
  sha: "abc1234",
  committedAt: "2026-08-30T10:00:00+00:00",
  subject: "Add the bucket",
  merged: false,
  hasSession: false,
  branchAhead: 3,
  trunkAhead: 0,
  files: [],
  ...over,
});

describe("parseDivergence", () => {
  it("reads both sides of the count", () => {
    // `--left-right --count trunk...branch`: trunk's side first.
    expect(parseDivergence("154\t0")).toEqual({ trunkAhead: 154, branchAhead: 0 });
    expect(parseDivergence("0 12")).toEqual({ trunkAhead: 0, branchAhead: 12 });
  });

  it("treats an unreadable answer as no divergence rather than NaN", () => {
    // A NaN reaching the view renders as "NaN commits ahead", which is worse
    // than saying nothing.
    expect(parseDivergence("")).toEqual({ trunkAhead: 0, branchAhead: 0 });
    expect(parseDivergence("fatal: bad revision")).toEqual({ trunkAhead: 0, branchAhead: 0 });
  });
});

describe("parseRefs", () => {
  it("keeps a subject that contains tabs", () => {
    const refs = parseRefs("main\tabc123\t2026-08-30 17:21:07 +0400\tFix\tthe\tthing");
    expect(refs[0].name).toBe("main");
    expect(refs[0].subject).toBe("Fix\tthe\tthing");
  });

  it("ignores blank lines rather than inventing a branch", () => {
    expect(parseRefs("main\tabc\t2026\tx\n\n")).toHaveLength(1);
  });
});

describe("branchState", () => {
  it("calls a merged branch merged, whatever else is true of it", () => {
    // Finished is finished; the useful thing to do with it is delete it.
    expect(branchState({ merged: true, hasSession: true, branchAhead: 9, trunkAhead: 400 })).toBe("merged");
  });

  it("never calls a branch with an agent in it stale", () => {
    // Its last commit may be old while an agent is working in it right now.
    expect(branchState({ merged: false, hasSession: true, branchAhead: 0, trunkAhead: 900 })).toBe("working");
  });

  it("warns once the trunk has moved a long way", () => {
    expect(branchState({ merged: false, hasSession: false, branchAhead: 2, trunkAhead: DRIFT_WARNING })).toBe("drifted");
    expect(branchState({ merged: false, hasSession: false, branchAhead: 2, trunkAhead: DRIFT_WARNING - 1 })).toBe("ahead");
  });

  it("distinguishes a branch with no work from one with work", () => {
    expect(branchState({ merged: false, hasSession: false, branchAhead: 0, trunkAhead: 0 })).toBe("empty");
    expect(branchState({ merged: false, hasSession: false, branchAhead: 1, trunkAhead: 0 })).toBe("ahead");
  });
});

describe("fileOverlaps", () => {
  it("finds two live branches editing the same file", () => {
    const pairs = fileOverlaps([
      branch({ name: "task/a", hasSession: true, files: ["src/api/limit.ts", "src/a.ts"] }),
      branch({ name: "task/b", hasSession: true, files: ["src/api/limit.ts", "src/b.ts"] }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].files).toEqual(["src/api/limit.ts"]);
    expect(pairs[0].branches).toEqual(["task/a", "task/b"]);
  });

  it("says nothing about branches nobody is working", () => {
    // Two finished branches that touched one file is history. Two agents
    // editing it now is a conflict being written as you watch, and that is
    // the only moment when saying so is any use.
    const pairs = fileOverlaps([
      branch({ name: "task/a", hasSession: false, files: ["src/same.ts"] }),
      branch({ name: "task/b", hasSession: false, files: ["src/same.ts"] }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("says nothing when live branches keep out of each other's way", () => {
    const pairs = fileOverlaps([
      branch({ name: "task/a", hasSession: true, files: ["src/a.ts"] }),
      branch({ name: "task/b", hasSession: true, files: ["src/b.ts"] }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("reports every colliding pair, not only the first", () => {
    const pairs = fileOverlaps([
      branch({ name: "a", hasSession: true, files: ["x.ts"] }),
      branch({ name: "b", hasSession: true, files: ["x.ts"] }),
      branch({ name: "c", hasSession: true, files: ["x.ts"] }),
    ]);
    expect(pairs).toHaveLength(3);
  });
});

describe("buildBranchTree", () => {
  it("leaves the trunk out of its own branch list", () => {
    const tree = buildBranchTree({
      trunk: "main",
      branches: [branch({ name: "main" }), branch({ name: "task/a" })],
    });
    expect(tree.branches.map((item: { name: string }) => item.name)).toEqual(["task/a"]);
  });

  it("orders by what needs attention, not by name or date", () => {
    const tree = buildBranchTree({
      trunk: "main",
      branches: [
        branch({ name: "done", merged: true }),
        branch({ name: "idle", branchAhead: 0 }),
        branch({ name: "live", hasSession: true }),
        branch({ name: "old", trunkAhead: 99 }),
      ],
    });
    // Working, then drifted, then waiting, then finished.
    expect(tree.branches.map((item: { name: string }) => item.name)).toEqual(["live", "old", "idle", "done"]);
  });

  it("gives every branch a sentence rather than only a state word", () => {
    const tree = buildBranchTree({ trunk: "main", branches: [branch({ merged: true })] });
    expect(tree.branches[0].note).toMatch(/delete/i);
  });
});

describe("what a row says versus what the legend says", () => {
  it("gives the row a word and the legend a sentence", () => {
    // The sentence on every row read well with three branches and became
    // wallpaper at thirty — the same line down the whole screen, carrying
    // nothing per row.
    const tree = buildBranchTree({
      trunk: "main",
      branches: [branch({ name: "a", trunkAhead: 99 })],
    });
    expect(tree.branches[0].label).toBe("behind");
    expect(tree.branches[0].note).toMatch(/trunk has moved/i);
    // Short enough to sit in a column beside the counts.
    expect(tree.branches[0].label.length).toBeLessThan(12);
  });

  it("labels every state it can produce", () => {
    const states = ["merged", "working", "empty", "drifted", "ahead"];
    for (const state of states) expect(STATE_LABEL[state]).toBeTruthy();
    for (const state of states) expect(STATE_NOTE[state]).toBeTruthy();
  });
});
