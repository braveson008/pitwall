import { useState } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The worktrees finished work could not remove, and why.
 *
 * Only ones no session is running in. A worktree with uncommitted changes is
 * not offered for removal at all: git refuses without --force, and forcing is
 * how work gets lost. One with commits no remote has is removed after a
 * second click — its branch keeps those commits.
 */
export function UnfinishedWorktreesModal({
  open,
  worktrees,
  error,
  busyPath,
  onOpen,
  onRemove,
  onClose,
}: {
  open: boolean;
  worktrees: WorktreeAudit[] | null;
  error: string;
  busyPath: string;
  onOpen: (worktree: WorktreeAudit) => void;
  onRemove: (worktree: WorktreeAudit) => void;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  const [confirming, setConfirming] = useState("");
  if (!open) return null;
  const idle = (worktrees ?? []).filter((worktree) => !worktree.live);

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog dk-dialog--wide" role="dialog" aria-modal="true" aria-label="Unfinished worktrees" onClick={(event) => event.stopPropagation()}>
        <header className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Unfinished worktrees</h2>
            <p className="dk-dialog-desc">
              Worktrees finished work could not remove. One with uncommitted changes is never offered for removal.
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="dk-dialog-body">
          {error ? <p className="dk-error">{error}</p> : null}
          {!worktrees && !error ? <p className="dk-hint">Reading worktrees…</p> : null}
          {worktrees && !idle.length ? (
            <div className="dk-empty">
              <strong>None</strong>
              Every finished worktree was clean and pushed.
            </div>
          ) : null}

          {idle.length ? (
            <ul className="dk-list dk-worktree-list">
              {idle.map((worktree) => {
                const busy = busyPath === worktree.path;
                const asking = confirming === worktree.path;
                return (
                  <li className="dk-list-row" key={worktree.path}>
                    <div className="dk-row-main">
                      <div className="dk-worktree-line">
                        <span className="dk-row-title dk-mono">{worktree.branch || "detached"}</span>
                        {worktree.dirty ? <span className="dk-badge dk-badge--amber">{plural(worktree.dirty, "uncommitted file")}</span> : null}
                        {worktree.unpushed ? <span className="dk-badge dk-badge--amber">{plural(worktree.unpushed, "unpushed commit")}</span> : null}
                        {!worktree.dirty && !worktree.unpushed && !worktree.error ? <span className="dk-badge">Clean</span> : null}
                      </div>
                      <span className={`dk-row-sub${asking ? " dk-worktree-ask" : ""}`} title={worktree.path}>
                        {asking
                          ? worktree.unpushed
                            ? `${plural(worktree.unpushed, "commit")} stay on ${worktree.branch || "no branch"}, and on no remote`
                            : "git could not say whether this is safe"
                          : worktree.error || worktree.path}
                      </span>
                    </div>
                    <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => onOpen(worktree)}>Open</button>
                    {worktree.dirty ? null : asking ? (
                      <>
                        <button type="button" className="dk-btn dk-btn--sm" onClick={() => setConfirming("")}>Keep</button>
                        <button type="button" className="dk-btn dk-btn--danger dk-btn--primary dk-btn--sm" disabled={busy} onClick={() => { setConfirming(""); onRemove(worktree); }}>
                          Remove anyway
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="dk-btn dk-btn--danger dk-btn--sm"
                        disabled={busy}
                        onClick={() => (worktree.unpushed || worktree.error ? setConfirming(worktree.path) : onRemove(worktree))}
                      >
                        {busy ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
