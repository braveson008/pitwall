import { describe, expect, it } from "vitest";
import screen from "./hermesScreen.cjs";

const { readHermesScreen, describeHermesScreen, lastHermesReply } = screen;

describe("Hermes screen", () => {
  it("reads the optional-feature question Hermes asks before its prompt", () => {
    const text = "\nThis needs Hermes' optional 'fal' feature, which isn't installed yet.\nInstall it now? [Y/n] ";
    expect(readHermesScreen(text)).toEqual({ kind: "optional-feature", feature: "fal" });
  });

  it("tells an empty balance from a retired model, though both arrive as a 404", () => {
    expect(readHermesScreen("Billing or credits exhausted: HTTP 404: Model 'deepseek/deepseek-v4.1-flash:US' requires available credits.")).toEqual({ kind: "no-credits" });
    expect(readHermesScreen("Model 'stealth/space-bunny-alpha' isn't available on Nous Portal. Pick a different model")).toEqual({ kind: "model-missing", model: "stealth/space-bunny-alpha" });
  });

  it("reads an install Hermes cannot start from", () => {
    const text = "hermes: no dependency environment is committed for this install; run `hermes pm repair`\r\n[process exited 1]";
    expect(readHermesScreen(text)).toEqual({ kind: "broken-install" });
    expect(describeHermesScreen({ kind: "broken-install" })?.message).toMatch(/hermes pm repair/);
  });

  it("reads a Hermes that has lost its login, and offers to sign it in", () => {
    const text = "No access token found for Nous Portal login. Run `hermes -p pitwall-1b32c28cb38c model` to re-authenticate.";
    expect(readHermesScreen(text)).toEqual({ kind: "signed-out", command: "hermes -p pitwall-1b32c28cb38c model" });
    // One sign-in reconnects every project, so the notice offers it rather than a command.
    expect(describeHermesScreen(readHermesScreen(text))).toMatchObject({ tone: "error", action: "hermes-sign-in" });
    expect(readHermesScreen("Nous refresh token is terminally invalid")).toEqual({ kind: "signed-out", command: "hermes model" });
  });

  it("says nothing about an ordinary screen", () => {
    expect(readHermesScreen("Welcome to Hermes Agent! Type your message or /help for commands.")).toBeNull();
    expect(describeHermesScreen(null)).toBeNull();
  });

  it("asks for a decision when the model cannot answer", () => {
    expect(describeHermesScreen({ kind: "no-credits" })?.tone).toBe("error");
    expect(describeHermesScreen({ kind: "model-missing", model: "x/y" })?.message).toMatch(/hermes model/);
  });
});

describe("lastHermesReply", () => {
  it("is the session's last assistant message with text, whole", () => {
    const session = { id: "20261006_234324_d96cdc", messages: [
      { role: "user", content: "review this" },
      { role: "assistant", content: "Reading the change." },
      { role: "tool", content: "file contents" },
      { role: "assistant", content: null },
      { role: "assistant", content: '{"verdict": "approve", "summary": "A long summary that a terminal would have wrapped across several lines.", "comments": []}' },
    ] };
    expect(JSON.parse(lastHermesReply(`${JSON.stringify(session)}\n`)).verdict).toBe("approve");
  });

  it("is nothing, not Hermes's own notice, when the turn failed", () => {
    const session = { messages: [
      { role: "assistant", content: "An earlier answer." },
      { role: "user", content: "review this" },
      { role: "assistant", content: "Your request was not processed. Send it again if you still want me to carry it out." },
    ] };
    expect(lastHermesReply(JSON.stringify(session))).toBe("");
  });

  it("is empty when there is nothing readable", () => {
    expect(lastHermesReply("")).toBe("");
    expect(lastHermesReply("not json")).toBe("");
  });
});
