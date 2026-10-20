import { describe, expect, it } from "vitest";
import {
  LESSON_MARKER,
  MAX_LESSONS,
  extractLessons,
  formatLessonsPrompt,
  getCouncilLessonsPath,
  getCouncilLessonsPaths,
  mergeLessons,
  parseLessonsFile,
  renderLessonsFile,
} from "./councilMemory";
import { detectTreeOscillation, fingerprintTree, MAX_REPEATED_TREE_STATES } from "./councilRelay";

describe("extractLessons", () => {
  it("reads lessons from anywhere in a handoff, not just the first line", () => {
    const handoff = [
      "TO: qa-claude",
      "Implemented the endpoint.",
      "LESSON: the test suite needs a running Postgres on 5433",
      "Also refactored the router.",
      "LESSON: src/legacy/ is generated — never hand-edit it",
    ].join("\n");
    expect(extractLessons(handoff)).toEqual([
      "the test suite needs a running Postgres on 5433",
      "src/legacy/ is generated — never hand-edit it",
    ]);
  });

  it("ignores the routing markers and empty noise", () => {
    expect(extractLessons("TO: qa-claude\nRELAY-COMPLETE\nnothing here")).toEqual([]);
    expect(extractLessons("LESSON: short")).toEqual([]); // below the useful-length floor
  });

  it("truncates an essay rather than letting it into every future prompt", () => {
    const long = `${LESSON_MARKER}: ${"x".repeat(400)}`;
    const [lesson] = extractLessons(long);
    expect(lesson.length).toBeLessThanOrEqual(240);
    expect(lesson.endsWith("…")).toBe(true);
  });

  it("preserves stable identities for explicit corrections", () => {
    expect(extractLessons("LESSON [runtime]: Use Node 24 as declared in package.json.")).toEqual([
      "[runtime] Use Node 24 as declared in package.json.",
    ]);
  });
});

describe("mergeLessons", () => {
  it("keeps the newer wording when a council restates the same lesson", () => {
    const merged = mergeLessons(
      ["The build command is npm run build"],
      ["the build command IS   npm run build."],
    );
    expect(merged).toEqual(["the build command IS   npm run build."]);
  });

  it("keeps a refinement as its own lesson rather than collapsing it", () => {
    // Deliberately conservative: only a restatement is deduped, not anything
    // that merely contains an earlier lesson. Collapsing on containment would
    // silently drop "run npm test" when someone later wrote "run npm test:e2e
    // before releasing", and losing a lesson is worse than keeping two.
    const merged = mergeLessons(
      ["The build command is npm run build"],
      ["the build command is npm run build (needs node 20)"],
    );
    expect(merged).toHaveLength(2);
  });

  it("preserves order of distinct lessons, oldest first", () => {
    expect(mergeLessons(["a lesson about one", "a lesson about two"], ["a lesson about three"])).toEqual([
      "a lesson about one",
      "a lesson about two",
      "a lesson about three",
    ]);
  });

  it("caps the file so it cannot outgrow its usefulness", () => {
    const many = Array.from({ length: MAX_LESSONS + 15 }, (_, i) => `lesson number ${i}`);
    const merged = mergeLessons([], many);
    expect(merged).toHaveLength(MAX_LESSONS);
    // Oldest fall off, newest survive.
    expect(merged.at(-1)).toBe(`lesson number ${MAX_LESSONS + 14}`);
  });

  it("supersedes the same explicit identity without guessing at unrelated claims", () => {
    expect(mergeLessons(
      ["[runtime] Use Node 20.", "The build command is npm run build."],
      ["[runtime] Use Node 24."],
    )).toEqual(["[runtime] Use Node 24.", "The build command is npm run build."]);
    expect(mergeLessons(["Use Node 20."], ["Use Node 24."])).toHaveLength(2);
  });
});

describe("the lessons file round-trips", () => {
  it("survives render → parse unchanged", () => {
    const lessons = ["tests need Postgres on 5433", "src/legacy/ is generated"];
    expect(parseLessonsFile(renderLessonsFile(lessons))).toEqual(lessons);
  });

  it("tolerates a human editing it by hand", () => {
    const handEdited = "# my own notes\n\n- keep this one\n\nsome prose someone typed\n- and this one\n";
    expect(parseLessonsFile(handEdited)).toEqual(["keep this one", "and this one"]);
  });

  it("renders nothing for an empty set rather than an empty heading", () => {
    expect(renderLessonsFile([])).toBe("");
  });

  it("lives once per project, not once per run", () => {
    expect(getCouncilLessonsPath()).not.toMatch(/runId|<|\$\{/);
    expect(getCouncilLessonsPath()).toMatch(/lessons\.md$/);
  });

  it("writes lessons under .pitwall and still reads the file older versions wrote under .braveli", () => {
    expect(getCouncilLessonsPath()).toBe(".pitwall/council/lessons.md");
    expect(getCouncilLessonsPaths()).toEqual([".pitwall/council/lessons.md", ".braveli/council/lessons.md"]);
  });
});

describe("formatLessonsPrompt", () => {
  it("asks a first council to start recording without handing it an empty file", () => {
    const prompt = formatLessonsPrompt([], ".pitwall/council/lessons.md");
    expect(prompt).toMatch(new RegExp(`${LESSON_MARKER}:`));
    expect(prompt).not.toMatch(/Previous councils/);
  });

  it("gives a later council what was learned, and permission to overturn it", () => {
    const prompt = formatLessonsPrompt(["tests need Postgres"], ".pitwall/council/lessons.md");
    expect(prompt).toMatch(/Previous councils/);
    expect(prompt).toMatch(/tests need Postgres/);
    expect(prompt).toMatch(/turns out to be wrong/);
    expect(prompt).toContain("advisory observations");
    expect(prompt).not.toContain("treat them as true");
  });
});

describe("detectTreeOscillation", () => {
  const tree = (files: Record<string, string>) => fingerprintTree(files);

  it("is quiet while work moves forward", () => {
    const history = [
      tree({ "a.ts": "M:1:0" }),
      tree({ "a.ts": "M:2:0" }),
      tree({ "a.ts": "M:2:0", "b.ts": "A:9:0" }),
    ];
    expect(detectTreeOscillation(history).oscillating).toBe(false);
  });

  it("tolerates one revert-and-retry", () => {
    const first = tree({ "a.ts": "M:1:0" });
    expect(detectTreeOscillation([first, tree({ "a.ts": "M:2:0" }), first]).oscillating).toBe(false);
  });

  it("flags members undoing each other", () => {
    const a = tree({ "a.ts": "M:1:0" });
    const b = tree({ "a.ts": "M:2:0" });
    const result = detectTreeOscillation([a, b, a, b, a]);
    expect(result.oscillating).toBe(true);
    expect(result.repeats).toBeGreaterThanOrEqual(MAX_REPEATED_TREE_STATES);
    expect(result.reason).toMatch(/undoing each other/);
  });

  it("does not call a tree that simply stopped changing oscillation", () => {
    // Regression: the council smoke test caught this. Three turns that leave
    // the tree identical is a council making no changes — which the evidence
    // check already reports — not members undoing each other.
    const stable = tree({ "a.ts": "M:1:0" });
    expect(detectTreeOscillation([stable, stable, stable, stable]).oscillating).toBe(false);
  });

  it("does not call an untouched repository oscillation", () => {
    // A council that has not written anything yet is at its starting state on
    // every turn; that is not thrash.
    expect(detectTreeOscillation(["", "", "", "", ""]).oscillating).toBe(false);
  });

  it("fingerprints are order-independent", () => {
    expect(tree({ b: "1", a: "2" })).toBe(tree({ a: "2", b: "1" }));
  });
});
