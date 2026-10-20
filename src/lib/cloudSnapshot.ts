import type { AgentSession, Project } from "../data";
import type { BraveliWorkspaceState } from "../domain/types";
import type { CustomAgentDefinition } from "../domain/customAgents";
import type { TaskRun } from "../domain/contracts";
import type { AttemptOutcome } from "./modelHistory";

/** Preferences that follow the person between computers; panel widths and the editor stay with the machine. */
export const CLOUD_PREF_KEYS = [
  "braveli-theme",
  "braveli-color-theme",
  "braveli-app-font",
  "braveli-terminal-font-size",
  "braveli-terminal-font-family",
  "braveli-notification-sound",
  "braveli-task-density",
  "braveli-council-view",
  "braveli-project-notifications",
] as const;

export interface CloudRendererSnapshot {
  projects: Array<Omit<Project, "sessions"> & { sessions: Array<Omit<AgentSession, "logs">> }>;
  braveli: BraveliWorkspaceState;
  taskRuns: TaskRun[];
  outcomes: AttemptOutcome[];
  customAgents: CustomAgentDefinition[];
  sessionOrder: Record<string, string[]>;
  prefs: Record<string, string>;
  /** The last batch from other computers this window has applied. */
  appliedGeneration: number;
}

export function readCloudPrefs(storage: Pick<Storage, "getItem"> = window.localStorage): Record<string, string> {
  const prefs: Record<string, string> = {};
  for (const key of CLOUD_PREF_KEYS) {
    const value = storage.getItem(key);
    if (value !== null) prefs[key] = value;
  }
  return prefs;
}

/** What the renderer hands to the sync engine: its state, minus terminal output, which is this machine's alone. */
export function buildCloudSnapshot(input: {
  projects: Project[];
  braveli: BraveliWorkspaceState;
  taskRuns: TaskRun[];
  outcomes: AttemptOutcome[];
  customAgents: CustomAgentDefinition[];
  sessionOrder: Record<string, string[]>;
  prefs: Record<string, string>;
  appliedGeneration: number;
}): CloudRendererSnapshot {
  return {
    ...input,
    projects: input.projects.map((project) => ({
      ...project,
      sessions: project.sessions.map(({ logs: _logs, ...session }) => session),
    })),
  };
}
