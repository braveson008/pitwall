import type { CouncilRelayMember, CouncilThreadMessage, RelayRouteSource } from "./councilRelay";

/**
 * The council as a conversation, rather than as N terminals.
 *
 * A Council's claim is that its members argue and a conductor routes the work
 * on merit. None of that was visible: the members were three independent CLI
 * scrollbacks and the routing was a single strip showing the latest hop, so the
 * one thing that distinguishes a Council from three agents run side by side was
 * the one thing you could not see.
 *
 * Both halves were already being recorded — `messages` for what was said,
 * `routes` for where the conductor sent it and why. This interleaves them into
 * the order they happened.
 */

export type ThreadEntry =
  | {
      kind: "said";
      key: string;
      turn: number;
      author: "member" | "user" | "council";
      from: string;
      to: string | null;
      content: string;
      contributors?: string[];
    }
  | {
      kind: "routed";
      key: string;
      turn: number;
      from: string;
      to: string;
      source: RelayRouteSource;
      reason: string;
      directive: string;
    };

export type RouteRecord = {
  turn: number;
  fromMemberId: string;
  toMemberId: string;
  source: RelayRouteSource;
  reason: string;
  directive: string;
};

/**
 * Messages and routing decisions in the order they happened.
 *
 * A route is the decision that *ends* a turn, so it sorts after everything said
 * during that turn. Ordering is otherwise by turn and then by arrival, never by
 * author — a council reads as a discussion or it reads as nothing.
 */
export function buildThread(
  messages: readonly CouncilThreadMessage[],
  routes: readonly RouteRecord[],
): ThreadEntry[] {
  const entries: Array<{ entry: ThreadEntry; turn: number; rank: number; index: number }> = [];

  messages.forEach((message, index) => {
    entries.push({
      turn: message.turn,
      rank: 0,
      index,
      entry: {
        kind: "said",
        key: `said-${message.turn}-${index}`,
        turn: message.turn,
        author: message.author ?? "member",
        from: message.fromMemberId,
        to: message.toMemberId,
        content: message.content,
        contributors: (message as { contributors?: string[] }).contributors,
      },
    });
  });

  routes.forEach((route, index) => {
    entries.push({
      turn: route.turn,
      rank: 1,
      index,
      entry: {
        kind: "routed",
        key: `routed-${route.turn}-${index}`,
        turn: route.turn,
        from: route.fromMemberId,
        to: route.toMemberId,
        source: route.source,
        reason: route.reason,
        directive: route.directive,
      },
    });
  });

  return entries
    .sort((left, right) => left.turn - right.turn || left.rank - right.rank || left.index - right.index)
    .map((item) => item.entry);
}

/**
 * What to call a member on screen.
 *
 * Member ids are handles the agents address each other by — "implementer-codex"
 * — which is right for a prompt and wrong for a person reading the thread.
 */
export function memberLabel(members: readonly CouncilRelayMember[], memberId: string | null | undefined): string {
  if (!memberId) return "";
  const member = members.find((item) => item.memberId === memberId);
  if (!member) return memberId;
  return member.roleLabel || member.memberId;
}

/** The agent behind a member, for the quieter half of a label. */
export function memberAgent(members: readonly CouncilRelayMember[], memberId: string | null | undefined): string {
  if (!memberId) return "";
  return members.find((item) => item.memberId === memberId)?.agentLabel ?? "";
}

/**
 * One chip per turn, for the strip that shows how the work has moved.
 *
 * Built from the routes rather than the messages: a turn where a member said
 * several things is still one turn, and the strip is about where the work went.
 */
export type TurnStop = { turn: number; memberId: string; current: boolean };

export function buildTurnStrip(
  routes: readonly RouteRecord[],
  currentMemberId: string | null | undefined,
  currentTurn: number,
): TurnStop[] {
  const stops: TurnStop[] = [];
  for (const route of routes) {
    if (!route.toMemberId) continue;
    const last = stops[stops.length - 1];
    // A conductor that re-routes to the same member inside one turn is one stop.
    if (last && last.turn === route.turn && last.memberId === route.toMemberId) continue;
    stops.push({ turn: route.turn, memberId: route.toMemberId, current: false });
  }
  // The member holding the turn is where the work is now, whether or not a
  // route has been recorded for it yet.
  if (currentMemberId) {
    const last = stops[stops.length - 1];
    if (!last || last.memberId !== currentMemberId || last.turn !== currentTurn) {
      stops.push({ turn: currentTurn, memberId: currentMemberId, current: true });
    } else {
      last.current = true;
    }
  }
  return stops;
}

/**
 * The one line a folded message shows.
 *
 * A council handoff is a document — a heading, a ticket reference, numbered
 * acceptance criteria, several hundred lines of reasoning. Folded, it still has
 * to say what it is, and the first heading is almost always the answer because
 * that is how agents open one. Boilerplate the members all write ("Stage 3 —
 * Reviewer") says nothing the card's own header does not, so it is skipped in
 * favour of the first real sentence.
 */
export function summariseMessage(content: string): string {
  const lines = content.split("\n").map((line) => line.trim());
  for (const line of lines) {
    if (!line) continue;
    const bare = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^>\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    if (!bare || /^-{3,}$/.test(bare)) continue;
    // "Stage 2 — Implementer" repeats the card's own header.
    if (/^stage\s*\d+\b/i.test(bare)) continue;
    return bare.length > 120 ? `${bare.slice(0, 119).trimEnd()}…` : bare;
  }
  return "";
}

/** Roughly how much of a message is worth showing before folding the rest. */
export const FOLD_AFTER_LINES = 14;

export function isLongMessage(content: string): boolean {
  return content.split("\n").length > FOLD_AFTER_LINES || content.length > 900;
}
