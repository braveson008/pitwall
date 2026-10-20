import { Boxes, ChevronRight, GitBranch, Plus, Terminal, X } from "lucide-react";
import type { AgentSession } from "../data";
import type { BraveliTask } from "../domain/types";
import { useModalFocus } from "../hooks/useModalFocus";

export type TaskStartDestination = "council" | "staged" | "new-session" | `session:${string}`;

export function TaskStartModal({
  open,
  task,
  sessions,
  starting,
  onClose,
  onStart,
}: {
  open: boolean;
  task?: BraveliTask;
  sessions: AgentSession[];
  starting: boolean;
  onClose: () => void;
  onStart: (destination: TaskStartDestination) => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(open && Boolean(task), onClose);
  if (!open || !task) return null;

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-label="Start task" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Choose one destination</h2>
            <p className="dk-dialog-desc"><strong>{task.title}</strong> will be sent only to the destination you choose.</p>
          </div>
          <button className="dk-icon-btn" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-list">
            <button className="dk-list-row" type="button" disabled={starting} onClick={() => onStart("council")}>
              <Boxes size={16} className="dk-faint" aria-hidden="true" />
              <span className="dk-row-main">
                <span className="dk-row-title">Council pipeline</span>
                <span className="dk-row-sub">Choose Architect, Implementer, QA, and the remaining stages</span>
              </span>
              <ChevronRight size={14} className="dk-faint" aria-hidden="true" />
            </button>

            {/* The council puts every member in one thread and lets a conductor
                route between them. This is the other shape: one stage at a time,
                each told only what it needs, and a review that never sees how
                the implementation went. */}
            <button className="dk-list-row" type="button" disabled={starting} onClick={() => onStart("staged")}>
              <GitBranch size={16} className="dk-faint" aria-hidden="true" />
              <span className="dk-row-main">
                <span className="dk-row-title">Staged run</span>
                <span className="dk-row-sub">A contract, then an implementation, then a review that did not write it</span>
              </span>
              <ChevronRight size={14} className="dk-faint" aria-hidden="true" />
            </button>

            {sessions.map((session) => (
              <button
                className="dk-list-row"
                type="button"
                disabled={starting}
                key={session.id}
                onClick={() => onStart(`session:${session.id}`)}
              >
                <Terminal size={16} className="dk-faint" aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{session.name}</span>
                  <span className="dk-row-sub">{session.agent} · {session.model}</span>
                </span>
                <ChevronRight size={14} className="dk-faint" aria-hidden="true" />
              </button>
            ))}

            <button className="dk-list-row" type="button" disabled={starting} onClick={() => onStart("new-session")}>
              <Plus size={16} className="dk-faint" aria-hidden="true" />
              <span className="dk-row-main">
                <span className="dk-row-title">New session</span>
                <span className="dk-row-sub">Create a session, then send this task when its CLI is ready</span>
              </span>
              <ChevronRight size={14} className="dk-faint" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
