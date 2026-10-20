import { describe, expect, it } from "vitest";
import { buildThreadNotice, summariseNote } from "./councilNotice";

describe("buildThreadNotice", () => {
  it("says nothing about a council that is still running", () => {
    expect(buildThreadNotice({ turn: 3 })).toBeUndefined();
    expect(buildThreadNotice(null)).toBeUndefined();
  });

  // The bug this whole thing exists for: finishing the work was reported with
  // the same amber warning as falling over.
  it("reports finished work as done, not as a warning", () => {
    const notice = buildThreadNotice({
      note: "The council finished — an agent marked the work complete.",
      tone: "done",
      turn: 7,
      startedAt: "2026-08-26T10:00:00.000Z",
      finishedAt: "2026-08-26T10:12:00.000Z",
    });
    expect(notice?.tone).toBe("done");
    expect(notice?.title).toBe("The council finished");
    expect(notice?.meta).toBe("7 turns · 12m");
  });

  it("still reports a finish without knowing how long it took", () => {
    const notice = buildThreadNotice({ note: "done", tone: "done", turn: 1 });
    expect(notice?.tone).toBe("done");
    expect(notice?.meta).toBe("1 turn");
  });

  it("a pause outranks whatever stopped the relay", () => {
    const notice = buildThreadNotice({ note: "Paused.", paused: true, tone: "warn", turn: 4 });
    expect(notice?.tone).toBe("attention");
    expect(notice?.title).toBe("Paused");
  });

  // A council out of turns is usually still productive. Calling it a failure
  // invites throwing the run away rather than extending it.
  it("treats running out of turns as something to answer, not a fault", () => {
    const notice = buildThreadNotice({ note: "Turn limit reached.", atTurnLimit: true, turn: 24 });
    expect(notice?.tone).toBe("attention");
    expect(notice?.title).toBe("Out of turns");
  });

  // The council used to fall straight from "we agree on the approach" into
  // building it, off a plan nobody had read.
  it("reports an agreed approach as a decision to act on, not as a stop", () => {
    const notice = buildThreadNotice({
      note: "The council agreed an approach and has not started building it.",
      tone: "attention",
      awaitingStart: true,
      turn: 1,
    });
    expect(notice?.tone).toBe("attention");
    expect(notice?.title).toBe("The approach is agreed");
  });

  it("still lets a pause outrank the agreed approach", () => {
    expect(buildThreadNotice({ note: "n", awaitingStart: true, paused: true })?.title).toBe("Paused");
  });

  it("reports anything else as a warning, carrying the reason", () => {
    const notice = buildThreadNotice({ note: "A member exited without handing off.", turn: 2 });
    expect(notice?.tone).toBe("warn");
    expect(notice?.detail).toBe("A member exited without handing off.");
  });

  it("does not invent a turn count it was not given", () => {
    expect(buildThreadNotice({ note: "stopped" })?.meta).toBe("");
    expect(buildThreadNotice({ note: "stopped", turn: 0 })?.meta).toBe("");
  });
});

describe("summariseNote", () => {
  it("leaves a note that already fits", () => {
    expect(summariseNote("The council finished.")).toBe("The council finished.");
  });

  it("cuts a note built from what an agent wrote", () => {
    // A verification verdict lists every gap it found, and an agent asked to be
    // thorough writes thousands of words. One filled the window, pushed the
    // rest of the interface off screen, and buried the button beside it.
    const wall = `Verification failed. Still open: ${Array.from({ length: 200 }, (_, i) => `gap number ${i} in some file`).join("; ")}.`;
    const short = summariseNote(wall);
    expect(short.length).toBeLessThan(320);
    expect(short).toContain("Verification failed");
    expect(short).toContain("the full detail is in the thread");
  });

  it("ends on a thought rather than mid-word", () => {
    const text = `${"word ".repeat(80)}end`;
    expect(summariseNote(text)).not.toMatch(/\bwor…/);
  });

  it("flattens the newlines an agent's prose arrives with", () => {
    expect(summariseNote("one\n\ntwo   three")).toBe("one two three");
  });

  it("copes with nothing", () => {
    expect(summariseNote("")).toBe("");
    expect(summariseNote(undefined as never)).toBe("");
  });
});
