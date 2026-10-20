/**
 * Agent CLIs and model runtimes Pitwall knows how to install.
 *
 * Separate from `providerRegistry`, and deliberately so. That list is the
 * agents Pitwall ships first-class support for: its `agent` field is a closed
 * union wired into the session launcher, so adding a name to it is a claim
 * that Pitwall can start and drive that CLI. This is a different claim —
 * "this exists, here is how to install it, here is where its documentation
 * is" — and once installed you point Pitwall at it through Add agent, which
 * already exists for exactly this.
 *
 * Every entry here was checked, not remembered. For each one: the package was
 * resolved against the npm registry, and its declared repository compared
 * against the project's own. That check is not ceremony — `grok-cli` on npm
 * declares `whitesmith/grok-cli`, which is not the `superagent-ai` project
 * Pitwall links to, so it is not in this list. An install command pointing at
 * the wrong package is not a broken feature, it is a supply-chain incident.
 *
 * Where the publisher's own instructions are not an install Pitwall can run —
 * a shell script piped into a shell, a download — the entry carries only its
 * documentation. `providers.ts` has the rule and it holds here: a wrong
 * install command is worse than none.
 *
 * ## What the check keeps out
 *
 * The last sweep of candidates rejected as many as it admitted, and none of
 * the rejections were guesses:
 *
 * - `coderabbit` and `plandex` on npm are security-hold placeholders at
 *   `0.0.1-security`, with no binary. Installing either gets you nothing.
 * - `kimi-cli` on npm is version 0.0.2 with no repository and no binary; the
 *   real one is on PyPI. The npm name is not Moonshot's.
 * - `@vibe-kit/grok-cli` declares no repository at all, so there is nothing to
 *   check the name against.
 * - Sourcegraph's Cody CLI still publishes, but Sourcegraph has moved to Amp;
 *   a marketplace that lists the superseded tool is misleading rather than
 *   complete.
 *
 * Editors (Cursor's app, Windsurf, Zed) and hosted agents (Devin, Jules) are
 * absent for a different reason: they are not a binary Pitwall can start, so
 * an entry for one could only ever be a link. Where such a product does ship a
 * CLI — Cursor does — the CLI is what is listed.
 */

export interface CatalogueEntry {
  id: string;
  name: string;
  /**
   * An agent takes a task and works on it. A runtime serves models to the
   * agents — Ollama does not review your diff, it answers the CLI that does.
   * Listing them together as "agents" would be a category error.
   */
  kind: "agent" | "runtime";
  /** One line: what it is, not what it claims. */
  summary: string;
  /** The binary it installs, used to tell whether it is already there. */
  command: string;
  /** Verified against the registry; absent when nothing could be confirmed. */
  installCommand?: string;
  docs: string;
  /** Where Windows differs: Homebrew is Mac-only. A command only when the project publishes one. */
  windows?: { installCommand?: string; docs?: string };
  /**
   * The licence the project ships under, where it is published plainly.
   * Left off rather than guessed — it is the field people filter on when
   * they have a policy about it, so a wrong value is worse than a blank.
   */
  licence?: string;
  /** How you pay for the models it drives, which is rarely the agent itself. */
  access: "open-source" | "subscription" | "bring-your-own-key";
  /** Whose models it can drive. Descriptive: none of these are locked to one. */
  models: string[];
}

export const agentCatalogue: CatalogueEntry[] = [
  {
    id: "opencode",
    name: "OpenCode",
    kind: "agent",
    summary: "Open-source terminal agent, provider-agnostic — bring any model.",
    command: "opencode",
    installCommand: "npm install -g opencode-ai",
    docs: "https://opencode.ai/docs/",
    licence: "MIT",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "Google", "local via Ollama"],
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    kind: "agent",
    summary: "Alibaba's open-source coding agent, built around Qwen3-Coder.",
    command: "qwen",
    installCommand: "npm install -g @qwen-code/qwen-code",
    docs: "https://github.com/QwenLM/qwen-code",
    licence: "Apache-2.0",
    access: "bring-your-own-key",
    models: ["Qwen", "OpenAI-compatible endpoints"],
  },
  {
    id: "crush",
    name: "Crush",
    kind: "agent",
    summary: "Charm's terminal agent, with LSP context and MCP support.",
    command: "crush",
    installCommand: "npm install -g @charmland/crush",
    docs: "https://github.com/charmbracelet/crush",
    licence: "FSL",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "Groq", "OpenRouter"],
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    kind: "agent",
    summary: "Copilot's coding agent in the terminal. Needs a Copilot subscription.",
    command: "copilot",
    installCommand: "npm install -g @github/copilot",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
    access: "subscription",
    models: ["GitHub Copilot models"],
  },
  {
    id: "continue",
    name: "Continue",
    kind: "agent",
    summary: "Open-source assistant with a CLI, configurable per project.",
    command: "cn",
    installCommand: "npm install -g @continuedev/cli",
    docs: "https://docs.continue.dev/",
    licence: "Apache-2.0",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "local via Ollama"],
  },
  {
    id: "cline",
    name: "Cline",
    kind: "agent",
    summary: "Open-source agent, plan-then-act, with its own CLI.",
    command: "cline",
    // `@cline/cli` is the experimental build in cline/sdk and installs a binary
    // called `clite`, so Pitwall installed it and then never found it. The
    // shipped CLI is the unscoped `cline` package, from cline/cline.
    installCommand: "npm install -g cline",
    docs: "https://github.com/cline/cline",
    licence: "Apache-2.0",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "OpenRouter", "local via Ollama"],
  },
  {
    id: "goose",
    name: "Goose",
    kind: "agent",
    summary: "Block's on-machine agent — does more than code, extensible over MCP.",
    command: "goose",
    installCommand: "brew install block-goose-cli",
    windows: { docs: "https://goose-docs.ai/docs/quickstart" },
    docs: "https://goose-docs.ai/docs/getting-started/installation/",
    licence: "Apache-2.0",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "Google", "local via Ollama"],
  },
  {
    id: "aider",
    name: "Aider",
    kind: "agent",
    summary: "Git-native pair programming: every change lands as a commit.",
    command: "aider",
    installCommand: "uv tool install aider-chat",
    docs: "https://aider.chat/docs/install.html",
    licence: "Apache-2.0",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "DeepSeek", "local via Ollama"],
  },
  {
    id: "cursor-cli",
    name: "Cursor CLI",
    kind: "agent",
    summary: "Cursor's agent outside the editor, driving the same models as the app.",
    command: "cursor-agent",
    installCommand: "brew install --cask cursor-cli",
    windows: { installCommand: "irm 'https://cursor.com/install?win32=true' | iex", docs: "https://cursor.com/docs/cli/installation" },
    docs: "https://cursor.com/docs/cli/overview",
    access: "subscription",
    models: ["Anthropic", "OpenAI", "Google", "xAI"],
  },
  {
    id: "droid",
    name: "Droid",
    kind: "agent",
    summary: "Factory's terminal agent, built around specs and long-running tasks.",
    command: "droid",
    installCommand: "brew install --cask droid",
    windows: { installCommand: "irm https://app.factory.ai/cli/windows | iex", docs: "https://docs.factory.ai/cli/getting-started/overview" },
    docs: "https://docs.factory.ai/cli/getting-started/overview",
    access: "subscription",
    models: ["Anthropic", "OpenAI", "Google"],
  },
  {
    id: "amp",
    name: "Amp",
    kind: "agent",
    summary: "Sourcegraph's agent — unconstrained token use, no model picker by design.",
    command: "amp",
    installCommand: "npm install -g @sourcegraph/amp",
    docs: "https://ampcode.com/manual",
    access: "subscription",
    models: ["Chosen by Amp"],
  },
  {
    id: "auggie",
    name: "Auggie",
    kind: "agent",
    summary: "Augment Code's terminal agent, indexing the repository before it works.",
    command: "auggie",
    installCommand: "npm install -g @augmentcode/auggie",
    docs: "https://docs.augmentcode.com/cli/overview",
    access: "subscription",
    models: ["Anthropic", "OpenAI"],
  },
  {
    id: "qodo-command",
    name: "Qodo Command",
    kind: "agent",
    summary: "Qodo's agent runner — agents defined in files, aimed at review and tests.",
    command: "qodo",
    installCommand: "npm install -g @qodo/command",
    docs: "https://docs.qodo.ai/qodo-documentation/qodo-command",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "Google"],
  },
  {
    id: "forge",
    name: "Forge",
    kind: "agent",
    summary: "Open-source terminal agent from Antinomy, provider-agnostic.",
    command: "forge",
    installCommand: "npm install -g @antinomyhq/forge",
    docs: "https://github.com/antinomyhq/forge",
    licence: "MIT",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "OpenRouter", "local via Ollama"],
  },
  {
    id: "codebuff",
    name: "Codebuff",
    kind: "agent",
    summary: "Open-source agent that spawns sub-agents per file it is changing.",
    command: "codebuff",
    installCommand: "npm install -g codebuff",
    docs: "https://github.com/CodebuffAI/codebuff",
    licence: "MIT",
    access: "subscription",
    models: ["Anthropic", "OpenAI", "Google"],
  },
  {
    id: "octofriend",
    name: "Octofriend",
    kind: "agent",
    summary: "Small open-source terminal agent, happy pointed at a local model.",
    command: "octofriend",
    installCommand: "npm install -g octofriend",
    docs: "https://github.com/synthetic-lab/octofriend",
    licence: "MIT",
    access: "bring-your-own-key",
    models: ["Anthropic", "OpenAI", "local via Ollama"],
  },
  {
    id: "iflow",
    name: "iFlow CLI",
    kind: "agent",
    summary: "Terminal agent from iFlow, driving Qwen, Kimi, DeepSeek and GLM.",
    command: "iflow",
    installCommand: "npm install -g @iflow-ai/iflow-cli",
    docs: "https://github.com/iflow-ai/iflow-cli",
    access: "bring-your-own-key",
    models: ["Qwen", "Kimi", "DeepSeek", "GLM", "OpenAI-compatible endpoints"],
  },
  {
    id: "kiro-cli",
    name: "Kiro CLI",
    kind: "agent",
    summary: "Amazon's terminal agent — the Q Developer CLI, renamed.",
    command: "kiro-cli",
    installCommand: "brew install --cask kiro-cli",
    windows: { installCommand: "irm 'https://cli.kiro.dev/install.ps1' | iex", docs: "https://kiro.dev/docs/cli/installation/" },
    docs: "https://kiro.dev/docs/cli/",
    access: "subscription",
    models: ["Anthropic", "Amazon Nova"],
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "runtime",
    summary: "Runs open models on your own machine. Point an agent at it for local inference.",
    command: "ollama",
    installCommand: "brew install ollama",
    windows: { installCommand: "winget install --id Ollama.Ollama -e", docs: "https://docs.ollama.com/windows" },
    docs: "https://docs.ollama.com/macos",
    licence: "MIT",
    access: "open-source",
    models: ["Llama", "Qwen", "Gemma", "DeepSeek", "and the rest of its library"],
  },
];

/**
 * How to install an entry on this platform, and how on the other one, so both
 * are always on screen. The PowerShell one-liners are shown to copy rather
 * than run for you: the installer only runs commands of known shapes.
 */
export function installFor(entry: CatalogueEntry, platform: string): { installCommand?: string; docs: string; elsewhere?: { label: string; installCommand: string } } {
  const onWindows = platform === "win32";
  const windowsCommand = entry.windows ? entry.windows.installCommand : entry.installCommand;
  const here = onWindows ? { installCommand: windowsCommand, docs: entry.windows?.docs ?? entry.docs } : { installCommand: entry.installCommand, docs: entry.docs };
  const otherCommand = onWindows ? entry.installCommand : windowsCommand;
  const elsewhere = otherCommand && otherCommand !== here.installCommand ? { label: onWindows ? "Mac" : "Windows", installCommand: otherCommand } : undefined;
  return { ...here, ...(elsewhere ? { elsewhere } : {}) };
}

export type LocalCatalogueEntry = CatalogueEntry & { elsewhere?: { label: string; installCommand: string } };

const thisPlatform = typeof window !== "undefined"
  ? ((window as { pitwall?: { platform?: string } }).pitwall?.platform ?? (/Win/.test(navigator.platform || "") ? "win32" : "darwin"))
  : "darwin";

/** The catalogue as this computer should offer it: its own install command first, the other platform's beside it. */
export const localCatalogue: LocalCatalogueEntry[] = agentCatalogue.map((entry) => {
  const resolved = installFor(entry, thisPlatform);
  return { ...entry, installCommand: resolved.installCommand, docs: resolved.docs, ...(resolved.elsewhere ? { elsewhere: resolved.elsewhere } : {}) };
});

/** Catalogue entries that are not already first-class providers. */
export function catalogueFor(kind: CatalogueEntry["kind"]): CatalogueEntry[] {
  return agentCatalogue.filter((entry) => entry.kind === kind);
}
