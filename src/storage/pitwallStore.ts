import type { Project } from "../data";
import { providerIdFromAgent } from "../domain/providers";
import type {
  PitwallActivityEvent,
  PitwallContextEntry,
  PitwallProjectRecord,
  PitwallSessionStatus,
  PitwallTask,
  PitwallWorkspaceState,
} from "../domain/types";
import { writeStoredJson } from "../lib/storage";

const STORE_KEY = "pitwall-workspace-state";
const LEGACY_STORE_KEY = "bravely-workspace-state";

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSessionStatus(status: unknown): PitwallSessionStatus {
  if (status === "paused") return "waiting";
  if (status === "idle") return "completed";
  if (status === "blocked") return "failed";
  if (["starting", "running", "waiting", "completed", "failed", "disconnected"].includes(String(status))) {
    return status as PitwallSessionStatus;
  }
  return "disconnected";
}

function projectRecordFromProject(project: Project): PitwallProjectRecord {
  const timestamp = now();
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    defaultBranch: project.branch || "main",
    providerIds: ["claude", "codex", "gemini", "grok", "kimi", "hermes"],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function seedTasks(projects: Project[]): PitwallTask[] {
  const timestamp = now();
  return projects.flatMap((project) =>
    project.sessions.map((session, index) => ({
      id: `task-${session.id}`,
      identifier: `legacy-${index + 1}`,
      projectId: project.id,
      title: session.task || `Task ${index + 1}`,
      description: session.task || "Coordinate agent work for this project.",
      status: session.status === "running" || session.status === "starting" ? "running" : session.status === "failed" ? "review" : "ready",
      priority: session.risk === "high" ? "high" : session.risk === "medium" ? "medium" : "low",
      assignedAgent: providerIdFromAgent(session.agent),
      relatedFiles: [],
      worktree: session.branch,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  );
}

function seedContext(projects: Project[]): PitwallContextEntry[] {
  const timestamp = now();
  return projects.flatMap((project) => [
    {
      id: makeId(`ctx-${project.id}-architecture`),
      projectId: project.id,
      title: "Architecture",
      category: "architecture",
      content: `Current project root: ${project.path}. Default branch: ${project.branch}.`,
      visibility: "all-agents",
      priority: 90,
      providerIds: ["claude", "codex", "gemini", "grok", "kimi", "hermes"],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: makeId(`ctx-${project.id}-standards`),
      projectId: project.id,
      title: "Coding Standards",
      category: "coding-standards",
      content: "Keep changes scoped, prefer existing project patterns, run relevant checks before completion.",
      visibility: "all-agents",
      priority: 80,
      providerIds: ["claude", "codex", "gemini", "grok", "kimi", "hermes"],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: makeId(`ctx-${project.id}-testing`),
      projectId: project.id,
      title: "Testing Strategy",
      category: "testing",
      content: "Use focused tests for changed behavior and avoid broad unrelated refactors.",
      visibility: "all-agents",
      priority: 70,
      providerIds: ["claude", "codex", "gemini", "grok", "kimi", "hermes"],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
}

function seedActivity(projects: Project[]): PitwallActivityEvent[] {
  const timestamp = now();
  return projects.flatMap((project) => [
    {
      id: makeId(`activity-${project.id}`),
      projectId: project.id,
      type: "system",
      message: "Project imported into Pitwall mission control",
      createdAt: timestamp,
    },
  ]);
}

export function createEmptyProjectState(project: Project): Pick<
  PitwallWorkspaceState,
  "projects" | "tasks" | "contextEntries" | "activity"
> {
  return {
    projects: [projectRecordFromProject(project)],
    tasks: seedTasks([project]),
    contextEntries: seedContext([project]),
    activity: seedActivity([project]),
  };
}

export function createInitialPitwallState(projects: Project[]): PitwallWorkspaceState {
  return {
    version: 1,
    projects: projects.map(projectRecordFromProject),
    tasks: seedTasks(projects),
    contextEntries: seedContext(projects),
    contextSnapshots: [],
    sessions: [],
    activity: seedActivity(projects),
    councilRuns: [],
    compareRuns: [],
  };
}

/** Tasks saved by an older build or synced from another computer can lack fields every screen reads. */
export function normalizeTask(task: PitwallTask): PitwallTask {
  return Array.isArray(task.relatedFiles) ? task : { ...task, relatedFiles: [] };
}

export function readPitwallState(projects: Project[]): PitwallWorkspaceState {
  try {
    const stored = window.localStorage.getItem(STORE_KEY) ?? window.localStorage.getItem(LEGACY_STORE_KEY);
    if (!stored) return createInitialPitwallState(projects);
    const parsed = JSON.parse(stored) as PitwallWorkspaceState;
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return createInitialPitwallState(projects);
    if (Array.isArray(parsed.activity) && parsed.activity.length > MAX_STORED_ACTIVITY) {
      parsed.activity = parsed.activity.slice(0, MAX_STORED_ACTIVITY);
    }
    parsed.tasks = (parsed.tasks ?? []).map(normalizeTask);
    parsed.sessions = (parsed.sessions ?? []).map((session) => ({
      ...session,
      status: normalizeSessionStatus(session.status),
    }));

    const missingProjects = projects.filter((project) => !parsed.projects.some((item) => item.id === project.id));
    if (missingProjects.length === 0) return parsed;

    const migrated = createInitialPitwallState(missingProjects);
    return {
      ...parsed,
      projects: [...parsed.projects, ...migrated.projects],
      tasks: [...parsed.tasks, ...migrated.tasks],
      contextEntries: [...parsed.contextEntries, ...migrated.contextEntries],
      activity: [...migrated.activity, ...parsed.activity],
    };
  } catch {
    return createInitialPitwallState(projects);
  }
}

/** How much history is kept. The log is newest first and only ever grew. */
export const MAX_STORED_ACTIVITY = 1000;

export function writePitwallState(state: PitwallWorkspaceState) {
  const capped = state.activity.length > MAX_STORED_ACTIVITY
    ? { ...state, activity: state.activity.slice(0, MAX_STORED_ACTIVITY) }
    : state;
  writeStoredJson(STORE_KEY, capped);
  window.localStorage.removeItem(LEGACY_STORE_KEY);
}

export { makeId };
