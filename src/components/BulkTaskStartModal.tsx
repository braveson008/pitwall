import { LoaderCircle, X } from "lucide-react";
import type { AgentProvider } from "../data";
import type { AgentOption, ModelOption } from "../domain/agents";
import type { PitwallSessionType, PitwallTask } from "../domain/types";
import { getRole, roleOrder, roles } from "../domain/roles";
import { Dropdown } from "./Dropdown";
import { useModalFocus } from "../hooks/useModalFocus";

export function BulkTaskStartModal({
  tasks,
  agentOptions,
  agent,
  models,
  model,
  sessionType,
  starting,
  running,
  cancelling,
  onAgentChange,
  onModelChange,
  onRoleChange,
  onClose,
  onStart,
}: {
  tasks: PitwallTask[];
  agentOptions: AgentOption[];
  agent: AgentProvider;
  models: ModelOption[];
  model: string;
  sessionType: PitwallSessionType;
  starting: number;
  /** True for the whole run, including the tracker read before session one. */
  running: boolean;
  /** A stop was asked for and the run is finishing the session in flight. */
  cancelling: boolean;
  onAgentChange: (agent: AgentProvider) => void;
  onModelChange: (model: string) => void;
  onRoleChange: (type: PitwallSessionType) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  // `starting` counts sessions, and the first phase — reading every task from
  // its tracker — creates none. Busy has to be its own signal or the modal
  // becomes closeable, and Start clickable again, during the longest part of
  // the wait.
  const busy = running;
  const dialogRef = useModalFocus<HTMLElement>(tasks.length > 0, () => { if (!busy) onClose(); });
  if (tasks.length === 0) return null;
  const sessionLabel = tasks.length === 1 ? "session" : "sessions";

  return (
    <div className="dk-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <section ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-task-title" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="bulk-task-title">Start {tasks.length} task {sessionLabel}</h2>
            <p className="dk-dialog-desc">Pitwall will create one isolated session and task worktree for every selected task.</p>
          </div>
          <button data-dialog-autofocus className="dk-icon-btn" type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-list dk-bulk-list">
            {tasks.map((task, index) => (
              <div className="dk-list-row" key={task.id}>
                <span className="dk-bulk-index">{index + 1}</span>
                <span className="dk-row-main"><span className="dk-row-title">{task.title}</span></span>
                <code className="dk-mono dk-faint">{task.identifier}</code>
              </div>
            ))}
          </div>
          <div className="dk-bulk-options">
            <div className="dk-field"><span className="dk-label">Agent</span><Dropdown value={String(agent)} onChange={(value) => onAgentChange(value as AgentProvider)} ariaLabel="Agent for selected tasks" options={agentOptions.map((option) => ({ value: String(option.agent), label: String(option.agent) }))} /></div>
            <div className="dk-field"><span className="dk-label">Model</span><Dropdown value={model} onChange={onModelChange} ariaLabel="Model for selected tasks" options={models.map((option) => ({ value: option.label, label: option.label }))} /></div>
            <div className="dk-field"><span className="dk-label">Role</span><Dropdown value={sessionType} onChange={(value) => onRoleChange(value as PitwallSessionType)} ariaLabel="Role for selected tasks" options={roleOrder.map((type) => ({ value: type, label: roles[type].label }))} /></div>
          </div>
          <p className="dk-hint">{getRole(sessionType).summary}</p>
        </div>

        <div className="dk-dialog-footer">
          {/* The tracker read happens before any session exists, and it is the
              longest part. Counting "1 of 4" through it looks stuck; saying what
              it is doing does not. */}
          <span className="dk-hint">
            {!busy
              ? `${tasks.length} ${sessionLabel} will open in Work`
              : cancelling
                ? starting === 0
                  ? "Stopping — no sessions have been created."
                  : `Stopping after the session in flight. ${starting - 1} already created.`
                : starting === 0
                  ? `Reading ${tasks.length} task${tasks.length === 1 ? "" : "s"} from their tracker…`
                  : `Starting ${starting} of ${tasks.length}…`}
          </span>
          {/* Stopping stays available while it runs. The tracker read is the
              longest part and nothing exists during it, so a mind changed there
              costs nothing; later it stops at the next session rather than
              abandoning one half-created. */}
          <button className="dk-btn dk-btn--ghost" type="button" disabled={cancelling} onClick={onClose}>
            {busy ? (cancelling ? "Stopping…" : "Stop") : "Cancel"}
          </button>
          <button className="dk-btn dk-btn--primary" type="button" disabled={busy} onClick={onStart}>
            {busy ? <LoaderCircle className="dk-spin" size={14} /> : null}
            {busy ? "Starting" : `Start ${tasks.length} ${sessionLabel}`}
          </button>
        </div>
      </section>
    </div>
  );
}
