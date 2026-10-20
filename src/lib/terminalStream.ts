import { TERMINAL_REPLAY_RESET } from "./terminalHistory";

/**
 * A pane's buffer holds two kinds of entry: raw PTY output, which is a byte
 * stream, and notices Pitwall prints into the pane itself. They used to be told
 * apart by sniffing the entry for a control character, and a PTY chunk that
 * happened to carry none — a word of streamed prose landing on its own read
 * boundary — was mistaken for a notice and had a line break appended to it.
 *
 * That break moved the cursor out from under the CLI's own redraws. Everything
 * the CLI painted afterwards, positioned relative to where it believed the
 * cursor was, landed a row off and overwrote text already on screen, which is
 * how a pane ended up with characters interleaved mid-word. It happened at
 * random because nothing about the output decides where the kernel splits it.
 *
 * Notices now carry their line ending from the moment they are made, so nothing
 * downstream has to guess: every entry in the buffer is written verbatim.
 */
export function terminalNotice(text: string) {
  return `${text}\r\n`;
}

export function terminalNotices(lines: string[]) {
  return lines.map(terminalNotice);
}

export type TerminalWritePlan = {
  /** Clear the screen and replay from the start of the buffer. */
  reset: boolean;
  /** The entries to hand the terminal, in order and unmodified. */
  writes: readonly string[];
};

/**
 * What a pane still owes its terminal, given how much of the buffer it has
 * already written and the last entry it wrote.
 *
 * A buffer normally only grows, and a pane just writes the tail it has not seen.
 * But a buffer can also be *replaced* — a council run reseeding its panes, a
 * session restarting — while the pane stays mounted, because it is keyed by
 * session and the session did not change. A replacement leaves the write
 * position pointing into a buffer that no longer exists: past the end of the
 * new one, so every later chunk is silently swallowed and the pane freezes, or
 * into the middle of it, so the pane writes output it has already shown. Both
 * are caught by checking that the entry the pane last wrote is still sitting
 * where it wrote it.
 */
export function terminalWritePlan(
  chunks: readonly string[],
  written: number,
  lastWritten: string | null,
  replayCharacters: number = REPLAY_CHARACTERS,
  /**
   * How many chunks have been dropped off the front of this session's buffer.
   *
   * The buffer is bounded, so it is a sliding window rather than a log: once it
   * is full, every flush removes chunks from the start and every index shifts.
   * Without this the check below sees a different chunk at the position it last
   * wrote, concludes the buffer was replaced, and resets the terminal for a
   * full replay — on every frame, which reads as a flickering pane.
   */
  dropped: number = 0,
  /**
   * The modes the session's program had switched on (full screen, mouse
   * reporting…), restored before any replay that does not start at the very
   * beginning of the stream — which is where the program turned them on.
   */
  preamble: string = "",
): TerminalWritePlan {
  // The caller counts in absolute terms; this array starts at `dropped`.
  const position = written - dropped;
  const replay = () => replayTail(chunks, replayCharacters, dropped > 0 ? preamble : "");
  // Behind the window: the chunks this pane had not written yet are gone, so a
  // replay is the only honest answer.
  if (written > 0 && position < 0) return { reset: true, writes: replay() };
  const replaced = position > 0 && (position > chunks.length || chunks[position - 1] !== lastWritten);
  if (replaced) return { reset: true, writes: replay() };
  // Nothing written yet: this terminal is new, so what it owes is a replay
  // rather than a tail, and a replay is worth bounding.
  if (written === 0) return { reset: false, writes: replay() };
  return { reset: false, writes: chunks.slice(position) };
}

/**
 * How much of a buffer is worth replaying into a new terminal.
 *
 * A pane that mounts has to catch up on everything its session has said, and it
 * used to be handed the whole buffer — tens of thousands of writes and several
 * megabytes of escape sequences to parse. Almost all of that work is wasted:
 * the terminal keeps 5000 lines of scrollback and discards the rest as it goes,
 * so the beginning is parsed only to be thrown away. Switching to a long-running
 * session paid for all of it.
 *
 * Sized to comfortably exceed what that scrollback can hold.
 */
export const REPLAY_CHARACTERS = 1_000_000;

/**
 * The tail of a buffer, cut at chunk boundaries.
 *
 * Whole entries only — a chunk is a raw PTY read and can end mid-escape, so
 * cutting inside one would hand the terminal half a sequence. This is safe here
 * and only here: it feeds a terminal that has nothing on it yet. Trimming the
 * buffer a *live* terminal is mid-stream on is what corrupts a session, because
 * the replay resumes at an arbitrary point in a TUI's redraw.
 */
function replayTail(chunks: readonly string[], budget: number, preamble = ""): readonly string[] {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  if (total <= budget) return preamble ? [preamble, ...chunks] : chunks;

  let kept = 0;
  let index = chunks.length;
  while (index > 0 && kept + chunks[index - 1].length <= budget) {
    index -= 1;
    kept += chunks[index].length;
  }
  // Always something, even if a single chunk is larger than the whole budget.
  if (index === chunks.length) index = chunks.length - 1;
  // The replay now starts mid-stream, so whatever escape last set a colour is
  // gone while its effect is not.
  return [TERMINAL_REPLAY_RESET, ...(preamble ? [preamble] : []), ...coalesce(chunks.slice(index))];
}

/** How much replayed output goes into one write. */
const WRITE_BLOCK_CHARACTERS = 64 * 1024;

/**
 * Joins adjacent entries into fewer, larger writes.
 *
 * A bounded replay is still tens of thousands of entries, and each one was a
 * separate call into the terminal with its own queueing and bookkeeping. The
 * parser is a stream: handing it two entries in one call is byte-for-byte the
 * same as handing it one after the other. Only whole entries are ever joined,
 * so no escape sequence is split across a block.
 */
function coalesce(chunks: readonly string[]): string[] {
  const blocks: string[] = [];
  let block = "";
  for (const chunk of chunks) {
    block += chunk;
    if (block.length >= WRITE_BLOCK_CHARACTERS) {
      blocks.push(block);
      block = "";
    }
  }
  if (block) blocks.push(block);
  return blocks;
}

export type TerminalSize = { cols: number; rows: number };

/**
 * Whether a pane coming back on screen has to clear and replay.
 *
 * A session can be rendered in two places at once — its row in the Terminal tab
 * and its cell in the Council grid. Each pane fits itself and each resizes the
 * single PTY they share, so only the visible one's shape matches it. The hidden
 * one keeps taking output drawn for the other pane's shape, and showing it
 * reflows that into overlapping boxes and half-drawn rules.
 *
 * Both dimensions count. Comparing widths alone missed the ordinary case of two
 * panes the same width and different heights — a council cell against a
 * full-height terminal row — which left the pane rendering a screen laid out
 * for a different number of rows: the output stranded, most of the pane empty.
 */
export function needsResync(pty: TerminalSize | undefined, pane: TerminalSize): boolean {
  if (!pty || !pty.cols || !pty.rows) return false;
  return pty.cols !== pane.cols || pty.rows !== pane.rows;
}


/**
 * Where a raw PTY read stops being safe to store.
 *
 * The kernel splits output wherever it likes, so a read can end half way
 * through an escape sequence. Stored like that, a replay that starts at the
 * next entry begins with the sequence's second half and prints it as text
 * ("[K…"), with the terminal's parser out of step. The unfinished sequence is
 * held back and joined to the next read, so every stored entry starts and ends
 * on a boundary. Anything implausibly long is let through rather than held.
 */
const ESCAPE_HOLD_LIMIT = 4096;
const INCOMPLETE_ESCAPE = [
  /\x1b$/,
  /\x1b\[[0-9;:?<=>!]*[ -/]*$/,
  /\x1b[\]P_^X][^\x07\x1b]*(?:\x1b)?$/,
  /\x1b[()*+#%][^]?$/,
];

export function splitAtEscapeBoundary(data: string): { ready: string; carry: string } {
  const at = data.lastIndexOf("\x1b");
  if (at < 0 || data.length - at > ESCAPE_HOLD_LIMIT) return { ready: data, carry: "" };
  const tail = data.slice(at);
  // A tail whose own escape is complete is not held, whatever came before it.
  const incomplete = INCOMPLETE_ESCAPE.some((pattern) => pattern.test(tail))
    && !/^\x1b[()*+#%].$/.test(tail);
  return incomplete ? { ready: data.slice(0, at), carry: tail } : { ready: data, carry: "" };
}

/**
 * The private modes a terminal program switched on, followed across the whole
 * stream. A bounded replay starts somewhere in the middle and never sees the
 * program turn them on; without them a full-screen agent (Claude Code) is
 * replayed into the normal screen, and the mouse wheel scrolls the terminal's
 * own history instead of reaching the program, which reads as a frozen pane.
 */
const TRACKED_MODES = ["1", "25", "47", "1047", "1049", "1000", "1002", "1003", "1004", "1005", "1006", "1015", "2004", "2026"];
const ALT_SCREEN = ["47", "1047", "1049"];

export type TerminalModeTracker = { observe: (chunk: string) => void; preamble: () => string };

export function createModeTracker(): TerminalModeTracker {
  const modes = new Map<string, boolean>();
  let carry = "";
  return {
    observe(chunk) {
      const text = carry + chunk;
      for (const match of text.matchAll(/\x1b\[\?([0-9;]+)([hl])/g)) {
        for (const mode of match[1].split(";")) {
          if (TRACKED_MODES.includes(mode)) modes.set(mode, match[2] === "h");
        }
      }
      // Enough to rejoin a sequence a read split in two.
      carry = text.slice(-24);
    },
    preamble() {
      const on = (mode: string) => modes.get(mode) === true;
      let out = "";
      // The alternate screen first, so everything after lands on it.
      if (ALT_SCREEN.some(on)) out += "\x1b[?1049h";
      for (const mode of TRACKED_MODES) {
        if (ALT_SCREEN.includes(mode) || mode === "25") continue;
        if (on(mode)) out += `\x1b[?${mode}h`;
      }
      if (modes.get("25") === false) out += "\x1b[?25l";
      return out;
    },
  };
}
