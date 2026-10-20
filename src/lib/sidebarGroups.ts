import type { AgentSession, Project } from "../data";
import type { PitwallCouncilRun, PitwallTask } from "../domain/types";
import { pairReviewerLabel } from "../domain/pairReviewer";
import { applySessionOrder } from "./sessionOrder";
import { expandSessionName } from "./sessionNames";

/**
 * The sidebar's two lists, as Pitwall had them: every session, where it was
 * put and with its state on a glyph, and the work waiting in Review. Grouping
 * sessions by what their agent was doing moved rows out from under the cursor
 * and filed the same work in different places as the agent flickered.
 */
export type SidebarGroupName = "Working" | "Review";

export interface SidebarRow {
  id: string;
  kind: "task" | "session" | "council" | "starting";
  /** Rendered with emphasis: it is waiting on the person. */
  needsYou: boolean;
  projectId: string;
  taskId?: string;
  sessionId?: string;
  /** Set when the row stands for a Council: deleting it removes the whole run. */
  councilRunId?: string;
  councilName?: string;
  /** The session a session or Council row speaks for. */
  session?: AgentSession;
  title: string;
  /** The task key, or the project for a session with no task. */
  key: string;
  status: string;
  when: string;
  sortAt: number;
}

/** A session still being created: no id of its own yet, only what it will be. */
export interface StartingSession {
  id: string;
  projectId: string;
  title: string;
  agent: string;
}

export interface SidebarGroup {
  name: SidebarGroupName;
  rows: SidebarRow[];
}

export function relativeTime(at: number, now: number): string {
  // No time recorded is no time to show, not fifty-six years ago.
  if (!Number.isFinite(at) || at <= 0) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (!Number.isFinite(seconds) || seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function reviewStatus(task: PitwallTask): string {
  const pair = task.pair;
  if (!pair) return "Ready for review";
  const reviewer = pairReviewerLabel(pair.reviewer);
  if (pair.state === "approved") return `Approved by ${reviewer === "Hermes" ? "the reviewer" : reviewer}`;
  if (pair.state === "open-points") return `${reviewer === "Hermes" ? "The reviewer" : reviewer} has open points`;
  return "Ready for review";
}

export function buildSidebarGroups({
  tasks,
  projects,
  projectFilter,
  now,
  links = [],
  councilRuns = [],
  sessionOrder = {},
  starting = [],
}: {
  tasks: PitwallTask[];
  councilRuns?: PitwallCouncilRun[];
  projects: Project[];
  /** Which session belongs to which task, from Pitwall's own session records. */
  links?: Array<{ id: string; taskId: string }>;
  /** "" for every project. */
  projectFilter: string;
  now: number;
  /** The order the person arranged each project's sessions in. */
  sessionOrder?: Record<string, string[]>;
  /** Sessions being created, shown first so the wait is visible. */
  starting?: StartingSession[];
}): SidebarGroup[] {
  const inScope = (projectId: string) => !projectFilter || projectId === projectFilter;
  const projectName = new Map(projects.map((project) => [project.id, project.name]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskBySession = new Map(links.filter((link) => link.taskId).map((link) => [link.id, link.taskId]));
  const sessionById = new Map(projects.flatMap((project) => project.sessions.map((session) => [session.id, session] as const)));
  const councilSessionIds = new Set(councilRuns.flatMap((run) => run.responses.map((response) => response.sessionId)));

  const working: SidebarRow[] = starting
    .filter((item) => inScope(item.projectId))
    .map((item) => ({
      id: item.id,
      kind: "starting" as const,
      needsYou: false,
      projectId: item.projectId,
      title: item.title,
      key: projectName.get(item.projectId) ?? "",
      status: item.agent,
      when: "",
      sortAt: now,
    }));
  for (const project of projects) {
    if (!inScope(project.id)) continue;
    const sessions = applySessionOrder(project.sessions.filter((session) => !councilSessionIds.has(session.id)), sessionOrder[project.id] ?? []);
    for (const session of sessions) {
      const taskId = taskBySession.get(session.id);
      const at = Date.parse(session.started) || 0;
      working.push({
        id: `session:${session.id}`,
        kind: "session",
        needsYou: session.status === "waiting",
        projectId: project.id,
        taskId,
        sessionId: session.id,
        session,
        title: expandSessionName(session.name, taskId ? taskById.get(taskId)?.title : undefined) || session.name || session.branch,
        key: project.name,
        status: String(session.agent ?? ""),
        when: relativeTime(at, now),
        sortAt: at,
      });
    }
  }

  // A Council is one piece of work however many agents sit on it; its row
  // speaks for its liveliest member.
  for (const run of councilRuns) {
    if (!inScope(run.projectId)) continue;
    const members = run.responses.map((response) => sessionById.get(response.sessionId)).filter((session): session is AgentSession => Boolean(session));
    if (members.length === 0) continue;
    const lead = members.find((member) => member.status === "waiting")
      ?? members.find((member) => member.status === "running" || member.status === "starting")
      ?? members[0];
    const at = Date.parse(run.createdAt) || 0;
    working.push({
      id: `council:${run.id}`,
      kind: "council",
      needsYou: lead.status === "waiting",
      projectId: run.projectId,
      taskId: run.taskId,
      sessionId: lead.id,
      session: lead,
      councilRunId: run.id,
      councilName: run.name || "Council",
      title: run.name || (run.taskId ? taskById.get(run.taskId)?.title : undefined) || run.prompt.slice(0, 60) || "Council",
      key: projectName.get(run.projectId) ?? "",
      status: `Council of ${members.length}`,
      when: relativeTime(at, now),
      sortAt: at,
    });
  }

  const sessionByTask = new Map<string, string>();
  for (const project of projects) {
    for (const session of project.sessions) {
      const taskId = taskBySession.get(session.id);
      if (taskId) sessionByTask.set(taskId, session.id);
      else sessionByTask.set(`${project.id}\0${session.task}`, session.id);
    }
  }
  const review: SidebarRow[] = tasks
    .filter((task) => task.status === "review" && inScope(task.projectId))
    .map((task) => {
      const at = Date.parse(task.updatedAt) || 0;
      return {
        id: `task:${task.id}`,
        kind: "task" as const,
        needsYou: true,
        projectId: task.projectId,
        taskId: task.id,
        sessionId: sessionByTask.get(task.id) ?? sessionByTask.get(`${task.projectId}\0${task.title}`),
        title: task.title,
        key: task.identifier ? task.identifier.toUpperCase() : projectName.get(task.projectId) ?? "",
        status: reviewStatus(task),
        when: relativeTime(at, now),
        sortAt: at,
      };
    })
    .sort((a, b) => b.sortAt - a.sortAt);

  return [
    { name: "Working" as const, rows: working },
    { name: "Review" as const, rows: review },
  ].filter((group) => group.rows.length > 0);
}
