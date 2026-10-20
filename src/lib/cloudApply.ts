import type { AgentSession, Project, SessionStatus } from "../data";
import type {
  BraveliActivityEvent, BraveliProjectRecord, BraveliSession, BraveliSessionStatus, BraveliTask, BraveliWorkspaceState,
} from "../domain/types";
import type { CustomAgentDefinition } from "../domain/customAgents";
import type { TaskRun } from "../domain/contracts";
import type { AttemptOutcome } from "./modelHistory";
import { MAX_STORED_ACTIVITY, normalizeTask } from "../storage/braveliStore";

export interface CloudChange {
  kind: string;
  localId: string;
  /** Null when the record was deleted elsewhere. */
  data: Record<string, unknown> | null;
}

export interface CloudAppliedState {
  projects: Project[];
  braveli: BraveliWorkspaceState;
  taskRuns: TaskRun[];
  outcomes: AttemptOutcome[];
  customAgents: CustomAgentDefinition[];
  sessionOrder: Record<string, string[]>;
}

const PROJECT_FIELDS = ["name", "path", "branch", "status", "accent", "health", "openSessions", "queuedTasks", "lastCommit", "ci", "queue", "timeline"] as const;
const RECORD_FIELDS = ["name", "path", "defaultBranch", "providerIds", "overseer", "remote", "remoteUrl", "cloudHistory", "createdAt", "updatedAt"] as const satisfies ReadonlyArray<keyof BraveliProjectRecord>;
const ORDER = ["project", "session"];

export const outcomeId = (outcome: AttemptOutcome) => [outcome.projectId, outcome.provider, outcome.model, outcome.at].join("|");

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
const isToken = (value: unknown) => typeof value === "string" && value.startsWith("@{");
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** An agent that was running on another computer is not running here. */
function demote<T extends string>(status: T | undefined): T {
  return (status === "running" || status === "starting" || status === "waiting" ? "disconnected" : status ?? "disconnected") as T;
}

function upsert<T>(list: T[], idOf: (item: T) => string, id: string, next: T | null): T[] {
  const index = list.findIndex((item) => idOf(item) === id);
  if (next === null) return index === -1 ? list : list.filter((_, at) => at !== index);
  if (index === -1) return [next, ...list];
  return same(list[index], next) ? list : list.map((item, at) => (at === index ? next : item));
}

function projectFromRecord(data: Record<string, unknown>, existing: Project | undefined): Project {
  const base: Project = existing ?? {
    id: String(data.id), name: "", path: "", branch: "main", status: "quiet", accent: "#0a84ff", health: 100, openSessions: 0,
    queuedTasks: 0, lastCommit: "", ci: "pending", sessions: [], queue: [], timeline: [],
  };
  const next = { ...base } as Project & Record<string, unknown>;
  for (const field of PROJECT_FIELDS) if (data[field] !== undefined) next[field] = data[field] as never;
  // A project that is here already keeps where it is here.
  if (isToken(next.path) && existing?.path && !isToken(existing.path)) next.path = existing.path;
  if (!next.branch && typeof data.defaultBranch === "string") next.branch = data.defaultBranch;
  return next;
}

function workspaceProjectFromRecord(data: Record<string, unknown>, existing: BraveliProjectRecord | undefined): BraveliProjectRecord {
  const stamp = new Date().toISOString();
  const next = { ...(existing ?? { id: String(data.id), name: "", path: "", defaultBranch: "main", providerIds: [], createdAt: stamp, updatedAt: stamp }) } as BraveliProjectRecord & Record<string, unknown>;
  for (const field of RECORD_FIELDS) if (data[field] !== undefined) next[field] = data[field] as never;
  if (isToken(next.path) && existing?.path && !isToken(existing.path)) next.path = existing.path;
  return next;
}

/**
 * Remote records into the renderer's state. Pure, and returns the very same
 * objects when nothing changed, so an idle sync never re-renders the app.
 */
export function applyRemote(state: CloudAppliedState, changes: CloudChange[]): CloudAppliedState & { prefs: Record<string, string> | null } {
  let { projects, braveli, taskRuns, outcomes, customAgents, sessionOrder } = state;
  let prefs: Record<string, string> | null = null;
  const sorted = [...changes].sort((a, b) => {
    const rank = (kind: string) => (ORDER.indexOf(kind) === -1 ? ORDER.length : ORDER.indexOf(kind));
    return rank(a.kind) - rank(b.kind);
  });
  const setBraveli = <K extends keyof BraveliWorkspaceState>(key: K, value: BraveliWorkspaceState[K]) => {
    if (value !== braveli[key]) braveli = { ...braveli, [key]: value };
  };

  for (const change of sorted) {
    const { kind, localId, data } = change;
    if (kind === "project") {
      const local = projects.find((item) => item.id === localId);
      const nextProject = data ? projectFromRecord(data, local) : null;
      projects = upsert(projects, (item) => item.id, localId, nextProject && local && same(local, nextProject) ? local : nextProject);
      const localRecord = braveli.projects.find((item) => item.id === localId);
      const nextRecord = data ? workspaceProjectFromRecord(data, localRecord) : null;
      setBraveli("projects", upsert(braveli.projects, (item) => item.id, localId, nextRecord && localRecord && same(localRecord, nextRecord) ? localRecord : nextRecord));
    } else if (kind === "session") {
      const projectId = String(data?.projectId ?? "");
      const agent = data?.agent as Omit<AgentSession, "logs"> | undefined;
      const workspace = data?.workspace as BraveliSession | undefined;
      const mapped = projects.map((project) => {
        const local = project.sessions.find((session) => session.id === localId);
        if (!data || !agent || project.id !== projectId) {
          return local && (!data || project.id !== projectId) ? { ...project, sessions: project.sessions.filter((session) => session.id !== localId) } : project;
        }
        // Status and progress are this computer's own; a session new here has not run here.
        const runtimeDefaults = { progress: 0, tokens: "", approvals: 0, files: 0 };
        const next = {
          ...runtimeDefaults,
          ...(agent as Partial<AgentSession>),
          ...(local ? { progress: local.progress, tokens: local.tokens, approvals: local.approvals, files: local.files } : {}),
          logs: local?.logs ?? [],
          status: local ? local.status : demote<SessionStatus>(agent.status),
        } as AgentSession;
        if (local && same(local, next)) return project;
        return { ...project, sessions: upsert(project.sessions, (session) => session.id, localId, next) };
      });
      if (mapped.some((project, index) => project !== projects[index])) projects = mapped;
      const localWorkspace = braveli.sessions.find((session) => session.id === localId);
      const nextWorkspace = data && workspace
        ? { ...workspace, status: localWorkspace ? localWorkspace.status : demote<BraveliSessionStatus>(workspace.status) }
        : null;
      setBraveli("sessions", upsert(braveli.sessions, (session) => session.id, localId, nextWorkspace));
    } else if (kind === "task") {
      setBraveli("tasks", upsert(braveli.tasks, (item) => item.id, localId, data ? normalizeTask(data as unknown as BraveliTask) : null));
    } else if (kind === "context") {
      setBraveli("contextEntries", upsert(braveli.contextEntries, (item) => item.id, localId, data as never));
    } else if (kind === "snapshot") {
      setBraveli("contextSnapshots", upsert(braveli.contextSnapshots, (item) => item.id, localId, data as never));
    } else if (kind === "council") {
      setBraveli("councilRuns", upsert(braveli.councilRuns, (item) => item.id, localId, data as never));
    } else if (kind === "compare") {
      setBraveli("compareRuns", upsert(braveli.compareRuns, (item) => item.id, localId, data as never));
    } else if (kind === "activity") {
      const incoming = (data?.events as BraveliActivityEvent[] | undefined) ?? [];
      const known = new Set(braveli.activity.map((event) => event.id));
      const fresh = incoming.filter((event) => !known.has(event.id));
      if (fresh.length) {
        const merged = [...fresh, ...braveli.activity].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        setBraveli("activity", merged.slice(0, MAX_STORED_ACTIVITY));
      }
    } else if (kind === "taskRun") {
      taskRuns = upsert(taskRuns, (item) => item.id, localId, data as never);
    } else if (kind === "outcome") {
      outcomes = upsert(outcomes, outcomeId, localId, data as never);
    } else if (kind === "customAgent") {
      customAgents = upsert(customAgents, (item) => item.id, localId, data as never);
    } else if (kind === "sessionOrder") {
      const order = (data?.order as Record<string, string[]> | undefined) ?? {};
      if (!same(order, sessionOrder)) sessionOrder = order;
    } else if (kind === "prefs" && data) {
      prefs = Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === "string")) as Record<string, string>;
    }
  }
  return { projects, braveli, taskRuns, outcomes, customAgents, sessionOrder, prefs };
}

/**
 * The same repository was already a project here under another id: the local
 * project takes the synced project's id, and everything that names it follows,
 * so one repository is one project on every computer.
 */
export function renameProject(state: CloudAppliedState, from: string, to: string): CloudAppliedState {
  if (from === to || !state.projects.some((project) => project.id === from) && !state.braveli.projects.some((project) => project.id === from)) return state;
  const swap = <T extends { projectId?: string }>(items: T[]) => items.map((item) => (item.projectId === from ? { ...item, projectId: to } : item));
  const sessionOrder = Object.fromEntries(Object.entries(state.sessionOrder).map(([key, value]) => [key === from ? to : key, value]));
  return {
    ...state,
    projects: state.projects.map((project) => (project.id === from ? { ...project, id: to } : project)),
    braveli: {
      ...state.braveli,
      projects: state.braveli.projects.map((project) => (project.id === from ? { ...project, id: to } : project)),
      tasks: swap(state.braveli.tasks),
      sessions: swap(state.braveli.sessions),
      contextEntries: swap(state.braveli.contextEntries as Array<{ projectId?: string }>) as never,
      contextSnapshots: swap(state.braveli.contextSnapshots as Array<{ projectId?: string }>) as never,
      activity: swap(state.braveli.activity),
      councilRuns: swap(state.braveli.councilRuns as Array<{ projectId?: string }>) as never,
      compareRuns: swap(state.braveli.compareRuns as Array<{ projectId?: string }>) as never,
    },
    taskRuns: swap(state.taskRuns),
    outcomes: swap(state.outcomes),
    sessionOrder,
  };
}
