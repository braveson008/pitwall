import { describe, expect, it } from "vitest";
import { claudeModelIdFromLabel } from "./modelLabels";

describe("claudeModelIdFromLabel", () => {
  it("turns a shown name back into the id the CLI takes", () => {
    expect(claudeModelIdFromLabel("Opus 5.5")).toBe("claude-opus-5-5");
    expect(claudeModelIdFromLabel("Sonnet 5.5 · 1M context")).toBe("claude-sonnet-5-5[1m]");
    expect(claudeModelIdFromLabel("Fable 5.1")).toBe("claude-fable-5-1");
  });

  it("leaves anything else alone", () => {
    expect(claudeModelIdFromLabel("Opus")).toBeNull();
    expect(claudeModelIdFromLabel("gpt-5.5")).toBeNull();
    expect(claudeModelIdFromLabel("Auto")).toBeNull();
  });
});
