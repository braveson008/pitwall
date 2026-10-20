import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHandoff, claudeTurns, codexTurns, findCodexRolloutById, writeHandoffFile } from "./sessionHandoff.cjs";

describe("claudeTurns", () => {
  it("keeps what was said and one line per tool call, not the tool output", () => {
    const turns = claudeTurns([
      { type: "user", message: { content: "Fix the picker" } },
      { type: "assistant", message: { content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
      { type: "queue-operation", operation: "enqueue" },
    ]);
    expect(turns).toEqual([
      { role: "user", text: "Fix the picker" },
      { role: "agent", text: "Looking." },
      { role: "tool", text: 'Edit {"file_path":"a.ts"}' },
    ]);
  });
});

describe("codexTurns", () => {
  it("reads the reduced rollout and leaves out reasoning", () => {
    expect(codexTurns([
      { kind: "user", text: "Go" },
      { kind: "thinking", text: "**Plan**" },
      { kind: "tool", name: "shell", input: "ls" },
      { kind: "text", text: "Done" },
    ])).toEqual([
      { role: "user", text: "Go" },
      { role: "tool", text: "shell ls" },
      { role: "agent", text: "Done" },
    ]);
  });
});

describe("buildHandoff", () => {
  it("names both agents, the task, the conversation and the worktree", () => {
    const text = buildHandoff({
      fromAgent: "Codex",
      toAgent: "Claude",
      task: { identifier: "shop-1967", title: "Picker saves wrong value" },
      turns: [{ role: "user", text: "Fix it" }, { role: "agent", text: "Fixed the mapping" }],
      gitStatus: " M src/picker.ts",
      diffStat: " src/picker.ts | 4 ++--",
    });
    expect(text).toContain("# Handoff from Codex to Claude");
    expect(text).toContain("SHOP-1967: Picker saves wrong value");
    expect(text).toContain("**Person:** Fix it");
    expect(text).toContain("**Codex:** Fixed the mapping");
    expect(text).toContain(" M src/picker.ts");
    expect(text).toContain("wait for the person's next instruction");
  });

  it("keeps the first instruction when the tail cuts it off", () => {
    const turns = [{ role: "user" as const, text: "The original ask" }, ...Array.from({ length: 50 }, (_, i) => ({ role: "agent" as const, text: `step ${i}` }))];
    const text = buildHandoff({ fromAgent: "Codex", toAgent: "Claude", turns, maxTurns: 10 });
    expect(text).toContain("## How the session started\n\nThe original ask");
    expect(text).toContain("(41 earlier entries left out.)");
    expect(text).not.toContain("step 39\n");
    expect(text).toContain("step 49");
  });

  it("says so when the conversation could not be read", () => {
    expect(buildHandoff({ fromAgent: "Codex", toAgent: "Claude", turns: [] })).toContain("could not be read");
  });
});

describe("files", () => {
  it("numbers handoffs and adds the folder to git's exclude once", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "handoff-"));
    const exclude = path.join(dir, "gitdir", "info", "exclude");
    expect(writeHandoffFile(dir, "one", { excludeFile: exclude })).toBe(".pitwall/handoff-1.md");
    expect(writeHandoffFile(dir, "two", { excludeFile: exclude })).toBe(".pitwall/handoff-2.md");
    expect(readFileSync(path.join(dir, ".pitwall/handoff-2.md"), "utf8")).toBe("two");
    expect(readFileSync(exclude, "utf8")).toBe("/.pitwall/\n");
  });

  it("finds a Codex rollout by its conversation id", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-"));
    mkdirSync(path.join(root, "2026", "10", "07"), { recursive: true });
    const file = path.join(root, "2026", "10", "07", "rollout-2026-10-07T10-00-00-abc-123.jsonl");
    writeFileSync(file, "");
    expect(findCodexRolloutById("abc-123", root)).toBe(file);
    expect(findCodexRolloutById("../etc", root)).toBe("");
  });
});
