import type { AgentSession } from "../data";

/**
 * Which session wants you, and how badly.
 *
 * A tab strip answers "switch to session X", which is the question you have
 * when there are three of them. At ten the question is different — "which one
 * needs me?" — and a strip of equal-width chips is the worst shape for it: the
 * session that has been stuck for four minutes looks exactly like the nine that
 * are fine.
 *
 * The signal nothing showed before is quiet time. An agent that is working
 * produces output continuously; one that has gone silent while still claiming
 * to work is either finished, wedged, or waiting on something it cannot ask
 * for. That gap is the most useful number on the screen and it costs nothing to
 * compute — the app already counts every chunk that arrives.
 */

export type SessionActivity = {
  chunks: number;
  firstAt: number;
  lastAt: number;
  /**
   * When the current run of output began.
   *
   * Not the same as firstAt, which is the first chunk this session ever
   * produced. A session that worked, went idle for an hour, then was given a
   * new prompt is working for seconds, not an hour, and saying the latter is
   * worse than saying nothing.
   */
  busySince: number;
};

export type AttentionLevel = "needs-you" | "failed" | "quiet" | "working" | "done" | "idle";

export type SessionAttention = {
  level: AttentionLevel;
  /** Said plainly, in the interface's voice. */
  label: string;
  /** Milliseconds since this session last produced anything, or null. */
  quietFor: number | null;
  /** Milliseconds this session has been producing output without a break. */
  busyFor: number | null;
};

/** After this long without output, a working session is worth a second look. */
export const QUIET_AFTER_MS = 90_000;

export function readSessionAttention(
  session: AgentSession,
  activity: SessionActivity | undefined,
  now: number,
  options: {
    waiting?: boolean;
    attached?: boolean;
    /** What the pane says: true while it offers to interrupt, false at a prompt, null if unread. */
    busy?: boolean | null;
  } = {},
): SessionAttention {
  const quietFor = activity?.lastAt ? Math.max(0, now - activity.lastAt) : null;
  const busyFor = activity?.busySince ? Math.max(0, now - activity.busySince) : null;

  // Asked a question and stopped: the only state where the work cannot continue
  // without you, so it outranks everything including a failure.
  if (options.waiting) return { level: "needs-you", label: "Waiting on you", quietFor, busyFor };
  if (session.status === "failed") return { level: "failed", label: "Stopped with an error", quietFor, busyFor };
  if (session.status === "completed") return { level: "done", label: "Finished", quietFor, busyFor };
  if (!options.attached) return { level: "idle", label: "Not attached", quietFor, busyFor };

  // A CLI at its prompt keeps redrawing its status bar, so recent output cannot
  // tell idle from working. The pane can: it offers "esc to interrupt" exactly
  // while there is something to interrupt. No clock, since the redraws keep
  // resetting it.
  if (options.busy === false) return { level: "quiet", label: "At the prompt", quietFor: null, busyFor: null };
  if (options.busy === true) return { level: "working", label: "Working", quietFor, busyFor };

  // The label names the state and the row's number says how long it has been in
  // it, so the duration belongs in one place or the other, never both.
  if (quietFor !== null && quietFor >= QUIET_AFTER_MS) {
    return { level: "quiet", label: "Quiet", quietFor, busyFor };
  }
  return { level: "working", label: "Working", quietFor, busyFor };
}

/**
 * The duration worth showing next to a session, or null.
 *
 * A working session is measured by how long it has been going; a quiet one, or
 * one waiting on an answer, by how long it has been silent. Showing
 * time-since-last-output for a working session prints a counter that resets to
 * zero every couple of seconds, which is noise wearing the costume of
 * information. Finished, failed and unattached sessions have no clock worth
 * running at all.
 */
export function attentionDuration(attention: SessionAttention): number | null {
  if (attention.level === "working") return attention.busyFor;
  // How long the answer has been owed is the whole point of the top row.
  if (attention.level === "quiet" || attention.level === "needs-you") return attention.quietFor;
  return null;
}

/** A duration a person would say out loud: "40s", "4m", "1h 12m". */
export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
