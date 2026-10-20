import { Trash2, X } from "lucide-react";
import type { AgentSession } from "../data";
import { useModalFocus } from "../hooks/useModalFocus";

export function DeleteSessionModal({
  session,
  deleting,
  onCancel,
  onConfirm,
}: {
  session: AgentSession | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(Boolean(session), () => { if (!deleting) onCancel(); });
  if (!session) return null;

  return (
    <div className="dk-backdrop" onClick={() => !deleting && onCancel()}>
      <div ref={dialogRef} className="dk-dialog dk-dialog--narrow" role="alertdialog" aria-modal="true" aria-label="Delete session" onClick={(event) => event.stopPropagation()}>
        <header className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Remove this session from Pitwall?</h2>
            <p className="dk-dialog-desc">
              Its terminal and Pitwall session history will be removed. The Git branch, worktree, and files remain on disk.
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onCancel} disabled={deleting} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="dk-dialog-body">
          <div className="dk-list">
            <div className="dk-list-row">
              <span className="dk-row-main">
                <span className="dk-row-title">{session.name}</span>
                {session.branch ? <span className="dk-row-sub dk-mono">{session.branch}</span> : null}
              </span>
            </div>
          </div>
        </div>

        <footer className="dk-dialog-footer">
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button type="button" className="dk-btn dk-btn--danger dk-btn--primary" onClick={onConfirm} disabled={deleting}>
            <Trash2 size={14} />
            {deleting ? "Deleting…" : "Delete session"}
          </button>
        </footer>
      </div>
    </div>
  );
}
