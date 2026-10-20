import { Trash2, X } from "lucide-react";
import type { PitwallTask } from "../domain/types";
import { useModalFocus } from "../hooks/useModalFocus";

export function DeleteTaskModal({
  task,
  sessionCount,
  councilCount,
  queued = 0,
  deleting,
  onCancel,
  onConfirm,
}: {
  task: PitwallTask | null;
  sessionCount: number;
  councilCount: number;
  /** Further selected tasks that each get their own confirmation after this one. */
  queued?: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(Boolean(task), () => { if (!deleting) onCancel(); });
  if (!task) return null;

  return (
    <div className="dk-backdrop" onClick={() => !deleting && onCancel()}>
      <div ref={dialogRef} className="dk-dialog dk-dialog--narrow" role="alertdialog" aria-modal="true" aria-label="Delete task" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Remove this task from Pitwall?</h2>
          </div>
          <button className="dk-icon-btn" type="button" onClick={onCancel} disabled={deleting} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-card dk-delete-summary">
            <span className={`dk-dot ${task.status === "running" ? "is-working" : "is-quiet"}`} aria-hidden="true" />
            <span className="dk-row-main">
              <span className="dk-row-title">{task.title}</span>
              <span className="dk-row-sub dk-mono">{task.identifier ?? taskBranchName(task)}</span>
            </span>
          </div>

          <p className="dk-dialog-text">
            The task, {sessionCount} related {sessionCount === 1 ? "session" : "sessions"}, and {councilCount} Council {councilCount === 1 ? "run" : "runs"} will be removed. Git branches, worktrees, and files remain on disk.
            {queued > 0 ? ` ${queued} more selected ${queued === 1 ? "task follows" : "tasks follow"}.` : null}
          </p>
        </div>

        <div className="dk-dialog-footer">
          <button className="dk-btn dk-btn--ghost" type="button" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="dk-btn dk-btn--primary dk-btn--danger" type="button" onClick={onConfirm} disabled={deleting}>
            <Trash2 size={14} />
            {deleting ? "Deleting…" : "Delete task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function taskBranchName(task: PitwallTask) {
  return task.worktree || "No branch assigned";
}
