import { Markdown } from "./Markdown";
import { isScheduledRunTask } from "../domain/schedule";
import { GitBranch } from "lucide-react";
import type { AgentSession, Project } from "../data";
import type { PitwallTask } from "../domain/types";
import { getTaskStatusLabel } from "../lib/format";
import { roleLabel, roleStateLabel, rolesOnTask, type RoleRun } from "../lib/taskRoles";
import { mcpTaskSourceLabel } from "../lib/taskImport";
import { shortcutLabel } from "../lib/shortcutLabel";

const runDot: Record<AgentSession["status"], string> = {
  starting: "is-working",
  running: "is-working",
  waiting: "is-needs",
  completed: "is-ready",
  failed: "is-failed",
  disconnected: "is-failed",
};

const statusBadge: Partial<Record<PitwallTask["status"], string>> = {
  running: "dk-badge--green",
  review: "dk-badge--amber",
  completed: "dk-badge--accent",
};

const toneStatus: Record<string, string> = { failed: "is-failed", waiting: "is-needs", working: "is-working" };
const toneDot: Record<string, string> = { failed: "is-failed", waiting: "is-needs", working: "is-working", done: "is-ready" };

const INSPECTOR_CHANGES = 6;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const runStateLabel: Record<AgentSession["status"], string> = {
  starting: "Starting agent",
  running: "Working",
  waiting: "Waiting for input",
  completed: "Ready to inspect",
  failed: "Needs attention",
  disconnected: "Disconnected",
};


interface WorkspaceInspectorProps {
  project: Project;
  activeTask?: PitwallTask;
  selectedSession?: AgentSession;
  assignedAgentLabel: string;
  runCount: number;
  contextCount: number;
  /** Every run on the current task, so the roles working it can be shown. */
  taskRuns: RoleRun[];
  /** What the selected run's agent has changed so far, live. */
  liveChanges?: PitwallLiveChanges | null;
  onOpenChanges?: (filePath?: string) => void;
  /** The tail of the selected run's terminal, for the preview. */
  /** True when the agent has asked something and is waiting for an answer. */
  needsInput?: boolean;
  /** Which screen it sits beside; each owns a different set of actions. */
  section: "work" | "review";
  onOpenWork: () => void;
  onHandoff: () => void;
  onCouncil: () => void;
  onCompare: () => void;
  onReview: () => void;
  onComplete: () => void;
}

export function WorkspaceInspector({
  project,
  activeTask,
  selectedSession,
  assignedAgentLabel,
  runCount,
  contextCount,
  taskRuns,
  liveChanges,
  onOpenChanges,
  needsInput = false,
  section,
  onOpenWork,
  onHandoff,
  onCouncil,
  onCompare,
  onReview,
  onComplete,
}: WorkspaceInspectorProps) {
  const waiting = needsInput || selectedSession?.status === "waiting";

  /**
   * What the agent is doing, in the words somebody would use.
   *
   * Four answers, and the one that matters is "waiting on you" — a session
   * that has stopped for an approval looks identical to a working one if all
   * you have is scrollback, and it will sit there until somebody notices.
   */
  const agentState = (() => {
    const status = selectedSession?.status;
    if (status === "failed") {
      return { tone: "failed", label: "Stopped", note: "It ended with an error. Open the run to see what it said." };
    }
    if (status === "completed") {
      return { tone: "done", label: "Finished", note: "It has stopped and left its work behind." };
    }
    if (waiting) {
      return { tone: "waiting", label: "Waiting on you", note: "It has asked something and will not go on until it is answered." };
    }
    if (status === "running") {
      return { tone: "working", label: "Working", note: "Running now. Nothing is needed from you." };
    }
    if (status === "starting") return { tone: "working", label: "Starting", note: "The agent is starting. Its output will appear in the run." };
    if (status === "disconnected") return { tone: "failed", label: "Disconnected", note: "The agent is no longer connected. Open the run to reconnect." };
    return { tone: "idle", label: "Idle", note: "Started, and not doing anything at the moment." };
  })();

  return (
    <aside className="inspector dk-inspector" aria-label="Task details">
      <header className="dk-inspector-head">
        <div className="dk-inspector-kicker">
          <span>{project.name}</span>
          {activeTask ? (
            <span className={`dk-badge ${statusBadge[activeTask.status] ?? ""}`}>{sentence(getTaskStatusLabel(activeTask.status))}</span>
          ) : null}
        </div>
        <h2 className="dk-inspector-title">{activeTask?.title ?? "No task selected"}</h2>
        {activeTask ? (
          // Its own structure, clamped: a ticket's steps and bullets read as steps and bullets.
          <div className="dk-inspector-desc dk-inspector-md"><Markdown source={activeTask.description} /></div>
        ) : (
          <p className="dk-inspector-desc">{shortcutLabel("Nothing selected. Pick a task from the board — or press ⌘K and type \"new task\".")}</p>
        )}
      </header>

      <div className="dk-inspector-body">
        {activeTask ? (
          <section className="dk-section">
            <h3 className="dk-section-title">Details</h3>
            <dl className="dk-inspector-facts">
              <dt>Task</dt>
              <dd><code className="dk-mono">{activeTask.identifier || activeTask.id}</code></dd>
              <dt>Owner</dt>
              <dd>{assignedAgentLabel || "Unassigned"}</dd>
              <dt>Source</dt>
              <dd>{activeTask.source?.kind === "mcp" ? `${mcpTaskSourceLabel(activeTask.source.name || "MCP")} · ${activeTask.source.provider || "Claude"}` : isScheduledRunTask(activeTask) ? "Scheduled run" : "Local task"}</dd>
              <dt>Worktree</dt>
              <dd className="dk-inspector-branch"><GitBranch size={12} aria-hidden="true" /><span className="dk-mono">{activeTask.worktree || project.branch}</span></dd>
            </dl>
          </section>
        ) : null}

        {activeTask && taskRuns.length > 0 ? (
          <section className="dk-section" aria-label="Roles on this task">
            <h3 className="dk-section-title">Roles</h3>
            <div className="dk-list">
              {rolesOnTask(taskRuns).map((run) => (
                <div key={run.role} className="dk-list-row dk-inspector-row">
                  <span className={`dk-dot ${runDot[run.status]}`} aria-hidden="true" />
                  <span className="dk-row-main">
                    <span className="dk-row-title">{roleLabel(run.role)}</span>
                  </span>
                  <span className="dk-status">{sentence(roleStateLabel(run))}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="dk-section">
          <div className="dk-section-head">
            <div>
              <h3 className="dk-section-title">Runs</h3>
            </div>
            <span className="dk-faint">{runCount} run{runCount === 1 ? "" : "s"}</span>
          </div>
          {selectedSession?.id ? (
            <div className="dk-list">
              <div className="dk-list-row dk-inspector-row">
                <span className={`dk-dot ${runDot[selectedSession.status]}`} aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{selectedSession.name}</span>
                  <span className="dk-row-sub">{selectedSession.agent} · {selectedSession.model}</span>
                </span>
                <span className="dk-status">{runStateLabel[selectedSession.status]}</span>
              </div>
            </div>
          ) : (
            <p className="dk-section-desc">No run is selected. Start the task with one agent, compare independent attempts, or convene a council.</p>
          )}
          <p className="dk-hint">
            {project.openSessions} open session{project.openSessions === 1 ? "" : "s"} · {contextCount} context item{contextCount === 1 ? "" : "s"} selected
          </p>
        </section>

        {liveChanges?.ok && liveChanges.files.length > 0 ? (
          <section className="dk-section" aria-label="Changes so far">
            <div className="dk-section-head">
              <h3 className="dk-section-title">Changes</h3>
              <span className="dk-diffstat">
                <span className="dk-add">+{liveChanges.additions}</span>
                <span className="dk-del">−{liveChanges.deletions}</span>
              </span>
            </div>
            <ul className="dk-inspector-changes">
              {liveChanges.files.slice(0, INSPECTOR_CHANGES).map((file) => (
                <li key={file.path}>
                  <button type="button" className="dk-inspector-change" title={file.path} onClick={() => onOpenChanges?.(file.path)}>
                    <span className="dk-mono">{file.path.split("/").pop()}</span>
                    <span className="dk-diffstat">
                      {file.additions ? <span className="dk-add">+{file.additions}</span> : null}
                      {file.deletions ? <span className="dk-del">−{file.deletions}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="dk-link" onClick={() => onOpenChanges?.()}>
              {liveChanges.files.length > INSPECTOR_CHANGES ? `All ${liveChanges.files.length} files` : "Review changes"}
            </button>
          </section>
        ) : null}

        {selectedSession ? (
          <section className="dk-section" aria-label="Agent status">
            <h3 className="dk-section-title">Agent</h3>
            {/* What the session is doing, not what its terminal is drawing.
                This used to show the last few lines of output, which for an
                agent CLI is a redrawing interface — spinners, cursor moves and
                colour codes — and read as fragments of nothing. Six lines of a
                TUI cannot say "waiting on you"; a status can. */}
            <div className="dk-inspector-agent">
              <span className={`dk-status ${toneStatus[agentState.tone] ?? ""}`}>
                <span className={`dk-dot ${toneDot[agentState.tone] ?? ""}`} aria-hidden="true" />
                {agentState.label}
              </span>
              <span className="dk-faint">{selectedSession.agent}</span>
            </div>
            <p className="dk-section-desc">{agentState.note}</p>
            {section === "review" ? (
              <button type="button" className="dk-btn dk-btn--sm dk-inspector-open" onClick={onOpenWork}>Open run</button>
            ) : null}
          </section>
        ) : null}
      </div>

      {/* The primary action and "new session" live in the main area; this
          column only holds what has no other home on the screen. */}
      <footer className="dk-inspector-actions" aria-label="Task and run actions">
        {section === "work" ? (
          <details className="dk-inspector-more" onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.currentTarget.removeAttribute("open");
            event.currentTarget.querySelector("summary")?.focus();
          }}>
            <summary className="dk-btn">More actions</summary>
            <div className="dk-popover" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")?.removeAttribute("open"); }}>
              {activeTask ? <button type="button" className="dk-menu-item" onClick={onHandoff}>Hand off</button> : null}
              <button type="button" className="dk-menu-item" onClick={onCouncil}>Council</button>
              <button type="button" className="dk-menu-item" onClick={onCompare}>Compare</button>
            </div>
          </details>
        ) : null}
        {activeTask && activeTask.status !== "completed" ? (
          activeTask.status === "review" ? (
            <button className="dk-btn dk-btn--primary dk-inspector-primary" type="button" onClick={onComplete}>Approve</button>
          ) : section === "work" ? (
            <button className="dk-btn dk-btn--primary dk-inspector-primary" type="button" onClick={onReview}>Send to review</button>
          ) : null
        ) : null}
      </footer>
    </aside>
  );
}
