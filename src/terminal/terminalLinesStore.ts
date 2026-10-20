/**
 * Terminal output, outside React state.
 *
 * It used to be App state, so every frame with output from any session
 * rendered the whole app — the board, the sidebar, every hidden pane — to
 * update one terminal. Now each pane subscribes to its own session and is the
 * only thing that renders when that session prints.
 */

export type TerminalLines = Record<string, string[]>;

export type TerminalLinesStore = {
  get: (sessionId: string) => string[] | undefined;
  getAll: () => TerminalLines;
  /** Replaces the lines, telling only the sessions whose lines changed. */
  publish: (next: TerminalLines) => void;
  subscribe: (sessionId: string, listener: () => void) => () => void;
  subscribeAll: (listener: () => void) => () => void;
};

export function createTerminalLinesStore(initial: TerminalLines): TerminalLinesStore {
  let current = initial;
  const bySession = new Map<string, Set<() => void>>();
  const everyone = new Set<() => void>();

  return {
    get: (sessionId) => current[sessionId],
    getAll: () => current,
    publish(next) {
      if (next === current) return;
      const previous = current;
      current = next;
      for (const [sessionId, listeners] of bySession) {
        if (previous[sessionId] === next[sessionId]) continue;
        for (const listener of listeners) listener();
      }
      for (const listener of everyone) listener();
    },
    subscribe(sessionId, listener) {
      let listeners = bySession.get(sessionId);
      if (!listeners) {
        listeners = new Set();
        bySession.set(sessionId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0) bySession.delete(sessionId);
      };
    },
    subscribeAll(listener) {
      everyone.add(listener);
      return () => everyone.delete(listener);
    },
  };
}
