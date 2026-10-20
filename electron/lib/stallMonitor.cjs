/**
 * Records when the app stops responding, and what it was doing at the time.
 *
 * Main-process JavaScript runs on Electron's UI thread, so a long synchronous
 * stretch there freezes every window. Reasoning about which code does that has
 * been unreliable; this writes it down as it happens instead. Three things are
 * recorded, each only when it crosses the threshold:
 *
 * - an event-loop stall, with the IPC calls in flight and those that finished
 *   inside the stalled window;
 * - an IPC handler whose synchronous part alone ran that long;
 * - a renderer long task, reported by the renderer.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const MAX_LOG_BYTES = 1024 * 1024;

function createStallMonitor({ thresholdMs = 200, intervalMs = 50, record, now = () => performance.now() }) {
  const inFlight = new Map();
  let finished = [];
  let sequence = 0;
  let last = now();
  let timer = null;

  const begin = (channel) => {
    const id = ++sequence;
    inFlight.set(id, { channel, at: now() });
    return () => {
      const entry = inFlight.get(id);
      if (!entry) return;
      inFlight.delete(id);
      finished.push({ channel, at: entry.at, end: now() });
    };
  };

  const call = (channel, handler, args) => {
    const end = begin(channel);
    const started = now();
    let result;
    try {
      result = handler(...args);
    } catch (error) {
      end();
      throw error;
    } finally {
      const sync = now() - started;
      if (sync >= thresholdMs) record({ kind: "slow-handler", channel, syncMs: Math.round(sync) });
    }
    if (result && typeof result.then === "function") {
      return result.finally(end);
    }
    end();
    return result;
  };

  const tick = () => {
    const at = now();
    const blocked = at - last - intervalMs;
    const windowStart = last;
    last = at;
    if (blocked >= thresholdMs) {
      record({
        kind: "main-stall",
        blockedMs: Math.round(blocked),
        inFlight: [...inFlight.values()].map((entry) => `${entry.channel} (${Math.round(at - entry.at)}ms)`),
        finished: finished
          .filter((entry) => entry.end >= windowStart)
          .map((entry) => `${entry.channel} (${Math.round(entry.end - entry.at)}ms)`),
      });
    }
    finished = finished.filter((entry) => entry.end >= at - intervalMs);
  };

  return {
    call,
    tick,
    start() {
      if (timer) return;
      last = now();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

/** Routes every handler registered from here on through the monitor. */
function instrumentIpc(ipcMain, monitor) {
  const handle = ipcMain.handle.bind(ipcMain);
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, (...args) => monitor.call(channel, handler, args));
  ipcMain.on = (channel, listener) => on(channel, (...args) => monitor.call(channel, listener, args));
}

/** One JSON line per event, and the file starts over once it passes 1 MB. */
function createStallLog(resolveFile) {
  let queue = Promise.resolve();
  return (event) => {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
    queue = queue.then(async () => {
      const file = resolveFile();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const size = await fs.stat(file).then((stat) => stat.size, () => 0);
      if (size > MAX_LOG_BYTES) await fs.rename(file, `${file}.1`).catch(() => {});
      await fs.appendFile(file, line);
    }).catch(() => {});
  };
}

module.exports = { createStallMonitor, instrumentIpc, createStallLog };
