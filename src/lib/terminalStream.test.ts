import { TERMINAL_REPLAY_RESET } from "./terminalHistory";
import { describe, expect, it } from "vitest";
import { needsResync, terminalNotice, terminalNotices, terminalWritePlan } from "./terminalStream";

const replay = (chunks: string[]) => terminalWritePlan(chunks, 0, null).writes.join("");

describe("terminalNotice", () => {
  it("carries its own line ending so nothing downstream has to guess", () => {
    expect(terminalNotice("$ claude")).toBe("$ claude\r\n");
    expect(terminalNotices(["a", "b"])).toEqual(["a\r\n", "b\r\n"]);
  });
});

describe("terminalWritePlan", () => {
  it("hands the terminal a split stream byte for byte", () => {
    // The regression. PTY output is a byte stream and a read boundary falls
    // wherever the kernel puts it, so a chunk of plain prose carrying no
    // control character is ordinary output — not a line Pitwall printed.
    // Appending a break to it moved the cursor out from under the CLI's own
    // redraws, and everything painted afterwards landed a row off and overwrote
    // what was already on screen.
    const chunks = ["[2K\rSame theme as #5058 ", "—two", " comments", "\r\n"];
    expect(replay(chunks)).toBe("[2K\rSame theme as #5058 —two comments\r\n");
  });

  it("writes only the tail a pane has not seen", () => {
    expect(terminalWritePlan(["a", "b", "c"], 1, "a")).toEqual({ reset: false, writes: ["b", "c"] });
  });

  it("owes nothing when the buffer has not grown", () => {
    expect(terminalWritePlan(["a", "b"], 2, "b")).toEqual({ reset: false, writes: [] });
  });

  it("replays a buffer that was replaced by a shorter one", () => {
    // A council run reseeding a pane that stayed mounted. Without the reset the
    // write position sits past the end of the new buffer and every later chunk
    // is swallowed, which reads as a pane that has frozen.
    expect(terminalWritePlan(["boot"], 40, "old tail")).toEqual({ reset: true, writes: ["boot"] });
  });

  it("replays a buffer replaced by one of the same length", () => {
    expect(terminalWritePlan(["x", "y"], 2, "b")).toEqual({ reset: true, writes: ["x", "y"] });
  });

  it("does not replay when the buffer merely grew past a matching tail", () => {
    expect(terminalWritePlan(["a", "b", "c", "d"], 2, "b")).toEqual({ reset: false, writes: ["c", "d"] });
  });
});

describe("terminalWritePlan replay budget", () => {
  const chunk = "x".repeat(1_000);
  const big = Array.from({ length: 500 }, () => chunk); // 500k characters

  it("replays a short buffer whole", () => {
    const plan = terminalWritePlan(big.slice(0, 3), 0, null, 100_000);
    expect(plan.writes.join("")).toBe(big.slice(0, 3).join(""));
    expect(plan.reset).toBe(false);
  });

  it("replays only the tail of a long buffer into a new terminal", () => {
    // The terminal discards everything above its scrollback anyway, so parsing
    // the whole buffer is work spent to be thrown away.
    const plan = terminalWritePlan(big, 0, null, 10_000);
    const characters = plan.writes.reduce((sum, write) => sum + write.length, 0);
    expect(characters).toBeLessThanOrEqual(10_000 + TERMINAL_REPLAY_RESET.length);
    expect(plan.writes.join("").endsWith(big.at(-1)!)).toBe(true);
  });

  it("clears inherited colour when it starts mid-stream", () => {
    expect(terminalWritePlan(big, 0, null, 10_000).writes[0]).toBe(TERMINAL_REPLAY_RESET);
  });

  it("cuts only at chunk boundaries, never inside an escape sequence", () => {
    const plan = terminalWritePlan(big, 0, null, 10_000);
    // Whole entries only: the replayed text is a suffix of the buffer, so no
    // sequence was split — however the entries were grouped into writes.
    const replayed = plan.writes.slice(1).join("");
    expect(big.join("").endsWith(replayed)).toBe(true);
    expect(replayed.length % chunk.length).toBe(0);
  });

  it("hands the terminal few large writes instead of thousands of small ones", () => {
    const plan = terminalWritePlan(big, 0, null, 400_000);
    expect(plan.writes.length).toBeLessThan(12);
    // and loses nothing doing it
    expect(big.join("").endsWith(plan.writes.slice(1).join(""))).toBe(true);
  });

  it("still writes something when one chunk exceeds the whole budget", () => {
    const plan = terminalWritePlan(["small", "y".repeat(50_000)], 0, null, 10_000);
    expect(plan.writes.join("")).toContain("y".repeat(50_000));
  });

  it("does not bound the live tail — an attached pane gets every byte", () => {
    // The append path must stay exact: this is the stream a live TUI is drawing
    // into, and dropping or restarting any of it is what corrupts a session.
    const plan = terminalWritePlan(big, 499, big[498], 10_000);
    expect(plan.reset).toBe(false);
    expect(plan.writes).toEqual([big[499]]);
  });

  it("bounds a replaced buffer too, since that is a fresh replay", () => {
    const plan = terminalWritePlan(big, 400, "something else entirely", 10_000);
    expect(plan.reset).toBe(true);
    const characters = plan.writes.reduce((sum, write) => sum + write.length, 0);
    expect(characters).toBeLessThanOrEqual(10_000 + TERMINAL_REPLAY_RESET.length);
  });
});

describe("terminalWritePlan against a bounded buffer", () => {
  /**
   * The transcript is a sliding window, not a log: once it is full every flush
   * drops chunks off the front and every index shifts. Read as append-only,
   * the chunk at the position a pane last wrote is a different one each frame,
   * so the pane concluded the buffer had been replaced — resetting the terminal
   * and replaying a megabyte of escape sequences, sixty times a second. On
   * screen that is a flickering pane.
   */
  it("writes only what is new after the buffer has started trimming", () => {
    // The pane has written 100 chunks. Since then the buffer dropped 10 off the
    // front and gained 2, so it holds chunks 10..101 and only 2 are new.
    const chunks = Array.from({ length: 92 }, (_, i) => `chunk ${i + 10}`);
    const plan = terminalWritePlan(chunks, 100, "chunk 99", 1_000_000, 10);
    expect(plan.reset).toBe(false);
    expect(plan.writes).toEqual(["chunk 100", "chunk 101"]);
  });

  it("does not reset when nothing is new and the window has moved", () => {
    // The frame that used to reset every time: no new output at all, but the
    // window slid, so the old check saw a different chunk at its position.
    const chunks = Array.from({ length: 90 }, (_, i) => `chunk ${i + 10}`);
    const plan = terminalWritePlan(chunks, 100, "chunk 99", 1_000_000, 10);
    expect(plan.reset).toBe(false);
    expect(plan.writes).toEqual([]);
  });

  it("still replays when the pane has fallen behind the window", () => {
    // Its next chunk was dropped before it was ever written, so there is a real
    // gap and a replay is the only honest answer.
    const chunks = Array.from({ length: 50 }, (_, i) => `chunk ${i + 500}`);
    const plan = terminalWritePlan(chunks, 100, "chunk 99", 1_000_000, 500);
    expect(plan.reset).toBe(true);
    expect(plan.writes.length).toBeGreaterThan(0);
  });

  it("still detects a buffer that was genuinely replaced", () => {
    // The case the check exists for — a session reset, not a window slide.
    const plan = terminalWritePlan(["different", "content"], 2, "chunk 1", 1_000_000, 0);
    expect(plan.reset).toBe(true);
  });

  it("behaves exactly as before when nothing has been dropped", () => {
    const chunks = ["a", "b", "c"];
    expect(terminalWritePlan(chunks, 2, "b", 1_000_000, 0)).toEqual(
      terminalWritePlan(chunks, 2, "b"),
    );
  });
});

describe("needsResync", () => {
  // One session can be shown in two places at once — its row in the Terminal
  // tab and its cell in the Council grid. Both fit themselves and both resize
  // the single PTY they share, so the hidden one keeps taking output drawn for
  // the other pane's shape.
  const pane = { cols: 120, rows: 30 };

  it("resyncs a pane whose width no longer matches the PTY", () => {
    expect(needsResync({ cols: 96, rows: 30 }, pane)).toBe(true);
  });

  it("resyncs a pane whose height no longer matches the PTY", () => {
    // Two panes of equal width and different height is the ordinary case: a
    // council cell against a full-height terminal row. Checking only the width
    // left that pane rendering a screen laid out for a different number of
    // rows, which shows as output stranded in a mostly empty pane.
    expect(needsResync({ cols: 120, rows: 52 }, pane)).toBe(true);
  });

  it("leaves a pane alone when it already matches", () => {
    expect(needsResync({ cols: 120, rows: 30 }, pane)).toBe(false);
  });

  it("does nothing without a reported PTY size", () => {
    expect(needsResync(undefined, pane)).toBe(false);
    expect(needsResync({ cols: 0, rows: 0 }, pane)).toBe(false);
  });
});

describe("escape boundaries", () => {
  it("holds back an unfinished escape sequence and lets a finished one through", async () => {
    const { splitAtEscapeBoundary } = await import("./terminalStream");
    expect(splitAtEscapeBoundary("ok, here\x1b")).toEqual({ ready: "ok, here", carry: "\x1b" });
    expect(splitAtEscapeBoundary("ok\x1b[")).toEqual({ ready: "ok", carry: "\x1b[" });
    expect(splitAtEscapeBoundary("ok\x1b[38;5")).toEqual({ ready: "ok", carry: "\x1b[38;5" });
    expect(splitAtEscapeBoundary("ok\x1b]0;title")).toEqual({ ready: "ok", carry: "\x1b]0;title" });
    expect(splitAtEscapeBoundary("ok\x1b[K")).toEqual({ ready: "ok\x1b[K", carry: "" });
    expect(splitAtEscapeBoundary("ok\x1b]0;title\x07")).toEqual({ ready: "ok\x1b]0;title\x07", carry: "" });
    expect(splitAtEscapeBoundary("ok\x1b]0;title\x1b\\")).toEqual({ ready: "ok\x1b]0;title\x1b\\", carry: "" });
    expect(splitAtEscapeBoundary("plain text")).toEqual({ ready: "plain text", carry: "" });
    expect(splitAtEscapeBoundary("ok\x1b(")).toEqual({ ready: "ok", carry: "\x1b(" });
    expect(splitAtEscapeBoundary("ok\x1b(B")).toEqual({ ready: "ok\x1b(B", carry: "" });
  });

  it("rejoins a split sequence so no stored entry starts with half of one", async () => {
    const { splitAtEscapeBoundary } = await import("./terminalStream");
    const reads = ["line one\x1b", "[Kok, here is the data\r\n"];
    let carry = "";
    const stored: string[] = [];
    for (const read of reads) {
      const { ready, carry: next } = splitAtEscapeBoundary(carry + read);
      carry = next;
      if (ready) stored.push(ready);
    }
    expect(stored).toEqual(["line one", "\x1b[Kok, here is the data\r\n"]);
  });
});

describe("terminal modes across a bounded replay", () => {
  it("remembers what the program switched on, even split across reads", async () => {
    const { createModeTracker } = await import("./terminalStream");
    const tracker = createModeTracker();
    tracker.observe("\x1b[?1049h\x1b[?10");
    tracker.observe("06h\x1b[?1000h\x1b[?2004h\x1b[?25l");
    expect(tracker.preamble()).toBe("\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?25l");
    tracker.observe("\x1b[?1000l\x1b[?1049l\x1b[?25h");
    expect(tracker.preamble()).toBe("\x1b[?1006h\x1b[?2004h");
  });

  it("restores them before a replay that starts mid-stream, and only then", async () => {
    const { terminalWritePlan } = await import("./terminalStream");
    const preamble = "\x1b[?1049h\x1b[?1006h";
    // The start of the stream is still here: the program's own sequences replay.
    expect(terminalWritePlan(["a", "b"], 0, null, undefined, 0, preamble).writes).toEqual(["a", "b"]);
    // The start is gone: the modes go first.
    expect(terminalWritePlan(["c", "d"], 0, null, undefined, 40, preamble).writes).toEqual([preamble, "c", "d"]);
    // Behind the window: reset, modes, then the tail.
    const behind = terminalWritePlan(["c", "d"], 10, "x", undefined, 40, preamble);
    expect(behind.reset).toBe(true);
    expect(behind.writes[0]).toBe(preamble);
  });
});
