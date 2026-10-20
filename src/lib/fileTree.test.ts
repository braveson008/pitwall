import { describe, expect, it } from "vitest";
import { ancestorsOf, buildTree, changedFolders, flattenTree } from "./fileTree";

describe("file tree", () => {
  const tree = buildTree(["src/b.ts", "README.md", "src/lib/a.ts", "src/A.ts", "package.json"]);

  it("lists folders before files, by name, and only opens what is expanded", () => {
    expect(flattenTree(tree, new Set()).map((row) => row.path)).toEqual(["src", "package.json", "README.md"]);
    expect(flattenTree(tree, new Set(["src"])).map((row) => `${row.depth}:${row.name}`)).toEqual([
      "0:src", "1:lib", "1:A.ts", "1:b.ts", "0:package.json", "0:README.md",
    ]);
  });

  it("marks every folder above a changed file", () => {
    expect([...changedFolders(["src/lib/a.ts", "README.md"])].sort()).toEqual(["src", "src/lib"]);
  });

  it("knows which folders reveal a file", () => {
    expect(ancestorsOf("src/lib/a.ts")).toEqual(["src", "src/lib"]);
    expect(ancestorsOf("a.ts")).toEqual([]);
  });

  it("flattens a large repository quickly when little is open", () => {
    const paths = Array.from({ length: 50_000 }, (_, index) => `pkg${index % 50}/dir${index % 400}/file${index}.ts`);
    const big = buildTree(paths);
    const started = performance.now();
    const rows = flattenTree(big, new Set(["pkg1"]));
    expect(performance.now() - started).toBeLessThan(20);
    expect(rows.length).toBeLessThan(100);
  });
});
