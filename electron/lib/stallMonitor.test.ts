import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createStallMonitor, instrumentIpc } = require("./stallMonitor.cjs");

function clockedMonitor(options: Record<string, unknown> = {}) {
  let time = 0;
  const events: Record<string, unknown>[] = [];
  const monitor = createStallMonitor({ record: (event: Record<string, unknown>) => events.push(event), now: () => time, ...options });
  return { monitor, events, advance: (ms: number) => { time += ms; } };
}

describe("createStallMonitor", () => {
  it("records a stall with the call that was in flight across it", async () => {
    const { monitor, events, advance } = clockedMonitor();
    let release = () => {};
    const pending = monitor.call("knowledge:prepare", () => new Promise<void>((resolve) => { release = resolve; }), []);
    advance(450);
    monitor.tick();
    expect(events).toEqual([{ kind: "main-stall", blockedMs: 400, inFlight: ["knowledge:prepare (450ms)"], finished: [] }]);
    release();
    await pending;
  });

  it("names a synchronous handler that has already returned by the time the stall is seen", () => {
    const { monitor, events, advance } = clockedMonitor();
    monitor.call("git:status", () => { advance(300); return "done"; }, []);
    monitor.tick();
    expect(events).toEqual([
      { kind: "slow-handler", channel: "git:status", syncMs: 300 },
      { kind: "main-stall", blockedMs: 250, inFlight: [], finished: ["git:status (300ms)"] },
    ]);
  });

  it("stays quiet below the threshold and forgets calls from earlier windows", () => {
    const { monitor, events, advance } = clockedMonitor();
    monitor.call("git:status", () => { advance(40); }, []);
    advance(10);
    monitor.tick();
    advance(50);
    monitor.tick();
    advance(500);
    monitor.tick();
    expect(events).toEqual([{ kind: "main-stall", blockedMs: 450, inFlight: [], finished: [] }]);
  });

  it("passes results and errors through untouched", async () => {
    const { monitor } = clockedMonitor();
    expect(monitor.call("a", (x: number) => x + 1, [1])).toBe(2);
    await expect(monitor.call("b", async () => "ok", [])).resolves.toBe("ok");
    expect(() => monitor.call("c", () => { throw new Error("boom"); }, [])).toThrow("boom");
  });
});

describe("instrumentIpc", () => {
  it("wraps handlers registered after it, preserving their arguments and results", async () => {
    const registered: Record<string, (...args: unknown[]) => unknown> = {};
    const ipcMain = {
      handle(channel: string, handler: (...args: unknown[]) => unknown) { registered[channel] = handler; },
      on(channel: string, listener: (...args: unknown[]) => unknown) { registered[channel] = listener; },
    };
    const { monitor } = clockedMonitor();
    instrumentIpc(ipcMain, monitor);
    ipcMain.handle("sum", async (_event: unknown, a: number, b: number) => a + b);
    await expect(registered.sum({}, 2, 3)).resolves.toBe(5);
  });
});
