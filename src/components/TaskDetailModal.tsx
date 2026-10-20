import { ExternalLink, Play, TerminalSquare, X } from "lucide-react";
import type { PitwallTask } from "../domain/types";
import { getTaskStatusLabel } from "../lib/format";
import { useModalFocus } from "../hooks/useModalFocus";
import { TaskDescription } from "./TaskDescription";

export function TaskDetailModal({
  task,
  runCount,
  providerLabel,
  onClose,
  onOpenWork,
  onStart,
}: {
  task: PitwallTask | null;
  runCount: number;
  providerLabel: string;
  onClose: () => void;
  onOpenWork: () => void;
  onStart: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>(Boolean(task), onClose);
  if (!task) return null;
  const hasWork = runCount > 0;
  const finished = task.status === "completed" || task.status === "cancelled";
  const completionSummary = task.completionSummary ?? (
    task.status === "review" || task.status === "completed"
      ? {
          what: `Work for ${task.identifier || task.title} reached ${task.status === "review" ? "review" : "completion"}.`,
          how: "This task predates structured agent handoffs. Use its saved session transcript and changed components as the implementation record.",
          components: task.relatedFiles,
          source: "derived" as const,
          reportedAt: task.updatedAt,
        }
      : null
  );
  const status = getTaskStatusLabel(task.status);
  const fromTracker = task.source?.kind === "mcp" ? task.source : null;

  return (
    <div className="dk-backdrop dk-sheet-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="dk-dialog dk-sheet dk-task-sheet" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onClick={(event) => event.stopPropagation()}>
        <header className="dk-task-sheet-bar">
          {task.identifier ? <span className="dk-mono">{task.identifier}</span> : null}
          {fromTracker?.name ? <span>· {fromTracker.name}</span> : null}
          <span className="dk-spacer" />
          {fromTracker?.url ? (
            <button className="dk-btn dk-btn--ghost dk-btn--sm" type="button" onClick={() => void window.pitwall?.openExternalUrl(fromTracker.url!)}>
              Open in {fromTracker.name || "tracker"}
              <ExternalLink size={13} aria-hidden="true" />
            </button>
          ) : null}
          <button className="dk-icon-btn" type="button" onClick={onClose} aria-label="Close task detail"><X size={16} /></button>
        </header>

        <div className="dk-task-sheet-body">
          <h2 className="dk-title" id="task-detail-title">{task.title}</h2>

          <dl className="dk-task-facts">
            <dt>Status</dt>
            <dd>
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {fromTracker?.status ? <span className="dk-faint"> · {fromTracker.status} in {fromTracker.name || "the tracker"}</span> : null}
            </dd>
            <dt>Priority</dt>
            <dd>{task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</dd>
            <dt>Assigned to</dt>
            <dd>{providerLabel || "Unassigned"}</dd>
            <dt>Branch</dt>
            <dd>
              <span className="dk-mono">{task.worktree || task.identifier || "Not created"}</span>
              {hasWork ? null : <span className="dk-faint"> · created when work starts</span>}
            </dd>
            <dt>Sessions</dt>
            <dd>{runCount}</dd>
            <dt>Updated</dt>
            <dd>{new Date(task.updatedAt).toLocaleString()}</dd>
          </dl>

          <section className="dk-task-sheet-section" aria-labelledby="task-description-heading">
            <h3 id="task-description-heading">Description</h3>
            <TaskDescription value={task.description} />
          </section>

          {completionSummary ? (
            <section className="dk-task-sheet-section" aria-labelledby="task-completion-heading">
              <h3 id="task-completion-heading">Completion summary</h3>
              <p className="dk-hint">
                {completionSummary.source === "agent" ? "Agent-reported handoff" : "Derived from task evidence"} · {new Date(completionSummary.reportedAt).toLocaleString()}
              </p>
              <div className="dk-task-summary">
                <strong>What was done</strong>
                <p>{completionSummary.what}</p>
              </div>
              <div className="dk-task-summary">
                <strong>How it was done</strong>
                <p>{completionSummary.how}</p>
              </div>
              <div className="dk-task-summary">
                <strong>Affected components</strong>
                {completionSummary.components.length > 0
                  ? <div className="dk-task-files">{completionSummary.components.map((component) => <code className="dk-mono" key={component}>{component}</code>)}</div>
                  : <p className="dk-muted">No changed component list was captured. Inspect the task worktree for the current diff.</p>}
              </div>
            </section>
          ) : null}

          {task.relatedFiles.length > 0 ? (
            <section className="dk-task-sheet-section" aria-labelledby="task-files-heading">
              <h3 id="task-files-heading">Related files</h3>
              <div className="dk-task-files">{task.relatedFiles.map((file) => <code className="dk-mono" key={file}>{file}</code>)}</div>
            </section>
          ) : null}
        </div>

        <div className="dk-dialog-footer">
          <button className="dk-btn dk-btn--ghost" type="button" onClick={onClose}>Close</button>
          {!finished ? (
            <button className="dk-btn dk-btn--primary" type="button" onClick={hasWork ? onOpenWork : onStart}>
              {hasWork ? <TerminalSquare size={14} /> : <Play size={14} />}
              {hasWork ? "Open session" : "Start working"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
