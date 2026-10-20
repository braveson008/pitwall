export type TerminalWrite = (payload: { sessionId: string; data: string }) => Promise<unknown>;

/**
 * Whether a PTY write landed. The bridge answers `{ ok: false }` when there is
 * no terminal behind the session; anything else — including the `undefined` of
 * a caller that reports nothing — counts as delivered, since treating silence
 * as failure would make every successful write look like a lost one.
 */
function delivered(result: unknown) {
  return !(result && typeof result === "object" && (result as { ok?: unknown }).ok === false);
}

/** Bytes per PTY write. Small enough that a composer keeps up with the stream. */
const PIECE = 1024;

/**
 * Splits without ever cutting a surrogate pair. A prompt carries file paths and
 * prose that may include astral characters, and half a pair is a replacement
 * character in the agent's input rather than the character that was written.
 */
export function splitForPty(content: string, size = PIECE): string[] {
  if (content.length <= size) return [content];
  const pieces: string[] = [];
  let index = 0;
  while (index < content.length) {
    let end = Math.min(index + size, content.length);
    const code = content.charCodeAt(end - 1);
    if (end < content.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    pieces.push(content.slice(index, end));
    index = end;
  }
  return pieces;
}

/**
 * How long to wait after the last piece before pressing Enter.
 *
 * A fixed gap is a race. A council brief runs to tens of thousands of
 * characters, and a TUI that is still absorbing the paste when Enter arrives
 * submits the fragment it has and leaves the remainder in the composer. The
 * next Enter then sends that remainder, which reaches the agent as a message
 * beginning mid-sentence. Waiting in proportion to the size costs a moment on a
 * long prompt and nothing on a short one.
 */
export function settleMs(length: number, boundaryMs: number): number {
  if (boundaryMs <= 0) return 0;
  return Math.min(2000, Math.max(boundaryMs, Math.round(length / 40)));
}

/**
 * Agent TUIs can collapse a long write as pasted content. Sending Enter in the
 * same PTY write leaves that paste sitting in the composer, so submission must
 * cross a separate write boundary.
 *
 * Returns whether the prompt reached the terminal. Callers that are waiting on
 * the agent to do something need to know: a prompt written into a session with
 * no PTY behind it disappears silently, and whatever was expecting a reply waits
 * for one that was never asked for.
 */
export async function submitTerminalPrompt(
  write: TerminalWrite,
  sessionId: string,
  prompt: string,
  boundaryMs = 120,
): Promise<boolean> {
  const content = prompt.trim();
  if (!content) return false;

  const pieces = splitForPty(content);
  for (let index = 0; index < pieces.length; index += 1) {
    if (!delivered(await write({ sessionId, data: pieces[index] }))) return false;
    // Yield between pieces so the reader drains rather than meeting the whole
    // prompt in one burst.
    if (boundaryMs > 0 && index < pieces.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  }

  const settle = settleMs(content.length, boundaryMs);
  if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle));
  return delivered(await write({ sessionId, data: "\r" }));
}
