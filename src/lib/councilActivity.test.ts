import { describe, expect, it } from "vitest";
import { currentStep, hasLiveWork, isTuiStatusLine, orderForDisplay, pushStep, stateLabel, type MemberWork } from "./councilActivity";

const member = (over: Partial<MemberWork> = {}): MemberWork => ({
  memberId: "m1", sessionId: "s1", roleLabel: "Architect", agentLabel: "Claude",
  state: "working", step: null, steps: [], forMs: 1000, isCurrent: false, ...over,
});

describe("currentStep", () => {
  it("takes the last line that says something", () => {
    expect(currentStep("● Read(src/app.ts)\n● Bash(npm test)")).toBe("● Bash(npm test)");
  });

  it("skips trailing blank lines, which every screen has", () => {
    expect(currentStep("● Working on it\n\n\n   \n")).toBe("● Working on it");
  });

  it("skips box drawing and rules rather than reporting them as progress", () => {
    expect(currentStep("● Running tests\n────────────────\n╰──────────╯")).toBe("● Running tests");
  });

  it("skips the input prompt, which is not the agent doing anything", () => {
    expect(currentStep("● Bash(npm test)\n> ")).toBe("● Bash(npm test)");
    expect(currentStep("● Bash(npm test)\n❯ npm run build")).toBe("● Bash(npm test)");
  });

  it("ignores a line too short to mean anything", () => {
    expect(currentStep("● Compiling\nok")).toBe("● Compiling");
  });

  it("truncates a long line rather than letting it break the layout", () => {
    const long = "● " + "x".repeat(200);
    const out = currentStep(long, 40)!;
    expect(out).toHaveLength(40);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns nothing rather than guessing when there is nothing to report", () => {
    expect(currentStep("")).toBeNull();
    expect(currentStep(null)).toBeNull();
    expect(currentStep("\n\n   \n────\n> ")).toBeNull();
  });
});

// Lines copied from a council thread that filled with the CLIs' own status.
const SCREENSHOT_STATUS = [
  "◦ Working (20s • esc to interrupt)",
  "• Working (1m 05s • esc to interrupt)",
  "* Baked for 1m 24s · done 12:12 AM",
  "Tip: Use /hooks to view and manage lifecycle hooks.",
  "  ⎿  Tip: Use /hooks to view and manage lifecycle hooks.",
];

describe("isTuiStatusLine", () => {
  it("recognises the status lines that reached the thread", () => {
    for (const line of SCREENSHOT_STATUS) expect(isTuiStatusLine(line), line).toBe(true);
  });

  it("recognises Claude's spinner, turn end and footer in their other shapes", () => {
    for (const line of [
      "✻ Thinking…",
      "✢ Sautéing… (12s · ↑ 1.2k tokens · esc to interrupt)",
      "· Brewing…",
      "✻ Crunched for 2m 5s",
      "✻ Worked for 3m",
      "▶▶ auto mode on (shift+tab to cycle) · esc to interrupt",
      "⏵⏵ accept edits on (shift+tab to cycle)",
      "? for shortcuts",
      "Context left until auto-compact: 8%",
      "ctrl+t to show todos",
      "thinking · ctrl+c to stop",
    ]) expect(isTuiStatusLine(line), line).toBe(true);
  });

  it("leaves the work itself alone", () => {
    for (const line of [
      "● Read(src/app.ts)",
      "● Bash(npm test)",
      "• Ran npm test",
      "• Explored",
      "  └ Read councilThread.ts",
      "LESSON: the relay reads the handoff file, not the pane.",
      "Implementer → Reviewer / QA Handed over directly",
      "Resolved questions",
      "Waiting for the build to finish before running the tests",
      "The tip of the branch is 3b136d4.",
    ]) expect(isTuiStatusLine(line), line).toBe(false);
  });
});

describe("currentStep, over a working pane", () => {
  it("reports the work above a Codex spinner, not the spinner", () => {
    const screen = ["• Ran npm test", "  └ 42 passed", "", "◦ Working (20s • esc to interrupt)", "", "› "].join("\n");
    expect(currentStep(screen)).toBe("└ 42 passed");
  });

  it("reports the work above Claude's spinner and its tip", () => {
    const screen = [
      "● Update(src/lib/councilActivity.ts)",
      "",
      "✻ Baking… (1m 24s · ↑ 3.1k tokens · esc to interrupt)",
      "  ⎿  Tip: Use /hooks to view and manage lifecycle hooks.",
      "",
      "❯ ",
    ].join("\n");
    expect(currentStep(screen)).toBe("● Update(src/lib/councilActivity.ts)");
  });

  it("does not report the line a finished turn ends on", () => {
    expect(currentStep("● Bash(npm test)\n* Baked for 1m 24s · done 12:12 AM\n> ")).toBe("● Bash(npm test)");
  });

  it("builds a trail of work, not of spinner frames", () => {
    let trail: string[] = [];
    for (const seconds of [20, 21, 22, 23, 24]) {
      trail = pushStep(trail, currentStep(`• Ran npm test\n◦ Working (${seconds}s • esc to interrupt)\n› `));
    }
    expect(trail).toEqual(["• Ran npm test"]);
  });

  it("returns nothing when all there is is status", () => {
    expect(currentStep(SCREENSHOT_STATUS.join("\n"))).toBeNull();
  });
});

describe("stateLabel", () => {
  it("says what a person would say", () => {
    expect(stateLabel("waiting")).toBe("Needs you");
    expect(stateLabel("working")).toBe("Working");
  });
});

describe("hasLiveWork", () => {
  it("is true while anything is working or waiting", () => {
    expect(hasLiveWork([member({ state: "working" })])).toBe(true);
    expect(hasLiveWork([member({ state: "waiting" })])).toBe(true);
  });

  it("is false once everything has stopped, so the panel gets out of the way", () => {
    expect(hasLiveWork([member({ state: "done" }), member({ state: "quiet" })])).toBe(false);
    expect(hasLiveWork([])).toBe(false);
  });
});

describe("orderForDisplay", () => {
  it("puts whoever's turn it is first", () => {
    const out = orderForDisplay([
      member({ memberId: "a", state: "working" }),
      member({ memberId: "b", state: "quiet", isCurrent: true }),
    ]);
    expect(out[0].memberId).toBe("b");
  });

  it("puts a member that needs answering above one that is working", () => {
    const out = orderForDisplay([
      member({ memberId: "a", state: "working" }),
      member({ memberId: "b", state: "waiting" }),
    ]);
    expect(out[0].memberId).toBe("b");
  });

  it("breaks a tie by how long it has been going", () => {
    const out = orderForDisplay([
      member({ memberId: "a", state: "working", forMs: 1000 }),
      member({ memberId: "b", state: "working", forMs: 90000 }),
    ]);
    expect(out[0].memberId).toBe("b");
  });

  it("does not mutate what it was given", () => {
    const input = [member({ memberId: "a" }), member({ memberId: "b", state: "waiting" })];
    orderForDisplay(input);
    expect(input.map((m) => m.memberId)).toEqual(["a", "b"]);
  });
});

describe("pushStep", () => {
  it("starts a trail from nothing", () => {
    expect(pushStep(undefined, "● Read(src/app.ts)")).toEqual(["● Read(src/app.ts)"]);
  });

  it("keeps a step that is genuinely new", () => {
    expect(pushStep(["● Read(a.ts)"], "● Bash(npm test)")).toEqual(["● Read(a.ts)", "● Bash(npm test)"]);
  });

  // Two identical pushes must be one entry: React invokes the render that
  // builds this twice under StrictMode, and the screen redraws far more often
  // than the agent prints a new line.
  it("does not repeat the step already at the end", () => {
    expect(pushStep(["● Read(a.ts)"], "● Read(a.ts)")).toEqual(["● Read(a.ts)"]);
  });

  it("leaves the trail alone when there is nothing to add", () => {
    expect(pushStep(["● Read(a.ts)"], null)).toEqual(["● Read(a.ts)"]);
  });

  it("keeps only the most recent steps", () => {
    expect(pushStep(["a1", "b2", "c3", "d4"], "e5", 4)).toEqual(["b2", "c3", "d4", "e5"]);
  });

  it("does not mutate the trail it was given", () => {
    const trail = ["● Read(a.ts)"];
    pushStep(trail, "● Bash(npm test)");
    expect(trail).toEqual(["● Read(a.ts)"]);
  });

  // A step that comes back after something else is news again, not a duplicate.
  it("allows a step to reappear later", () => {
    expect(pushStep(["● Read(a.ts)", "● Bash(npm test)"], "● Read(a.ts)")).toEqual([
      "● Read(a.ts)", "● Bash(npm test)", "● Read(a.ts)",
    ]);
  });
});

describe("Pitwall's own banners", () => {
  // The council writes a turn marker into each member's pane. The
  // all-separators rule missed it, because a rule with a label inside it is
  // not all separators — so the thread reported Pitwall's own banner back as
  // the thing the agent was doing.
  it("does not report a turn banner as a step", () => {
    const screen = [
      "● Reading the promo-winnings hook.",
      "———————————————— Architect · Claude 1 —",
      "> ",
    ].join("\n");
    expect(currentStep(screen)).toBe("● Reading the promo-winnings hook.");
  });

  it("ignores the banner whichever member it names", () => {
    for (const who of ["Architect · Claude 1", "Reviewer / QA · Claude 2", "Implementer · Codex"]) {
      const screen = ["● Working on it.", `———————————————— ${who} —`, "> "].join("\n");
      expect(currentStep(screen)).toBe("● Working on it.");
    }
  });

  // Eight in a row is the test, not the wording — so a divider drawn by a CLI
  // nobody here has looked at is caught too.
  it("ignores any long rule, whatever is written in it", () => {
    expect(currentStep(["● Real work.", "==================== build ====", "> "].join("\n"))).toBe("● Real work.");
    expect(currentStep(["● Real work.", "──────── tests ────────", "> "].join("\n"))).toBe("● Real work.");
  });

  // A sentence with a dash in it is a sentence.
  it("keeps a line that merely contains dashes", () => {
    const screen = ["● Ran npm run build -- --watch", "> "].join("\n");
    expect(currentStep(screen)).toBe("● Ran npm run build -- --watch");
  });
});
