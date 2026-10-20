import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVE,
  autoApproveFor,
  splitByAutoApprove,
  supportsAutoApprove,
  withAutoApprove,
} from "./autoApprove";

describe("autoApproveFor", () => {
  it("knows the flag each CLI documents", () => {
    expect(autoApproveFor("claude")?.args).toEqual(["--dangerously-skip-permissions"]);
    // Not `--permission-mode auto`: its classifier denies rather than asks, so
    // a member is blocked and looks stalled. Not `dontAsk` either — that one
    // denies anything not pre-approved.
    expect(autoApproveFor("claude")?.args).not.toContain("auto");
    expect(autoApproveFor("claude")?.args).not.toContain("dontAsk");
    expect(autoApproveFor("codex")?.args).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(autoApproveFor("gemini")?.args).toEqual(["--yolo"]);
    expect(autoApproveFor("qwen")?.args).toEqual(["--yolo"]);
  });

  it("returns nothing for an agent whose flag was never verified", () => {
    // The important half. Guessing a flag on a CLI that ignores unknown
    // arguments starts a session, tells the user it runs unattended, and then
    // stops at the first prompt anyway.
    expect(autoApproveFor("aider")).toBeNull();
    expect(autoApproveFor("opencode")).toBeNull();
    expect(supportsAutoApprove("some-agent-added-yesterday")).toBe(false);
    expect(supportsAutoApprove(undefined)).toBe(false);
    expect(supportsAutoApprove("")).toBe(false);
  });

  it("says where every flag came from, so it can be re-checked", () => {
    // These are other people's command-line interfaces and they change.
    for (const mode of AUTO_APPROVE) {
      expect(mode.verifiedFrom, mode.command).toBeTruthy();
      expect(mode.args.length, mode.command).toBeGreaterThan(0);
      expect(mode.label.length, mode.command).toBeGreaterThan(10);
    }
  });

  it("has one entry per command", () => {
    const commands = AUTO_APPROVE.map((mode) => mode.command);
    expect(new Set(commands).size).toBe(commands.length);
  });
});

describe("withAutoApprove", () => {
  it("appends the flag, keeping the arguments already there", () => {
    expect(withAutoApprove("claude", ["--model", "opus"], true)).toEqual([
      "--model",
      "opus",
      "--dangerously-skip-permissions",
    ]);
  });

  it("changes nothing when the mode is off", () => {
    expect(withAutoApprove("claude", ["--model", "opus"], false)).toEqual(["--model", "opus"]);
  });

  it("changes nothing for an agent with no verified flag", () => {
    // Applied unconditionally by callers, so this is the common path for any
    // agent added through Add agent.
    expect(withAutoApprove("aider", ["--no-auto-commits"], true)).toEqual(["--no-auto-commits"]);
  });

  it("does not lose the flag's value to a token that appears elsewhere", () => {
    // `--permission-mode auto` against `--model auto` deduped the shared
    // "auto" and emitted `--permission-mode` with nothing after it. "Auto" is
    // the default model in the picker, so this was the ordinary case, and the
    // CLI would have failed on a malformed argument list.
    expect(withAutoApprove("gemini", ["--model", "yolo"], true)).toEqual([
      "--model",
      "yolo",
      "--yolo",
    ]);
  });

  it("does not add the flag twice", () => {
    // A repeated flag is an error on some CLIs and confusing on all of them.
    const once = withAutoApprove("codex", [], true);
    expect(withAutoApprove("codex", once, true)).toEqual(once);
  });

  it("copes with no arguments at all", () => {
    expect(withAutoApprove("qwen", undefined, true)).toEqual(["--yolo"]);
    expect(withAutoApprove("qwen", undefined, false)).toEqual([]);
  });
});

describe("splitByAutoApprove", () => {
  it("separates the roster into what will and will not run unattended", () => {
    // Shown before starting: auto-approve that silently covers three of four
    // members is worse than none, because you leave it running and come back
    // to one that stopped on turn two.
    expect(splitByAutoApprove(["claude", "aider", "codex"])).toEqual({
      covered: ["claude", "codex"],
      uncovered: ["aider"],
    });
  });

  it("lists a repeated agent once", () => {
    expect(splitByAutoApprove(["claude", "claude"]).covered).toEqual(["claude"]);
  });

  it("is empty for an empty roster", () => {
    expect(splitByAutoApprove([])).toEqual({ covered: [], uncovered: [] });
  });
});
