import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import brief from "./handoffBrief.cjs";

const { MAX_BRIEF, buildHandoffBrief, messagesFromTranscript } = brief;
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

describe("handoff brief", () => {
  it("reads the conversation's own words from Claude and Codex files, skipping tool traffic", () => {
    expect(messagesFromTranscript("claude", fixture("claude-2.1.296.jsonl"))).toEqual([
      { role: "user", text: "Fix the cart total in /Users/fixture/Projects/shop/src/cart.ts please" },
      { role: "assistant", text: "The total ignores discounts. I changed src/cart.ts to subtract them." },
    ]);
    expect(messagesFromTranscript("codex", fixture("codex-0.162.1.jsonl"))).toEqual([
      { role: "user", text: "Fix the cart total" },
      { role: "assistant", text: "Done: discounts are subtracted now." },
    ]);
    expect(messagesFromTranscript("hermes", '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}')).toHaveLength(2);
  });

  it("says where the work came from, what the task is, what changed and the latest turns", () => {
    const text = buildHandoffBrief({
      task: { title: "Fix the cart", description: "Totals ignore discounts" },
      messages: [{ role: "user", text: "Fix it" }, { role: "assistant", text: "Subtracting discounts now" }],
      diffStat: " src/cart.ts | 4 ++--",
      reviewComments: ["Add a test"],
      device: "MacBook",
      at: "10:42",
    });
    for (const part of ["MacBook", "Fix the cart", "Totals ignore discounts", "src/cart.ts", "Add a test", "Person: Fix it", "Agent: Subtracting discounts now"]) {
      expect(text).toContain(part);
    }
  });

  it("stays short enough for a Windows command line, keeping the newest turns", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `turn ${index} ${"x".repeat(900)}` }));
    const text = buildHandoffBrief({ task: { title: "Big", description: "y".repeat(2000) }, messages });
    expect(text.length).toBeLessThanOrEqual(MAX_BRIEF);
    expect(text).toContain("turn 11");
    expect(text).not.toContain("turn 0 ");
  });
});
