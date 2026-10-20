import { describe, expect, it } from "vitest";
import { scoreTerm, searchPalette, type PaletteItem } from "./commandPalette";

const item = (id: string, title: string, keywords = ""): PaletteItem =>
  ({ id, title, group: "g", keywords });

describe("scoreTerm", () => {
  it("prefers a prefix over a word start over a bare substring", () => {
    expect(scoreTerm("new", "New task")).toBeGreaterThan(scoreTerm("task", "New task"));
    expect(scoreTerm("task", "New task")).toBeGreaterThan(scoreTerm("ask", "New task"));
  });

  it("matches the way launchers abbreviate", () => {
    // Not adjacent, but in order — the muscle-memory way.
    expect(scoreTerm("nts", "new task session")).toBeGreaterThan(0);
    expect(scoreTerm("xz", "new task session")).toBe(-1);
  });

  it("is case-insensitive", () => {
    expect(scoreTerm("BROAD", "Broadcast to all sessions")).toBe(100);
  });

  it("survives regex metacharacters in the query", () => {
    expect(() => scoreTerm("c++ (", "c++ (session)")).not.toThrow();
  });
});

describe("searchPalette", () => {
  const items = [
    item("nt", "New task"),
    item("ns", "New session"),
    item("bt", "Broadcast to all sessions"),
    item("go-tasks", "Tasks", "board kanban"),
    item("th-tokyo", "Theme: Tokyo"),
  ];

  it("returns the leading items untouched for an empty query", () => {
    expect(searchPalette(items, "").map((i) => i.id)).toEqual(["nt", "ns", "bt", "go-tasks", "th-tokyo"]);
  });

  it("requires every term to match", () => {
    expect(searchPalette(items, "new task").map((i) => i.id)).toEqual(["nt"]);
  });

  it("finds by hidden keywords without ranking them above title hits", () => {
    const hits = searchPalette(items, "kanban");
    expect(hits.map((i) => i.id)).toEqual(["go-tasks"]);
  });

  it("drops non-matches entirely", () => {
    expect(searchPalette(items, "zzz")).toEqual([]);
  });

  it("puts the tighter title first on ties", () => {
    const hits = searchPalette(items, "ne");
    expect(hits[0].id).toBe("nt");   // "New task" beats "New session" only by length
  });
});
