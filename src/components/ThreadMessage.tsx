import { CheckCheck, ChevronRight, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Markdown } from "./Markdown";
import { isLongMessage, summariseMessage } from "../lib/councilThread";
import { extractAgentMarkers } from "../lib/agentMarkers";

/**
 * One thing that was said, in a thread.
 *
 * Shared by the Council and by a single session, which is the point: they are
 * the same act of reading. The Council grew this shape first — folded unless it
 * is the newest, because a turn is a document and four of them shown in full
 * make the thread longer than the terminals it replaced — and a solo session
 * has exactly the same problem with exactly the same answer.
 *
 * Extracted rather than copied. A second card that looked like this one would
 * drift from it, and the two surfaces would slowly stop being the same thing.
 */
export function ThreadMessage({
  tone,
  who,
  agent,
  eyebrow,
  content,
  meta,
  action,
  openByDefault,
  foldLabel = "the full message",
  continued = false,
}: {
  /** Drives the card's colour: who is speaking outranks what they said. */
  tone: "user" | "member" | "council";
  who: string;
  /** The quieter half of the label — which CLI, when that is not the subject. */
  agent?: string;
  /** "Turn 3", a timestamp — whatever locates this in the conversation. */
  eyebrow?: string;
  content: string;
  /** Anything else belonging in the header: who it went to, who answered. */
  meta?: ReactNode;
  /** A control on the right of the header. */
  action?: ReactNode;
  openByDefault: boolean;
  foldLabel?: string;
  /** More from the speaker of the message above, in the same turn: their name is already there. */
  continued?: boolean;
}) {
  /**
   * The agent addresses two audiences in one message: the reader, and Pitwall.
   *
   * Its protocol lines — the completion summary, the preview URLs — are meant
   * for the app, and left in the prose they are a wall of JSON in the middle of
   * a sentence. Lifted out and shown as what they are.
   */
  const { prose, markers } = extractAgentMarkers(content);
  const foldable = isLongMessage(prose);
  const [open, setOpen] = useState(openByDefault || !foldable);
  const summary = summariseMessage(prose);

  // A name like "The council" is marked by what it names, not by its article.
  const mark = (agent || who).replace(/^the\s+/i, "").charAt(0).toUpperCase();

  return (
    <article className={`dk-msg dk-msg--${tone}${open ? " is-open" : ""}`}>
      {tone === "user" ? (
        <header className="dk-msg-head">
          <strong className="sr-only">{who}</strong>
          {eyebrow ? <span className="dk-msg-eyebrow">{eyebrow}</span> : null}
          {meta}
          {action}
        </header>
      ) : continued ? null : (
        <header className="dk-msg-head">
          <span className="dk-msg-tile" aria-hidden="true">{mark}</span>
          <strong className="dk-msg-who">{who}</strong>
          {agent ? <span className="dk-msg-agent">{agent}</span> : null}
          {eyebrow ? <span className="dk-msg-eyebrow">{eyebrow}</span> : null}
          {meta}
          {action}
        </header>
      )}

      {foldable || prose ? (
        <div className="dk-msg-body">
          {foldable ? (
            <button
              type="button"
              className="dk-msg-fold"
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronRight size={13} className={open ? "is-open" : undefined} aria-hidden="true" />
              <span>{open ? `Hide ${foldLabel}` : summary || `Show ${foldLabel}`}</span>
            </button>
          ) : null}
          {open && prose ? <Markdown source={prose} /> : null}
        </div>
      ) : null}

      {markers.map((marker, index) =>
        marker.kind === "summary" ? (
          <section className="dk-card dk-msg-summary" key={index}>
            <header>
              <CheckCheck size={13} aria-hidden="true" />
              Completion summary
            </header>
            <dl>
              <dt>What changed</dt>
              <dd>{marker.what}</dd>
              <dt>How</dt>
              <dd>{marker.how}</dd>
            </dl>
            {marker.components.length > 0 ? (
              <ul className="dk-msg-components">
                {marker.components.map((component) => (
                  <li key={component}>
                    <code className="dk-mono">{component}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <button
            className="dk-chip dk-msg-preview"
            key={index}
            type="button"
            onClick={() => void window.pitwall?.openExternalUrl?.(marker.url)}
          >
            <ExternalLink size={12} aria-hidden="true" />
            <strong>{marker.label}</strong>
            <span className="dk-mono">{marker.url.replace(/^https?:\/\//, "")}</span>
          </button>
        ),
      )}
    </article>
  );
}
