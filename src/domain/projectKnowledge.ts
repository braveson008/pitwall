import type { PitwallContextEntry } from "./types";

export type KnowledgeKind = "overview" | "area" | "command" | "convention" | "decision" | "pitfall";
export type KnowledgeFreshness = "current" | "stale" | "unknown";
export type KnowledgeScope =
  | { type: "project" }
  | { type: "task"; taskId: string; workspacePath: string; branch?: string }
  | { type: "workspace"; workspacePath: string; branch?: string };

export interface KnowledgeRecord {
  id: string;
  version: number;
  kind: KnowledgeKind;
  title: string;
  content: string;
  scope: KnowledgeScope;
  sources: Array<{ path: string; hash: string }>;
  status: "observed" | "tentative" | "superseded" | "forgotten";
  origin: "inventory" | "agent" | "user";
  pinned: boolean;
  taskId?: string;
  runId?: string;
  providerIds?: string[];
  /** The agent that reported it, e.g. "hermes"; absent for people and older records. */
  author?: string;
  supersedes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeView extends KnowledgeRecord {
  freshness: KnowledgeFreshness;
  compatible: boolean;
}

export interface KnowledgeObservation {
  kind?: KnowledgeKind;
  title: string;
  content: string;
  sourcePaths?: string[];
  origin?: "agent" | "user";
  scope?: KnowledgeScope;
  supersedes?: string;
  providerIds?: string[];
  author?: string;
}

export interface DeliveryReceipt {
  id: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
  provider: string;
  role: string;
  records: Array<{
    id: string;
    version: number;
    title: string;
    sources: Array<{ path: string; hash: string }>;
    freshness: KnowledgeFreshness;
  }>;
  manualEntryIds: string[];
  manualEntries: Array<{ id: string; title: string }>;
  /** Whether any delivered note is limited to named providers. */
  providerRestricted?: boolean;
  payloadHash: string;
  approximateChars: number;
  branch?: string;
  revision?: string;
  workspacePath: string;
  status: "prepared" | "delivered" | "failed";
  createdAt: string;
  deliveredAt?: string;
  error?: string;
  warnings: string[];
  exportPath?: string;
}

export interface ProjectKnowledgeLocation {
  projectPath: string;
  workspacePath?: string;
  taskId?: string;
}

export interface ProjectKnowledgeSnapshot {
  ok: boolean;
  repositoryId: string;
  records: KnowledgeView[];
  receipts: DeliveryReceipt[];
  coverage: {
    filesInspected: number;
    inspectedPaths: string[];
    totalEligibleFiles: number;
    scanTruncated: boolean;
    lastLearnedAt?: string;
  };
  warnings: string[];
  error?: string;
}

export interface PrepareKnowledgeInput extends ProjectKnowledgeLocation {
  projectId?: string;
  runId?: string;
  sessionId?: string;
  task: { title: string; description?: string; relatedFiles?: string[] };
  role: string;
  provider: string;
  manualEntries?: PitwallContextEntry[];
  basePrompt: string;
}

export interface PrepareKnowledgeResult {
  ok: boolean;
  prompt: string;
  receipt?: DeliveryReceipt;
  error?: string;
}

export interface KnowledgeMutationResult {
  ok: boolean;
  records?: KnowledgeRecord[];
  record?: KnowledgeRecord;
  error?: string;
  warnings?: string[];
}

export interface KnowledgeUpdateInput extends ProjectKnowledgeLocation {
  id: string;
  expectedVersion: number;
  patch: Partial<Pick<KnowledgeRecord, "title" | "content" | "pinned" | "status">> & { scope?: { type: "project" } };
}
