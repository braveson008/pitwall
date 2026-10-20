import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import importer from "./importBraveli.cjs";

const { declineImport, importFromBraveli, MARKER } = importer;

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function braveliProfile() {
  root = mkdtempSync(path.join(os.tmpdir(), "pitwall-import-"));
  const from = path.join(root, "Braveli");
  const write = (name: string, body = "x") => {
    mkdirSync(path.dirname(path.join(from, name)), { recursive: true });
    writeFileSync(path.join(from, name), body);
  };
  write("Local Storage/leveldb/000003.log", "projects");
  write("project-knowledge/p1.json", "{}");
  write("schedule.json", "[]");
  write("mcp-profiles/p1/config.json", "{}");
  write("worktrees/p1/task/README.md", "huge");
  write("Cache/data_0", "cache");
  write("runtime-state.json", "{\"terminals\":[]}");
  write("github-credentials.json", "{\"encryptedToken\":\"abc\"}");
  write("licence.json", "{}");
  write("project-knowledge.backup-2026-09-25/p1.json", "{}");
  return { from, to: path.join(root, "Pitwall") };
}

describe("importing Braveli's data", () => {
  it("copies projects, memory, schedules and settings, and leaves the rest", () => {
    const { from, to } = braveliProfile();
    expect(importFromBraveli({ from, to })).toBe("imported");
    expect(readFileSync(path.join(to, "Local Storage/leveldb/000003.log"), "utf8")).toBe("projects");
    for (const kept of ["project-knowledge/p1.json", "schedule.json", "mcp-profiles/p1/config.json"]) {
      expect(existsSync(path.join(to, kept))).toBe(true);
    }
    for (const left of ["worktrees", "Cache", "runtime-state.json", "github-credentials.json", "licence.json", "project-knowledge.backup-2026-09-25"]) {
      expect(existsSync(path.join(to, left))).toBe(false);
    }
    // Braveli itself is untouched.
    expect(existsSync(path.join(from, "worktrees/p1/task/README.md"))).toBe(true);
  });

  it("happens once", () => {
    const { from, to } = braveliProfile();
    importFromBraveli({ from, to });
    writeFileSync(path.join(from, "schedule.json"), "[\"changed later in Braveli\"]");
    expect(importFromBraveli({ from, to })).toBe("already");
    expect(readFileSync(path.join(to, "schedule.json"), "utf8")).toBe("[]");
  });

  it("never overwrites a Pitwall that already has data", () => {
    const { from, to } = braveliProfile();
    mkdirSync(path.join(to, "Local Storage"), { recursive: true });
    writeFileSync(path.join(to, "schedule.json"), "[\"pitwall's own\"]");
    expect(importFromBraveli({ from, to })).toBe("fresh");
    expect(readFileSync(path.join(to, "schedule.json"), "utf8")).toBe("[\"pitwall's own\"]");
    expect(existsSync(path.join(to, MARKER))).toBe(true);
  });

  it("waits while Braveli is open, copying nothing and recording nothing", () => {
    const { from, to } = braveliProfile();
    expect(importFromBraveli({ from, to, isRunning: () => true })).toBe("busy");
    expect(existsSync(to)).toBe(false);
    expect(importFromBraveli({ from, to, isRunning: () => false })).toBe("imported");
  });

  it("is not offered again once declined", () => {
    const { from, to } = braveliProfile();
    declineImport(to);
    expect(importFromBraveli({ from, to, isRunning: () => false })).toBe("already");
    expect(existsSync(path.join(to, "schedule.json"))).toBe(false);
  });

  it("does nothing without a Braveli to import from", () => {
    root = mkdtempSync(path.join(os.tmpdir(), "pitwall-import-"));
    expect(importFromBraveli({ from: path.join(root, "nope"), to: path.join(root, "Pitwall") })).toBe("none");
  });
});
