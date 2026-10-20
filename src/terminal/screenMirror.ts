import { Terminal } from "@xterm/headless";

/**
 * A copy of every session's screen, kept whether or not anyone is looking.
 *
 * The rail's whole claim is that it can tell you which session needs you. It
 * could not: the state it reads — the menu a CLI is waiting on — is read off a
 * rendered terminal, and a rendered terminal only exists for panes that are
 * mounted. Panes are only ever mounted for sessions you have selected, so a
 * session you had not clicked could sit on an unanswered prompt indefinitely
 * while its row said "Working". You had to visit a session to find out it
 * wanted you, which is the thing the rail exists to save you from.
 *
 * These terminals parse the same bytes with no DOM, no renderer and no canvas.
 * They exist to be read, never to be shown.
 */

/**
 * Wide and tall enough that a prompt is not wrapped or scrolled out of the
 * screen area before it can be read. The real pane's size varies with the
 * window; this one only has to hold a frame long enough to search it.
 */
const MIRROR_COLS = 220;
const MIRROR_ROWS = 80;

export type ScreenMirror = {
  write(sessionId: string, chunks: readonly string[]): void;
  /**
   * Resolves once the parser has drained what has been written.
   *
   * `write` is asynchronous — xterm queues bytes and parses them on its own
   * schedule — so a read taken in the same tick sees an empty screen. Nothing
   * in the app needs this, because reads happen on a timer long after the
   * writes they follow; a test that writes and reads in one breath does.
   */
  flush(sessionId: string): Promise<void>;
  read(sessionId: string): string | null;
  drop(sessionId: string): void;
  /**
   * Limits mirroring to the sessions whose screens are actually read — the
   * project on screen and the council being watched. Others are skipped.
   */
  setScope(sessionIds: readonly string[]): void;
  retain(sessionIds: readonly string[]): void;
  size(): number;
  dispose(): void;
};

function readTerminal(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < terminal.rows; row += 1) {
    // baseY, not viewportY — the active screen area. Matches how a mounted
    // pane reads itself, so a menu is detected the same way in both.
    const line = buffer.getLine(buffer.baseY + row);
    lines.push(line ? line.translateToString(true) : "");
  }
  return lines.join("\n");
}

export function createScreenMirror(): ScreenMirror {
  const terminals = new Map<string, Terminal>();
  /**
   * Sessions whose screen anything actually reads.
   *
   * Every reader is scoped to the project on screen or the council being
   * watched — the rail's "needs you" check walks `activeProject.sessions`, and
   * the member cards read their own run. A session in a project you are not
   * looking at is parsed by nobody, so mirroring it is pure cost: one headless
   * terminal per session, parsing every byte, scheduling xterm's render
   * debouncer on every write.
   *
   * Measured with four projects of eight sessions: mirroring all of them made
   * the worst project switch 4.0 seconds and blocked the main thread for 68 ms
   * at a time. Mirroring none of them made the worst switch 235 ms and blocked
   * it for nothing. This keeps the ones that are read and drops the rest.
   *
   * Empty means "no scope set" — everything is mirrored, which is the correct
   * behaviour before the app has told it otherwise.
   */
  let scope: Set<string> | null = null;

  const terminalFor = (sessionId: string) => {
    const existing = terminals.get(sessionId);
    if (existing) return existing;
    const terminal = new Terminal({
      cols: MIRROR_COLS,
      rows: MIRROR_ROWS,
      // Nothing scrolls back through this one, and scrollback is the expensive
      // part of keeping a terminal for a session that has run all day.
      scrollback: 0,
      allowProposedApi: true,
    });
    terminals.set(sessionId, terminal);
    return terminal;
  };

  return {
    write(sessionId, chunks) {
      if (chunks.length === 0) return;
      // Nothing reads this one. Its output still reaches the pane and the
      // transcript; only the off-screen parse is skipped.
      if (scope && !scope.has(sessionId)) return;
      const terminal = terminalFor(sessionId);
      // Joined into one write: the parser is a stream, so this is byte-for-byte
      // the same as writing them in turn and costs one call instead of many.
      terminal.write(chunks.join(""));
    },
    flush(sessionId) {
      const terminal = terminals.get(sessionId);
      if (!terminal) return Promise.resolve();
      return new Promise((resolve) => terminal.write("", () => resolve()));
    },
    read(sessionId) {
      const terminal = terminals.get(sessionId);
      return terminal ? readTerminal(terminal) : null;
    },
    drop(sessionId) {
      terminals.get(sessionId)?.dispose();
      terminals.delete(sessionId);
    },
    /**
     * Narrows what is mirrored. A session leaving the scope loses its terminal
     * rather than keeping a stale screen: a screen that stopped updating an
     * hour ago is worse than none, because "waiting on you" would still be
     * true of it long after it was not.
     */
    setScope(sessionIds) {
      scope = new Set(sessionIds);
      for (const [id, terminal] of terminals) {
        if (scope.has(id)) continue;
        terminal.dispose();
        terminals.delete(id);
      }
    },
    retain(sessionIds) {
      const live = new Set(sessionIds);
      for (const [id, terminal] of terminals) {
        if (live.has(id)) continue;
        terminal.dispose();
        terminals.delete(id);
      }
    },
    size() {
      return terminals.size;
    },
    dispose() {
      for (const terminal of terminals.values()) terminal.dispose();
      terminals.clear();
    },
  };
}
