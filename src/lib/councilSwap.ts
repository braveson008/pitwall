import type { CouncilRelayMember, CouncilThreadMessage } from "./councilRelay";

/**
 * Changing who sits in a council seat, without ending the council.
 *
 * A council's roster was fixed the moment it started: if you gave QA to Claude
 * and then wanted Codex reading the code instead, the only route was to stop
 * the run and build a new one, which threw away the thread — every handoff,
 * every decision argued out, the whole reason the council was worth running.
 *
 * ## The seat is the identity, not the agent
 *
 * Members address each other by handle. `thread.md` is full of `TO: qa-claude`
 * lines already written to disk and already read, and the conductor routes
 * against the same names. So a swap keeps the handle and changes who answers
 * to it: `qa-claude` is a seat called that, and after a swap the roster prints
 * it as "`qa-claude` — Reviewer / QA (codex)", which says exactly what is true.
 *
 * Renaming the seat to `qa-codex` was the other option and is worse: every
 * historical reference in the thread would point at a member no longer on the
 * roster, and the members read that thread.
 */

/** What the caller wants: this seat, run by that agent, on that model. */
export interface SwapRequest {
  sessionId: string;
  agent: string;
  model: string;
}

export interface SwapPlan {
  member: CouncilRelayMember;
  /** The seat's handle, unchanged — this is the point. */
  memberId: string;
  fromAgent: string;
  toAgent: string;
  toModel: string;
  /** True when this seat holds the turn, so the replacement must be given it. */
  holdsTurn: boolean;
  /** The turn the replacement has to pick up, when it holds one. */
  turn: number;
}

export interface SwapContext {
  members: readonly CouncilRelayMember[];
  currentMemberId: string | null | undefined;
  turn: number;
  stopped?: boolean;
}

/**
 * Whether this swap can be done, and what it involves.
 *
 * Returns a reason rather than throwing: every rejection here is something the
 * user should be told in the pane they clicked, not an exception.
 */
export function planSwap(
  context: SwapContext,
  request: SwapRequest,
): { ok: true; plan: SwapPlan } | { ok: false; reason: string } {
  const member = context.members.find((item) => item.sessionId === request.sessionId);
  if (!member) return { ok: false, reason: "That pane is not part of a council." };
  // Deliberately no check for a stopped council. Swapping the seat is how a
  // stalled one is repaired — a member whose CLI will not start is the main
  // reason to reach for this — and refusing then blocked the fix at exactly
  // the moment it was wanted, leaving nothing to do but discard the run.
  if (!request.agent) return { ok: false, reason: "Pick an agent to swap in." };
  // A no-op swap still costs a CLI boot and a lost turn, so it is refused
  // rather than quietly performed.
  if (sameSeat(member.agentLabel, request.agent) && !request.model) {
    return { ok: false, reason: `${member.roleLabel} is already running on ${request.agent}.` };
  }
  // A council needs someone to hand off to. Swapping the only member out
  // leaves a relay talking to itself.
  if (context.members.length < 2) {
    return { ok: false, reason: "A council needs at least two members to hand work between." };
  }
  return {
    ok: true,
    plan: {
      member,
      memberId: member.memberId,
      fromAgent: member.agentLabel,
      toAgent: request.agent,
      toModel: request.model || "Auto",
      holdsTurn: context.currentMemberId === member.memberId,
      turn: context.turn,
    },
  };
}

const sameSeat = (a: string, b: string) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * The roster after the swap.
 *
 * Only the two fields that describe who is in the seat change. `writesCode`,
 * `rolePrompt` and `roleLabel` belong to the seat and survive, which is what
 * makes this a substitution rather than a new member.
 */
export function applySwap(
  members: readonly CouncilRelayMember[],
  plan: SwapPlan,
  nextSessionId: string,
): CouncilRelayMember[] {
  return members.map((member) =>
    member.memberId === plan.memberId
      ? { ...member, sessionId: nextSessionId, agentLabel: plan.toAgent }
      : member,
  );
}

/**
 * The line written into the thread so the swap is not invisible.
 *
 * Without it a member reads three turns of `qa-claude` and then meets a
 * different reviewer under the same handle, with nothing in the record to
 * explain why the review it already agreed with is being reopened.
 */
export function swapNotice(plan: SwapPlan): string {
  const model = plan.toModel && plan.toModel !== "Auto" ? ` (${plan.toModel})` : "";
  const seat = `\`${plan.memberId}\` — ${plan.member.roleLabel}`;
  const handover = plan.holdsTurn
    ? " It picks up the turn that was in progress, so treat any part-finished work from the previous holder as unfinished."
    : "";
  return (
    `The ${seat} seat changed hands: ${plan.fromAgent} handed it to ${plan.toAgent}${model}. ` +
    `The handle is unchanged, so keep addressing that seat as \`${plan.memberId}\`. ` +
    `Everything already in this thread still stands.${handover}`
  );
}

/** The swap as a thread entry, authored by the user, because it was their call. */
export function swapMessage(plan: SwapPlan, userId: string): CouncilThreadMessage {
  return {
    turn: plan.turn,
    fromMemberId: userId,
    toMemberId: plan.memberId,
    content: swapNotice(plan),
    author: "user",
  };
}
