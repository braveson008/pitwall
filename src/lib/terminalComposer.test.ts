import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPOSER_HISTORY,
  composerKeyAction,
  recallSubmission,
  rememberSubmission,
  withImagePaths,
  type ComposerHistory,
} from "./terminalComposer";

const at = (value: string, caret: number) => ({ value, selectionStart: caret, selectionEnd: caret });

describe("rememberSubmission", () => {
  it("keeps the newest submission first", () => {
    let history = rememberSubmission(EMPTY_COMPOSER_HISTORY, "first");
    history = rememberSubmission(history, "second");
    expect(history.entries).toEqual(["second", "first"]);
  });

  it("does not stack a repeated submission", () => {
    const history = rememberSubmission(rememberSubmission(EMPTY_COMPOSER_HISTORY, "retry"), "retry");
    expect(history.entries).toEqual(["retry"]);
  });

  it("ignores whitespace-only submissions", () => {
    expect(rememberSubmission(EMPTY_COMPOSER_HISTORY, "   \n ").entries).toEqual([]);
  });

  it("resets the cursor and stashed draft on every submission", () => {
    const walked: ComposerHistory = { entries: ["old"], index: 0, draft: "half-written" };
    expect(rememberSubmission(walked, "sent")).toMatchObject({ index: -1, draft: "" });
  });
});

describe("recallSubmission", () => {
  const history: ComposerHistory = { entries: ["newest", "older"], index: -1, draft: "" };

  it("walks back through submissions", () => {
    const first = recallSubmission(history, -1, "");
    expect(first?.value).toBe("newest");
    const second = recallSubmission(first!.history, -1, "newest");
    expect(second?.value).toBe("older");
  });

  it("stops at the oldest entry rather than wrapping", () => {
    const oldest: ComposerHistory = { entries: ["newest", "older"], index: 1, draft: "" };
    expect(recallSubmission(oldest, -1, "older")).toBeNull();
  });

  it("gives back the draft that was interrupted", () => {
    const stepped = recallSubmission(history, -1, "a draft I was writing");
    expect(stepped?.history.draft).toBe("a draft I was writing");
    const back = recallSubmission(stepped!.history, 1, "newest");
    expect(back?.value).toBe("a draft I was writing");
    expect(back?.history.index).toBe(-1);
  });

  it("keeps the original draft when walking several entries deep", () => {
    const one = recallSubmission(history, -1, "original")!;
    const two = recallSubmission(one.history, -1, "newest")!;
    const back = recallSubmission(recallSubmission(two.history, 1, "older")!.history, 1, "newest")!;
    expect(back.value).toBe("original");
  });

  it("answers nothing when there is no history", () => {
    expect(recallSubmission(EMPTY_COMPOSER_HISTORY, -1, "")).toBeNull();
  });
});

describe("composerKeyAction", () => {
  it("submits on Enter and breaks the line on Shift+Enter", () => {
    expect(composerKeyAction({ key: "Enter" }, at("ship it", 7))).toBe("submit");
    expect(composerKeyAction({ key: "Enter", shiftKey: true }, at("ship it", 7))).toBe("newline");
  });

  it("does not submit an empty message", () => {
    expect(composerKeyAction({ key: "Enter" }, at("   ", 3))).toBe("none");
  });

  it("only recalls history from the edges of the text", () => {
    expect(composerKeyAction({ key: "ArrowUp" }, at("line", 0))).toBe("recall-older");
    expect(composerKeyAction({ key: "ArrowUp" }, at("line", 2))).toBe("none");
    expect(composerKeyAction({ key: "ArrowDown" }, at("line", 4))).toBe("recall-newer");
    expect(composerKeyAction({ key: "ArrowDown" }, at("line", 1))).toBe("none");
  });

  it("leaves the arrows alone while text is selected", () => {
    expect(composerKeyAction({ key: "ArrowUp" }, { value: "line", selectionStart: 0, selectionEnd: 4 })).toBe("none");
  });

  it("hands focus back to the terminal on Escape", () => {
    expect(composerKeyAction({ key: "Escape" }, at("", 0))).toBe("blur-to-terminal");
  });
});

describe("withImagePaths", () => {
  it("quotes each staged path the way the terminal pane does", () => {
    // Pitwall stages images under Application Support, so a bare path breaks
    // at the space and the agent is handed two words that are not files.
    const staged = "/Users/a/Library/Application Support/Pitwall/terminal-attachments/s1/shot.png";
    expect(withImagePaths("", [staged])).toBe(`'${staged}' `);
    expect(withImagePaths("look at", [staged, "/tmp/b.png"])).toBe(`look at '${staged}' '/tmp/b.png' `);
    expect(withImagePaths("look at ", ["/tmp/b.png"])).toBe("look at '/tmp/b.png' ");
  });

  it("leaves the draft alone when nothing was staged", () => {
    expect(withImagePaths("draft", [])).toBe("draft");
  });
});
