import type { PairReviewer } from "./pairReviewer";
// Built-in provider ids plus room for user-defined agents (any string).
export type BraveliProviderId = "claude" | "codex" | "gemini" | "grok" | "kimi" | "hermes" | (string & {});

export type BraveliTaskStatus =
  | "backlog"
  | "ready"
  | "running"
  | "review"
  | "completed"
  | "cancelled";

export type BraveliTaskPriority = "low" | "medium" | "high" | "urgent";

export type BraveliSessionType =
  | "architecture"
  | "implementation"
  | "debugging"
  | "review"
  | "code-review"
  | "research";

export type BraveliSessionStatus =
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

export interface BraveliProjectRecord {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  providerIds: BraveliProviderId[];
  /** Hermes as this project's reviewer, learning it between reviews. */
  overseer?: BraveliProjectOverseer;
  /** The git remote, normalised (`github.com/owner/repo`): how other computers recognise this project. */
  remote?: string;
  /** Where to clone it from, without credentials. */
  remoteUrl?: string;
  /** Agent conversations sync with the project unless this is false. */
  cloudHistory?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Hermes reviews and learns every project unless the person turns it off there. */
export const DEFAULT_OVERSEER: BraveliProjectOverseer = { enabled: true, model: "auto", rounds: 3 };

export interface BraveliProjectOverseer {
  /** Every finished task is reviewed by Hermes, and Hermes learns from it and from your decisions. */
  enabled: boolean;
  /** The Hermes model value; "auto" is Hermes's own default. */
  model: string;
  /** Rounds of review before the work comes to you regardless. */
  rounds: number;
}

export interface BraveliTask {
  id: string;
  /** User-facing issue key and branch name. Optional only for legacy stored tasks. */
  identifier?: string;
  projectId: string;
  title: string;
  description: string;
  status: BraveliTaskStatus;
  priority: BraveliTaskPriority;
  assignedAgent: BraveliProviderId | "council" | "";
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
    provider?: BraveliProviderId;
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
  pair?: BraveliTaskPair;
  completionSummary?: BraveliTaskSummary;
  createdAt: string;
  updatedAt: string;
}

export interface BraveliTaskPair {
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
  rounds?: BraveliPairRound[];
  /** What the person decided on the reviewed work, beside what the reviewer had said: its track record. */
  decisions?: BraveliPairDecision[];
}

export interface BraveliPairDecision {
  at: string;
  lead: "approved" | "sent-back";
  /** Where the reviewer had left it. */
  reviewer: "approved" | "open-points";
  model?: string;
}

export interface BraveliPairRound {
  round: number;
  verdict: "approve" | "request_changes" | "unreadable";
  summary: string;
  comments: { path: string; line: number; body: string }[];
  at: string;
  /** The model that reviewed this round, so a track record can be read per model. */
  model?: string;
}

export interface BraveliTaskSummary {
  what: string;
  how: string;
  components: string[];
  source: "agent" | "derived";
  reportedAt: string;
}

export interface BraveliContextEntry {
  id: string;
  projectId: string;
  title: string;
  category: ContextCategory;
  content: string;
  visibility: ContextVisibility;
  priority: number;
  providerIds: BraveliProviderId[];
  createdAt: string;
  updatedAt: string;
}

export interface BraveliContextSnapshot {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  provider: BraveliProviderId;
  model: string;
  files: string[];
  task: Pick<BraveliTask, "id" | "identifier" | "title" | "description" | "status" | "priority" | "relatedFiles" | "worktree">;
  contextEntries: Array<Pick<BraveliContextEntry, "id" | "title" | "category" | "content" | "priority">>;
  receipt?: import("./projectKnowledge").DeliveryReceipt;
  createdAt: string;
}

export interface BraveliSession {
  id: string;
  projectId: string;
  provider: BraveliProviderId;
  taskId: string;
  type: BraveliSessionType;
  status: BraveliSessionStatus;
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

export interface BraveliActivityEvent {
  id: string;
  projectId: string;
  taskId?: string;
  sessionId?: string;
  provider?: BraveliProviderId;
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

export interface BraveliCouncilRun {
  id: string;
  name?: string;
  projectId: string;
  taskId: string;
  prompt: string;
  providerIds: BraveliProviderId[];
  synthesizer: BraveliProviderId;
  status: "draft" | "running" | "ready" | "completed";
  responses: Array<{
    provider: BraveliProviderId;
    sessionId: string;
    status: BraveliSessionStatus;
  }>;
  /**
   * The council's conversation and routing state. Held here so a run survives a
   * restart — the agent processes do not, but the discussion that makes the run
   * worth resuming does. Shape is validated on read; see isRestorableRelayState.
   */
  relay?: unknown;
  createdAt: string;
}

export interface BraveliCompareRun {
  id: string;
  projectId: string;
  taskId: string;
  prompt: string;
  providerIds: BraveliProviderId[];
  status: "running" | "ready" | "completed";
  responses: Array<{
    provider: BraveliProviderId;
    sessionId: string;
    status: BraveliSessionStatus;
  }>;
  createdAt: string;
}

export interface BraveliWorkspaceState {
  version: 1;
  projects: BraveliProjectRecord[];
  tasks: BraveliTask[];
  contextEntries: BraveliContextEntry[];
  contextSnapshots: BraveliContextSnapshot[];
  sessions: BraveliSession[];
  activity: BraveliActivityEvent[];
  councilRuns: BraveliCouncilRun[];
  compareRuns: BraveliCompareRun[];
}
