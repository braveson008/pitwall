import { DEV_PREVIEW_PATTERN, MOBILE_PREVIEW_PATTERN, findLatestDevPreview, type DevPreview } from "./devPreview";

/**
 * Watches arriving output for a dev-server URL.
 *
 * The URL used to be found by re-reading a session's whole buffer, inside a
 * memo keyed on that buffer — so it ran again for every session on every frame
 * that carried terminal output, joining and splitting megabytes each time. At
 * six busy sessions that alone cost more than a frame's entire budget, and it
 * grew for as long as the sessions ran.
 *
 * Only new output can contain something new, so only new output is read.
 */

/**
 * How much of the previous read is kept.
 *
 * A PTY splits its output wherever the kernel happens to, which can fall in the
 * middle of the line carrying the marker. Carrying the tail forward lets the
 * two halves be read as one.
 */
export const CARRY_CHARACTERS = 2_048;

export type PreviewWatch = {
  /** Trailing output whose line was not finished by the last read. */
  carry: string;
  preview: DevPreview | null;
  /**
   * Whether a marked preview has ever been seen.
   *
   * A marker outranks a URL that merely appeared in passing, and it has to keep
   * outranking it after the fact — otherwise the next stray localhost address
   * in a log line would replace a preview the agent announced deliberately.
   */
  marked: boolean;
};

export function emptyPreviewWatch(): PreviewWatch {
  return { carry: "", preview: null, marked: false };
}

/** Reads newly arrived chunks and returns the watch, unchanged if nothing new. */
export function watchPreview(state: PreviewWatch, chunks: readonly string[]): PreviewWatch {
  if (chunks.length === 0) return state;

  const text = state.carry + chunks.join("");
  const found = findLatestDevPreview([text]);
  const marked = DEV_PREVIEW_PATTERN.test(text) || MOBILE_PREVIEW_PATTERN.test(text);
  const carry = text.slice(-CARRY_CHARACTERS);

  // Nothing to adopt: keep the preview already held.
  if (!found) return carry === state.carry ? state : { ...state, carry };
  // A bare URL cannot displace one the agent announced.
  if (state.marked && !marked) return { ...state, carry };

  return { carry, preview: found, marked: state.marked || marked };
}

/** Establishes a watch from output that was already on disk. Scans once. */
export function seedPreviewWatch(chunks: readonly string[]): PreviewWatch {
  return watchPreview(emptyPreviewWatch(), chunks);
}
