import { describe, expect, it } from "vitest";
import { providerRegistry } from "./providers";

describe("provider install commands", () => {
  it("shows Hermes' install for the other platform too", () => {
    const hermes = providerRegistry.find((provider) => provider.id === "hermes")!;
    expect(hermes.installCommand).toContain("install.sh");
    expect(hermes.installElsewhere).toEqual({ label: "Windows", installCommand: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)" });
  });
});
