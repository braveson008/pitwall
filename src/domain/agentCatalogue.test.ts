import { describe, expect, it } from "vitest";
import { agentCatalogue, catalogueFor, installFor } from "./agentCatalogue";
import { providerRegistry } from "./providers";

/**
 * These guard the catalogue's own rule: an entry is a claim about somebody
 * else's software, and a wrong one sends a user to install the wrong package.
 * Registry checks happen when an entry is added; these are the invariants that
 * cannot be checked by hand once the list is long.
 */
describe("agentCatalogue", () => {
  it("has no duplicate ids or binaries", () => {
    // Two entries claiming one binary means the grid shows one as installed
    // because the other is.
    const ids = agentCatalogue.map((entry) => entry.id);
    const commands = agentCatalogue.map((entry) => entry.command);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("gives every entry the fields the grid renders", () => {
    for (const entry of agentCatalogue) {
      expect(entry.name, entry.id).toBeTruthy();
      expect(entry.summary.length, entry.id).toBeGreaterThan(15);
      expect(entry.command, entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.docs, entry.id).toMatch(/^https:\/\//);
      expect(entry.models.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("installs the binary it then looks for", () => {
    // `@cline/cli` installs `clite`, so the catalogue installed it and then
    // reported it as missing forever. The package name and the binary do not
    // have to match, but a mismatch has to be deliberate rather than assumed.
    const known: Record<string, string> = {
      "cursor-cli": "brew install --cask cursor-cli",
      droid: "brew install --cask droid",
      "kiro-cli": "brew install --cask kiro-cli",
      amp: "npm install -g @sourcegraph/amp",
      cline: "npm install -g cline",
      continue: "npm install -g @continuedev/cli",
      goose: "brew install block-goose-cli",
      aider: "uv tool install aider-chat",
      "qwen-code": "npm install -g @qwen-code/qwen-code",
    };
    for (const [id, installCommand] of Object.entries(known)) {
      const entry = agentCatalogue.find((item) => item.id === id);
      expect(entry?.installCommand, id).toBe(installCommand);
    }
  });

  it("names no install command it cannot actually run", () => {
    for (const entry of agentCatalogue) {
      if (!entry.installCommand) continue;
      expect(entry.installCommand, entry.id).toMatch(/^(npm install -g |brew install |uv tool install )/);
      // A shell pipe is the shape the file refuses: it is not an install
      // Pitwall can run or a user can read before agreeing to it.
      expect(entry.installCommand, entry.id).not.toMatch(/[|;&]|curl|wget/);
    }
  });

  it("keeps out the packages the last sweep rejected", () => {
    // Placeholders, squatted names and a project with no declared repository.
    // Named here so re-adding one has to be a deliberate act.
    const rejected = ["coderabbit", "plandex", "@vibe-kit/grok-cli", "kimi-cli", "@cline/cli"];
    const installs = agentCatalogue.map((entry) => entry.installCommand ?? "").join(" ");
    for (const name of rejected) {
      expect(installs, name).not.toContain(`-g ${name}`);
    }
  });

  it("does not list an agent Pitwall already drives first-class", () => {
    // The catalogue answers "this exists, here is how to install it". A
    // first-class provider is a stronger claim made elsewhere, and listing it
    // in both places gives the same agent two entries in the grid.
    const firstClass = new Set(providerRegistry.map((provider) => provider.command));
    for (const entry of agentCatalogue) {
      expect(firstClass.has(entry.command), entry.id).toBe(false);
    }
  });

  it("separates the runtimes from the agents", () => {
    // Ollama does not review a diff; it answers the CLI that does.
    expect(catalogueFor("runtime").map((entry) => entry.id)).toContain("ollama");
    expect(catalogueFor("agent").map((entry) => entry.id)).not.toContain("ollama");
    expect(catalogueFor("agent").length).toBeGreaterThan(10);
  });

  it("states a licence only where the project publishes one plainly", () => {
    // "SEE LICENSE IN LICENSE.md" is not a licence, and this is the field
    // people filter on when they have a policy — a wrong value beats a blank.
    for (const entry of agentCatalogue) {
      if (!entry.licence) continue;
      expect(entry.licence, entry.id).toMatch(/^(MIT|Apache-2\.0|FSL|BSD-3-Clause|GPL-3\.0|MPL-2\.0)$/);
    }
  });
});

describe("installing on each platform", () => {
  it("offers Windows a way in for everything Homebrew-only on the Mac", () => {
    for (const entry of agentCatalogue) {
      if (!entry.installCommand?.startsWith("brew ")) continue;
      const windows = installFor(entry, "win32");
      expect(windows.installCommand?.startsWith("brew ") ?? false, entry.id).toBe(false);
      expect(windows.docs, entry.id).toMatch(/^https:\/\//);
    }
  });

  it("gives Ollama its Windows installer and docs", () => {
    const ollama = agentCatalogue.find((entry) => entry.id === "ollama")!;
    expect(installFor(ollama, "win32")).toMatchObject({ installCommand: "winget install --id Ollama.Ollama -e", docs: "https://docs.ollama.com/windows" });
    expect(installFor(ollama, "darwin")).toMatchObject({ installCommand: "brew install ollama", docs: "https://docs.ollama.com/macos" });
  });

  it("shows the other platform's way too", () => {
    const ollama = agentCatalogue.find((entry) => entry.id === "ollama")!;
    expect(installFor(ollama, "win32").elsewhere).toEqual({ label: "Mac", installCommand: "brew install ollama" });
    expect(installFor(ollama, "darwin").elsewhere).toEqual({ label: "Windows", installCommand: "winget install --id Ollama.Ollama -e" });
    const npmOnly = agentCatalogue.find((entry) => entry.id === "opencode")!;
    expect(installFor(npmOnly, "win32").elsewhere).toBeUndefined();
  });
});
