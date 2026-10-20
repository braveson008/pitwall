import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planChecks, readScripts, summarise, trimOutput } from "./validationGate.cjs";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pitwall-gate-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    scripts: { "type-check": "tsc --noEmit", test: "vitest run", build: "vite build" },
  }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("planChecks", () => {
  // A gate that has to be configured before it works is one most people never
  // turn on.
  it("finds the scripts a project already has, under any of their names", () => {
    const checks = planChecks(dir);
    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
    expect(byName.typecheck.script).toBe("type-check");
    expect(byName.tests.script).toBe("test");
    expect(byName.build.script).toBe("build");
  });

  // Not the same fact as "lint passed", and a reviewer should have the
  // difference.
  it("reports a missing check as not configured rather than dropping it", () => {
    const lint = planChecks(dir).find((check) => check.name === "lint");
    expect(lint).toBeTruthy();
    expect(lint.skipped).toBe(true);
    expect(lint.command).toBe("");
  });

  // Typecheck and lint answer in seconds; a build can take minutes.
  it("asks the quick questions first", () => {
    const names = planChecks(dir).map((check) => check.name);
    expect(names.indexOf("typecheck")).toBeLessThan(names.indexOf("tests"));
    expect(names.indexOf("lint")).toBeLessThan(names.indexOf("build"));
  });

  it("can be narrowed to the checks worth re-running", () => {
    expect(planChecks(dir, { only: ["typecheck"] }).map((check) => check.name)).toEqual(["typecheck"]);
  });

  // A repository with no package.json is not a broken gate.
  it("finds nothing runnable rather than throwing", () => {
    const checks = planChecks(join(dir, "nowhere"));
    expect(checks.every((check) => check.skipped)).toBe(true);
    expect(readScripts(join(dir, "nowhere"))).toEqual({});
  });

  it("ignores a script that exists but is empty", () => {
    const empty = mkdtempSync(join(tmpdir(), "pitwall-gate-empty-"));
    writeFileSync(join(empty, "package.json"), JSON.stringify({ scripts: { test: "   " } }));
    expect(planChecks(empty).find((check) => check.name === "tests").skipped).toBe(true);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("summarise", () => {
  it("passes when every check that ran passed", () => {
    expect(summarise([
      { name: "typecheck", ok: true, skipped: false },
      { name: "tests", ok: true, skipped: false },
    ])).toMatchObject({ ok: true, ranCount: 2, failedNames: [] });
  });

  // A repository with no linter has not failed its lint.
  it("does not fail a run for checks that were never configured", () => {
    expect(summarise([
      { name: "typecheck", ok: true, skipped: false },
      { name: "lint", ok: false, skipped: true },
    ])).toMatchObject({ ok: true, ranCount: 1 });
  });

  it("names every failure, for the sentence the loop writes", () => {
    expect(summarise([
      { name: "typecheck", ok: false, skipped: false },
      { name: "tests", ok: false, skipped: false },
    ]).failedNames).toEqual(["typecheck", "tests"]);
  });

  it("passes a run where nothing could be checked at all", () => {
    expect(summarise([{ name: "lint", ok: false, skipped: true }])).toMatchObject({ ok: true, ranCount: 0 });
  });
});

describe("trimOutput", () => {
  // A compiler prints the files it read first and the error last, so the tail
  // is the half worth keeping.
  it("keeps the end, where the error is", () => {
    const output = trimOutput("noise".repeat(2000) + "TS2345: the actual error", 100);
    expect(output).toContain("TS2345: the actual error");
    expect(output).toContain("characters trimmed");
  });

  it("leaves a short output alone", () => {
    expect(trimOutput("all good")).toBe("all good");
    expect(trimOutput("")).toBe("");
  });
});
