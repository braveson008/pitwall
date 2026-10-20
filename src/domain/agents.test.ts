import { describe, expect, it } from "vitest";
import { resolveAgentLaunch, type AgentOption } from "./agents";
import { providerIdFromAgent } from "./providers";

const custom = (over: Partial<AgentOption> = {}): AgentOption => ({
  agent: "Aider",
  command: "aider",
  loginCommand: "",
  models: [{ label: "gpt-4o", value: "gpt-4o" }],
  custom: true,
  args: "--no-auto-commits",
  ...over,
});

describe("resolveAgentLaunch", () => {
  it("returns {} for built-in agents (Electron uses its own profile)", () => {
    expect(resolveAgentLaunch({ agent: "Claude", command: "claude", loginCommand: "", models: [] }, "opus")).toEqual({});
  });

  it("builds command + args for a custom agent", () => {
    expect(resolveAgentLaunch(custom(), "gpt-4o")).toEqual({
      command: "aider",
      args: ["--no-auto-commits", "--model", "gpt-4o"],
    });
  });

  it("omits the model flag when there are no models or the value is 'default'", () => {
    expect(resolveAgentLaunch(custom({ models: [], args: "" }), "default")).toEqual({ command: "aider", args: [] });
  });

  it("uses the model value, not the label", () => {
    const opt = custom({ models: [{ label: "Fast", value: "gpt-4o-mini" }], args: "" });
    expect(resolveAgentLaunch(opt, "Fast")).toEqual({ command: "aider", args: ["--model", "gpt-4o-mini"] });
  });
});

describe("provider attribution", () => {
  it("keeps built-in ids and derives stable ids for custom agents", () => {
    expect(providerIdFromAgent("Claude")).toBe("claude");
    expect(providerIdFromAgent("Smoke Shell")).toBe("smoke-shell");
  });
});
