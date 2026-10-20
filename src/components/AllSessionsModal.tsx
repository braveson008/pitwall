import { useModalFocus } from "../hooks/useModalFocus";
import { Trash2, X } from "lucide-react";
import type { AgentSession } from "../data";

export interface SessionGroup {
  label: string;
  sessions: AgentSession[];
}

const statusDot: Partial<Record<AgentSession["status"], string>> = {
  running: "is-working",
  starting: "is-working",
  waiting: "is-needs",
  failed: "is-failed",
  disconnected: "is-failed",
  completed: "is-ready",
};

const statusLabel = (status: AgentSession["status"]) => status.charAt(0).toUpperCase() + status.slice(1);

/**
 * A directory of every open session, grouped (regular / council). Handy when the
 * chip strip overflows — pick any session here and it opens its terminal.
 */
export function AllSessionsModal({
  open,
  groups,
  selectedId,
  onOpen,
  onDelete,
  onClose,
}: {
  open: boolean;
  groups: SessionGroup[];
  selectedId: string;
  onOpen: (session: AgentSession) => void;
  onDelete: (session: AgentSession) => void;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  const total = groups.reduce((sum, group) => sum + group.sessions.length, 0);

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-label="All sessions" onClick={(event) => event.stopPropagation()}>
        <header className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">All sessions ({total})</h2>
            <p className="dk-dialog-desc">Open one to bring up its terminal.</p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="dk-dialog-body">
          {groups
            .filter((group) => group.sessions.length > 0)
            .map((group) => (
              <section className="dk-section" key={group.label}>
                <h3 className="dk-section-title">{group.label}</h3>
                <div className="dk-list">
                  {group.sessions.map((session) => (
                    <div key={session.id} className={`dk-list-row dk-session-row${session.id === selectedId ? " is-current" : ""}`}>
                      <button
                        type="button"
                        className="dk-session-row-open"
                        aria-current={session.id === selectedId ? "true" : undefined}
                        onClick={() => onOpen(session)}
                      >
                        <span className={`dk-dot ${statusDot[session.status] ?? ""}`} aria-hidden="true" />
                        <span className="dk-row-main">
                          <span className="dk-row-title">{session.name}</span>
                          <span className="dk-row-sub">
                            {session.agent} · {session.model}
                          </span>
                        </span>
                        <span className="dk-status">{statusLabel(session.status)}</span>
                      </button>
                      <button
                        type="button"
                        className="dk-icon-btn dk-icon-btn--sm"
                        onClick={() => onDelete(session)}
                        aria-label={`Delete ${session.name}`}
                        title="Delete session"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
