import type { AgentSession } from "../data";

/**
 * Statuses a broadcast can reach.
 *
 * A finished session is included, and deliberately: the message most worth
 * sending to every session at once is the one that comes *after* the work —
 * "open a PR", "push what you have" — and the sessions that need it most are
 * precisely the ones that have finished. Excluding them meant the agents that
 * had done their job were the only ones that never heard about it.
 *
 * Reaching one costs a resume, which the broadcast already knows how to do for
 * any session whose CLI is not attached.
 *
 * A failed session stays out. It stopped without finishing, so an instruction
 * that assumes completed work is the wrong thing to send it; those are restarted
 * deliberately, one at a time, through Retry session.
 */
const MESSAGEABLE_STATUSES = new Set(["starting", "running", "waiting", "completed"]);

/** Sessions a broadcast can reach, resuming any whose CLI has exited. */
export function broadcastEligibleSessions(sessions: AgentSession[]) {
  return sessions.filter((session) => MESSAGEABLE_STATUSES.has(session.status));
}

/** Whether reaching this session means starting its CLI up again first. */
export function needsResumeToReceive(session: AgentSession) {
  return session.status === "completed";
}

/**
 * Who a Council message is for.
 *
 * A council without a conductor runs every member on the same prompt at the
 * same time, so a message to "everyone" reaches people who are all mid-task.
 * A conducted council is a relay: one member holds the turn and the rest are
 * parked between turns. A correction sent to a parked member does not reach a
 * reader — it sits in that agent's input until its turn opens, and arrives as
 * an instruction about work the council has since moved past.
 *
 * Falls back to everyone when there is nobody on turn, because a send that
 * silently reaches nothing is worse than one that reaches too many.
 */
export function councilRecipients<T extends { id: string }>(
  sessions: readonly T[],
  scope: "all" | "current",
  currentSessionId: string | undefined,
): T[] {
  if (scope !== "current" || !currentSessionId) return [...sessions];
  const onTurn = sessions.filter((session) => session.id === currentSessionId);
  return onTurn.length > 0 ? onTurn : [...sessions];
}
