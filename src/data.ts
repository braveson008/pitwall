export type SessionStatus = "starting" | "running" | "waiting" | "completed" | "failed" | "disconnected";
export type ProjectStatus = "active" | "watching" | "quiet";
// The built-in agents are named literals; `(string & {})` keeps their
// autocomplete while allowing user-defined agents to carry any name.
export type AgentProvider = "Claude" | "Grok" | "Codex" | "Gemini" | "Kimi" | "Hermes" | "Cursor" | "Local" | (string & {});

export interface AgentSession {
  id: string;
  name: string;
  agent: AgentProvider;
  status: SessionStatus;
  model: string;
  branch: string;
  worktreePath?: string;
  nativeSessionId?: string;
  nativeSessionStarted?: boolean;
  /**
   * How this session is launched, when the agent is not a built-in provider.
   *
   * A local model's agent row is worked out at runtime from what Ollama has
   * pulled, which is what keeps the list honest — delete the model and the row
   * goes. But a session outlives the moment it was created, and re-attaching
   * one whose row has not been rediscovered yet found no way to launch it and
   * failed as "Unsupported agent". Recording the command with the session
   * means it can always be started by the thing that started it before.
   */
  launchCommand?: string;
  launchArgs?: string[];
  /**
   * Run this session in its CLI's own unattended mode, skipping the approval
   * prompts that would otherwise hold a council waiting for a human.
   *
   * Recorded on the session for the same reason the launch command is: a
   * council's configuration is a moment, and the session outlives it. A member
   * restarted or swapped in later has to come back in the mode the council was
   * started in, or the relay quietly stops on the one pane that reverted.
   */
  autoApprove?: boolean;
  task: string;
  progress: number;
  tokens: string;
  approvals: number;
  risk: "low" | "medium" | "high";
  files: number;
  started: string;
  logs: string[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  status: ProjectStatus;
  accent: string;
  health: number;
  openSessions: number;
  queuedTasks: number;
  lastCommit: string;
  ci: "passing" | "failing" | "pending";
  sessions: AgentSession[];
  queue: string[];
  timeline: string[];
}

export const projectsSeed: Project[] = [];
