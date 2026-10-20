import { Trash2, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

export function DeleteCouncilModal({
  name,
  sessionCount,
  deleting,
  onCancel,
  onConfirm,
}: {
  name: string | null;
  sessionCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(Boolean(name), () => { if (!deleting) onCancel(); });
  if (!name) return null;

  return (
    <div className="dk-backdrop" onClick={() => !deleting && onCancel()}>
      <div
        ref={dialogRef}
        className="dk-dialog dk-dialog--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-label="Delete Council run"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Remove this Council from Pitwall?</h2>
            <p className="dk-dialog-desc">
              All agent terminals and Council history for this run will be removed. Git branches, worktrees, and files remain on disk.
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onCancel} disabled={deleting} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-list">
            <div className="dk-list-row">
              <span className="dk-dot is-ready" aria-hidden="true" />
              <div className="dk-row-main">
                <strong className="dk-row-title">{name}</strong>
                <small className="dk-row-sub">{sessionCount} agent {sessionCount === 1 ? "session" : "sessions"}</small>
              </div>
            </div>
          </div>
        </div>

        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button type="button" className="dk-btn dk-btn--danger dk-btn--primary" onClick={onConfirm} disabled={deleting}>
            <Trash2 size={15} />
            {deleting ? "Deleting…" : "Delete Council"}
          </button>
        </div>
      </div>
    </div>
  );
}
