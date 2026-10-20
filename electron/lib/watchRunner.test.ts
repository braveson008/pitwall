import { describe, expect, it } from "vitest";
import { createWatchRunner } from "./watchRunner.cjs";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const watch = (id: string, extra = {}) => ({ id, projectId: "p", enabled: true, lastCheckedAt: 0, ...extra });

describe("watch runner", () => {
  it("a slow watch does not hold back the others", async () => {
    const slow = deferred();
    const checked: string[] = [];
    const runner = createWatchRunner({
      list: () => [watch("tickets"), watch("reviews")],
      intervalMs: () => 60_000,
      detect: async (item: { id: string }) => { if (item.id === "tickets") await slow.promise; checked.push(item.id); },
    });
    void runner.check();
    await new Promise((done) => setTimeout(done, 0));
    expect(checked).toEqual(["reviews"]);
    slow.resolve();
  });

  it("Check now runs while another check is in flight, and waits for it", async () => {
    const slow = deferred();
    const runs: string[] = [];
    const runner = createWatchRunner({
      list: () => [watch("tickets"), watch("reviews", { lastCheckedAt: Date.now() })],
      intervalMs: () => 60_000,
      detect: async (item: { id: string }) => { runs.push(item.id); if (item.id === "tickets") await slow.promise; },
    });
    void runner.check();
    await new Promise((done) => setTimeout(done, 0));
    let finished = false;
    const now = runner.check({ force: true }).then(() => { finished = true; });
    await new Promise((done) => setTimeout(done, 0));
    // The fresh watch is checked anyway; the one already running is joined, not started twice.
    expect(runs).toEqual(["tickets", "reviews"]);
    expect(finished).toBe(false);
    slow.resolve();
    await now;
    expect(finished).toBe(true);
  });

  it("skips paused watches, other projects, and watches not yet due", async () => {
    const runs: string[] = [];
    const runner = createWatchRunner({
      list: () => [watch("paused", { enabled: false }), watch("other", { projectId: "q" }), watch("fresh", { lastCheckedAt: Date.now() }), watch("due")],
      intervalMs: () => 60_000,
      detect: async (item: { id: string }) => { runs.push(item.id); },
    });
    await runner.check({ projectId: "p" });
    expect(runs).toEqual(["due"]);
  });

  it("a failing check does not stop the rest", async () => {
    const runs: string[] = [];
    const runner = createWatchRunner({
      list: () => [watch("broken"), watch("fine")],
      intervalMs: () => 60_000,
      detect: async (item: { id: string }) => { if (item.id === "broken") throw new Error("boom"); runs.push(item.id); },
    });
    await runner.check();
    expect(runs).toEqual(["fine"]);
  });
});
