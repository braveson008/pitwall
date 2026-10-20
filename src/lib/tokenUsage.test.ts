import { describe, expect, it } from "vitest";
import { formatTokens, readUsage, totalUsage } from "./tokenUsage";

describe("readUsage", () => {
  it("reads the shape Codex actually prints", () => {
    // Verified against a real run: a `tokens used` header, the figure below.
    expect(readUsage("codex\nBRIDGE_OK\ntokens used\n26,740\n").tokens).toBe(26740);
  });

  it("reads it on one line too", () => {
    expect(readUsage("done. tokens used: 1,234").tokens).toBe(1234);
    expect(readUsage("Total tokens: 900").tokens).toBe(900);
  });

  it("adds an input and output pair", () => {
    expect(readUsage("input: 1,000 tokens\noutput: 2,500 tokens").tokens).toBe(3500);
  });

  it("reads a cost when one is printed", () => {
    expect(readUsage("Total cost: $0.42").costUsd).toBe(0.42);
  });

  it("reports nothing rather than guessing when the CLI said nothing", () => {
    // The whole point. An estimate would sit in the same column as a real
    // figure, in the same font, and nobody could tell them apart.
    expect(readUsage("I have finished the task. Everything looks good.")).toEqual({});
    expect(readUsage("")).toEqual({});
  });

  it("does not read an agent's prose as a measurement", () => {
    // A loose /(\d+) tokens/ would match this and report 500 tokens spent.
    expect(readUsage("I trimmed the prompt to around 500 tokens for speed.").tokens).toBeUndefined();
    expect(readUsage("The context window is 262144 tokens.").tokens).toBeUndefined();
  });

  it("takes the figure from the end, where a CLI prints its summary", () => {
    const transcript = `tokens used\n111\n${"x".repeat(9000)}\ntokens used\n999\n`;
    expect(readUsage(transcript).tokens).toBe(999);
  });

  it("says which pattern matched, so a wrong reading can be traced", () => {
    expect(readUsage("tokens used\n10\n").source).toBe("codex");
  });

  it("ignores a zero cost rather than reporting free work as measured", () => {
    expect(readUsage("Total cost: $0.00").costUsd).toBeUndefined();
  });
});

describe("totalUsage", () => {
  it("sums what was reported and counts what was not", () => {
    const total = totalUsage([{ tokens: 100 }, { tokens: 250 }, {}]);
    expect(total.tokens).toBe(350);
    expect(total.reported).toBe(2);
    // Shown beside the total, because 350 from two of three sessions is not
    // what this run cost.
    expect(total.unreported).toBe(1);
  });

  it("is null rather than zero when nothing reported", () => {
    // Zero would read as "this was free", which is a claim, and false.
    const total = totalUsage([{}, {}]);
    expect(total.tokens).toBeNull();
    expect(total.costUsd).toBeNull();
    expect(total.unreported).toBe(2);
  });

  it("adds costs without floating-point litter", () => {
    expect(totalUsage([{ costUsd: 0.1 }, { costUsd: 0.2 }]).costUsd).toBe(0.3);
  });
});

describe("formatTokens", () => {
  it("says numbers the way a person would", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(26_740)).toBe("27k");
    expect(formatTokens(1_400_000)).toBe("1.4M");
  });
});
