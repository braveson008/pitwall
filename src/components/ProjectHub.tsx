import {
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, CSSProperties } from "react";
import type { AgentSession, Project } from "../data";
import type { PitwallActivityEvent, PitwallContextEntry, PitwallProjectOverseer, PitwallTask } from "../domain/types";
import { DEFAULT_OVERSEER } from "../domain/types";
import { formatActivityTime, getTaskStatusLabel } from "../lib/format";
import { buildBoard, columnFor, localStateLabel, normaliseStatus, showsLocalState } from "../lib/taskBoard";
import { taskDescriptionText } from "./TaskDescription";
import type { WorkspaceSection } from "./WorkspaceNavigation";
import { TaskChangeset } from "./TaskChangeset";
import { ChangeRequestBox } from "./ChangeRequestBox";
import { GITHUB_WORDS, type RepositoryHostWords } from "./ConnectionsModal";
import { BranchTree } from "./BranchTree";
import { Dropdown } from "./Dropdown";
import { BranchChanges } from "./BranchChanges";
import { formatTokens } from "../lib/tokenUsage";
import type { ValidationResult } from "../domain/contracts";
import { REVIEW_STATE_LABEL, reviewStateFor } from "../domain/reviewState";
import { formatAge } from "../lib/format";
import { DAY_PRESETS, bookingTimes, clockTime, daysFromKey, daysKey, describeRepeat, formatScheduleSpan, formatScheduleTime, hoursFromKey, isScheduledRunTask, nextJob, slotStatus, splitDay } from "../domain/schedule";
import { ValidationEvidence } from "./ValidationEvidence";
import { ProjectKnowledgePanel } from "./ProjectKnowledgePanel";
import { pairReviewerLabel } from "../domain/pairReviewer";
import { shortcutLabel } from "../lib/shortcutLabel";

interface ProjectHubProps {
  section: Exclude<WorkspaceSection, "work" | "connections">;
  project: Project;
  tasks: PitwallTask[];
  activeTask?: PitwallTask;
  sessions: AgentSession[];
  contextEntries: PitwallContextEntry[];
  selectedContextIds: string[];
  knowledgeRefresh?: number;
  activity: PitwallActivityEvent[];
  runCountByTask: Record<string, number>;
  /** Branches with a live agent session, so the tree can say which are worked. */
  sessionBranches?: string[];
  /** Jobs Pitwall starts by itself, for this project. */
  scheduleJobs?: ScheduleJob[];
  onSaveScheduleJob?: (job: ScheduleJob) => void;
  onDeleteScheduleJob?: (job: ScheduleJob) => void;
  onRunScheduleJobNow?: (job: ScheduleJob) => void;
  /** Settles a run you finished yourself, after clearing whatever blocked it. */
  onMarkScheduleRunDone?: (job: ScheduleJob) => void;
  /** Takes a typed line; resolves to an error to show, or "" on success. */
  onCreateScheduleJob?: (time: string, prompt: string, agent: string, days: number[], everyHours: number, until: string) => Promise<string>;
  /** The agents that can actually run today, in the order the picker offers them. */
  scheduleAgents?: string[];
  /**
   * The open booking's run: its live terminal while it is going, its
   * conversation and history once it is done. Passed as a render function
   * because the terminal needs eight pieces of app state, and threading those
   * through here would put the run workspace's plumbing inside this file.
   */
  renderScheduleRun?: (job: ScheduleJob) => ReactNode;
  /** What the repository says about each branch, keyed by branch name. */
  reviewFacts?: Record<string, ReviewBranchFacts> | null;
  /** False when gh is missing or signed out: the list has local facts only. */
  pullRequestsAvailable?: boolean;
  pullRequestError?: string;
  /** Why the last read failed. Empty when it succeeded. */
  reviewError?: string;
  reviewRefreshing?: boolean;
  onRefreshReview?: () => void;
  checksByTask?: Record<string, ValidationResult | undefined>;
  checkingTaskIds?: string[];
  attentionTaskIds?: string[];
  onRunValidation: (task: PitwallTask) => void;
  onSelectSession: (session: AgentSession) => void;
  /** What each task's sessions reported spending, by task. */
  usageByTask?: Record<string, { tokens: number | null; costUsd: number | null; unreported: number; reported: number }>;
  /** Opens a branch as its own tab, to read what it changed. */
  onOpenBranch?: (branch: { name: string; worktreePath?: string }) => void;
  /** Abandons a task git will never call done. Completing by hand is gone. */
  onCancelTask?: (task: PitwallTask) => void;
  /** Branches already open as tabs on this screen. */
  /** Which one is showing; empty means the review queue. */
  providerLabel: (provider: PitwallTask["assignedAgent"]) => string;
  onNewTask: () => void;
  onImportTasks: () => void;
  onSyncTasks: () => void;
  syncingTasks: boolean;
  /** Minutes until the trackers are re-read on their own. Null before the first read. */
  trackerSyncMinutes?: number | null;
  onSelectTask: (task: PitwallTask) => void;
  onOpenTask: (task: PitwallTask) => void;
  /** The task's agent session, when one is still there to talk to. */
  hasSession?: (task: PitwallTask) => boolean;
  onOpenSession?: (task: PitwallTask) => void;
  onStartTask: (task: PitwallTask) => void;
  onStartTasks: (tasks: PitwallTask[]) => void;
  onDeleteTasks: (tasks: PitwallTask[]) => void;
  /** Moves a card to another column. Pitwall only — the ticket is untouched. */
  onMoveTask: (task: PitwallTask, column: string) => void;
  /** Removes every task in a column from Pitwall. The tickets are untouched. */
  onClearColumn: (column: string, tasks: PitwallTask[]) => void;
  onCompleteTask: (task: PitwallTask) => void;
  /** Sends the work back with a reason. Resolves once an agent has it, or not. */
  onRequestChanges: (task: PitwallTask, body: string, filePath?: string) => Promise<boolean>;
  onOpenWork: () => void;
  onNewContext: () => void;
  onToggleContext: (id: string, checked: boolean) => void;
  onOpenConnections: () => void;
  /** The account this repository pushes as — a project's own fact. */
  onOpenGitHub: () => void;
  /** A review the sidebar asked to open. */
  focusReviewTaskId?: string;
  /** Hermes as this project's reviewer: its settings, whether it is installed, and its models. */
  overseer?: PitwallProjectOverseer;
  hermesReady?: boolean;
  hermesModels?: Array<{ value: string; label: string }>;
  onChangeOverseer?: (next: PitwallProjectOverseer) => void;
  githubLogin: string | null;
  /** The project's code host; null when Pitwall holds no account there. */
  repositoryHost?: RepositoryHostWords | null;
  /** "pull request" or "merge request". */
  requestNoun?: string;
  onOpenProject: () => void;
  editorLabel: string;
  previewByTask: Record<string, { url: string; label: string }>;
  onOpenTaskEditor: (task: PitwallTask) => Promise<void>;
  onOpenTaskPullRequest: (task: PitwallTask) => Promise<void>;
  /** Drafts a pull or merge request for the task's branch, to read and send. */
  onCreateTaskRequest?: (task: PitwallTask) => Promise<void>;
  onOpenTaskPreview: (task: PitwallTask) => Promise<void>;
}

const taskGroups: Array<{
  label: string;
  statuses: PitwallTask["status"][];
}> = [
  { label: "Ready", statuses: ["backlog", "ready"] },
  { label: "In progress", statuses: ["running"] },
  { label: "Review", statuses: ["review"] },
  { label: "Done", statuses: ["completed", "cancelled"] },
];

/** Domain labels are lower case; the interface says them in sentence case. */
function sentence(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Who a task belongs to, as the interface names it. Empty when nobody. */
function ownerOf(task: PitwallTask, providerLabel: (provider: PitwallTask["assignedAgent"]) => string): string {
  if (!task.assignedAgent) return "";
  return task.assignedAgent === "council" ? "Council" : sentence(providerLabel(task.assignedAgent));
}

/** The right-hand column of a task row: what is happening to it, in a phrase. */
function taskRowState(
  task: PitwallTask,
  runs: number,
  providerLabel: (provider: PitwallTask["assignedAgent"]) => string,
): string {
  const who = ownerOf(task, providerLabel);
  if (task.status === "review") return [who, "review requested"].filter(Boolean).join(" · ");
  if (task.status === "running") return [who, runs ? `${runs} ${runs === 1 ? "run" : "runs"}` : "working"].filter(Boolean).join(" · ");
  return sentence([who, getTaskStatusLabel(task.status)].filter(Boolean).join(" · "));
}

/** A task's status as a dot: green while worked, amber while it waits on you. */
function taskDot(task: PitwallTask): string {
  if (task.status === "running") return "is-working";
  if (task.status === "review") return "is-needs";
  if (task.status === "completed") return "is-quiet";
  return "";
}

function sessionDot(status: AgentSession["status"]): string {
  if (status === "running") return "is-working";
  if (status === "waiting") return "is-needs";
  if (status === "failed") return "is-failed";
  return "is-quiet";
}

/** A session's agent, in the shape `providerLabel` expects. */
function providerOf(session: AgentSession): PitwallTask["assignedAgent"] {
  return String(session.agent).toLowerCase() as PitwallTask["assignedAgent"];
}

export function ProjectHub({
  section,
  project,
  tasks,
  activeTask,
  sessions,
  contextEntries,
  selectedContextIds,
  knowledgeRefresh,
  activity,
  runCountByTask,
  sessionBranches = [],
  scheduleJobs = [],
  onSaveScheduleJob,
  onDeleteScheduleJob,
  onRunScheduleJobNow,
  onMarkScheduleRunDone,
  onCreateScheduleJob,
  scheduleAgents = [],
  renderScheduleRun,
  reviewFacts = null,
  pullRequestsAvailable = false,
  pullRequestError = "",
  reviewError = "",
  reviewRefreshing = false,
  onRefreshReview,
  checksByTask = {},
  checkingTaskIds = [],
  attentionTaskIds = [],
  onRunValidation,
  onSelectSession,
  usageByTask = {},
  onOpenBranch,
  onCancelTask,
  providerLabel,
  onNewTask,
  onImportTasks,
  onSyncTasks,
  syncingTasks,
  trackerSyncMinutes = null,
  onSelectTask,
  onOpenTask,
  hasSession,
  onOpenSession,
  onStartTask,
  onStartTasks,
  onDeleteTasks,
  onMoveTask,
  onClearColumn,
  onCompleteTask,
  onRequestChanges,
  onOpenWork,
  onNewContext,
  onToggleContext,
  onOpenConnections,
  onOpenGitHub,
  focusReviewTaskId,
  overseer,
  hermesReady,
  hermesModels = [],
  onChangeOverseer,
  githubLogin,
  repositoryHost = GITHUB_WORDS,
  requestNoun = "pull request",
  onOpenProject,
  editorLabel,
  previewByTask,
  onOpenTaskEditor,
  onOpenTaskPullRequest,
  onCreateTaskRequest,
  onOpenTaskPreview,
}: ProjectHubProps) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    try { return localStorage.getItem("pitwall-task-density") === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; }
  });
  useEffect(() => {
    try { localStorage.setItem("pitwall-task-density", density); } catch { /* Keep the preference for this window when storage is unavailable. */ }
  }, [density]);
  useEffect(() => { setSelectedTaskIds([]); }, [query, agentFilter, statusFilter, attentionOnly]);
  const search = query.trim().toLocaleLowerCase();
  // A scheduled run keeps a task record for its session and review; it is not filed work.
  const filteredTasks = tasks.filter((task) => !isScheduledRunTask(task) &&
    (!search || `${task.identifier || ""} ${task.title}`.toLocaleLowerCase().includes(search))
    && (!agentFilter || (agentFilter === "unassigned" ? !task.assignedAgent : task.assignedAgent === agentFilter))
    && (!statusFilter || task.status === statusFilter)
    && (!attentionOnly || attentionTaskIds.includes(task.id)));
  const hasFilters = Boolean(search || agentFilter || statusFilter || attentionOnly);
  const clearFilters = () => { setQuery(""); setAgentFilter(""); setStatusFilter(""); setAttentionOnly(false); };
  // The column a card is being dragged over, so the board can say where it will
  // land. Without it a drag is a guess until you let go.
  const [dropColumn, setDropColumn] = useState("");
  const [busyReviewAction, setBusyReviewAction] = useState("");
  // Which row is open. Local to this screen: App.tsx is already carrying too
  // much, and nothing outside the review section needs to know.
  const [selectedReviewId, setSelectedReviewId] = useState("");
  useEffect(() => {
    if (focusReviewTaskId) setSelectedReviewId(focusReviewTaskId);
  }, [focusReviewTaskId]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleAgent, setScheduleAgent] = useState("");
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [scheduleEveryHours, setScheduleEveryHours] = useState(0);
  /** The last hour a repeat runs, as typed. Empty means the end of the day. */
  const [scheduleUntil, setScheduleUntil] = useState("");
  const [editUntil, setEditUntil] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editAgent, setEditAgent] = useState("");
  const [editDays, setEditDays] = useState<number[]>([]);
  const [editEveryHours, setEditEveryHours] = useState(0);
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [scheduleDraftError, setScheduleDraftError] = useState("");
  const scheduleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachScheduleInput = useCallback((el: HTMLTextAreaElement | null) => {
    scheduleInputRef.current = el;
    if (el) fitToContent(el);
    // fitToContent is stable, so this ref is too: React attaches it once
    // rather than on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Grow a field to fit what is in it.
   *
   * `field-sizing: content` would do this in CSS, and is new enough that
   * relying on it left the instruction on one scrolling line for anyone whose
   * Chromium predates it. Measuring is a few lines and works everywhere.
   */
  const fitToContent = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, []);
  // Each failure named separately. Collapsing them into one sentence reported
  // "no time found" for `12:00,` — a line whose time was the part already right.
  // A minute is the resolution the page shows, so half of one keeps "in 4h 37m"
  // and the now line honest without spending anything noticeable.
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  useEffect(() => {
    if (section !== "schedule") return;
    setScheduleNow(Date.now());
    const tick = window.setInterval(() => setScheduleNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, [section]);

  // Derived, never stored. A task leaves this list because the repository says
  // so, not because somebody clicked a button about it.
  const reviewTasks = tasks.filter((task) =>
    task.status === "review" && (!reviewFacts || reviewStateFor(task.worktree, reviewFacts) !== "done"));
  const openReviewTask = section === "review" && !selectedBranch ? reviewTasks.find((task) => task.id === selectedReviewId) : undefined;
  // ⌘↵ approves the open task, ⌘⇧↵ starts a note sending it back.
  useEffect(() => {
    if (!openReviewTask) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("textarea, input, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      if (event.shiftKey) document.querySelector<HTMLButtonElement>(".dk-review-bar .dk-request-open")?.click();
      else onCompleteTask(openReviewTask);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openReviewTask, onCompleteTask]);
  const activeTasks = tasks.filter((task) => task.status === "running");
  const readyTasks = tasks.filter((task) => task.status === "ready" || task.status === "backlog");
  const attentionSessions = sessions.filter((session) => session.status === "failed" || session.status === "waiting");
  const runningSessions = sessions.filter((session) => session.status === "running");
  const selectedTasks = tasks.filter((task) => selectedTaskIds.includes(task.id));
  /* Every column, every time. Hiding the empty ones made the board a
     different shape each visit, and left nowhere to drag a card that is the
     first of its kind. */
  const visibleTaskGroups = taskGroups;

  useEffect(() => {
    setSelectedTaskIds((current) => current.filter((id) => tasks.some((task) => task.id === id)));
  }, [project.id, tasks]);

  function toggleTask(task: PitwallTask) {
    setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]);
  }

  async function runReviewAction(task: PitwallTask, action: "editor" | "pr" | "preview" | "create") {
    const key = `${task.id}:${action}`;
    setBusyReviewAction(key);
    try {
      if (action === "editor") await onOpenTaskEditor(task);
      if (action === "pr") await onOpenTaskPullRequest(task);
      if (action === "create") await onCreateTaskRequest?.(task);
      if (action === "preview") await onOpenTaskPreview(task);
    } finally {
      setBusyReviewAction("");
    }
  }

  if (section === "overview") {
    // Running first, then what is waiting on a person, then what could be
    // picked up. The whole point of a list is that you can see the queue.
    const liveTasks = [...activeTasks, ...reviewTasks, ...readyTasks];
    const recentSessions = [...sessions].reverse().slice(0, 6);

    return (
      <section className="dk-page dk-overview" aria-label="Overview">
        <div className="dk-toolbar">
          <p className="dk-overview-summary">
            {liveTasks.length} active {liveTasks.length === 1 ? "task" : "tasks"}
            {" · "}
            {runningSessions.length} {runningSessions.length === 1 ? "agent" : "agents"} working
          </p>
          <span className="dk-spacer" />
          <button className="dk-btn" type="button" onClick={onOpenProject}>
            <ExternalLink size={14} />
            Open repository
          </button>
          <button className="dk-btn dk-btn--primary" type="button" onClick={activeTask ? onOpenWork : onNewTask}>
            {activeTask ? <TerminalSquare size={14} /> : <Plus size={14} />}
            {activeTask ? "Open current work" : "New task"}
          </button>
        </div>

        {attentionSessions.length > 0 && (
          <section className="dk-section" aria-labelledby="overview-needs">
            <div className="dk-section-head">
              <div className="dk-overview-heading">
                <h2 className="dk-section-title" id="overview-needs">Needs you</h2>
                <span className="dk-overview-count is-needs">{attentionSessions.length}</span>
              </div>
            </div>
            <div className="dk-list">
              {attentionSessions.map((session) => (
                <button className="dk-list-row" type="button" key={session.id} onClick={() => onSelectSession(session)}>
                  <span className={`dk-dot ${sessionDot(session.status)}`} aria-hidden="true" />
                  <span className="dk-row-main">
                    <span className="dk-row-title">{session.name}</span>
                    <span className="dk-row-sub">
                      {[sentence(providerLabel(providerOf(session))), session.branch].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`dk-status ${session.status === "failed" ? "is-failed" : "is-needs"}`}>
                    {session.status === "failed" ? "Agent failed" : "Waiting for your input"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="dk-section" aria-labelledby="overview-active">
          <div className="dk-section-head">
            <div className="dk-overview-heading">
              <h2 className="dk-section-title" id="overview-active">Active</h2>
              {liveTasks.length ? <span className="dk-overview-count">{liveTasks.length}</span> : null}
            </div>
          </div>
          {liveTasks.length === 0 ? (
            <p className="dk-overview-empty">
              No tasks yet. <button className="dk-link" type="button" onClick={onNewTask}>Create one</button> or{" "}
              <button className="dk-link" type="button" onClick={onImportTasks}>import from a tracker</button>.
            </p>
          ) : (
            <div className="dk-flow">
              {liveTasks.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  className={`dk-flow-row${activeTask?.id === task.id ? " is-current" : ""}`}
                  onClick={() => onSelectTask(task)}
                >
                  <span className={`dk-dot ${taskDot(task)}`} aria-hidden="true" />
                  <span className="dk-flow-key dk-mono">{task.identifier || "—"}</span>
                  <span className="dk-flow-title">{task.title}</span>
                  <span className="dk-flow-meta">{taskRowState(task, runCountByTask[task.id] ?? 0, providerLabel)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {recentSessions.length > 0 && (
          <section className="dk-section" aria-labelledby="overview-sessions">
            <div className="dk-section-head">
              <div className="dk-overview-heading">
                <h2 className="dk-section-title" id="overview-sessions">Recent sessions</h2>
                <span className="dk-overview-count">{sessions.length}</span>
              </div>
            </div>
            <div className="dk-flow">
              {recentSessions.map((session) => (
                <button className="dk-flow-row" type="button" key={session.id} onClick={() => onSelectSession(session)}>
                  <span className={`dk-dot ${sessionDot(session.status)}`} aria-hidden="true" />
                  <span className="dk-flow-key">{sentence(providerLabel(providerOf(session)))}</span>
                  <span className="dk-flow-title">{session.name}</span>
                  <span className="dk-flow-meta dk-mono">{session.branch}</span>
                  <span className="dk-flow-age">{session.started ? formatAge(session.started) : ""}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="dk-section" aria-labelledby="overview-activity">
          <div className="dk-section-head">
            <div><h2 className="dk-section-title" id="overview-activity">Recent activity</h2></div>
          </div>
          {activity.length === 0 ? (
            <p className="dk-overview-empty">Activity appears here as agents and tasks move.</p>
          ) : (
            <div className="dk-activity-day">
              {activity.slice(0, 6).map((event) => (
                <div className="dk-activity-row" key={event.id}>
                  <span className="dk-activity-time dk-mono">{formatActivityTime(event.createdAt)}</span>
                  <span className="dk-dot is-quiet" aria-hidden="true" />
                  <span className="dk-activity-what">{event.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dk-section" aria-labelledby="overview-workspace">
          <div className="dk-section-head">
            <div><h2 className="dk-section-title" id="overview-workspace">Workspace</h2></div>
            <button className="dk-btn dk-btn--ghost dk-btn--sm" type="button" onClick={onOpenConnections}>
              Manage connections
            </button>
          </div>
          <dl className="dk-card dk-facts">
            <div><dt>Branch</dt><dd className="dk-mono">{project.branch}</dd></div>
            <div><dt>Open sessions</dt><dd>{sessions.length}</dd></div>
            <div><dt>Agents working</dt><dd>{runningSessions.length}</dd></div>
            <div><dt>Shared context</dt><dd>{contextEntries.length}</dd></div>
            <div><dt>Repository</dt><dd className="dk-mono" title={project.path}>{project.path}</dd></div>
            <div>
              <dt>{repositoryHost ? `${repositoryHost.label} account` : "Git account"}</dt>
              <dd>
                {repositoryHost ? (
                  <button className="dk-link" type="button" onClick={onOpenGitHub}>
                    {githubLogin ? `@${githubLogin}` : "Not connected"}
                  </button>
                ) : (
                  <span className="dk-muted">Your own Git credentials</span>
                )}
              </dd>
            </div>
            {onChangeOverseer && (() => {
              const current: PitwallProjectOverseer = overseer ?? DEFAULT_OVERSEER;
              const reviewed = tasks.filter((task) => task.pair?.reviewer === "hermes" && (task.pair.rounds?.length ?? 0) > 0);
              const sentBack = reviewed.filter((task) => task.pair?.rounds?.some((round) => round.verdict === "request_changes")).length;
              return (
                <div>
                  <dt>Hermes reviewer</dt>
                  <dd className="dk-overseer">
                    {!hermesReady ? (
                      <button className="dk-link" type="button" onClick={onOpenConnections}>Set up Hermes to review and learn this project</button>
                    ) : (
                      <>
                        <button
                          className="dk-link"
                          type="button"
                          aria-pressed={current.enabled}
                          title={current.enabled ? "Finished work goes to Hermes before it comes to you, and Hermes learns the project from it" : "Have Hermes review every finished task and learn this project"}
                          onClick={() => onChangeOverseer({ ...current, enabled: !current.enabled })}
                        >
                          {current.enabled ? "On" : "Off"}
                        </button>
                        {current.enabled && (
                          <Dropdown
                            className="dk-dropdown--chip"
                            ariaLabel="Hermes's model"
                            value={current.model}
                            options={(hermesModels.length ? hermesModels : [{ value: "auto", label: "Auto" }])}
                            onChange={(model) => onChangeOverseer({ ...current, model })}
                          />
                        )}
                        {reviewed.length > 0 && (
                          <span className="dk-muted">
                            {reviewed.length} {reviewed.length === 1 ? "review" : "reviews"} · {sentBack} sent back
                          </span>
                        )}
                      </>
                    )}
                  </dd>
                </div>
              );
            })()}
          </dl>
        </section>
      </section>
    );
  }

  if (section === "tasks") {
    const agentOptions = [...new Set(tasks.flatMap((task) => (task.assignedAgent ? [task.assignedAgent] : [])))].sort();
    /*
     * A project with a tracker gets the tracker's columns, and only those.
     *
     * Pitwall's own four were added alongside them, so a board synced from Jira
     * showed a pipeline nobody works in: two columns for "in progress" and an
     * always-empty "Review" beside the team's "Code review". The tracker is the
     * authority on what the stages are called and what they are.
     *
     * Taken from every task rather than the filtered ones, so a column does not
     * disappear while a filter is on, or when the last card is dragged out of
     * it and there is nowhere to put it back.
     */
    const trackerColumns = [...new Set(
      tasks.flatMap((item) => {
        const status = item.source?.status?.trim();
        return status ? [normaliseStatus(status)] : [];
      }),
    )];
    const board = buildBoard(
      filteredTasks,
      hasFilters ? [] : (trackerColumns.length ? trackerColumns : visibleTaskGroups.map((group) => group.label)),
    );
    const trackerSources = [...new Set(tasks.flatMap((task) => task.source?.kind === "mcp" && task.source.name ? [task.source.name] : []))];
    // With nothing imported there is nothing to re-read, so no countdown to one.
    const syncMinutes = trackerSources.length ? trackerSyncMinutes : null;
    return (
      <section
        className={`dk-page dk-board-page${selectedTasks.length ? " is-selecting" : ""}`}
        aria-label="Tasks"
        onKeyDown={(event) => { if (event.key === "Escape" && selectedTasks.length) { event.stopPropagation(); setSelectedTaskIds([]); } }}
      >
        <div className="dk-toolbar">
          <div className="dk-board-filters" role="search" aria-label="Filter tasks">
            <label className="dk-search dk-board-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
              />
            </label>
            <Dropdown
              className="dk-dropdown--chip"
              ariaLabel="Agent"
              value={agentFilter}
              placeholder="Any agent"
              options={[
                { value: "", label: "Any agent" },
                { value: "unassigned", label: "Unassigned" },
                ...agentOptions.map((agent) => ({
                  value: agent,
                  label: agent === "council" ? "Council" : sentence(providerLabel(agent)),
                })),
              ]}
              onChange={setAgentFilter}
            />
            <Dropdown
              className="dk-dropdown--chip"
              ariaLabel="Status"
              value={statusFilter}
              placeholder="Any status"
              options={[
                { value: "", label: "Any status" },
                ...(["backlog", "ready", "running", "review", "completed", "cancelled"] as const).map((status) => ({
                  value: status,
                  label: sentence(getTaskStatusLabel(status)),
                })),
              ]}
              onChange={setStatusFilter}
            />
            <button
              type="button"
              className={`dk-chip${attentionOnly ? " is-on" : ""}`}
              aria-pressed={attentionOnly}
              onClick={() => setAttentionOnly(!attentionOnly)}
            >
              Needs me
            </button>
          </div>
          <span className="dk-spacer" />
          {/* The sync status is also the way to sync now: one control, saying
              when the trackers are next read. */}
          <button
            type="button"
            className="dk-btn dk-btn--ghost dk-board-sync"
            disabled={syncingTasks}
            onClick={onSyncTasks}
            title="Check tracker now"
          >
            {syncMinutes === null ? null : <span className="dk-dot is-ready" aria-hidden="true" />}
            <span>
              {syncingTasks
                ? "Checking tracker…"
                : [
                    trackerSources.join(", "),
                    syncMinutes === null
                      ? "Check tracker"
                      : syncMinutes === 0
                        ? "Checking any moment"
                        : `Re-reads in ${syncMinutes}m`,
                  ].filter(Boolean).join(" · ")}
            </span>
            <RefreshCw size={13} className={syncingTasks ? "dk-spin" : undefined} aria-hidden="true" />
          </button>
          <button type="button" className="dk-btn" onClick={onImportTasks}>Import</button>
          <button type="button" className="dk-btn dk-btn--primary" onClick={onNewTask}>
            <Plus size={14} aria-hidden="true" />
            New task
          </button>
        </div>

        {hasFilters && !filteredTasks.length ? (
          <p className="dk-board-none">
            No tasks match. <button type="button" className="dk-link" onClick={clearFilters}>Clear filters</button>
          </p>
        ) : null}

        <div className="dk-board" style={{ "--board-columns": board.length } as CSSProperties}>
          {board.map((group) => {
            const groupedTasks = group.tasks;
            const blocked = group.name.toLowerCase() === "blocked";
            return (
              <section
                className={`dk-board-column${dropColumn === group.name ? " is-drop-target" : ""}`}
                aria-label={group.name}
                key={group.name}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dropColumn !== group.name) setDropColumn(group.name);
                }}
                onDragLeave={() => setDropColumn((current) => (current === group.name ? "" : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropColumn("");
                  const moved = tasks.find((item) => item.id === event.dataTransfer.getData("text/plain"));
                  if (moved && columnFor(moved) !== group.name) onMoveTask(moved, group.name);
                }}
              >
                <header className="dk-board-column-head">
                  <h2>{group.name}</h2>
                  <span className={blocked && groupedTasks.length > 0 ? "is-needs" : undefined}>{groupedTasks.length}</span>
                </header>
                {groupedTasks.map((task) => {
                  const owner = ownerOf(task, providerLabel);
                  const needsYou = blocked || attentionTaskIds.includes(task.id);
                  const working = task.status === "running";
                  const state = blocked
                    ? sentence(localStateLabel(task.status))
                    : needsYou
                      ? "needs you"
                      : showsLocalState(task)
                        ? localStateLabel(task.status).toLowerCase()
                        : working
                          ? "working"
                          : "";
                  const line = [owner, state].filter(Boolean).join(" · ") || "Unassigned";
                  const picked = selectedTaskIds.includes(task.id);
                  const dot = needsYou ? "is-needs" : working ? "is-working" : owner ? "is-quiet" : "";
                  return (
                    <article
                      className={`dk-board-card${task.id === activeTask?.id ? " is-current" : ""}${picked ? " is-picked" : ""}${needsYou ? " is-needs" : ""}`}
                      aria-label={task.title}
                      key={task.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDropColumn("")}
                      onClick={(event) => {
                        // Cmd (or Ctrl) picks a card out without opening it,
                        // the way a file list works. A plain click still
                        // opens the one you pointed at.
                        // While picking, a plain click picks too, as in Finder or Linear.
                        if (event.metaKey || event.ctrlKey || selectedTaskIds.length > 0) { toggleTask(task); return; }
                        onOpenTask(task);
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) onOpenTask(task); }}
                      tabIndex={0}
                    >
                      <button
                        type="button"
                        className="dk-board-pick"
                        role="checkbox"
                        aria-checked={picked}
                        aria-label={`Select ${task.title}`}
                        title={picked ? "Deselect" : "Select — then start or remove several at once"}
                        onClick={(event) => { event.stopPropagation(); toggleTask(task); }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {picked ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
                      </button>
                      <span className="dk-board-card-meta">
                        <span className="dk-mono">{task.identifier || "—"}</span>
                        {task.source?.kind === "mcp" && task.source.name ? <span>{task.source.name}</span> : null}
                      </span>
                      <span className={`dk-board-card-title${group.name.toLowerCase() === "backlog" ? " is-quiet" : ""}`}>{task.title}</span>
                      <span className={`dk-status${needsYou ? " is-needs" : ""}`}>
                        {dot ? <span className={`dk-dot ${dot}`} aria-hidden="true" /> : null}
                        {line}
                      </span>
                    </article>
                  );
                })}
                {groupedTasks.length === 0 ? <p className="dk-board-empty">No tasks</p> : null}
              </section>
            );
          })}
        </div>

        {selectedTasks.length > 0 ? (
          <div className="dk-selection-bar" role="toolbar" aria-label="Selected tasks">
            <span className="dk-selection-count">{selectedTasks.length} selected</span>
            <button
              type="button"
              className="dk-btn dk-btn--primary dk-btn--sm"
              onClick={() => { onStartTasks(selectedTasks); setSelectedTaskIds([]); }}
            >
              Start {selectedTasks.length}
            </button>
            <button
              type="button"
              className="dk-btn dk-btn--ghost dk-btn--danger dk-btn--sm"
              onClick={() => { onDeleteTasks(selectedTasks); setSelectedTaskIds([]); }}
            >
              Remove {selectedTasks.length}
            </button>
            <button type="button" className="dk-icon-btn dk-icon-btn--sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSelectedTaskIds([])}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  if (section === "schedule") {
    const composeAgent = scheduleAgent || scheduleAgents[0] || "";
    const day = splitDay(scheduleJobs, scheduleNow);
    const upNext = nextJob(scheduleJobs, scheduleNow);
    // "Tue 15 Sep" — not the locale's comma-separated default, which reorders
    // the parts.
    const at = new Date(scheduleNow);
    const dayLabel = [
      at.toLocaleDateString(undefined, { weekday: "short" }),
      at.getDate(),
      at.toLocaleDateString(undefined, { month: "short" }),
    ].join(" ").replace(/,/g, "");

    const repeatPicker = (
      days: number[],
      everyHours: number,
      onChange: (days: number[], everyHours: number) => void,
    ) => (
      <Dropdown
        className="dk-dropdown--chip dk-schedule-repeat"
        ariaLabel="How often it repeats"
        value={daysKey(days, everyHours)}
        options={DAY_PRESETS.map((preset) => ({ value: preset.key, label: preset.label }))}
        onChange={(key) => onChange(daysFromKey(key), hoursFromKey(key))}
      />
    );

    const agentPicker = (value: string, onChange: (agent: string) => void) => (
      <Dropdown
        className="dk-dropdown--chip dk-schedule-agent"
        ariaLabel="Agent for this booking"
        value={value}
        placeholder="No agent"
        options={scheduleAgents.map((agent) => ({ value: agent, label: agent }))}
        onChange={onChange}
      />
    );

    /* Start and end share one group, so a range reads as one thing:
       08:00 – 20:00. */
    const timeFields = (
      time: string,
      onTime: (value: string) => void,
      everyHours: number,
      until: string,
      onUntil: (value: string) => void,
    ) => (
      <span className="dk-schedule-when">
        <input
          className="dk-schedule-time"
          value={time}
          maxLength={5}
          onChange={(event) => onTime(event.target.value)}
          placeholder="HH:MM"
          aria-label="Time"
        />
        {everyHours > 0 ? (
          <>
            <span className="dk-faint" aria-hidden="true">–</span>
            <input
              className="dk-schedule-time"
              value={until}
              maxLength={5}
              onChange={(event) => onUntil(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="HH:MM"
              aria-label="Last hour it repeats"
            />
          </>
        ) : null}
      </span>
    );

    const beginEdit = (job: ScheduleJob) => {
      setEditingId(job.id);
      setEditError("");
      setEditTime(formatScheduleTime(job));
      setEditPrompt(job.prompt);
      setEditAgent(job.agent);
      setEditDays(job.days ?? []);
      setEditEveryHours(job.everyHours ?? 0);
      setEditUntil(job.untilMinutes
        ? `${String(Math.floor(job.untilMinutes / 60)).padStart(2, "0")}:${String(job.untilMinutes % 60).padStart(2, "0")}`
        : "");
    };

    const editRow = (job: ScheduleJob) => (
      <form
        key={job.id}
        className="dk-schedule-compose is-inline"
        onSubmit={(event) => {
          event.preventDefault();
          const times = bookingTimes(editTime, editEveryHours, editUntil);
          if ("error" in times) return setEditError(times.error);
          if (!editPrompt.trim()) return setEditError(`Say what should run at ${editTime.trim()}.`);
          onSaveScheduleJob?.({
            ...job,
            hour: times.hour,
            minute: times.minute,
            prompt: editPrompt.trim(),
            agent: editAgent,
            days: editDays,
            everyHours: editEveryHours,
            untilMinutes: times.untilMinutes,
          });
          setEditingId("");
        }}
      >
        <textarea
          rows={1}
          autoFocus
          ref={fitToContent}
          className="dk-schedule-what"
          value={editPrompt}
          onChange={(event) => { fitToContent(event.currentTarget); setEditPrompt(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditingId("");
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              (event.currentTarget.form as HTMLFormElement)?.requestSubmit();
            }
          }}
          aria-label="What should run"
        />
        <div className="dk-schedule-controls">
          {repeatPicker(editDays, editEveryHours, (d, h) => { setEditDays(d); setEditEveryHours(h); })}
          {timeFields(editTime, setEditTime, editEveryHours, editUntil, setEditUntil)}
          {agentPicker(editAgent, setEditAgent)}
          <span className="dk-spacer" />
          <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setEditingId("")}>Cancel</button>
          <button type="submit" className="dk-btn dk-btn--primary dk-btn--sm">Save</button>
        </div>
        {editError ? <p className="dk-error">{editError}</p> : null}
      </form>
    );

    const slot = (job: ScheduleJob) => {
      if (editingId === job.id) return editRow(job);
      const status = slotStatus(job, scheduleNow);
      const isNext = upNext?.id === job.id && job.enabled !== false;
      const open = selectedScheduleId === job.id;
      const done = status.box === "[x]";
      const dot = status.attention || status.tone === "amber"
        ? "is-needs"
        : status.box === "[>]"
          ? "is-working"
          : done
            ? "is-quiet"
            : isNext
              ? "is-ready"
              : "";
      const tone = status.attention || status.tone === "amber" ? " is-needs" : isNext || status.box === "[>]" ? " is-working" : "";
      return (
        <div
          key={job.id}
          role="option"
          tabIndex={0}
          aria-selected={open}
          className={`dk-slot${open ? " is-open" : ""}${status.attention ? " is-attention" : ""}${isNext ? " is-next" : ""}${done ? " is-done" : ""}${job.enabled === false ? " is-off" : ""}`}
          onClick={() => setSelectedScheduleId(open ? "" : job.id)}
          onKeyDown={(event) => {
            // Only keys aimed at the row itself. The row opens on Space, and
            // an open row contains the run's live terminal — so a space typed
            // into the agent bubbled up here, collapsed the row and took the
            // terminal with it, mid-session.
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedScheduleId(open ? "" : job.id);
            }
          }}
        >
          <div className="dk-slot-line">
            <span className="dk-slot-time dk-mono">{formatScheduleSpan(job)}</span>
            <span className="dk-slot-main">
              <span className="dk-slot-what" title={job.prompt}>{job.prompt}</span>
              <span className="dk-slot-sub">
                <span className="dk-cap">{describeRepeat(job)}</span>
                {" · "}
                <span className={`dk-slot-agent${job.agent && !scheduleAgents.includes(job.agent) ? " is-gone" : ""}`}>
                  {job.agent || "No agent"}
                </span>
              </span>
            </span>
            <span className={`dk-status dk-slot-state${tone}`}>
              <span className={`dk-dot ${dot}`} data-box={status.box} aria-hidden="true" />
              <span className="dk-cap">{job.enabled === false ? "off" : status.label}</span>
            </span>
            <button
              type="button"
              className="dk-btn dk-btn--ghost dk-btn--sm"
              onClick={(e) => { e.stopPropagation(); onRunScheduleJobNow?.(job); }}
            >
              Run now
            </button>
          </div>
          {open && renderScheduleRun ? (
            <div
              className="dk-slot-run"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {renderScheduleRun(job)}
            </div>
          ) : null}
          {status.note || open ? (
            <div
              className="dk-slot-foot"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className="dk-slot-why">{status.note ?? ""}</span>
              {open ? (
                <>
                  {/* Only when something is actually waiting on a person.
                      A booking that ran cleanly has nothing to settle. */}
                  {status.attention && onMarkScheduleRunDone ? (
                    <button
                      type="button"
                      className="dk-btn dk-btn--sm"
                      onClick={(e) => { e.stopPropagation(); onMarkScheduleRunDone(job); }}
                      title="Records this run as finished, for when you cleared what blocked it yourself"
                    >
                      Mark done
                    </button>
                  ) : null}
                  <button type="button" className="dk-btn dk-btn--sm" onClick={(e) => { e.stopPropagation(); beginEdit(job); }}>Edit</button>
                  <span className="dk-slot-agent-pick">
                    {agentPicker(job.agent, (agent) => onSaveScheduleJob?.({ ...job, agent }))}
                  </span>
                  <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={(e) => { e.stopPropagation(); onSaveScheduleJob?.({ ...job, enabled: job.enabled === false }); }}>
                    {job.enabled === false ? "Enable" : "Disable"}
                  </button>
                  <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm dk-btn--danger" onClick={(e) => { e.stopPropagation(); onDeleteScheduleJob?.(job); setSelectedScheduleId(""); }}>Delete</button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    };

    /* Now, in the time column between what is done and what is due. */
    const nowMarker = (
      <div className="dk-slot-now" key="now">
        <span className="dk-slot-time dk-mono">Now {clockTime(scheduleNow)}</span>
        <span className="dk-slot-now-rule" aria-hidden="true" />
      </div>
    );

    const compose = (
      <form
        className="dk-schedule-compose"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!onCreateScheduleJob) return;
          const error = await onCreateScheduleJob(scheduleTime, scheduleDraft, composeAgent, scheduleDays, scheduleEveryHours, scheduleUntil);
          setScheduleDraftError(error);
          if (!error) { setScheduleTime(""); setScheduleDraft(""); setScheduleDays([]); setScheduleEveryHours(0); }
        }}
      >
        {/* A growing textarea rather than one line: an instruction is often a
            paragraph, and a single-line field scrolls the start of it out of
            sight exactly when you are trying to read what you wrote. */}
        <textarea
          ref={attachScheduleInput}
          rows={1}
          className="dk-schedule-what"
          value={scheduleDraft}
          onChange={(event) => {
            fitToContent(event.currentTarget);
            setScheduleDraft(event.target.value);
            setScheduleDraftError("");
          }}
          onKeyDown={(event) => {
            // Enter writes a new line. Command-Enter books, for anyone who
            // would rather not reach for the button.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              (event.currentTarget.form as HTMLFormElement)?.requestSubmit();
            }
          }}
          placeholder={scheduleJobs.length ? "What should happen while you’re away?" : "Pick up the To Do tickets in the active sprint"}
          aria-label="What should run"
        />
        <div className="dk-schedule-controls">
          {repeatPicker(scheduleDays, scheduleEveryHours, (d, h) => { setScheduleDays(d); setScheduleEveryHours(h); })}
          {timeFields(scheduleTime, (value) => { setScheduleTime(value); setScheduleDraftError(""); }, scheduleEveryHours, scheduleUntil, setScheduleUntil)}
          {agentPicker(composeAgent, setScheduleAgent)}
          <span className="dk-spacer" />
          <button type="submit" className="dk-btn dk-btn--primary">Schedule</button>
        </div>
        {scheduleDraftError ? <p className="dk-error">{scheduleDraftError}</p> : null}
      </form>
    );

    return (
      <section className="dk-page dk-schedule" aria-label="Schedule">
        {compose}

        <section className="dk-section" aria-labelledby="schedule-title">
          <div className="dk-section-head">
            <div className="dk-overview-heading">
              <h2 className="dk-section-title" id="schedule-title">Today</h2>
              <span className="dk-faint">{dayLabel}</span>
            </div>
          </div>
          {scheduleJobs.length === 0 ? (
            <div className="dk-empty">
              <strong>Nothing is booked yet.</strong>
              <span>Pick a time, say what should happen, and it runs while you are away.</span>
            </div>
          ) : null}
          <div className="dk-schedule-list" role="listbox" aria-label="Schedule">
            {day.past.map(slot)}
            {nowMarker}
            {day.upcoming.map(slot)}
            {day.off.map(slot)}
          </div>
        </section>
      </section>
    );
  }

  if (section === "review") {
    const openTask = reviewTasks.find((task) => task.id === selectedReviewId) ?? null;

    // GitLab's are merge requests, numbered "!42"; GitHub's pull requests, "#42".
    const mergeRequests = requestNoun === "merge request";
    const reviewLabel = (state: ReturnType<typeof reviewStateFor>) =>
      state === "proposed" ? `${mergeRequests ? "MR" : "PR"} open` : sentence(REVIEW_STATE_LABEL[state]);

    const reviewItem = (task: PitwallTask) => {
      const facts = reviewFacts?.[task.worktree];
      const pr = facts?.pullRequest;
      const state = reviewFacts ? reviewStateFor(task.worktree, reviewFacts) : "working";
      const check = checksByTask[task.id];
      const selected = !selectedBranch && selectedReviewId === task.id;
      return (
        <button
          type="button"
          className={`dk-review-item${selected ? " is-current" : ""}`}
          aria-current={selected || undefined}
          key={task.id}
          onClick={() => { setSelectedBranch(""); setSelectedReviewId(task.id); }}
        >
          <span className="dk-review-item-meta">
            <span className="dk-mono">{pr?.number ? `${mergeRequests ? "!" : "#"}${pr.number}` : task.identifier || "—"}</span>
            {task.assignedAgent ? <span>{ownerOf(task, providerLabel)}</span> : null}
            <span className="dk-spacer" />
            <span>{formatAge(task.updatedAt)}</span>
          </span>
          <span className="dk-review-item-title">{task.title}</span>
          {/* Plain words in one line: the checks, what git says, the reviewer. */}
          <span className="dk-review-item-facts">
            {[
              <span key="checks" className={check && !check.ok ? "is-needs" : undefined}>
                {check ? (check.ok ? "Checks passed" : "Checks failing") : "No checks"}
              </span>,
              <span key="git" className={state === "rejected" ? "is-needs" : undefined}>{reviewFacts ? reviewLabel(state) : "…"}</span>,
              task.pair?.outcome ? (
                <span key="pair" className={task.pair.state === "approved" ? "is-approved" : task.pair.state === "open-points" ? "is-needs" : undefined} title={task.pair.summary}>
                  {task.pair.state === "approved" ? `${task.pair.reviewer === "hermes" ? "Reviewer" : pairReviewerLabel(task.pair.reviewer)} approved` : task.pair.state === "open-points" ? "Open points" : "Not reviewed"}
                </span>
              ) : null,
            ].filter(Boolean).flatMap((part, index) => (index ? [<span key={`sep-${index}`} aria-hidden="true"> · </span>, part] : [part]))}
          </span>
        </button>
      );
    };

    const detailFor = (task: PitwallTask) => {
      const check = checksByTask[task.id];
      // A closed request is history; a new one can still be opened for the branch.
      const requestState = reviewFacts?.[task.worktree]?.pullRequest?.state || "";
      const hasRequest = requestState === "open" || requestState === "merged";
      const usage = usageByTask[task.id];
      const runs = runCountByTask[task.id] ?? 0;
      return (
        <div className="dk-review-detail">
          <div className="dk-review-scroll">
            <article className="dk-review-article">
              <header className="dk-review-head">
                <p className="dk-review-meta">
                  {[
                    task.identifier ? <span className="dk-mono" key="id">{task.identifier}</span> : null,
                    task.assignedAgent ? <span key="who">{ownerOf(task, providerLabel)}</span> : null,
                    <span key="branch">branch <span className="dk-mono">{task.worktree || project.branch}</span></span>,
                    <span key="state">{reviewFacts ? reviewLabel(reviewStateFor(task.worktree, reviewFacts)) : "…"}</span>,
                  ].filter(Boolean).flatMap((part, index) => (index ? [<span key={`sep-${index}`} aria-hidden="true"> · </span>, part] : [part]))}
                </p>
                <h2 className="dk-title">{task.title}</h2>
                {/* Words, not icons. There is no "complete": git decides that. */}
                <div className="dk-review-actions">
                  {/* The agent that did the work, still there: ask it something or watch it fix. */}
                  {onOpenSession && hasSession?.(task) ? (
                    <button className="dk-btn dk-btn--sm" type="button" onClick={() => onOpenSession(task)}>Open session</button>
                  ) : null}
                  <button className="dk-btn dk-btn--sm" type="button" disabled={Boolean(busyReviewAction)} onClick={() => void runReviewAction(task, "editor")}>
                    {busyReviewAction === `${task.id}:editor` ? "Opening…" : `Open in ${editorLabel}`}
                  </button>
                  {/* Create until one exists; then the way to it. Both while
                      Pitwall cannot tell, since it could not read the host. */}
                  {onCreateTaskRequest && !hasRequest ? (
                    <button className="dk-btn dk-btn--primary dk-btn--sm" type="button" disabled={Boolean(busyReviewAction)} onClick={() => void runReviewAction(task, "create")}>
                      {busyReviewAction === `${task.id}:create` ? "Preparing…" : `Create ${requestNoun}`}
                    </button>
                  ) : null}
                  {hasRequest || !pullRequestsAvailable ? (
                    <button className="dk-btn dk-btn--sm" type="button" disabled={Boolean(busyReviewAction)} onClick={() => void runReviewAction(task, "pr")}>
                      {busyReviewAction === `${task.id}:pr` ? `Finding ${requestNoun}…` : `Open ${requestNoun}`}
                    </button>
                  ) : null}
                  {previewByTask[task.id] ? (
                    <button className="dk-btn dk-btn--sm" type="button" disabled={Boolean(busyReviewAction)} onClick={() => void runReviewAction(task, "preview")} title={previewByTask[task.id].url}>
                      {sentence(previewByTask[task.id].label)}
                    </button>
                  ) : null}
                  <button className="dk-btn dk-btn--ghost dk-btn--sm" type="button" onClick={() => onOpenTask(task)}>Task details</button>
                  {onCancelTask ? (
                    <button className="dk-btn dk-btn--ghost dk-btn--sm" type="button" onClick={() => { onCancelTask(task); setSelectedReviewId(""); }}>Cancel task</button>
                  ) : null}
                </div>
              </header>

              {task.pair?.outcome ? (
                <section className={`dk-pair-verdict is-${task.pair.state}`} aria-label="Reviewer">
                  <span className="dk-seal" aria-hidden="true">R</span>
                  <div>
                    <strong>{task.pair.outcome}</strong>
                    {task.pair.summary ? <span>{task.pair.summary}</span> : null}
                  </div>
                </section>
              ) : null}
              <p className="dk-review-text dk-muted">{taskDescriptionText(task.description, 360)}</p>

              {task.completionSummary ? (
                <section className="dk-review-block dk-review-summary" aria-labelledby="review-what">
                  <h3 id="review-what">What changed</h3>
                  <p className="dk-review-text">{taskDescriptionText(task.completionSummary.what, 180)}</p>
                  <p className="dk-review-text dk-muted">{taskDescriptionText(task.completionSummary.how, 220)}</p>
                </section>
              ) : null}

              <dl className="dk-review-facts">
                <div><dt>Runs</dt><dd>{runs}</dd></div>
                <div><dt>Related files</dt><dd>{task.relatedFiles.length}</dd></div>
                <div><dt>Worktree</dt><dd className="dk-mono">{task.worktree || project.branch}</dd></div>
                {/* What each task's sessions reported spending; unknown where
                    the CLI said nothing rather than filled in with a guess. */}
                {usage && (usage.tokens !== null || usage.costUsd !== null) ? (
                  <div title={usage.unreported ? `${usage.unreported} session(s) reported nothing` : undefined}>
                    <dt>Spent</dt>
                    <dd>
                      {usage.costUsd !== null ? `$${usage.costUsd.toFixed(2)}` : formatTokens(usage.tokens ?? 0)}
                      {usage.unreported ? ` · ${usage.unreported} not reported` : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {/* What the project's own checks said, beside the claim the
                  agent made. A typecheck is not an opinion. */}
              <section className="dk-review-block" aria-labelledby="review-checks">
                <h3 id="review-checks">Checks Pitwall ran</h3>
                <ValidationEvidence
                  result={check}
                  running={checkingTaskIds.includes(task.id)}
                  onRun={() => onRunValidation(task)}
                />
              </section>

              <section className="dk-review-block" aria-labelledby="review-files">
                <h3 id="review-files">Files</h3>
                <TaskChangeset
                  projectPath={project.path}
                  branch={task.worktree || project.branch}
                  baseBranch={project.branch}
                  requests={task.changeRequests ?? []}
                  onRequestChange={(filePath, body) => onRequestChanges(task, body, filePath)}
                />
              </section>
            </article>
          </div>
          <div className="dk-review-bar">
            <ChangeRequestBox task={task} onSubmit={onRequestChanges} />
            {/* Failing checks still allow it, through the override that says why. */}
            <button
              type="button"
              className={`dk-btn dk-btn--lg${check && !check.ok ? "" : " dk-btn--primary"}`}
              onClick={() => onCompleteTask(task)}
              title={shortcutLabel("Approve  ⌘↵")}
            >
              {check && !check.ok ? "Approve anyway…" : "Approve"}
            </button>
          </div>
        </div>
      );
    };

    return (
      <section className="dk-review" aria-label="Review">
        <div className="dk-review-side">
          <div className="dk-review-side-head">
            <h2 className="dk-review-caption">Finished by agents, waiting on you</h2>
            <span className="dk-faint">{reviewTasks.length}</span>
            {onRefreshReview ? (
              <button
                type="button"
                className="dk-icon-btn dk-icon-btn--sm"
                disabled={reviewRefreshing}
                onClick={onRefreshReview}
                aria-label={reviewRefreshing ? "Reading" : "Refresh"}
                title={reviewRefreshing ? "Reading the repository…" : "Read the repository again"}
              >
                <RefreshCw size={13} className={reviewRefreshing ? "dk-spin" : undefined} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {/* Two different failures, said apart. Blaming gh for a directory that
              is not a repository sends people to fix the wrong thing. */}
          {reviewError ? (
            <p className="dk-review-notice">
              {reviewError === "Not a git worktree"
                ? `${project.path} is not a git repository, so there is nothing to review yet. Run git init there, or open a different folder.`
                : reviewError}
            </p>
          ) : !pullRequestsAvailable ? (
            <p className="dk-review-notice">
              {/* What gh actually said: "Could not resolve to a Repository"
                  means the signed-in account cannot see it, which is a
                  different job from installing gh. */}
              No {requestNoun} state{pullRequestError ? ` — ${pullRequestError.replace(/[.\s]+$/, "")}` : ""}.
              {" "}Rows still clear when their branch merges into {project.branch} or is deleted.
              {repositoryHost ? (
                <>
                  {" "}
                  <button type="button" className="dk-link" onClick={() => onOpenGitHub()}>
                    Connect an account for this project
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          <div className="dk-review-list" aria-label="Waiting for review">
            {reviewTasks.map(reviewItem)}
          </div>
          {reviewTasks.length === 0 ? (
            <div className="dk-empty">
              <strong>Nothing to review</strong>
              <span>Work appears here while its branch is unmerged, and leaves when the repository says it is done.</span>
              <button type="button" className="dk-link" onClick={onOpenWork}>Open active work</button>
            </div>
          ) : null}

          {/* Branches are context for that work rather than the work itself.
              One opens into the same detail pane a row does. */}
          <BranchTree
            projectPath={project.path}
            baseBranch={project.branch}
            sessionBranches={sessionBranches}
            onOpenBranch={(branch) => { setSelectedBranch(branch.name); onOpenBranch?.(branch); }}
          />
        </div>

        <div className="dk-review-main">
          {selectedBranch ? (
            <div className="dk-review-detail">
              <div className="dk-review-scroll">
                <div className="dk-review-article">
                  <header className="dk-review-head is-row">
                    <h2 className="dk-review-branch dk-mono">{selectedBranch}</h2>
                    <button type="button" className="dk-icon-btn" aria-label="Close branch" onClick={() => setSelectedBranch("")}>
                      <X size={16} />
                    </button>
                  </header>
                  <BranchChanges projectPath={project.path} branch={selectedBranch} trunk={project.branch} />
                </div>
              </div>
            </div>
          ) : openTask ? (
            detailFor(openTask)
          ) : (
            <div className="dk-empty dk-review-placeholder">
              <strong>{reviewTasks.length ? "Pick something to review" : "All caught up"}</strong>
              <span>
                {reviewTasks.length
                  ? "Its summary, the checks Pitwall ran and the changed files open here."
                  : "Finished work lands here with its checks and changes."}
              </span>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (section === "context") {
    return (
      <ProjectKnowledgePanel projectPath={project.path} refreshKey={knowledgeRefresh} manualContext={
        <section className="dk-section" aria-labelledby="context-title">
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id="context-title">Notes you wrote</h2>
              <p className="dk-section-desc">Picked notes go with every new session. Private notes stay here; restricted notes go only to their agents.</p>
            </div>
            <button className="dk-btn" type="button" onClick={onNewContext}><Plus size={14} />New note</button>
          </div>
          {contextEntries.length === 0 ? (
            <div className="dk-card dk-empty">
              <strong>No notes yet</strong>
              <span>Add the project facts an agent should not have to rediscover.</span>
            </div>
          ) : (
            <div className="dk-list dk-notes">
              {contextEntries.map((entry) => {
                const selected = selectedContextIds.includes(entry.id);
                return (
                  <label className={`dk-list-row dk-note${selected ? " is-on" : ""}`} key={entry.id}>
                    <input type="checkbox" checked={selected} onChange={(event) => onToggleContext(entry.id, event.target.checked)} />
                    <span className="dk-row-main">
                      <span className="dk-note-title">{entry.title}</span>
                      <span className="dk-note-body">{entry.content}</span>
                    </span>
                    <span className="dk-badge">
                      {entry.visibility === "private"
                        ? "Private"
                        : entry.visibility === "selected-agents"
                          ? entry.providerIds.length ? entry.providerIds.map((id) => sentence(providerLabel(id))).join(", ") + " only" : "Selected agents"
                          : "All agents"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      } />
    );
  }

  // Grouped by the day it happened, newest first, so "what changed since
  // yesterday" is a glance rather than a read.
  const days: Array<{ label: string; events: PitwallActivityEvent[] }> = [];
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  for (const event of activity) {
    const at = new Date(event.createdAt);
    const label = Number.isNaN(at.getTime())
      ? "Earlier"
      : at.toDateString() === today.toDateString()
        ? "Today"
        : at.toDateString() === yesterday.toDateString()
          ? "Yesterday"
          : at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
    const last = days.at(-1);
    if (last?.label === label) last.events.push(event);
    else days.push({ label, events: [event] });
  }
  const identifierOf = (taskId?: string) => (taskId ? tasks.find((task) => task.id === taskId)?.identifier ?? "" : "");
  const activityDot = (type: PitwallActivityEvent["type"]) =>
    type === "task-completed" || type === "handoff-created"
      ? "is-ready"
      : type === "task-started" || type === "session-started" || type === "council-started" || type === "compare-started"
        ? "is-working"
        : "is-quiet";

  return (
    <section className="dk-page dk-activity" aria-label="Activity">
      {days.map((group) => (
        <section className="dk-activity-day" key={group.label} aria-label={group.label}>
          <h2 className="dk-activity-heading">{group.label}</h2>
          {group.events.map((event) => (
            <div className="dk-activity-row" key={event.id}>
              <span className="dk-activity-time dk-mono">{formatActivityTime(event.createdAt)}</span>
              <span className={`dk-dot ${activityDot(event.type)}`} aria-hidden="true" title={sentence(event.type.replace(/-/g, " "))} />
              <span className="dk-activity-what">{event.message}</span>
              <span className="dk-activity-ref dk-mono">{identifierOf(event.taskId)}</span>
            </div>
          ))}
        </section>
      ))}
      {activity.length === 0 ? (
        <div className="dk-empty">
          <strong>No project activity</strong>
          <span>Pitwall records tasks, runs, handoffs and system events here as they happen.</span>
        </div>
      ) : null}
    </section>
  );
}
