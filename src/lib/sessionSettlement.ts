import type { SessionStatus } from "../data";

/**
 * When a session record stops claiming to be live.
 *
 * A record went to `running` whenever its CLI was attached and came back only
 * when the agent reported a finished turn. Nothing else settled it: not a stop,
 * not a quit, not a restart. So records read as live for days, and everything
 * that asks "is this still going" — the schedule's overlap guard above all —
 * got the wrong answer.
 */

const LIVE_STATUSES = new Set<SessionStatus>(["starting", "running", "waiting"]);

export function isLiveSessionStatus(status: SessionStatus) {
  return LIVE_STATUSES.has(status);
}

export type TerminalClosure = { exitCode?: number; stopped?: boolean };

/**
 * What a record becomes when its terminal closes, or null if it is already
 * settled — a turn that reported its own outcome is better evidence than the
 * exit that followed it.
 */
export function statusAfterTerminalClosed(status: SessionStatus, closure: TerminalClosure): SessionStatus | null {
  if (!isLiveSessionStatus(status)) return null;
  if (!closure.stopped && typeof closure.exitCode === "number") return closure.exitCode === 0 ? "completed" : "failed";
  return "disconnected";
}

/**
 * What a record becomes once its CLI is attached.
 *
 * Attaching is not work. A session that was settled and is reattached without
 * a prompt is sitting at its prompt — the state a finished turn leaves — and
 * marking it `running` is what kept restored sessions live for good.
 */
export function statusAfterAttach(status: SessionStatus, promptSent: boolean): SessionStatus {
  if (promptSent || status === "starting") return "running";
  if (status === "disconnected") return "completed";
  return status;
}

/**
 * Applies `settle` to each record, and hands back the same array when nothing
 * changed — a new one is a state change, and a state change is a write.
 */
export function settleSessions<T extends { id: string; status: SessionStatus }>(
  sessions: T[],
  settle: (session: T) => SessionStatus | null,
  patch: Partial<T> = {},
): T[] {
  let changed = false;
  const next = sessions.map((session) => {
    const status = settle(session);
    if (!status || status === session.status) return session;
    changed = true;
    return { ...session, ...patch, status };
  });
  return changed ? next : sessions;
}

/** A live record whose terminal does not exist is disconnected, whatever it last said. */
export function statusWithoutTerminal(session: { id: string; status: SessionStatus }, hasTerminal: (sessionId: string) => boolean) {
  return isLiveSessionStatus(session.status) && !hasTerminal(session.id) ? "disconnected" as const : null;
}
