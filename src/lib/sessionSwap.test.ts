import { describe, expect, it } from "vitest";
import { handoffPrompt, swapRefusal, swappedSessionName } from "./sessionSwap";

describe("session swap", () => {
  it("refuses a Council member, no agent, and the agent already driving", () => {
    const base = { fromAgent: "Codex", fromModel: "gpt-5", toAgent: "Claude", toModel: "Opus", inCouncil: false };
    expect(swapRefusal(base)).toBeNull();
    expect(swapRefusal({ ...base, inCouncil: true })).toMatch(/Council/);
    expect(swapRefusal({ ...base, toAgent: "" })).toMatch(/Pick an agent/);
    expect(swapRefusal({ ...base, toAgent: "Codex", toModel: "gpt-5" })).toMatch(/already/);
    expect(swapRefusal({ ...base, toAgent: "Codex", toModel: "gpt-5-mini" })).toBeNull();
  });

  it("changes the agent in a name that carries one, and leaves others alone", () => {
    expect(swappedSessionName("New session · Codex", "Codex", "Claude")).toBe("New session · Claude");
    expect(swappedSessionName("Fix picker · Implementer · Codex", "Codex", "Claude")).toBe("Fix picker · Implementer · Claude");
    expect(swappedSessionName("Fix the Codex config", "Codex", "Claude")).toBe("Fix the Codex config");
  });

  it("points the new agent at the handoff and tells it to wait", () => {
    expect(handoffPrompt("Codex", ".pitwall/handoff-1.md")).toMatch(/Read \.pitwall\/handoff-1\.md.*wait for my next instruction/);
    expect(handoffPrompt("Codex", null)).toMatch(/git status/);
  });
});
