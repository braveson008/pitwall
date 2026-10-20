import { describe, expect, it } from "vitest";
import { parseUndoRequest, parseCorrection } from "./voiceCorrections.cjs";

describe("parseUndoRequest", () => {
  it("recognises the ways people ask to reverse the last thing", () => {
    for (const spoken of [
      "undo",
      "undo that",
      "undo it",
      "Undo that.",
      "no, undo that",
      "please undo",
      "take that back",
      "roll that back",
      "revert that",
      "never mind, undo that",
      "undo the last action",
    ]) {
      expect(parseUndoRequest(spoken), spoken).toBe(true);
    }
  });

  it("leaves a request that merely contains 'undo' to the router", () => {
    // "Undo the changes in App.tsx" is a request about specific files, and
    // answering it by reversing the last unrelated action would be a new bug
    // wearing the previous one's clothes.
    for (const spoken of [
      "undo the changes in App.tsx",
      "undo my last commit and then push",
      "can you undo the refactor in the parser",
      "revert the migration",
    ]) {
      expect(parseUndoRequest(spoken), spoken).toBe(false);
    }
  });

  it("is not triggered by ordinary speech", () => {
    for (const spoken of ["run the tests", "what's changed", "stop", "no", ""]) {
      expect(parseUndoRequest(spoken), spoken).toBe(false);
    }
  });
});

describe("parseCorrection", () => {
  it("pulls the real request out of the repair", () => {
    const cases: Array<[string, string]> = [
      ["no, I meant run the tests", "run the tests"],
      ["no I said push this", "push this"],
      ["I meant open App.tsx", "open App.tsx"],
      ["actually, show me the diff", "show me the diff"],
      ["no, I wanted you to commit this", "commit this"],
      ["no, run the tests", "run the tests"],
      ["no, not that, I want the status", "the status"],
    ];
    for (const [spoken, expected] of cases) {
      expect(parseCorrection(spoken)?.corrected, spoken).toBe(expected);
    }
  });

  it("preserves the case of what follows", () => {
    // Same reason the slot matcher runs on the original text: the corrected
    // request may itself carry a filename or a commit message.
    expect(parseCorrection("no, I meant open App.tsx")?.corrected).toBe("open App.tsx");
    expect(parseCorrection("actually commit this saying Fix the parser")?.corrected).toBe(
      "commit this saying Fix the parser",
    );
  });

  it("is not a correction when there is no request left in it", () => {
    // "No, that's wrong" is a complaint. There is nothing to route, and
    // inventing a request from it would be a worse failure than doing nothing.
    for (const spoken of ["no", "no, that", "no that's wrong", "wrong", "no, not that"]) {
      expect(parseCorrection(spoken), spoken).toBeNull();
    }
  });

  it("leaves an ordinary request alone", () => {
    for (const spoken of ["run the tests", "commit this", "what's changed", ""]) {
      expect(parseCorrection(spoken), spoken).toBeNull();
    }
  });

  it("does not mistake a request that mentions meaning for a correction", () => {
    // "What does this error mean" starts no correction pattern; the guard is
    // that patterns are anchored to the start of the utterance.
    expect(parseCorrection("what does this error mean")).toBeNull();
    expect(parseCorrection("explain what I meant by that")).toBeNull();
  });
});
