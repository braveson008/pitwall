import { memo, useState } from "react";
import { ArrowRight, CircleHelp, ShieldCheck, WifiOff } from "lucide-react";
import type { PitwallTaskPair } from "../domain/types";
import { isTerminalReply } from "../lib/terminalReplies";
import type { TerminalLinesStore } from "../terminal/terminalLinesStore";
import { LiveTerminalView } from "./LiveTerminalView";
import { pairReviewerLabel } from "../domain/pairReviewer";

type Props = {
  /** Kept mounted while another tab shows, so its terminal keeps its scrollback. */
  hidden?: boolean;
  pair: PitwallTaskPair;
  implementerLabel: string;
  /** Whether the implementer is mid-turn, for the strip. */
  implementerWorking: boolean;
  store: TerminalLinesStore;
  /** The reviewer's bounded buffer: how much it dropped, and the modes to restore on a replay. */
  droppedFor?: (sessionId: string) => number;
  replayPreamble?: (sessionId: string) => string;
  visible: boolean;
  fontFamily?: string;
  fontSize?: number;
  onOpenReview: () => void;
};

const STATE: Record<PitwallTaskPair["state"], string> = {
  implementing: "Waiting for the implementer",
  reviewing: "Reviewing",
  approved: "Approved",
  "open-points": "Open points",
  skipped: "Did not review",
};

/**
 * The reviewer of a pair, beside the implementer it reviews.
 *
 * You can watch it, never type to it: it reads the change offline and
 * read-only, so nothing in the code under review can talk it into acting, and
 * the only way to steer it is through Review — notes go to the implementer,
 * and the reviewer checks what comes back.
 */
export const PairReviewerPane = memo(function PairReviewerPane({
  hidden = false,
  pair,
  implementerLabel,
  implementerWorking,
  store,
  visible,
  fontFamily,
  fontSize,
  droppedFor,
  replayPreamble,
  onOpenReview,
}: Props) {
  const [why, setWhy] = useState(false);
  // Created the first time it is on screen: a terminal opened out of sight
  // measures its letters as nothing and draws them that size.
  const [shown, setShown] = useState(visible);
  if (visible && !shown) setShown(true);
  const reviewer = pairReviewerLabel(pair.reviewer);
  const sessionId = pair.reviewerSessionId;
  const latest = pair.rounds?.[pair.rounds.length - 1];
  const turn = pair.state === "reviewing" ? "reviewer" : pair.state === "implementing" ? "implementer" : "done";

  return (
    <aside className={`dk-pair-reviewer${hidden ? " is-hidden" : ""}`} aria-label={`Reviewer · ${reviewer}`} aria-hidden={hidden || undefined}>
      <div className="dk-pair-strip" aria-live="polite">
        <span className={turn === "implementer" ? "is-turn" : undefined}>
          {implementerLabel} {turn === "implementer" ? (implementerWorking ? "working" : "implementing") : "implemented"}
        </span>
        <ArrowRight size={12} aria-hidden="true" />
        <span className={turn === "reviewer" ? "is-turn" : undefined}>
          {reviewer} {turn === "reviewer" ? `reviewing · round ${pair.round} of ${pair.maxRounds}` : turn === "done" ? STATE[pair.state].toLowerCase() : "waits"}
        </span>
      </div>

      <header className="dk-pair-reviewer-head">
        <span className="dk-pair-reviewer-title">Reviewer · {reviewer}</span>
        <span className="dk-badge" title="It can read the worktree and nothing else"><ShieldCheck size={11} aria-hidden="true" /> Read-only</span>
        <span className="dk-badge" title="No network, no MCP servers"><WifiOff size={11} aria-hidden="true" /> Offline</span>
        <span className="dk-spacer" />
        <button type="button" className="dk-icon-btn" aria-expanded={why} aria-label="Why can't I message the reviewer?" title="Why can't I message it?" onClick={() => setWhy((open) => !open)}>
          <CircleHelp size={14} aria-hidden="true" />
        </button>
      </header>

      {why ? (
        <div className="dk-pair-why">
          <p>
            The reviewer reads the change offline and read-only: it cannot edit files, run commands, reach the network or
            use MCP servers. That is what makes its verdict trustworthy — nothing written into the code it reviews can
            talk it into doing anything.
          </p>
          <p>
            So it takes no messages. To steer the work, use Review: your notes go to the implementer, and {reviewer} checks
            the result again.
          </p>
          <button type="button" className="dk-btn dk-btn--sm" onClick={onOpenReview}>Open Review</button>
        </div>
      ) : null}

      {latest ? (
        <div className={`dk-pair-latest is-${latest.verdict}`}>
          <strong>
            Round {latest.round}: {latest.verdict === "approve" ? "approved" : latest.verdict === "request_changes" ? "sent back" : "no verdict"}
          </strong>
          {latest.summary ? <span>{latest.summary}</span> : null}
          {latest.comments.length ? (
            <ul>
              {latest.comments.slice(0, 6).map((comment, index) => (
                <li key={index}><code className="dk-mono">{comment.path}:{comment.line}</code> {comment.body}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="dk-pair-reviewer-body">
        {sessionId && shown ? (
          <LiveTerminalView
            store={store}
            droppedFor={droppedFor}
            replayPreamble={replayPreamble}
            placeholder={[`${reviewer} is starting its review`]}
            sessionId={sessionId}
            active={visible}
            fontFamily={fontFamily}
            fontSize={fontSize}
            // Only the terminal's own answers to the CLI get through; typing does not.
            onInput={(data) => {
              if (isTerminalReply(data)) void window.pitwall?.writeTerminal?.({ sessionId, data });
            }}
            onResize={(cols, rows) => void window.pitwall?.resizeTerminal?.({ sessionId, cols, rows })}
          />
        ) : sessionId ? null : (
          <p className="dk-pair-reviewer-empty">
            {pair.state === "implementing"
              ? `When ${implementerLabel} finishes, ${reviewer} reads the change here, before it reaches you.`
              : pair.outcome || "This pair was reviewed before reviewers had a terminal of their own."}
          </p>
        )}
      </div>
    </aside>
  );
});
