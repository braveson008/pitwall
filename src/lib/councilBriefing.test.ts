import { describe, expect, it } from "vitest";
import {
  emptyWorkingSet,
  formatWorkingSetForPrompt,
  isEmptyWorkingSet,
  isWorkingSet,
  mergeWorkingSet,
  parseWorkingSet,
  renderWorkingSet,
  workingSetContract,
} from "./councilBriefing";

const handoff = `TO: implementer-codex

I designed the approach.

## Working set
- src/lib/councilRelay.ts — builds every turn prompt; buildCouncilRelayTurn is the entry point
- src/App.tsx:3752 — startCouncilMode, where a council is assembled
- \`src/styles.css\` — council styles live under .council-cell

## Commands
- npm test
- npx tsc --noEmit

## Conventions
- Tests sit beside the file they cover as *.test.ts

## Open questions
- Does the conductor need the working set too?
`;

describe("parseWorkingSet", () => {
  it("reads the map out of a handoff", () => {
    const set = parseWorkingSet(handoff, 1, "architect-claude");
    expect(set.files.map((file) => file.path)).toEqual([
      "src/lib/councilRelay.ts",
      "src/App.tsx:3752",
      "src/styles.css",
    ]);
    expect(set.files[0].note).toContain("buildCouncilRelayTurn");
    expect(set.commands).toEqual(["npm test", "npx tsc --noEmit"]);
    expect(set.conventions[0]).toContain("*.test.ts");
    expect(set.openQuestions).toHaveLength(1);
  });

  it("records who established each file, and when", () => {
    // A wrong note sends the next member to the wrong place; it has to be
    // traceable to the turn that wrote it.
    const set = parseWorkingSet(handoff, 3, "qa-claude");
    expect(set.files[0]).toMatchObject({ turn: 3, by: "qa-claude" });
  });

  it("does not split a path at its line number", () => {
    // "src/App.tsx:3752 — where councils start" split at the colon sent the
    // next member to src/App.tsx with "3752 — where councils start" as the
    // description of it.
    const set = parseWorkingSet("## Working set\n- src/App.tsx:3752 — where councils start", 1, "m");
    expect(set.files[0]).toMatchObject({ path: "src/App.tsx:3752", note: "where councils start" });
  });

  it("splits on the first dash only, so a note keeps its own hyphens", () => {
    const set = parseWorkingSet("## Working set\n- src/a.ts — the read-only cache, hand-rolled", 1, "m");
    expect(set.files[0].note).toBe("the read-only cache, hand-rolled");
  });

  it("accepts the other separators a model reaches for", () => {
    const set = parseWorkingSet(
      "## Working set\n- src/a.ts: holds A\n* src/b.ts -- holds B\n1. src/c.ts – holds C",
      1,
      "m",
    );
    expect(set.files.map((file) => `${file.path}=${file.note}`)).toEqual([
      "src/a.ts=holds A",
      "src/b.ts=holds B",
      "src/c.ts=holds C",
    ]);
  });

  it("does not turn a prose bullet into a file the next member goes looking for", () => {
    // Telling a member to open a path that does not exist is worse than
    // telling it nothing: it spends the turn failing to find it.
    const set = parseWorkingSet(
      "## Working set\n- I mostly worked in the relay code and its tests\n- src/real.ts — real",
      1,
      "m",
    );
    expect(set.files.map((file) => file.path)).toEqual(["src/real.ts"]);
  });

  it("ignores lists outside the sections it owns", () => {
    const set = parseWorkingSet("## Notes\n- src/nope.ts — not the working set", 1, "m");
    expect(set.files).toEqual([]);
  });

  it("survives a handoff that has none of the sections", () => {
    expect(isEmptyWorkingSet(parseWorkingSet("TO: qa-claude\n\nAll done.", 1, "m"))).toBe(true);
    expect(isEmptyWorkingSet(parseWorkingSet("", 1, "m"))).toBe(true);
  });

  it("extracts only explicit decisions and resolutions, not proposals or code examples", () => {
    const set = parseWorkingSet([
      "I would prefer SQLite.",
      "## Proposals", "- Use SQLite.",
      "## Decisions to discuss", "- This is not yet accepted.",
      "```md", "DECISION: This is just an example.", "```",
      "## Decisions", "- [storage] Use JSON — accepted in stage-1.md.",
      "DECISION: Keep storage local.",
      "## Resolved questions", "- Which runtime?", "RESOLVED: Can we share between worktrees?",
    ].join("\n"), 2, "architect");
    expect(set.decisions).toEqual(["[storage] Use JSON — accepted in stage-1.md.", "Keep storage local."]);
    expect(set.resolvedQuestions).toEqual(["Which runtime?", "Can we share between worktrees?"]);
  });

  it("bounds decisions even when a single handoff is very large", () => {
    const set = parseWorkingSet(Array.from({ length: 80 }, (_, index) => `DECISION: Choice ${index}`).join("\n"), 1, "m");
    expect(set.decisions).toHaveLength(12);
    expect(set.decisions?.at(-1)).toBe("Choice 79");
  });
});

describe("mergeWorkingSet", () => {
  it("accumulates across turns", () => {
    const first = parseWorkingSet("## Working set\n- a.ts — from turn 1", 1, "architect");
    const second = parseWorkingSet("## Working set\n- b.ts — from turn 2", 2, "implementer");
    const merged = mergeWorkingSet(first, second);
    expect(merged.files.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("lets a later reading of a file replace an earlier one", () => {
    const first = parseWorkingSet("## Working set\n- a.ts — skimmed it", 1, "architect");
    const second = parseWorkingSet("## Working set\n- a.ts — actually it is the parser", 4, "implementer");
    const merged = mergeWorkingSet(first, second);
    expect(merged.files).toHaveLength(1);
    expect(merged.files[0].note).toBe("actually it is the parser");
  });

  it("does not overwrite a new file reading with an older restored snapshot", () => {
    const newer = parseWorkingSet("## Working set\n- a.ts — current implementation", 4, "implementer");
    const older = parseWorkingSet("## Working set\n- a.ts — early sketch", 1, "architect");
    expect(mergeWorkingSet(newer, older).files[0].note).toBe("current implementation");
  });

  it("does not let a bare mention wipe a useful note", () => {
    // A member listing a path without describing it knows no more than the one
    // that described it, so silence must not overwrite substance.
    const first = parseWorkingSet("## Working set\n- a.ts — the parser lives here", 1, "architect");
    const second = parseWorkingSet("## Working set\n- a.ts", 2, "qa");
    const merged = mergeWorkingSet(first, second);
    expect(merged.files[0].note).toBe("the parser lives here");
    expect(merged.files[0].turn).toBe(2);
  });

  it("does not repeat a command two members both report", () => {
    const first = parseWorkingSet("## Commands\n- npm test", 1, "a");
    const second = parseWorkingSet("## Commands\n- npm test\n- npm run build", 2, "b");
    expect(mergeWorkingSet(first, second).commands).toEqual(["npm test", "npm run build"]);
  });

  it("stays bounded, since it is injected into every later prompt", () => {
    // Unbounded, a long council pays for a hundred-line file list on every
    // hop — which is the cost this whole module exists to remove.
    let set = emptyWorkingSet();
    for (let turn = 1; turn <= 60; turn += 1) {
      set = mergeWorkingSet(set, parseWorkingSet(`## Working set\n- src/f${turn}.ts — note`, turn, "m"));
    }
    expect(set.files.length).toBeLessThanOrEqual(40);
    // The cap keeps the most recent, which is the part being worked on.
    expect(set.files[0].path).toBe("src/f60.ts");
  });

  it("keeps omitted questions open and removes only explicit resolutions", () => {
    const first = parseWorkingSet("## Open questions\n- Which runtime?\n- Who owns the migration?", 1, "architect");
    expect(mergeWorkingSet(first, emptyWorkingSet()).openQuestions).toEqual(first.openQuestions);
    const resolved = mergeWorkingSet(first, parseWorkingSet("RESOLVED: **which   runtime**", 2, "implementer"));
    expect(resolved.openQuestions).toEqual(["Who owns the migration?"]);
    expect(mergeWorkingSet(resolved, first).openQuestions).toEqual(["Who owns the migration?"]);
  });

  it("replaces a decision only when its stable label is reused", () => {
    const first = parseWorkingSet("DECISION: [storage] Use SQLite.\nDECISION: Keep all records local.", 1, "architect");
    const next = parseWorkingSet("DECISION: [storage] Use JSON after checking storage requirements.", 2, "architect");
    const merged = mergeWorkingSet(first, next);
    expect(merged.decisions).toEqual(["Keep all records local.", "[storage] Use JSON after checking storage requirements."]);
  });
});

describe("renderWorkingSet", () => {
  it("writes a file a member can open", () => {
    const rendered = renderWorkingSet(parseWorkingSet(handoff, 1, "architect"), "Add a swap control");
    expect(rendered).toContain("Task: Add a swap control");
    expect(rendered).toContain("`src/lib/councilRelay.ts` — builds every turn prompt");
    expect(rendered).toContain("## Commands");
    expect(rendered).toContain("## Open questions");
  });

  it("says so plainly when nothing is established yet", () => {
    expect(renderWorkingSet(emptyWorkingSet())).toContain("first turn");
  });

  it("renders accepted decisions and resolved questions for later members", () => {
    const set = parseWorkingSet("DECISION: Use the shared store.\nRESOLVED: Where should it live?", 1, "architect");
    expect(renderWorkingSet(set)).toContain("## Accepted decisions\n\n- Use the shared store.");
    expect(renderWorkingSet(set)).toContain("## Resolved questions\n\n- Where should it live?");
    expect(formatWorkingSetForPrompt(set, "ws.md")).toContain("Use the shared store.");
    expect(isEmptyWorkingSet(set)).toBe(false);
  });
});

describe("isWorkingSet", () => {
  it("accepts legacy working sets and rejects malformed optional metadata", () => {
    const old = { files: [], commands: [], conventions: [], openQuestions: [] };
    expect(isWorkingSet(old)).toBe(true);
    expect(isWorkingSet({ ...old, decisions: [12] })).toBe(false);
    expect(isWorkingSet({ ...old, resolvedQuestions: "answered" })).toBe(false);
    expect(isWorkingSet({ ...old, files: [{ path: "a.ts", note: "n", by: "m", turn: NaN }] })).toBe(false);
  });
});

describe("formatWorkingSetForPrompt", () => {
  it("inlines the map so a member does not have to open a file to get it", () => {
    const text = formatWorkingSetForPrompt(parseWorkingSet(handoff, 1, "architect"), ".braveli/working-set.md");
    expect(text).toContain("already read these files");
    expect(text).toContain("src/lib/councilRelay.ts");
    expect(text).toContain("npm test");
    expect(text).toContain("Do not re-derive");
    expect(text).toContain(".braveli/working-set.md");
  });

  it("caps the inlined list and points at the file for the rest", () => {
    let set = emptyWorkingSet();
    for (let turn = 1; turn <= 30; turn += 1) {
      set = mergeWorkingSet(set, parseWorkingSet(`## Working set\n- src/f${turn}.ts — n`, turn, "m"));
    }
    const text = formatWorkingSetForPrompt(set, "ws.md");
    expect(text).toMatch(/and \d+ more in ws\.md/);
  });

  it("is nothing at all on the first turn, rather than an empty preamble", () => {
    expect(formatWorkingSetForPrompt(emptyWorkingSet(), "ws.md")).toBe("");
    expect(formatWorkingSetForPrompt(null, "ws.md")).toBe("");
  });
});

describe("workingSetContract", () => {
  it("asks for exactly the sections the parser reads", () => {
    // The contract and the parser have to agree; drifting apart means every
    // handoff parses to nothing and the council silently goes back to
    // re-exploring the repo on every turn.
    const contract = workingSetContract(false);
    for (const heading of ["## Working set", "## Commands", "## Conventions", "## Open questions"]) {
      expect(contract).toContain(heading);
    }
    const asked = parseWorkingSet(
      "## Working set\n- a.ts — x\n## Commands\n- c\n## Conventions\n- v\n## Open questions\n- q",
      1,
      "m",
    );
    expect(isEmptyWorkingSet(asked)).toBe(false);
  });

  it("tells the first member that everyone after works from its map", () => {
    expect(workingSetContract(true)).toContain("first member");
    expect(workingSetContract(false)).not.toContain("first member");
  });
});
