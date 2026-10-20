import { useModalFocus } from "../hooks/useModalFocus";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentSession } from "../data";
import { EMPTY_TRANSCRIPT, reduceAgentEvents, type TranscriptEntry } from "../lib/agentStream";
import { formatTerminalTranscript } from "../lib/terminalHistory";
import { TranscriptBody } from "./TranscriptBody";

/** The conversation as plain text, for taking somewhere else. */
function asPlainText(entries: TranscriptEntry[]) {
  return entries
    .map((entry) => {
      if (entry.kind === "user") return `You:\n${entry.text}`;
      if (entry.kind === "text") return `Claude:\n${entry.text}`;
      if (entry.kind === "tool") return `[${entry.name}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function SessionTranscriptModal({
  session,
  chunks,
  cwd,
  onClose,
}: {
  session: AgentSession | null;
  /** The pane's raw output, kept only as a fallback. */
  chunks: string[];
  cwd?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const sessionId = session?.id;
  const nativeSessionId = session?.nativeSessionId;

  /**
   * The conversation, read from where the CLI recorded it.
   *
   * Not from the pane's bytes. Those are a recording of a screen: a TUI
   * repaints continuously, so every spinner frame survives the escape-stripping
   * and runs together — "Skedaddling…Skedaddling…" with the spaces between
   * words gone, which is what this dialog used to show.
   */
  useEffect(() => {
    if (!sessionId || !window.braveli?.readAgentTranscript) {
      setEntries(null);
      return;
    }
    let active = true;
    setLoading(true);
    void window.braveli
      .readAgentTranscript({ projectPath: cwd, claudeSessionId: nativeSessionId })
      .then((result) => {
        if (!active) return;
        setEntries(result?.ok && result.records.length ? reduceAgentEvents(EMPTY_TRANSCRIPT, result.records).entries : null);
      })
      .catch(() => active && setEntries(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [sessionId, nativeSessionId, cwd]);

  // Only reached when there is no recorded conversation — a non-Claude agent,
  // or a session that never wrote one. Better than an empty dialog.
  const rawText = useMemo(() => formatTerminalTranscript(chunks), [chunks]);
  const copyText = entries ? asPlainText(entries) : rawText;

  const dialogRef = useModalFocus<HTMLElement>(Boolean(session), onClose);
  if (!session) return null;

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <section ref={dialogRef}
        className="dk-dialog dk-dialog--wide dk-transcript-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-title"
        aria-describedby="transcript-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="transcript-title">{session.name}</h2>
            <p className="dk-dialog-desc" id="transcript-desc">
              {entries ? `${session.agent} conversation, as it was recorded` : `${session.agent} CLI output saved before Pitwall closed`}
              {" · "}Read-only
            </p>
          </div>
          <button type="button" className="dk-btn dk-btn--sm" onClick={() => void copyTranscript()} disabled={!copyText}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close transcript">
            <X size={16} />
          </button>
        </header>

        {entries ? (
          <div className="dk-dialog-body dk-transcript-body" tabIndex={0}>
            <TranscriptBody entries={entries} cwd={cwd} />
          </div>
        ) : (
          <div className="dk-dialog-body">
            <pre className="dk-transcript-raw" tabIndex={0}>
              {loading
                ? "Reading the saved conversation…"
                : rawText || "No conversation was recorded for this session."}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
