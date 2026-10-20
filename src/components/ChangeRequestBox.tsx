import { useState } from "react";
import { Send } from "lucide-react";
import type { BraveliTask } from "../domain/types";
import { isUsableRequest, pendingRequests, type TaskWithRequests } from "../lib/changeRequests";
import { shortcutLabel } from "../lib/shortcutLabel";

/**
 * Saying what is wrong with the work, to the agent that did it.
 *
 * Sits under the changeset because that is the order the judgement happens in:
 * read what changed, then say what is wrong with it. Collapsed until wanted, so
 * accepting good work stays a single button and does not have to walk past a
 * textarea to get there.
 */
export function ChangeRequestBox({
  task,
  onSubmit,
}: {
  task: BraveliTask;
  onSubmit: (task: BraveliTask, body: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Notes are often long, and the changeset above is what is being judged:
  // the history stays small unless asked to open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showEarlier, setShowEarlier] = useState(false);

  const waiting = pendingRequests(task as TaskWithRequests);
  const history = (task as TaskWithRequests).changeRequests ?? [];

  async function submit() {
    if (sending || !isUsableRequest(body)) return;
    setSending(true);
    try {
      await onSubmit(task, body);
      setBody("");
      setOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="dk-request">
      {history.length > 0 ? (
        <ul className="dk-request-history">
          {history.length > 1 ? (
            <li>
              <button type="button" className="dk-link dk-request-earlier" onClick={() => setShowEarlier(!showEarlier)}>
                {showEarlier ? "Hide earlier notes" : `${history.length - 1} earlier ${history.length - 1 === 1 ? "note" : "notes"}`}
              </button>
            </li>
          ) : null}
          {(showEarlier ? history : history.slice(-1)).map((request) => {
            const open = Boolean(expanded[request.id]);
            const long = request.body.length > 160 || request.body.includes("\n");
            return (
              <li key={request.id}>
                <span className={`dk-badge${request.from === "reviewer" ? " dk-badge--accent" : request.deliveredAt ? "" : " dk-badge--amber"}`}>
                  {request.from === "reviewer" ? "Reviewer" : request.deliveredAt ? "Sent" : "Queued"}
                </span>
                <span className={`dk-request-note${open ? " is-open" : ""}`}>{request.body}</span>
                {long ? (
                  <button type="button" className="dk-link dk-request-more" onClick={() => setExpanded((current) => ({ ...current, [request.id]: !open }))}>
                    {open ? "Less" : "Show all"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <div className="dk-request-compose">
          <textarea
            className="dk-textarea"
            value={body}
            autoFocus
            rows={3}
            aria-label="Note for the agent"
            placeholder="What needs to change? Be specific — this goes straight to the agent."
            disabled={sending}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // Enter alone inserts a newline: these are often several sentences.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <div className="dk-request-actions">
            <span className="dk-hint">{shortcutLabel("⌘↵ to send")}</span>
            <span className="dk-spacer" />
            <button className="dk-btn dk-btn--ghost" type="button" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </button>
            <button
              className="dk-btn"
              type="button"
              onClick={() => void submit()}
              disabled={sending || !isUsableRequest(body)}
            >
              <Send size={14} />
              {sending ? "Sending…" : "Send back"}
            </button>
          </div>
        </div>
      ) : (
        <button className="dk-request-open" type="button" onClick={() => setOpen(true)} title={shortcutLabel("Send back  ⌘⇧↵")}>
          {waiting.length > 0 ? "Send back another note…" : "Send back with a note…"}
        </button>
      )}
    </div>
  );
}
