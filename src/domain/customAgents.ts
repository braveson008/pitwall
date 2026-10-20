import { writeStoredJson } from "../lib/storage";
export interface CustomAgentModel {
  label: string;
  value: string;
}

/**
 * A user-defined agent. Unlike the built-in providers it isn't hardcoded — the
 * user supplies the CLI command so Pitwall can launch it like any other agent.
 */
export interface CustomAgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string;
  loginCommand: string;
  modelDiscoveryCommand?: string;
  models: CustomAgentModel[];
  createdAt: string;
}

const STORE_KEY = "braveli-custom-agents";
const LEGACY_STORE_KEY = "bravely-custom-agents";

export function readCustomAgents(): CustomAgentDefinition[] {
  try {
    const current = window.localStorage.getItem(STORE_KEY);
    const legacy = current ? null : window.localStorage.getItem(LEGACY_STORE_KEY);
    const stored = current ?? legacy;
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const agents = parsed.filter(
      (agent): agent is CustomAgentDefinition =>
        Boolean(agent && typeof agent === "object" && agent.id && agent.name && agent.command),
    );
    if (legacy) {
      writeStoredJson(STORE_KEY, agents);
      window.localStorage.removeItem(LEGACY_STORE_KEY);
    }
    return agents;
  } catch {
    return [];
  }
}

export function writeCustomAgents(agents: CustomAgentDefinition[]) {
  writeStoredJson(STORE_KEY, agents);
  window.localStorage.removeItem(LEGACY_STORE_KEY);
}
