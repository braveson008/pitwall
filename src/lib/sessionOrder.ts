/**
 * The order sessions sit in the rail.
 *
 * The rail used to sort by how badly a session wanted you. That sounds right
 * and is wrong in use: selecting a session attaches it, attaching changes the
 * state it reports, and so the row you just clicked jumps out from under the
 * cursor. An order that rearranges itself in response to being read is one you
 * can never build a spatial memory of — and at ten sessions spatial memory is
 * most of what makes the rail usable.
 *
 * So the order is the operator's instead: the order sessions were created in
 * until they drag something, then whatever they arranged. Urgency still reaches
 * them through the row's colour and the "N needs you" count in the header,
 * neither of which moves anything.
 */

/** Session ids, first to last. Ids that have since been deleted are tolerated. */
export type SessionOrder = readonly string[];

/**
 * Put `sessions` in the arranged order.
 *
 * Sessions created since the last drag have no place in the stored order. They
 * go at the end, keeping the order they arrived in, because a new session
 * appearing silently in the middle of an arranged list is indistinguishable
 * from the list having rearranged itself.
 */
export function applySessionOrder<T extends { id: string }>(sessions: readonly T[], order: SessionOrder): T[] {
  if (order.length === 0) return [...sessions];
  const rank = new Map(order.map((id, index) => [id, index]));
  const arranged: T[] = [];
  const added: T[] = [];
  for (const session of sessions) {
    if (rank.has(session.id)) arranged.push(session);
    else added.push(session);
  }
  arranged.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
  return [...arranged, ...added];
}

/**
 * Move one session to a slot between rows.
 *
 * `slot` counts the gaps, not the rows: 0 is above the first row and
 * `ids.length` is below the last. Gaps are what a drop indicator can actually
 * point at, and they are the only way to express "put it at the very end".
 */
export function moveSessionTo(ids: SessionOrder, draggedId: string, slot: number): string[] {
  const from = ids.indexOf(draggedId);
  if (from === -1) return [...ids];
  const target = Math.max(0, Math.min(ids.length, Math.trunc(slot)));
  // Both gaps touching the row's current position mean "leave it here". Lifting
  // the row closes the gap it was occupying, so without this the two of them
  // would resolve to a one-place move in opposite directions.
  if (target === from || target === from + 1) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(target > from ? target - 1 : target, 0, draggedId);
  return next;
}

/** Move one session by whole positions — the keyboard's version of a drag. */
export function nudgeSession(ids: SessionOrder, draggedId: string, delta: number): string[] {
  const from = ids.indexOf(draggedId);
  if (from === -1) return [...ids];
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}

/**
 * Drop ids for sessions that no longer exist.
 *
 * Without this the stored order grows without bound across a long-lived
 * project, and every deleted session leaves a rank that silently shifts the
 * rows below it.
 */
export function pruneSessionOrder(order: SessionOrder, sessions: readonly { id: string }[]): string[] {
  const live = new Set(sessions.map((session) => session.id));
  return order.filter((id) => live.has(id));
}
