import { describe, expect, it } from "vitest";
import { menuChoiceKey, readTerminalBusy, readTerminalMenu, stripAnsi } from "./terminalMenu";

const ESC = "\u001b";

// Reproduced from a real pane: the question, the numbered options with their
// descriptions indented under them, and the footer the CLI always prints.
const LIVE_MENU = [
  "I'm on branch web-815 with uncommitted integration work.",
  "",
  "What should I work on this session?",
  "",
  "❯ 1. Fix the checkbox old-DS defect",
  "     Rework SurveyCheckboxMultiple to match the new DS.",
  "  2. Verify/finish the integration work",
  "     Review the uncommitted survey-engine integration end to end.",
  "  3. Interstitial illustrations",
  "     Populate the empty interstitial illustration registry.",
  "  4. Something else",
  "  5. Type something.",
  "  6. Chat about this",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

describe("readTerminalMenu", () => {
  it("reads the choice a pane is waiting on", () => {
    const menu = readTerminalMenu(LIVE_MENU);
    expect(menu?.prompt).toBe("What should I work on this session?");
    expect(menu?.options.map((option) => option.label)).toEqual([
      "Fix the checkbox old-DS defect",
      "Verify/finish the integration work",
      "Interstitial illustrations",
      "Something else",
      "Type something.",
      "Chat about this",
    ]);
  });

  it("knows which option the highlight is on", () => {
    const menu = readTerminalMenu(LIVE_MENU);
    expect(menu?.options.filter((option) => option.selected).map((option) => option.index)).toEqual([1]);
  });

  it("sees through the colours the CLI paints it in", () => {
    const painted = LIVE_MENU.replace("❯ 1.", `${ESC}[36m❯ 1.`).replace("Enter to select", `${ESC}[2mEnter to select`);
    expect(readTerminalMenu(painted)?.options).toHaveLength(6);
  });

  it("reads the trust prompt, which uses the other footer", () => {
    const trust = ["Is this a project you trust?", "", "❯ 1. Yes, I trust this folder", "  2. No, exit", "", "Enter to confirm · Esc to cancel"].join("\n");
    expect(readTerminalMenu(trust)?.options.map((option) => option.label)).toEqual([
      "Yes, I trust this folder",
      "No, exit",
    ]);
  });

  it("says nothing when the menu has been answered and the pane moved on", () => {
    // Output after the footer means the choice was made; the agent is working
    // again, not waiting. Offering the options then would be offering to answer
    // a question that is already closed.
    expect(readTerminalMenu(`${LIVE_MENU}\n\n● Working on the checkbox defect now.`)).toBeNull();
  });

  it("says nothing for ordinary output", () => {
    expect(readTerminalMenu("● Ran 2 shell commands\n● All tests pass.")).toBeNull();
    expect(readTerminalMenu("")).toBeNull();
  });

  it("is not fooled by a numbered list in prose", () => {
    // A single "1." in a sentence is not a menu, and neither is a list with no
    // footer under it.
    expect(readTerminalMenu("Here is 1. one idea and that is all.")).toBeNull();
    expect(readTerminalMenu("1. first\n2. second\n3. third")).toBeNull();
  });

  it("only considers the most recent screenful", () => {
    const old = `${LIVE_MENU}\n${"filler output\n".repeat(600)}`;
    expect(readTerminalMenu(old)).toBeNull();
  });
});

describe("menuChoiceKey", () => {
  it("answers with the number drawn on screen", () => {
    expect(menuChoiceKey(1)).toBe("1");
    expect(menuChoiceKey(6)).toBe("6");
  });

  it("refuses an index it cannot send as one keystroke", () => {
    // Arrow keys were the alternative and they are worse: they must be sent
    // before anything can be verified, so a failed check leaves the highlight
    // moved and the next confirm takes whatever it drifted onto.
    expect(menuChoiceKey(0)).toBe("");
    expect(menuChoiceKey(10)).toBe("");
    expect(menuChoiceKey(-1)).toBe("");
  });
});

describe("stripAnsi", () => {
  it("removes colour, cursor moves and window titles", () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe("red");
    expect(stripAnsi(`${ESC}]0;a titletext`)).toBe("text");
    expect(stripAnsi(`${ESC}[2Kline`)).toBe("line");
  });
});

describe("readTerminalBusy", () => {
  it("is working while the CLI offers to interrupt", () => {
    expect(readTerminalBusy("▶▶ auto mode on (shift+tab to cycle) · esc to interrupt")).toBe(true);
  });

  it("is idle when the offer is gone", () => {
    // The exact footer from a session that had finished while chat still said
    // "Thinking": a turn that is abandoned never writes a stop_reason, so
    // anything waiting for one waits forever.
    expect(readTerminalBusy("▶▶ auto mode on · 1 shell · ← for agents · ↓ to manage")).toBe(false);
  });

  it("sees through the colours the footer is painted in", () => {
    expect(readTerminalBusy(`\u001b[2m auto mode on · esc to interrupt\u001b[0m`)).toBe(true);
  });

  it("says nothing about a screen it cannot read", () => {
    // No terminal mounted yet: the caller should fall back to the records
    // rather than be told the agent is idle.
    expect(readTerminalBusy("")).toBeNull();
    expect(readTerminalBusy("   \n  ")).toBeNull();
  });
});

describe("menus from every CLI, not only the ones we have seen", () => {
  // The footers were exact strings copied from Claude, so no Codex menu was
  // ever recognised — the rail could not say a Codex session was waiting, and
  // the thread could not offer the choice. Matching phrases only ever works for
  // the CLIs somebody has already looked at, so this matches the shape instead.
  it("reads a real Codex menu, whose footer is worded nothing like Claude's", () => {
    const menu = readTerminalMenu(
      [
        "  Select a review preset",
        "",
        "> 1. Review against a base branch  (PR Style)",
        "  2. Review uncommitted changes",
        "  3. Review a commit",
        "",
        "  Press enter to confirm or esc to go back",
      ].join("\n"),
    );
    expect(menu?.prompt).toBe("Select a review preset");
    expect(menu?.options).toHaveLength(3);
    expect(menu?.options[0]).toMatchObject({ index: 1, selected: true });
  });

  // None of these are drawn by any CLI Pitwall currently runs. That is the
  // point: the next agent should work without anyone editing this file.
  it("reads a menu numbered with parentheses", () => {
    const menu = readTerminalMenu(["Pick a branch", "❯ 1) main", "  2) develop", "", "[↑/↓ to move, Enter to accept]"].join("\n"));
    expect(menu?.options.map((option) => option.label)).toEqual(["main", "develop"]);
  });

  it("reads a menu numbered with colons, hinted with a different key", () => {
    const menu = readTerminalMenu(["Choose an option", "› 1: Continue", "  2: Abort", "", "Tab cycles · Return confirms"].join("\n"));
    expect(menu?.options).toHaveLength(2);
  });

  it("does not care how the hint is capitalised", () => {
    expect(readTerminalMenu(["Pick one", "1. A", "2. B", "", "ENTER TO SELECT"].join("\n"))?.options).toHaveLength(2);
  });

  // A menu is answered by sending the digit beside the choice, so one without
  // numbers would put buttons on screen that send a keystroke the CLI ignores.
  // Left to the terminal, where the arrow keys work.
  it("leaves an unnumbered arrow-key menu alone rather than offering a dead button", () => {
    expect(readTerminalMenu(["Which model?", "❯ gpt-5", "  claude-opus", "", "arrow keys, enter to choose"].join("\n"))).toBeNull();
  });

  // The hint is the liveness signal, not the phrasing. Without one there is
  // nothing separating a menu from a numbered list somebody wrote out.
  it("rejects a numbered list with no key hint under it", () => {
    expect(readTerminalMenu("Steps:\n1. Install\n2. Configure")).toBeNull();
  });

  it("rejects a list followed by ordinary prose", () => {
    expect(
      readTerminalMenu(
        ["Steps:", "1. Install", "2. Configure", "", "Then run the build and check the output before shipping."].join("\n"),
      ),
    ).toBeNull();
  });

  it("rejects a menu the screen has already moved past", () => {
    expect(
      readTerminalMenu(["Pick one", "1. A", "2. B", "", "Enter to select", "", "Running tests now…", "All 42 passed."].join("\n")),
    ).toBeNull();
  });
});

describe("readTerminalBusy across agents", () => {
  // A CLI at an idle prompt redraws its own status bar continuously, so
  // "is it printing" says working forever. "Is there something to interrupt"
  // is the question that actually has an answer.
  it("is busy while the CLI offers a way to interrupt", () => {
    expect(readTerminalBusy("✻ Sautéing… (esc to interrupt)")).toBe(true);
    expect(readTerminalBusy("Working… Esc to interrupt")).toBe(true);
    expect(readTerminalBusy("thinking · ctrl+c to stop")).toBe(true);
  });

  it("is not busy at an idle prompt, however much the footer redraws", () => {
    expect(readTerminalBusy("› \n▶▶ auto mode on (shift+tab to cycle) · PR #5217 · ← for agents")).toBe(false);
  });

  // "Esc to cancel" belongs under menus, and a menu means the agent is waiting
  // on you — the opposite of busy.
  it("does not read a menu's cancel hint as work", () => {
    expect(readTerminalBusy("1. Yes\n2. No\nEnter to select · Esc to cancel")).toBe(false);
  });

  it("says nothing about a screen it has not seen", () => {
    expect(readTerminalBusy("   ")).toBeNull();
  });
});
