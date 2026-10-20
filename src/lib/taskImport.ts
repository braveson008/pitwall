import type { PitwallTask, PitwallTaskStatus } from "../domain/types";
import { normalizeTaskIdentifier, validateTaskIdentifier } from "./taskIdentity";
import { trackerHtmlToMarkdown } from "./markdown";

export function mcpTaskSourceKey(provider: string, source: string) {
  return `${provider.trim().toLowerCase()}::${source.trim().toLowerCase()}`;
}

export function mcpTaskIdentity(
  provider: string,
  source: string,
  task: Pick<McpTaskCandidate, "id" | "url" | "title">,
) {
  const remoteIdentity = task.id || task.url || task.title;
  return `${mcpTaskSourceKey(provider, source)}::${String(remoteIdentity || "").trim().toLowerCase()}`;
}

export function importedTaskIdentity(task: PitwallTask) {
  if (task.source?.kind !== "mcp" || !task.source.name) return "";
  return mcpTaskIdentity(task.source.provider || "claude", task.source.name, {
    id: task.source.externalId,
    url: task.source.url,
    title: task.title,
  });
}

function identifierBase(candidate: McpTaskCandidate) {
  const raw = candidate.id || candidate.title || "imported-task";
  const slug = normalizeTaskIdentifier(raw)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 64);
  return !validateTaskIdentifier(slug) ? slug : "imported-task";
}

export function allocateImportedTaskIdentifier(candidate: McpTaskCandidate, usedIdentifiers: Set<string>) {
  const base = identifierBase(candidate);
  let identifier = base;
  let suffix = 2;
  while (usedIdentifiers.has(identifier)) {
    const ending = `-${suffix}`;
    identifier = `${base.slice(0, 64 - ending.length)}${ending}`;
    suffix += 1;
  }
  usedIdentifiers.add(identifier);
  return identifier;
}

const EXTERNAL_STATUS_MAP: Array<[RegExp, PitwallTaskStatus]> = [
  [/\b(?:cancelled|canceled|rejected|duplicate)\b/i, "cancelled"],
  [/\b(?:done|completed|closed|resolved|shipped)\b/i, "completed"],
  [/\b(?:review|qa|verify|verification|testing)\b/i, "review"],
  [/\b(?:in[\s_-]*progress|started|active|doing|working)\b/i, "running"],
  [/\b(?:backlog|triage|icebox|planned)\b/i, "backlog"],
  [/\b(?:todo|to[\s_-]*do|open|unstarted|ready|new)\b/i, "ready"],
];

/** Preserve a tracker's workflow meaning without coupling Pitwall to one vendor. */
export function mapExternalTaskStatus(status?: string): PitwallTaskStatus {
  const normalized = status?.trim();
  if (!normalized) return "ready";
  return EXTERNAL_STATUS_MAP.find(([pattern]) => pattern.test(normalized))?.[1] ?? "ready";
}

const TASK_SOURCE_HINT = /(?:linear|jira|issue|tracker|task|github|gitlab|asana|trello|clickup|shortcut|youtrack|azure)/i;
const AUDITED_TASK_SOURCE = /(?:atlassian|jira|linear|github)/i;

export function isAuditedTaskSource(name: string, target = "") {
  return AUDITED_TASK_SOURCE.test(`${name} ${target}`);
}

const SOURCE_WORDS: Record<string, string> = {
  api: "API",
  github: "GitHub",
  gitlab: "GitLab",
  jira: "Jira",
  mcp: "MCP",
};

export function mcpTaskSourceLabel(name: string) {
  const parts = name.split(":").filter(Boolean);
  const meaningful = parts[0]?.toLowerCase() === "plugin" ? parts.at(-1) || name : name;
  return meaningful
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SOURCE_WORDS[word.toLowerCase()] || `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * Each provider owns its connection state. The same display name may therefore
 * appear more than once, but duplicate discovery rows from one provider do not.
 */
export const NOT_CONNECTED_HERE = "not connected for this project";

export function flattenMcpTaskSources(
  sourcesByProvider: Partial<Record<string, McpListResult>>,
): McpTaskSource[] {
  const sources = new Map<string, McpTaskSource>();
  for (const [providerKey, result] of Object.entries(sourcesByProvider)) {
    const provider = String(result?.provider || providerKey).trim().toLowerCase();
    if (!provider || !result) continue;
    const boundHere = new Map((result.authProfiles || []).filter((profile) => profile.authenticatedAt).map((profile) => [profile.name, profile]));
    for (const server of result.servers || []) {
      const key = mcpTaskSourceKey(provider, server.name);
      // A remote server's OAuth token is keyed by its name and URL, not by
      // project, so without a binding here it answers as whichever account
      // logged in for another project.
      const borrowed = /http|sse/i.test(server.transport) && !boundHere.has(server.name);
      const candidate: McpTaskSource = {
        ...server,
        ...(borrowed ? { status: "needs-auth" as McpServerStatus, statusText: NOT_CONNECTED_HERE } : {}),
        provider,
        key,
        label: mcpTaskSourceLabel(server.name),
        importSupported: provider === "claude" && isAuditedTaskSource(server.name, server.target),
        scope: boundHere.get(server.name)?.scope,
      };
      const current = sources.get(key);
      if (!current || (current.status !== "connected" && candidate.status === "connected")) {
        sources.set(key, candidate);
      }
    }
  }
  return sortMcpTaskSources([...sources.values()]);
}

/** Keep every MCP source available, but put likely work trackers first. */
export function sortMcpTaskSources<T extends McpServerInfo>(sources: T[]): T[] {
  const score = (source: T) =>
    (TASK_SOURCE_HINT.test(`${source.name} ${source.target}`) ? 2 : 0) +
    (source.status === "connected" ? 1 : 0) +
    ("importSupported" in source && source.importSupported ? 2 : 0);
  return [...sources].sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name));
}

/**
 * The preview, laid out the way the board it came from is.
 *
 * Eighteen items arrived as one flat list. On the board they came from they sit
 * in nine columns across two sprints and a backlog, and none of that survived
 * the trip — so telling work due this week from work three weeks out meant
 * opening every one of them.
 *
 * Grouped by where the tracker says each item sits, and ordered so the work
 * that is actually in flight is at the top. A backlog is real work and belongs
 * in the list; it just does not belong first.
 */
export type ImportGroup = {
  /** The sprint or cycle name, "Backlog", or "" when the tracker has none. */
  key: string;
  label: string;
  tasks: McpTaskCandidate[];
  /** Scheduled into nothing: shown last, and collapsed. */
  isBacklog: boolean;
};

const BACKLOG = /^back\s*log$/i;

/**
 * The axis a tracker actually organises work along.
 *
 * Jira and Linear schedule into sprints and cycles, so that is the board. A
 * GitHub Projects kanban, a Trello board or an Asana section list has no such
 * concept — there the columns *are* the board, and grouping everything under
 * one heading throws away the only structure the tool has.
 *
 * So the axis is whichever one the tracker answered on. Falling back to status
 * is not a consolation prize; for those tools it is the more accurate reading
 * of the same idea.
 */
function groupingAxis(tasks: readonly McpTaskCandidate[]): "group" | "status" {
  return tasks.some((task) => String(task.group ?? "").trim()) ? "group" : "status";
}

export function groupImportCandidates(tasks: readonly McpTaskCandidate[]): ImportGroup[] {
  const axis = groupingAxis(tasks);
  const byKey = new Map<string, ImportGroup>();

  for (const task of tasks) {
    const raw = String((axis === "group" ? task.group : task.status) ?? "").trim();
    const key = raw || "unscheduled";
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        // A tracker that answered on neither gets no invented heading:
        // "Unscheduled" would be a claim about a distinction it does not make.
        label: raw || "Assigned to you",
        tasks: [],
        // A column literally called Backlog is a backlog, whichever axis it
        // arrived on — and belongs at the bottom either way.
        isBacklog: BACKLOG.test(raw),
      });
    }
    byKey.get(key)!.tasks.push(task);
  }

  // Backlog last, everything else in the order the tracker returned it —
  // which is most-recently-updated, so live work leads.
  return [...byKey.values()].sort((a, b) => Number(a.isBacklog) - Number(b.isBacklog));
}

/**
 * What a group is worth saying in one line.
 *
 * The columns are the useful part: "3 To Do · 3 Blocked · 4 Ready for Release"
 * is the board, and it is what tells you at a glance whether a sprint is
 * starting or nearly finished.
 */
export function summariseImportGroup(tasks: readonly McpTaskCandidate[], group?: ImportGroup): string {
  // When the heading already is the column, restating it under itself says
  // nothing: "Todo — 2 Todo".
  if (group && tasks.every((task) => String(task.status ?? "").trim() === group.label)) {
    return `${tasks.length} item${tasks.length === 1 ? "" : "s"}`;
  }
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = String(task.status ?? "").trim();
    if (!status) continue;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  if (counts.size === 0) return `${tasks.length} item${tasks.length === 1 ? "" : "s"}`;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => `${count} ${status}`)
    .join(" · ");
}

/**
 * A ticket description reduced to one readable line.
 *
 * Tracker descriptions are markdown, and the preview rendered them raw — every
 * row opened with a literal `**Objective:**` and some carried a stray `![]`
 * where an image had been. Worse, they ran to two full lines each, so eighteen
 * tickets came to three and a half thousand pixels of scrolling and you could
 * hold about three of them in view.
 *
 * This is a hint, not the document. The whole description is kept intact on the
 * task itself — it is what someone reads to do the work — and what belongs in a
 * list you are choosing from is enough to tell one row from another.
 */
export function taskPreviewLine(description: string | undefined, limit = 150): string {
  const text = trackerHtmlToMarkdown(String(description ?? ""))
    // Fenced code, images and links carry nothing at this size.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-=_]{3,}\s*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= limit) return text;
  // Cut at a word rather than mid-syllable.
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type TrackerSyncPlan = {
  added: McpTaskCandidate[];
  updates: Array<{ taskId: string; patch: Partial<PitwallTask> }>;
};

/**
 * What a periodic re-check of a tracker should change.
 *
 * Split from the manual refresh because the two answer different questions. A
 * person refreshing one task is asking for the tracker's version of it. A timer
 * running behind your back must not be able to move work: the board column is
 * seeded from the tracker on import and owned by Pitwall afterwards, so a
 * ticket someone closed on Jira cannot pull a running task out from under a
 * council. The agent and the worktree are Pitwall's for the same reason.
 *
 * Only the fields the tracker genuinely owns are refreshed, and only when they
 * actually differ, so a quiet board writes no state at all.
 */
export function planTrackerSync({
  tasks,
  candidates,
  source,
}: {
  tasks: readonly PitwallTask[];
  candidates: readonly McpTaskCandidate[];
  source: { provider: string; name: string; target?: string };
}): TrackerSyncPlan {
  const byIdentity = new Map<string, PitwallTask>();
  for (const task of tasks) {
    const identity = importedTaskIdentity(task);
    if (identity) byIdentity.set(identity, task);
  }

  const added: McpTaskCandidate[] = [];
  const updates: TrackerSyncPlan["updates"] = [];

  for (const candidate of candidates) {
    const identity = mcpTaskIdentity(source.provider, source.name, candidate);
    const task = byIdentity.get(identity);
    if (!task) {
      added.push(candidate);
      continue;
    }

    const patch: Partial<PitwallTask> = {};
    const title = candidate.title?.trim();
    if (title && title !== task.title) patch.title = title;
    const description = trackerHtmlToMarkdown(candidate.description ?? "").trim();
    if (description && description !== task.description) patch.description = description;

    const nextSource = {
      ...task.source,
      ...(candidate.id ? { externalId: candidate.id } : {}),
      ...(candidate.url ? { url: candidate.url } : {}),
      ...(candidate.status ? { status: candidate.status } : {}),
    };
    if (
      nextSource.externalId !== task.source?.externalId ||
      nextSource.url !== task.source?.url ||
      nextSource.status !== task.source?.status
    ) {
      patch.source = nextSource as PitwallTask["source"];
    }

    if (Object.keys(patch).length) updates.push({ taskId: task.id, patch });
  }

  return { added, updates };
}

/**
 * One line saying what a tracker re-check did.
 *
 * Written because the first version of this feature had none. Every way it
 * could do nothing — an unresolved source, a server reporting itself
 * disconnected, an empty answer, a thrown error — looked exactly like a run
 * that had never happened, so a board that had visibly moved and a Pitwall
 * that had not could only be reconciled by reading the code.
 */
export function summariseTrackerSync({
  source,
  candidates = 0,
  added = 0,
  updated = 0,
  error = "",
}: {
  source: { name: string };
  candidates?: number;
  added?: number;
  updated?: number;
  error?: string;
}): string {
  const label = mcpTaskSourceLabel(source.name);
  if (error) return `${label}: could not be read — ${error.replace(/\.$/, "")}.`;
  if (!candidates) return `${label}: the source returned no open items.`;

  const item = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const from = `from ${item(candidates, "open item", "open items")}`;
  if (!added && !updated) return `${label}: nothing new, ${from}.`;

  const parts = [
    added ? item(added, "new task", "new tasks") : "",
    updated ? `${updated} updated` : "",
  ].filter(Boolean);
  return `${label}: ${parts.join(", ")}, ${from}.`;
}
