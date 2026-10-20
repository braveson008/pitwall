import type { PairReviewer } from "./pairReviewer";
// Built-in provider ids plus room for user-defined agents (any string).
export type PitwallProviderId = "claude" | "codex" | "gemini" | "grok" | "kimi" | "hermes" | (string & {});

export type PitwallTaskStatus =
  | "backlog"
  | "ready"
  | "running"
  | "review"
  | "completed"
  | "cancelled";

export type PitwallTaskPriority = "low" | "medium" | "high" | "urgent";

export type PitwallSessionType =
  | "architecture"
  | "implementation"
  | "debugging"
  | "review"
  | "code-review"
  | "research";

export type PitwallSessionStatus =
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "disconnected";

export type ContextCategory =
  | "architecture"
  | "coding-standards"
  | "database"
  | "api"
  | "project-goals"
  | "decision"
  | "testing"
  | "security"
  | "notes";

export type ContextVisibility = "all-agents" | "selected-agents" | "private";

export interface PitwallProjectRecord {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  providerIds: PitwallProviderId[];
  /** Hermes as this project's reviewer, learning it between reviews. */
  overseer?: PitwallProjectOverseer;
  createdAt: string;
  updatedAt: string;
}

/** Hermes reviews and learns every project unless the person turns it off there. */
export const DEFAULT_OVERSEER: PitwallProjectOverseer = { enabled: true, model: "auto", rounds: 3 };

export interface PitwallProjectOverseer {
  /** Every finished task is reviewed by Hermes, and Hermes learns from it and from your decisions. */
  enabled: boolean;
  /** The Hermes model value; "auto" is Hermes's own default. */
  model: string;
  /** Rounds of review before the work comes to you regardless. */
  rounds: number;
}

export interface PitwallTask {
  id: string;
  /** User-facing issue key and branch name. Optional only for legacy stored tasks. */
  identifier?: string;
  projectId: string;
  title: string;
  description: string;
  status: PitwallTaskStatus;
  priority: PitwallTaskPriority;
  assignedAgent: PitwallProviderId | "council" | "";
  relatedFiles: string[];
  /**
   * Absolute paths to images attached to the description, staged into Pitwall's
   * own attachment directory. A bug report is usually a screenshot, and the
   * agent needs a path on disk rather than bytes — that is how every CLI takes
   * one.
   */
  images?: string[];
  worktree: string;
  source?: {
    /** "schedule": the record a scheduled run keeps for its session and review. Never on the board. */
    kind: "local" | "mcp" | "schedule";
    name?: string;
    provider?: PitwallProviderId;
    target?: string;
    externalId?: string;
    url?: string;
    status?: string;
  };
  /**
   * The board column this task sits in. Seeded from the source tracker's status
   * on import, then owned by Pitwall — moving a card here never writes back, so
   * the column cannot claim to be what the tracker currently says.
   */
  boardColumn?: string;
  /**
   * Reviewer feedback waiting for, or already given to, an agent. Kept on the
   * task because the session that did the work may be gone by the time anyone
   * reviews it, and a request typed into a dead pane was never made.
   */
  changeRequests?: {
    id: string;
    body: string;
    createdAt: string;
    deliveredAt: string | null;
    /** Written by the pair's reviewer rather than by a person. */
    from?: "reviewer";
  }[];
  /**
   * A reviewer agent paired with the implementer: it reads the change before
   * the person does, and sends it back a few rounds at most.
   */
  pair?: PitwallTaskPair;
  completionSummary?: PitwallTaskSummary;
  createdAt: string;
  updatedAt: string;
}

export interface PitwallTaskPair {
  /** The reviewer's CLI. */
  reviewer: PairReviewer;
  /** The reviewer's model, when one was chosen (Hermes's comes from the project). */
  model?: string;
  maxRounds: number;
  /** Rounds reviewed since the person last weighed in. */
  round: number;
  state: "implementing" | "reviewing" | "approved" | "open-points" | "skipped";
  /** The reviewer's last word, for the Review queue. */
  outcome?: string;
  summary?: string;
  /** The reviewer's own terminal, beside the implementer's. */
  reviewerSessionId?: string;
  /** Which session implements, and where, so a review can be resumed after a restart. */
  implementerSessionId?: string;
  worktreePath?: string;
  /** Each round's verdict, newest last. */
  rounds?: PitwallPairRound[];
  /** What the person decided on the reviewed work, beside what the reviewer had said: its track record. */
  decisions?: PitwallPairDecision[];
}

export interface PitwallPairDecision {
  at: string;
  lead: "approved" | "sent-back";
  /** Where the reviewer had left it. */
  reviewer: "approved" | "open-points";
  model?: string;
}

export interface PitwallPairRound {
  round: number;
  verdict: "approve" | "request_changes" | "unreadable";
  summary: string;
  comments: { path: string; line: number; body: string }[];
  at: string;
  /** The model that reviewed this round, so a track record can be read per model. */
  model?: string;
}

export interface PitwallTaskSummary {
  what: string;
  how: string;
  components: string[];
  source: "agent" | "derived";
  reportedAt: string;
}

export interface PitwallContextEntry {
  id: string;
  projectId: string;
  title: string;
  category: ContextCategory;
  content: string;
  visibility: ContextVisibility;
  priority: number;
  providerIds: PitwallProviderId[];
  createdAt: string;
  updatedAt: string;
}

export interface PitwallContextSnapshot {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  provider: PitwallProviderId;
  model: string;
  files: string[];
  task: Pick<PitwallTask, "id" | "identifier" | "title" | "description" | "status" | "priority" | "relatedFiles" | "worktree">;
  contextEntries: Array<Pick<PitwallContextEntry, "id" | "title" | "category" | "content" | "priority">>;
  receipt?: import("./projectKnowledge").DeliveryReceipt;
  createdAt: string;
}

export interface PitwallSession {
  id: string;
  projectId: string;
  provider: PitwallProviderId;
  taskId: string;
  type: PitwallSessionType;
  status: PitwallSessionStatus;
  model: string;
  worktreePath?: string;
  nativeSessionId?: string;
  nativeSessionStarted?: boolean;
  /** Restricted references can remain in the provider's resumed conversation. */
  contextProviderRestricted?: boolean;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
  }>;
  contextSnapshotId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PitwallActivityEvent {
  id: string;
  projectId: string;
  taskId?: string;
  sessionId?: string;
  provider?: PitwallProviderId;
  type:
    | "task-created"
    | "task-started"
    | "session-started"
    | "context-snapshot"
    | "handoff-created"
    | "council-started"
    | "compare-started"
    | "task-completed"
    | "git"
    | "system";
  message: string;
  createdAt: string;
}

export interface PitwallCouncilRun {
  id: string;
  name?: string;
  projectId: string;
  taskId: string;
  prompt: string;
  providerIds: PitwallProviderId[];
  synthesizer: PitwallProviderId;
  status: "draft" | "running" | "ready" | "completed";
  responses: Array<{
    provider: PitwallProviderId;
    sessionId: string;
    status: PitwallSessionStatus;
  }>;
  /**
   * The council's conversation and routing state. Held here so a run survives a
   * restart — the agent processes do not, but the discussion that makes the run
   * worth resuming does. Shape is validated on read; see isRestorableRelayState.
   */
  relay?: unknown;
  createdAt: string;
}

export interface PitwallCompareRun {
  id: string;
  projectId: string;
  taskId: string;
  prompt: string;
  providerIds: PitwallProviderId[];
  status: "running" | "ready" | "completed";
  responses: Array<{
    provider: PitwallProviderId;
    sessionId: string;
    status: PitwallSessionStatus;
  }>;
  createdAt: string;
}

export interface PitwallWorkspaceState {
  version: 1;
  projects: PitwallProjectRecord[];
  tasks: PitwallTask[];
  contextEntries: PitwallContextEntry[];
  contextSnapshots: PitwallContextSnapshot[];
  sessions: PitwallSession[];
  activity: PitwallActivityEvent[];
  councilRuns: PitwallCouncilRun[];
  compareRuns: PitwallCompareRun[];
}
