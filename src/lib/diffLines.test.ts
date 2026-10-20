import { describe, expect, it } from "vitest";
import { gutterWidth, parseUnifiedDiff } from "./diffLines";

const PATCH = [
  "diff --git a/src/limit.ts b/src/limit.ts",
  "index 7607a87..303d4f1 100644",
  "--- a/src/limit.ts",
  "+++ b/src/limit.ts",
  "@@ -10,4 +10,5 @@ export function rate() {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("drops the plumbing git prints before the change", () => {
    // Five lines of `diff --git`, `index`, `---`, `+++` say nothing the file
    // list has not already said, and they push the real change off the top.
    const lines = parseUnifiedDiff(PATCH);
    expect(lines.some((line) => line.text.startsWith("diff --git"))).toBe(false);
    expect(lines.some((line) => line.text.startsWith("index "))).toBe(false);
    expect(lines.filter((line) => line.kind === "hunk")).toHaveLength(1);
  });

  it("numbers every line on the side it exists", () => {
    const lines = parseUnifiedDiff(PATCH).filter((line) => line.kind !== "hunk");
    expect(lines.map((line) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ["context", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
      ["context", 12, 13],
    ]);
  });

  it("keeps the section git names for a hunk, not its arithmetic", () => {
    // "export function rate()" tells you where you are. "@@ -10,4 +10,5 @@"
    // repeats what the line numbers already show.
    expect(parseUnifiedDiff(PATCH).find((line) => line.kind === "hunk")?.label)
      .toBe("export function rate() {");
  });

  it("handles a new file, where the old side has no numbers at all", () => {
    const lines = parseUnifiedDiff([
      "diff --git a/x b/x",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/x",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
    ].join("\n"));
    expect(lines.filter((line) => line.kind === "add")).toHaveLength(2);
    expect(lines.every((line) => line.oldNo === undefined || line.kind === "hunk")).toBe(true);
    expect(lines.filter((line) => line.kind === "add").map((line) => line.newNo)).toEqual([1, 2]);
  });

  it("restarts the numbering at each hunk", () => {
    const lines = parseUnifiedDiff([
      "@@ -1,1 +1,1 @@",
      " a",
      "@@ -80,1 +90,1 @@",
      " b",
    ].join("\n"));
    const context = lines.filter((line) => line.kind === "context");
    expect(context[0].oldNo).toBe(1);
    expect(context[1].oldNo).toBe(80);
    expect(context[1].newNo).toBe(90);
  });

  it("keeps a line that is only whitespace, which a diff cares about", () => {
    const lines = parseUnifiedDiff(["@@ -1,2 +1,2 @@", "+  ", " a"].join("\n"));
    expect(lines.find((line) => line.kind === "add")?.text).toBe("  ");
  });

  it("says when a file ends without a newline rather than showing the backslash", () => {
    const lines = parseUnifiedDiff(["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file"].join("\n"));
    expect(lines[lines.length - 1].kind).toBe("meta");
    expect(lines[lines.length - 1].text).toBe("No newline at end of file");
  });

  it("returns nothing for nothing", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   ")).toEqual([]);
  });
});

describe("gutterWidth", () => {
  it("sizes to the widest number so the gutter does not jump mid-file", () => {
    expect(gutterWidth(parseUnifiedDiff(["@@ -998,1 +1204,1 @@", " a"].join("\n")))).toBe(4);
  });

  it("never gets narrower than two, so single digits are not cramped", () => {
    expect(gutterWidth(parseUnifiedDiff(["@@ -1,1 +1,1 @@", " a"].join("\n")))).toBe(2);
  });
});
