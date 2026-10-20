/**
 * What Pitwall keeps of a session's output, and what it lets go.
 *
 * Every byte a PTY produced was retained for the life of the window, in an
 * array that only ever grew. Two things go wrong with that, and the second is
 * the one people feel:
 *
 * 1. Memory. A council of four agents talking for an hour, plus six sessions
 *    in another project, is a great deal of text held forever.
 *
 * 2. Copying. New output is appended once per animation frame with
 *    `[...existing, ...chunks]`, which copies the whole array. When the array
 *    holds a hundred thousand chunks, that is a hundred thousand copies sixty
 *    times a second — and it gets slower the longer the app stays open, which
 *    is exactly how the lag was described.
 *
 * The scrollback a person actually reads lives in xterm, which keeps its own.
 * What this array is for is the tail: the last few lines for the inspector,
 * enough to spot a permission prompt, and enough to find the summary an agent
 * writes when it finishes. All of those are bounded, so this is too.
 */

/**
 * Characters kept per session. Generous — a completion summary and the
 * reasoning around it is a few thousand characters, and this holds far more —
 * while still bounding what one runaway session can cost.
 */
export const MAX_TRANSCRIPT_CHARS = 262_144;

/**
 * Chunks kept per session.
 *
 * Capping characters alone is not enough: a CLI drawing a progress bar emits
 * thousands of tiny writes, so the array can be enormous while the text is
 * small, and it is the array length that makes the copy slow.
 */
export const MAX_TRANSCRIPT_CHUNKS = 4_000;

/**
 * Appends new output, dropping the oldest once either bound is passed.
 *
 * Returns the existing array unchanged when there is nothing to add, so a
 * caller can skip a state update entirely.
 */
/**
 * How many chunks a session has dropped off the front, ever.
 *
 * The panes read this buffer by index — "I have written the first N" — which
 * only holds while it is append-only. Once the cap starts trimming, index N is
 * a different chunk every flush, and a pane comparing what it last wrote
 * against `chunks[N-1]` concludes the whole buffer was replaced: it resets the
 * terminal and replays everything, sixty times a second. On screen that is a
 * flicker; underneath it is a megabyte of escape sequences reparsed per frame.
 *
 * Counting what has been dropped turns the index back into something stable:
 * a pane holds an absolute position and subtracts the offset to find its place.
 */
export type DroppedCounts = Record<string, number>;

export function appendCapped(
  existing: readonly string[] | undefined,
  chunks: readonly string[],
  maxChars = MAX_TRANSCRIPT_CHARS,
  maxChunks = MAX_TRANSCRIPT_CHUNKS,
): string[] {
  const base = existing ?? [];
  if (chunks.length === 0) return base as string[];

  const next = [...base, ...chunks];
  // Over the chunk cap: keep the newest. One slice rather than repeated
  // shifting from the front.
  const capped = next.length > maxChunks ? next.slice(next.length - maxChunks) : next;

  // The character budget is then applied exactly rather than approximately.
  // Skipping this walk when the buffer looked small was tried and reverted: it
  // made the cap a hope instead of a guarantee, and the walk was never the
  // expense. It is bounded by the chunk cap above — a few thousand additions —
  // where the copy it replaced grew without limit.
  return withinCharBudget(capped, maxChars);
}

/**
 * The tail that fits in the character budget.
 *
 * A single chunk bigger than the whole budget is kept as its own tail rather
 * than dropped: discarding it returned an empty transcript, which loses the
 * output that just arrived — the opposite of the point. Terminals write in
 * bursts and one of them being enormous is ordinary.
 */
function withinCharBudget(chunks: string[], maxChars: number): string[] {
  let chars = 0;
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    chars += chunks[i].length;
    if (chars <= maxChars) continue;
    if (i === chunks.length - 1) return [chunks[i].slice(-maxChars)];
    return chunks.slice(i + 1);
  }
  return chunks;
}

/** Total characters held for a session, for reporting what was dropped. */
export function transcriptSize(chunks: readonly string[] | undefined): number {
  let total = 0;
  for (const chunk of chunks ?? []) total += chunk.length;
  return total;
}

/**
 * Applies a batch of arrivals to the whole map at once.
 *
 * Only the sessions that received something are rebuilt; the rest keep their
 * existing array by reference, so a session that has been quiet costs nothing
 * and its consumers see no change.
 */
export function applyBatch(
  current: Record<string, string[]>,
  batch: Record<string, string[]>,
  dropped?: DroppedCounts,
): Record<string, string[]> {
  const ids = Object.keys(batch);
  if (ids.length === 0) return current;
  const next = { ...current };
  for (const id of ids) {
    const before = next[id]?.length ?? 0;
    const arrived = batch[id].length;
    const after = appendCapped(next[id], batch[id]);
    // What the cap removed from the front: everything that went in, minus the
    // growth that survived. Accumulated so a pane can find its place again.
    if (dropped) dropped[id] = (dropped[id] ?? 0) + Math.max(0, before + arrived - after.length);
    next[id] = after;
  }
  return next;
}
