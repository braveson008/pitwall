import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_CHUNKS,
  appendCapped,
  applyBatch,
  transcriptSize,
} from "./transcriptBuffer";

describe("appendCapped", () => {
  it("appends in order", () => {
    expect(appendCapped(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(appendCapped(undefined, ["a"])).toEqual(["a"]);
  });

  it("returns the same array when nothing arrived", () => {
    // Identity, not equality: an unchanged reference lets a caller skip the
    // state update and the render behind it.
    const existing = ["a", "b"];
    expect(appendCapped(existing, [])).toBe(existing);
  });

  it("keeps the newest when the chunk count is exceeded", () => {
    const many = Array.from({ length: 10 }, (_, i) => String(i));
    const capped = appendCapped(many, ["10"], 1_000_000, 4);
    expect(capped).toEqual(["7", "8", "9", "10"]);
  });

  it("keeps the newest when the character budget is exceeded", () => {
    const capped = appendCapped(["aaaa", "bbbb", "cccc"], ["dddd"], 8, 100);
    expect(capped).toEqual(["cccc", "dddd"]);
  });

  it("never grows without bound, however long a session runs", () => {
    // The actual failure: an hour of output in an array that is copied every
    // animation frame, getting slower the longer the app stays open.
    // Twelve times the chunk cap, which proves the bound without the test
    // itself taking seconds — it was doing 200,000 appends and timing out.
    let buffer: string[] = [];
    for (let i = 0; i < 50_000; i += 1) buffer = appendCapped(buffer, [`line ${i}\n`]);
    expect(buffer.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHUNKS);
    expect(transcriptSize(buffer)).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    // And what it kept is the end, which is the part anything reads.
    expect(buffer[buffer.length - 1]).toBe("line 49999\n");
  });

  it("bounds a CLI that draws with thousands of tiny writes", () => {
    // A progress bar emits far more chunks than characters, so a character cap
    // alone leaves an enormous array holding almost no text — and it is the
    // length that makes the copy slow.
    let buffer: string[] = [];
    for (let i = 0; i < 50_000; i += 1) buffer = appendCapped(buffer, ["."]);
    expect(buffer.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHUNKS);
  });

  it("keeps the tail of a single chunk larger than the whole budget", () => {
    // Dropping it returned an empty transcript, losing the output that had
    // just arrived. Terminals write in bursts and one being enormous is
    // ordinary, so it is trimmed to its end rather than discarded.
    const huge = "x".repeat(MAX_TRANSCRIPT_CHARS * 2) + "END";
    const capped = appendCapped([], [huge]);
    expect(capped).toHaveLength(1);
    expect(capped[0].endsWith("END")).toBe(true);
    expect(transcriptSize(capped)).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
  });

  it("keeps enough for everything that reads it", () => {
    // The inspector takes the last 120, the gate check the last 50, and the
    // completion summary is parsed from the tail. All well inside the cap.
    let buffer: string[] = [];
    for (let i = 0; i < 10_000; i += 1) buffer = appendCapped(buffer, [`chunk ${i}\n`]);
    expect(buffer.length).toBeGreaterThan(200);
    expect(buffer.slice(-120)).toHaveLength(120);
  });
});

describe("applyBatch", () => {
  it("leaves a quiet session's array untouched, by reference", () => {
    // A session that received nothing must not appear changed, or every
    // consumer of it re-renders for output that belongs to another pane.
    const quiet = ["old"];
    const current = { quiet, busy: ["a"] };
    const next = applyBatch(current, { busy: ["b"] });
    expect(next.quiet).toBe(quiet);
    expect(next.busy).toEqual(["a", "b"]);
  });

  it("returns the same map when the batch is empty", () => {
    const current = { a: ["x"] };
    expect(applyBatch(current, {})).toBe(current);
  });

  it("caps each session independently", () => {
    const current = { a: Array.from({ length: 5000 }, () => "x"), b: ["y"] };
    const next = applyBatch(current, { a: ["z"] });
    expect(next.a.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHUNKS);
    expect(next.b).toEqual(["y"]);
  });
});

describe("applyBatch drop accounting", () => {
  it("counts what the cap removed, so a pane can find its place", () => {
    // Without this a pane tracking its position by index sees a different chunk
    // at that index every flush and resets the terminal, which is a flicker.
    const dropped: Record<string, number> = {};
    let map: Record<string, string[]> = { a: [] };
    for (let i = 0; i < MAX_TRANSCRIPT_CHUNKS + 500; i += 1) {
      map = applyBatch(map, { a: [`chunk ${i}`] }, dropped);
    }
    expect(map.a.length).toBe(MAX_TRANSCRIPT_CHUNKS);
    expect(dropped.a).toBe(500);
    // The invariant every reader depends on: absolute position of the first
    // chunk still held equals how many were dropped.
    expect(map.a[0]).toBe(`chunk ${dropped.a}`);
  });

  it("counts nothing while the buffer is still growing", () => {
    const dropped: Record<string, number> = {};
    let map: Record<string, string[]> = {};
    for (let i = 0; i < 50; i += 1) map = applyBatch(map, { a: [`c${i}`] }, dropped);
    expect(dropped.a ?? 0).toBe(0);
  });

  it("is optional, so a caller that does not need it is unaffected", () => {
    expect(applyBatch({ a: ["x"] }, { a: ["y"] }).a).toEqual(["x", "y"]);
  });
});
