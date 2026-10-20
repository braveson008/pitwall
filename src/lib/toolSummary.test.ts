import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "./agentStream";
import {
  describeToolGroup,
  groupIntoTurns,
  groupTranscript,
  relativePath,
  stripCommandPreamble,
  summariseTool,
} from "./toolSummary";

const WORKTREE = "/Users/someone/Library/Application Support/braveli/worktrees/d8d1248ed6574b28/web-815";

describe("stripCommandPreamble", () => {
  it("drops the cd every command in a worktree session repeats", () => {
    // ~85 characters of identical prefix on every row, which pushed the part
    // worth reading off the end of the line.
    expect(stripCommandPreamble(`cd "${WORKTREE}" && git status --short`)).toBe("git status --short");
  });

  it("handles an unquoted path and a chain of them", () => {
    expect(stripCommandPreamble("cd /tmp/a && cd /tmp/b && ls -la")).toBe("ls -la");
  });

  it("drops leading environment assignments that only set the command up", () => {
    expect(stripCommandPreamble('SCRATCH="/tmp/x" UDID=0812A8AA xcrun simctl io $UDID screenshot')).toBe(
      "xcrun simctl io $UDID screenshot",
    );
  });

  it("does not leave the separator behind when it strips an assignment", () => {
    // Straight from a pane: the row read "&& cd \"$SCRATCH/wt-interstitial\" &&
    // corepack pnpm format", because taking the assignment out left its `&&`.
    expect(
      stripCommandPreamble('SCRATCH="/private/tmp/x" && cd "$SCRATCH/wt-interstitial" && corepack pnpm format 2>&1'),
    ).toBe("corepack pnpm format 2>&1");
  });

  it("handles setup chained in any order", () => {
    expect(stripCommandPreamble('cd /a && SCRATCH=/b && cd "$SCRATCH" && pnpm test')).toBe("pnpm test");
  });

  it("keeps a command that is only setup", () => {
    expect(stripCommandPreamble("cd /tmp/somewhere")).toBe("cd /tmp/somewhere");
  });
});

describe("relativePath", () => {
  it("shows a path against the session's own directory", () => {
    expect(relativePath(`${WORKTREE}/apps/voy/src/App.tsx`, WORKTREE)).toBe("apps/voy/src/App.tsx");
  });

  it("leaves a path outside the session alone", () => {
    expect(relativePath("/etc/hosts", WORKTREE)).toBe("/etc/hosts");
    expect(relativePath("/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("summariseTool", () => {
  it("summarises a command by what it does", () => {
    expect(summariseTool("Bash", { command: `cd "${WORKTREE}" && pnpm vitest run`, description: "run tests" })).toEqual({
      detail: "pnpm vitest run",
      kind: "command",
    });
  });

  it("summarises a file tool by its path", () => {
    expect(summariseTool("Read", { file_path: `${WORKTREE}/apps/voy/src/App.tsx` }, WORKTREE)).toEqual({
      detail: "apps/voy/src/App.tsx",
      kind: "path",
    });
  });

  it("summarises a search by its pattern", () => {
    expect(summariseTool("Grep", { pattern: "useSurveyMachine" })).toMatchObject({ detail: "useSurveyMachine" });
  });

  it("says nothing rather than counting arguments it did not recognise", () => {
    // The old summary ended rows with "+1", which told the reader there was
    // another field and nothing about what the call was.
    expect(summariseTool("Mystery", { alpha: 1, beta: 2 })).toEqual({ detail: "", kind: "text" });
    expect(summariseTool("Mystery", null)).toEqual({ detail: "", kind: "text" });
  });
});

const tool = (id: string, name: string, state: "running" | "ok" | "error"): TranscriptEntry => ({
  kind: "tool",
  id,
  name,
  input: {},
  state,
  result: "",
});
const text = (id: string): TranscriptEntry => ({ kind: "text", id, text: "prose" });

describe("groupTranscript", () => {
  it("collapses a run of calls into one group", () => {
    // Six shell rows between two sentences is what made a session unreadable.
    const groups = groupTranscript([
      text("a"),
      tool("t1", "Bash", "ok"),
      tool("t2", "Bash", "ok"),
      tool("t3", "Read", "ok"),
      text("b"),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(["entry", "tools", "entry"]);
    expect(groups[1]).toMatchObject({ failed: 0, running: false });
    expect((groups[1] as { tools: unknown[] }).tools).toHaveLength(3);
  });

  it("starts a new group after prose comes between", () => {
    const groups = groupTranscript([tool("t1", "Bash", "ok"), text("a"), tool("t2", "Bash", "ok")]);
    expect(groups.map((group) => group.kind)).toEqual(["tools", "entry", "tools"]);
  });

  it("says up front that something in the group failed", () => {
    // A failed command looked identical to a successful one until expanded.
    const groups = groupTranscript([tool("t1", "Bash", "ok"), tool("t2", "Bash", "error")]);
    expect(groups[0]).toMatchObject({ failed: 1 });
  });

  it("marks a group with a call still running", () => {
    expect(groupTranscript([tool("t1", "Bash", "running")])[0]).toMatchObject({ running: true });
  });
});

describe("describeToolGroup", () => {
  const group = (tools: TranscriptEntry[]) =>
    groupTranscript(tools)[0] as Extract<ReturnType<typeof groupTranscript>[number], { kind: "tools" }>;

  it("names a single call by its tool", () => {
    expect(describeToolGroup(group([tool("t1", "Bash", "ok")]))).toBe("Bash");
  });

  it("counts a run of the same tool", () => {
    expect(describeToolGroup(group([tool("t1", "Bash", "ok"), tool("t2", "Bash", "ok")]))).toBe("2 Bash calls");
  });

  it("stays generic for a mixed run", () => {
    expect(describeToolGroup(group([tool("t1", "Bash", "ok"), tool("t2", "Read", "ok")]))).toBe("2 tool calls");
  });
});

describe("groupIntoTurns", () => {
  const said = (id: string, at?: string): TranscriptEntry => ({ kind: "user", id, text: "do it", at });
  const replied = (id: string, at?: string): TranscriptEntry => ({ kind: "text", id, text: "done", at });

  it("splits the conversation where the user speaks", () => {
    // Without this everything sits at one level and there is no visible line
    // between what was asked and what came back.
    const turns = groupIntoTurns([said("u1"), replied("a1"), tool("t1", "Bash", "ok"), said("u2"), replied("a2")]);
    expect(turns.map((turn) => turn.role)).toEqual(["you", "agent", "you", "agent"]);
  });

  it("keeps an agent's prose, thinking and work in one turn", () => {
    const turns = groupIntoTurns([
      said("u1"),
      replied("a1"),
      tool("t1", "Bash", "ok"),
      tool("t2", "Bash", "ok"),
      replied("a2"),
    ]);
    expect(turns).toHaveLength(2);
    // prose, one folded run of two calls, prose
    expect(turns[1].groups.map((group) => group.kind)).toEqual(["entry", "tools", "entry"]);
  });

  it("treats two user messages in a row as two turns", () => {
    const turns = groupIntoTurns([said("u1"), said("u2")]);
    expect(turns).toHaveLength(2);
  });

  it("takes the turn's time from its first timed entry", () => {
    const turns = groupIntoTurns([replied("a1"), replied("a2", "2026-08-18T17:42:10.145Z")]);
    expect(turns[0].at).toBe("2026-08-18T17:42:10.145Z");
  });

  it("says nothing about nothing", () => {
    expect(groupIntoTurns([])).toEqual([]);
  });
});
