import type { AgentProvider } from "../data";
import { splitArgs } from "../lib/format";

export type ModelOption = { label: string; value: string };

/** A selectable agent in the UI — a built-in provider or a user-defined one. */
export type AgentOption = {
  agent: AgentProvider;
  command: string;
  loginCommand: string;
  models: ModelOption[];
  modelSource?: string;
  modelError?: string;
  modelsDiscoveredAt?: string;
  custom?: boolean;
  /**
   * Derived from what is installed rather than defined by the user.
   *
   * Separate from `custom` because the two need the same launch handling and
   * opposite treatment in the list: a user-defined agent can be removed, and
   * this one cannot — it exists because a model is pulled, so the only way to
   * remove it is to delete the model.
   */
  local?: boolean;
  args?: string;
  id?: string;
};

// For a custom agent, resolve the concrete command + args to launch; built-in
// agents return {} so the Electron side uses its own profile.
export function resolveAgentLaunch(
  option: AgentOption | undefined,
  modelLabel: string,
): { command?: string; args?: string[] } {
  if (!option?.custom) return {};
  const model = option.models.find((item) => item.label === modelLabel);
  const modelValue = model?.value ?? modelLabel;
  const baseArgs = option.args ? splitArgs(option.args) : [];
  const skipModel = !modelValue || modelValue === "default" || modelValue === "auto";
  const modelArgs = option.models.length && !skipModel ? ["--model", modelValue] : [];
  return { command: option.command, args: [...baseArgs, ...modelArgs] };
}
