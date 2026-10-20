import type { AgentProvider } from "../data";
import type { PitwallProviderId } from "./types";

const onWindows = typeof window !== "undefined" && (window as { pitwall?: { platform?: string } }).pitwall?.platform === "win32";

const hermesInstall = {
  mac: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
  windows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
};

export interface ProviderDefinition {
  id: PitwallProviderId;
  agent: Extract<AgentProvider, "Claude" | "Codex" | "Gemini" | "Grok" | "Kimi" | "Hermes">;
  displayName: string;
  icon: string;
  command: string;
  loginCommand: string;
  /**
   * How to install the CLI, when it is known.
   *
   * Left empty rather than guessed: a wrong install command is worse than
   * none — it fails in a way the reader cannot diagnose, and it teaches them
   * the app is unreliable at the first thing they ever ask it.
   */
  installCommand?: string;
  installDocs?: string;
  /** The other desktop platform's command, shown alongside so neither platform looks unsupported. */
  installElsewhere?: { label: string; installCommand: string };
  supportedModels: Array<{ label: string; value: string }>;
  /**
   * Reviews and learns the project; never offered to write code. Hermes is the
   * project's long-term reviewer, so it is in the reviewer list and the MCP
   * panel, and in no list that picks who implements.
   */
  reviewerOnly?: boolean;
}

export const providerRegistry: ProviderDefinition[] = [
  {
    id: "claude",
    agent: "Claude",
    displayName: "Claude",
    icon: "C",
    command: "claude",
    loginCommand: "claude login",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    installDocs: "https://docs.claude.com/en/docs/claude-code/overview",
    supportedModels: [{ label: "Auto", value: "auto" }],
  },
  {
    id: "codex",
    agent: "Codex",
    displayName: "Codex",
    icon: "O",
    command: "codex",
    loginCommand: "codex login",
    installCommand: "npm install -g @openai/codex",
    installDocs: "https://github.com/openai/codex",
    supportedModels: [{ label: "Auto", value: "auto" }],
  },
  {
    id: "gemini",
    agent: "Gemini",
    displayName: "Gemini",
    icon: "G",
    command: "gemini",
    loginCommand: "gemini",
    installCommand: "npm install -g @google/gemini-cli",
    installDocs: "https://github.com/google-gemini/gemini-cli",
    supportedModels: [{ label: "Auto", value: "auto" }],
  },
  {
    id: "grok",
    agent: "Grok",
    displayName: "Grok",
    icon: "X",
    command: "grok",
    loginCommand: "grok login",
    installDocs: "https://github.com/superagent-ai/grok-cli",
    supportedModels: [{ label: "Auto", value: "auto" }],
  },
  {
    id: "kimi",
    agent: "Kimi",
    displayName: "Kimi",
    icon: "K",
    command: "kimi",
    loginCommand: "kimi login",
    installDocs: "https://github.com/MoonshotAI/kimi-cli",
    supportedModels: [{ label: "Auto", value: "auto" }],
  },
  {
    id: "hermes",
    agent: "Hermes",
    displayName: "Hermes",
    icon: "H",
    command: "hermes",
    loginCommand: "hermes setup",
    installCommand: onWindows ? hermesInstall.windows : hermesInstall.mac,
    installElsewhere: onWindows
      ? { label: "Mac", installCommand: hermesInstall.mac }
      : { label: "Windows", installCommand: hermesInstall.windows },
    installDocs: "https://github.com/NousResearch/hermes-agent",
    supportedModels: [{ label: "Auto", value: "auto" }],
    reviewerOnly: true,
  },
];

export function getProviderById(id: PitwallProviderId) {
  return providerRegistry.find((provider) => provider.id === id);
}

export function providerIdFromAgent(agent: AgentProvider): PitwallProviderId {
  const match = providerRegistry.find((provider) => provider.agent === agent);
  if (match) return match.id;

  const customId = String(agent)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return customId || "custom";
}

export function agentFromProviderId(id: PitwallProviderId) {
  return getProviderById(id)?.agent ?? "Codex";
}

export function getProviderModelValue(id: PitwallProviderId, modelLabel: string) {
  const provider = getProviderById(id);
  return provider?.supportedModels.find((model) => model.label === modelLabel)?.value ?? modelLabel;
}

/** Whether an agent may be chosen to do the work, rather than only to review it. */
export function canImplement(agent: AgentProvider): boolean {
  return !providerRegistry.some((provider) => provider.agent === agent && provider.reviewerOnly);
}
