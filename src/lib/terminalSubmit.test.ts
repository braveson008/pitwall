import { describe, expect, it, vi } from "vitest";
import { settleMs, splitForPty, submitTerminalPrompt, type TerminalWrite } from "./terminalSubmit";

describe("submitTerminalPrompt", () => {
  it("submits Enter in a separate PTY write after the prompt", async () => {
    const write = vi.fn(async () => undefined);

    await submitTerminalPrompt(write, "implementer", "  a long pasted handoff  ", 0);

    expect(write.mock.calls).toEqual([
      [{ sessionId: "implementer", data: "a long pasted handoff" }],
      [{ sessionId: "implementer", data: "\r" }],
    ]);
  });

  it("does not submit an empty prompt", async () => {
    const write = vi.fn(async () => undefined);
    expect(await submitTerminalPrompt(write, "architect", "   ", 0)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("reports a prompt that reached the terminal", async () => {
    const write = vi.fn(async () => ({ ok: true }));
    expect(await submitTerminalPrompt(write, "qa", "check the rejoin path", 0)).toBe(true);
  });

  it("reports a prompt written into a session with no terminal behind it", async () => {
    // Nothing is listening, so the caller must not go on to wait for a reply.
    const write = vi.fn(async () => ({ ok: false, error: "Terminal is not running" }));
    expect(await submitTerminalPrompt(write, "qa", "check the rejoin path", 0)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });

it("writes a long prompt in bounded pieces so the composer can keep up", async () => {
    const write = vi.fn<TerminalWrite>(async () => ({ ok: true }));
    const prompt = "x".repeat(5000);

    await submitTerminalPrompt(write, "architect", prompt, 0);

    const payloads = write.mock.calls.map((call) => call[0].data);
    expect(payloads.at(-1)).toBe("\r");
    const body = payloads.slice(0, -1);
    expect(body.length).toBeGreaterThan(1);
    expect(Math.max(...body.map((piece) => piece.length))).toBeLessThanOrEqual(1024);
    // Every byte still arrives, in order.
    expect(body.join("")).toBe(prompt);
  });

  it("keeps a short prompt a single write", async () => {
    const write = vi.fn<TerminalWrite>(async () => ({ ok: true }));
    await submitTerminalPrompt(write, "qa", "short one", 0);
    expect(write.mock.calls.map((call) => call[0].data)).toEqual(["short one", "\r"]);
  });

  it("stops writing as soon as a piece fails to land", async () => {
    const write = vi
      .fn<TerminalWrite>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Terminal is not running" });
    expect(await submitTerminalPrompt(write, "qa", "y".repeat(5000), 0)).toBe(false);
    // Two attempts, then it gives up rather than typing into a dead pane.
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("waits longer before Enter the more there is to absorb", () => {
    // A fixed gap is a race: Enter landing mid-paste submits a fragment and
    // leaves the rest in the composer, which is how a message arrives with its
    // beginning missing.
    expect(settleMs(20, 120)).toBe(120);
    expect(settleMs(40_000, 120)).toBeGreaterThan(120);
    expect(settleMs(40_000, 120)).toBeLessThanOrEqual(2000);
    expect(settleMs(400_000, 120)).toBeLessThanOrEqual(2000);
    expect(settleMs(40_000, 0)).toBe(0);
  });

  it("splits on the byte boundary, never mid-character", () => {
    const emoji = "🙂".repeat(600);
    const pieces = splitForPty(emoji, 1024);
    expect(pieces.join("")).toBe(emoji);
    expect(pieces.every((piece) => !/[\uD800-\uDBFF]$/.test(piece))).toBe(true);
  });

    it("reports failure when the terminal dies between the prompt and Enter", async () => {
    // The prompt is sitting in the composer unsubmitted — an agent that never
    // starts looks exactly like one still thinking.
    const write = vi
      .fn<TerminalWrite>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "Terminal is not running" });
    expect(await submitTerminalPrompt(write, "qa", "check the rejoin path", 0)).toBe(false);
  });
});
