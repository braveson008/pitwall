import { Loader2, RefreshCw, TerminalSquare } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_TRANSCRIPT, reduceAgentEvents, type TranscriptEntry } from "../lib/agentStream";
import { SessionThread } from "./SessionThread";
import type { MenuOption, TerminalMenu } from "../lib/terminalMenu";
import { hasLiveWork, stateLabel, type MemberWork } from "../lib/councilActivity";
import { formatDuration } from "../lib/sessionAttention";

/**
 * A session as a conversation, beside the terminal that is having it.
 *
 * The Council reads as a thread because Pitwall writes down what each member
 * says. A solo session had nowhere equivalent to look: everything the agent
 * said existed only as characters painted on a screen, so a long session could
 * only be re-read by scrolling a terminal.
 *
 * This reads the CLI's own session file — the record Claude and Codex each keep
 * of what actually happened. That matters more than it sounds. Pitwall already
 * had a chat surface, and it stayed switched off because it resumed the session
 * in a *second* headless process beside the terminal's, and two processes on
 * one conversation can disagree about it. A file cannot disagree with the
 * program that wrote it.
 *
 * Read-only by construction, which is the honest shape here: you drive the
 * session from the terminal, and this is where you read it back.
 */
export const SessionConversation = memo(function SessionConversation({
  sessionId,
  agent,
  cwd,
  nativeSessionId,
  active,
  work,
  pendingMenu,
  onChooseMenuOption,
  onAnswerInTerminal,
}: {
  sessionId: string;
  agent: string;
  cwd: string;
  nativeSessionId?: string;
  /** Only the visible pane polls. Six sessions open should not mean six readers. */
  active: boolean;
  /**
   * What the agent is doing right now.
   *
   * The session file lags: it records a turn once it is written, so a thread
   * built from it alone goes silent for minutes while the agent is plainly
   * working. The Council has shown this since it was built — same card here.
   */
  work?: MemberWork | null;
  /**
   * What the agent is asking right now, off the live screen.
   *
   * Deliberately not from the session file: the file records a question after
   * it has been answered, and a prompt you can only read once it no longer
   * applies is worse than no prompt. The screen is the only thing that knows a
   * question is open.
   */
  pendingMenu?: TerminalMenu | null;
  onChooseMenuOption?: (menu: TerminalMenu, choice: MenuOption) => void;
  onAnswerInTerminal?: () => void;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "unsupported" | "error">("loading");
  const [message, setMessage] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  // What was last rendered, so a re-read that found nothing new does not
  // replace the list with an identical one and scroll the reader away.
  const signatureRef = useRef("");

  const read = useCallback(async () => {
    if (!window.pitwall?.readSessionConversation) {
      setState("unsupported");
      return;
    }
    try {
      const result = await window.pitwall.readSessionConversation({
        sessionId,
        agent: agent.toLowerCase(),
        cwd,
        nativeSessionId,
      });

      if (!result?.ok) {
        setMessage(result?.error || "That session's transcript could not be read.");
        setState("error");
        return;
      }

      if (!result.found) {
        setMessage(result.message || "");
        setState(result.message ? "unsupported" : "empty");
        return;
      }

      // Claude arrives as protocol records and is reduced by the same code that
      // reduces it live; Codex arrives already reduced, because its rollout is
      // not that protocol.
      const next = result.entries?.length
        ? (result.entries as TranscriptEntry[])
        : reduceAgentEvents(EMPTY_TRANSCRIPT, result.records ?? []).entries;

      const signature = `${next.length}:${next[next.length - 1]?.id ?? ""}`;
      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setEntries(next);
      }
      setState(next.length ? "ready" : "empty");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  }, [sessionId, agent, cwd, nativeSessionId]);

  /**
   * Re-read on a slow tick.
   *
   * The file grows as the agent works and there is no event to say so. Four
   * seconds is far slower than the terminal, which is the point: the terminal
   * is where you watch, and this is where you read.
   */
  useEffect(() => {
    if (!active) return;
    void read();
    const timer = window.setInterval(() => void read(), 4000);
    return () => window.clearInterval(timer);
  }, [active, read]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, pendingMenu?.prompt, work?.state]);

  return (
    <div className="dk-conversation">
      <div className="dk-conversation-column">
        <header className="dk-conversation-source">
          <span>Read from {agent}&apos;s own session record</span>
          <button
            type="button"
            className="dk-icon-btn dk-icon-btn--sm"
            onClick={() => void read()}
            title="Read the session file again"
            aria-label="Read the session file again"
          >
            <RefreshCw size={13} />
          </button>
        </header>

        {state === "loading" ? (
          <p className="dk-conversation-note">
            <Loader2 size={14} className="is-spinning" />
            Reading the session…
          </p>
        ) : null}

        {state === "unsupported" ? (
          <p className="dk-conversation-note">
            {message || `Pitwall cannot read ${agent}'s transcript yet. The terminal has everything.`}
          </p>
        ) : null}

        {state === "error" ? <p className="dk-conversation-note dk-error">{message}</p> : null}

        {state === "empty" ? (
          <div className="dk-empty">
            <strong>Nothing has been said yet</strong>
            Turns appear here as the agent takes them.
          </div>
        ) : null}

        {entries.length > 0 ? <SessionThread entries={entries} agent={agent} cwd={cwd} /> : null}

        {/* Mid-thought, where the answer will appear: one live line rather
            than a silent gap while the session file catches up. */}
        {work && hasLiveWork([work]) ? (
          <div className="dk-live-line" aria-live="polite">
            <span className={`dk-dot ${work.state === "waiting" ? "is-needs" : "is-working"}`} aria-hidden="true" />
            <span className="dk-live-state">
              <span>{stateLabel(work.state)}</span>
              {work.steps.length > 0 ? (
                <code className="dk-mono" title={work.steps.join("\n")}>{work.steps[work.steps.length - 1]}</code>
              ) : (
                <span className="dk-faint">{work.state === "waiting" ? "It is asking for something." : "Starting up…"}</span>
              )}
            </span>
            {work.forMs ? <span className="dk-live-for">{formatDuration(work.forMs)}</span> : null}
            {onAnswerInTerminal ? (
              <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={onAnswerInTerminal}>
                Open terminal
              </button>
            ) : null}
          </div>
        ) : null}

        {/* A question the agent is asking now. Answering it here writes the
            same keystroke the terminal would have taken, so the CLI cannot tell
            which surface it came from. */}
        {pendingMenu && pendingMenu.options.length > 0 ? (
          <div className="dk-card dk-card--pad dk-ask" role="group" aria-label="The agent is asking">
            <p>{pendingMenu.prompt || "The agent is waiting on an answer."}</p>
            <div className="dk-ask-options">
              {pendingMenu.options.map((option) => (
                <button
                  key={`${option.index}-${option.label}`}
                  type="button"
                  className={`dk-btn dk-btn--sm${option.selected ? " dk-btn--primary" : ""}`}
                  onClick={() => onChooseMenuOption?.(pendingMenu, option)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {onAnswerInTerminal ? (
              <button type="button" className="dk-link dk-ask-terminal" onClick={onAnswerInTerminal}>
                <TerminalSquare size={12} aria-hidden="true" />
                Answer in the terminal instead
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
});

