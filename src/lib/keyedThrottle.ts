/**
 * Passes the first call per key through at once, then at most one per
 * interval, always ending on the latest value.
 *
 * For terminal resizes: every size a dragged window passes through used to
 * reach the PTY, and each one makes a TUI repaint its whole screen. The final
 * size is never dropped, only the ones in between.
 */
export function createKeyedThrottle<T>(intervalMs: number, send: (key: string, value: T) => void) {
  const lastSent = new Map<string, number>();
  const pending = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>();

  const flush = (key: string) => {
    const waiting = pending.get(key);
    if (!waiting) return;
    pending.delete(key);
    lastSent.set(key, Date.now());
    send(key, waiting.value);
  };

  return (key: string, value: T) => {
    const waiting = pending.get(key);
    if (waiting) {
      waiting.value = value;
      return;
    }
    const since = Date.now() - (lastSent.get(key) ?? 0);
    if (since >= intervalMs) {
      lastSent.set(key, Date.now());
      send(key, value);
      return;
    }
    pending.set(key, { value, timer: setTimeout(() => flush(key), intervalMs - since) });
  };
}
