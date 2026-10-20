import { Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSession } from "../data";
import { useModalFocus } from "../hooks/useModalFocus";
import { needsResumeToReceive } from "../lib/sessionBroadcast";
import { shortcutLabel } from "../lib/shortcutLabel";

export function BroadcastMessageModal({
  open,
  sessions,
  taskLabel,
  sending,
  onClose,
  onSend,
}: {
  open: boolean;
  sessions: AgentSession[];
  taskLabel: (session: AgentSession) => string;
  sending: boolean;
  onClose: () => void;
  onSend: (message: string) => void;
}) {
  const [message, setMessage] = useState("");
  const dialogRef = useModalFocus<HTMLElement>(open, onClose);
  useEffect(() => {
    if (open) setMessage("");
  }, [open]);
  if (!open) return null;

  const submit = () => {
    const value = message.trim();
    if (!value || sending) return;
    onSend(value);
  };

  const resuming = sessions.filter(needsResumeToReceive).length;

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <section ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-labelledby="broadcast-title" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="broadcast-title">Send to {sessions.length} {sessions.length === 1 ? "session" : "sessions"}</h2>
            <p className="dk-dialog-desc">This sends the same instruction to each listed CLI. Replies remain in their own task sessions.</p>
          </div>
          <button className="dk-icon-btn" type="button" onClick={onClose} aria-label="Close broadcast message"><X size={16} /></button>
        </div>
        <div className="dk-dialog-body">
          {resuming > 0 ? (
            <p className="dk-hint">
              {resuming === 1 ? "One session has finished" : `${resuming} sessions have finished`} — {resuming === 1 ? "its" : "their"} CLI starts up again to receive this.
            </p>
          ) : null}
          <div className="dk-list" aria-label="Message recipients">
            {sessions.map((session) => (
              <div className="dk-list-row dk-council-recipient" key={session.id}>
                <span
                  className={`dk-dot ${
                    session.status === "running" || session.status === "starting"
                      ? "is-working"
                      : session.status === "failed" || session.status === "disconnected"
                        ? "is-failed"
                        : "is-idle"
                  }`}
                  aria-hidden="true"
                />
                <div className="dk-row-main">
                  <strong className="dk-row-title">{session.agent}</strong>
                  <span className="dk-row-sub">{taskLabel(session)}</span>
                </div>
                {needsResumeToReceive(session) ? <span className="dk-badge">Resumes</span> : null}
              </div>
            ))}
          </div>
          <label className="dk-field">
            <span className="dk-label">Message</span>
            <textarea className="dk-textarea" data-dialog-autofocus value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
            }} placeholder="e.g. Pause after your current check and report status." rows={5} />
            <small className="dk-hint">{shortcutLabel("Press ⌘↵ to send. A normal terminal message still goes only to the selected session.")}</small>
          </label>
        </div>
        <div className="dk-dialog-footer">
          <button className="dk-btn dk-btn--ghost" type="button" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="dk-btn dk-btn--primary" type="button" onClick={submit} disabled={!message.trim() || sending}><Send size={15} />{sending ? "Sending…" : `Send to ${sessions.length}`}</button>
        </div>
      </section>
    </div>
  );
}
