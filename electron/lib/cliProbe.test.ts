import { describe, expect, it } from "vitest";
import probe from "./cliProbe.cjs";

const { classifyProbe, describeProbe } = probe;

describe("CLI launch probe", () => {
  it("sees a CLI that reached its input box as ready", () => {
    expect(classifyProbe({ agent: "codex", output: "\u001b[1m›\u001b[0m Ask Codex to do anything\r\n  ? for shortcuts" }).status).toBe("ready");
    expect(classifyProbe({ agent: "claude", output: "❯ \r\n  ⏵⏵ auto mode on (shift+tab to cycle)" }).status).toBe("ready");
  });

  it("reads past Hermes's banner and tips, which mention keys and sign-in", () => {
    const banner = "│  1password: sign in to your vault   │\r\n✦ Tip: add an API key with hermes auth add\r\nWelcome to Hermes Agent! Type your message or /help for commands.\r\n❯ ";
    expect(classifyProbe({ agent: "hermes", output: banner }).status).toBe("ready");
    expect(classifyProbe({ agent: "hermes", output: "Please log in to Nous Portal to continue" }).status).toBe("blocked");
  });

  it("sees a screen in front of the input box as blocking, and says which", () => {
    const trust = classifyProbe({ agent: "claude", output: "Quick safety check\nDo you trust this folder?\n❯ 1. Yes, I trust this folder\n? for shortcuts" });
    expect(trust).toMatchObject({ status: "blocked", kind: "trust" });
    expect(classifyProbe({ agent: "codex", output: "Update available! 0.160 -> 0.161\n1. Update now" })).toMatchObject({ status: "blocked", kind: "update" });
  });

  it("sees a rejected flag, or an early exit, as broken", () => {
    const rejected = classifyProbe({ agent: "claude", output: "error: unknown option '--settings'\n", exited: true, exitCode: 1 });
    expect(rejected).toMatchObject({ status: "broken", detail: "error: unknown option '--settings'" });
    expect(classifyProbe({ agent: "codex", output: "", exited: true, exitCode: 2 }).status).toBe("broken");
  });

  it("does not claim more than it saw", () => {
    expect(classifyProbe({ agent: "claude", output: "starting…" }).status).toBe("unknown");
  });

  it("says what happened in a sentence", () => {
    expect(describeProbe({ label: "Codex", from: "0.160.1", to: "0.161.0", result: { status: "ready", detail: "" } }).message)
      .toBe("Codex updated from 0.160.1 to 0.161.0. Pitwall started it with its usual settings and it is ready to use.");
    expect(describeProbe({ label: "Codex", from: "0.160.1", to: "0.161.0", result: { status: "broken", detail: "error: unknown option '-c'" } }).tone).toBe("error");
  });
});
