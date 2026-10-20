import { describe, expect, it } from "vitest";
import { MIN_ATTEMPTS_FOR_CONFIDENCE, describe as explain, firstTimeRate, recordFor, summarise } from "./modelHistory";
import type { AttemptOutcome } from "./modelHistory";

const outcome = (over: Partial<AttemptOutcome> = {}): AttemptOutcome => ({
  projectId: "p1", provider: "codex", model: "gpt-5.2-codex", riskLevel: "normal",
  passed: true, rounds: 1, at: "2026-08-28T20:00:00Z", ...over,
});

describe("summarise", () => {
  it("counts attempts, passes and first-time passes per model", () => {
    const records = summarise([
      outcome(),
      outcome({ passed: true, rounds: 2 }),
      outcome({ passed: false, rounds: 3 }),
    ]);
    expect(records[0]).toMatchObject({ attempts: 3, passes: 2, firstTimePasses: 1 });
  });

  // The number worth routing on: a model that always passes eventually, after
  // two fix rounds every time, is not cheap.
  it("separates passing from passing without fixes", () => {
    const records = summarise([outcome({ rounds: 1 }), outcome({ rounds: 2 }), outcome({ rounds: 3 })]);
    expect(records[0].passes).toBe(3);
    expect(records[0].firstTimePasses).toBe(1);
    expect(records[0].averageRounds).toBe(2);
  });

  it("keeps models and risk levels apart", () => {
    const records = summarise([
      outcome({ model: "a" }), outcome({ model: "b" }), outcome({ model: "a", riskLevel: "high" }),
    ]);
    expect(records).toHaveLength(3);
  });

  // What matters is how a model does on this codebase, not everywhere.
  it("can answer for one project only", () => {
    const records = summarise([outcome({ projectId: "p1" }), outcome({ projectId: "p2" })], "p1");
    expect(records[0].attempts).toBe(1);
  });

  it("has nothing to say about nothing", () => {
    expect(summarise([])).toEqual([]);
  });
});

describe("recordFor", () => {
  const many = Array.from({ length: MIN_ATTEMPTS_FOR_CONFIDENCE }, () => outcome());

  it("is confident once there are enough attempts to be", () => {
    const lookup = recordFor(summarise(many), { provider: "codex", model: "gpt-5.2-codex", riskLevel: "normal" });
    expect(lookup.basis).toBe("exact");
    expect(lookup.confident).toBe(true);
  });

  // Three is not statistics, but one is an anecdote.
  it("is not confident on a single attempt", () => {
    const lookup = recordFor(summarise([outcome()]), { provider: "codex", model: "gpt-5.2-codex", riskLevel: "normal" });
    expect(lookup.confident).toBe(false);
  });

  // A model that clears normal work is evidence about that model, weakly.
  it("borrows the same model's record from another risk level, and says so", () => {
    const lookup = recordFor(summarise(many), { provider: "codex", model: "gpt-5.2-codex", riskLevel: "high" });
    expect(lookup.basis).toBe("other-risk");
    expect(lookup.record?.attempts).toBe(MIN_ATTEMPTS_FOR_CONFIDENCE);
    // Borrowed evidence answers a different question, so never confident.
    expect(lookup.confident).toBe(false);
  });

  it("says it has nothing rather than inventing a baseline", () => {
    const lookup = recordFor(summarise(many), { provider: "claude", model: "opus", riskLevel: "normal" });
    expect(lookup.basis).toBe("none");
    expect(lookup.record).toBeUndefined();
  });
});

describe("firstTimeRate", () => {
  it("is the share that needed no fix round", () => {
    const records = summarise([outcome({ rounds: 1 }), outcome({ rounds: 1 }), outcome({ rounds: 3 })]);
    expect(firstTimeRate(records[0])).toBeCloseTo(2 / 3);
  });

  it("is nothing rather than zero when there is no record", () => {
    expect(firstTimeRate(undefined)).toBeNull();
  });
});

describe("describe", () => {
  // A number with no denominator invites more confidence than it earned.
  it("always says what the figure rests on", () => {
    const records = summarise(Array.from({ length: 4 }, () => outcome()));
    const sentence = explain(recordFor(records, { provider: "codex", model: "gpt-5.2-codex", riskLevel: "normal" }));
    expect(sentence).toContain("4 of 4");
    expect(sentence).toContain("100%");
  });

  it("says plainly when it should not be relied on", () => {
    const sentence = explain(recordFor(summarise([outcome()]), { provider: "codex", model: "gpt-5.2-codex", riskLevel: "normal" }));
    expect(sentence).toContain("too few attempts");
  });

  it("says when the evidence came from other work", () => {
    const records = summarise(Array.from({ length: 4 }, () => outcome()));
    const sentence = explain(recordFor(records, { provider: "codex", model: "gpt-5.2-codex", riskLevel: "high" }));
    expect(sentence).toContain("at other risk levels");
  });

  it("says it has no record rather than showing a zero", () => {
    expect(explain(recordFor([], { provider: "x", model: "y", riskLevel: "normal" }))).toBe("No record here yet.");
  });
});
