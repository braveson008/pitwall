import { describe, expect, it, vi } from "vitest";
import { createTerminalLinesStore } from "./terminalLinesStore";

describe("terminal lines store", () => {
  it("tells only the session whose lines changed", () => {
    const store = createTerminalLinesStore({ a: ["1"], b: ["2"] });
    const onA = vi.fn();
    const onB = vi.fn();
    const onAny = vi.fn();
    store.subscribe("a", onA);
    store.subscribe("b", onB);
    store.subscribeAll(onAny);

    const current = store.getAll();
    store.publish({ ...current, a: ["1", "more"] });
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
    expect(onAny).toHaveBeenCalledTimes(1);
    expect(store.get("a")).toEqual(["1", "more"]);

    store.publish(store.getAll());
    expect(onAny).toHaveBeenCalledTimes(1);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = createTerminalLinesStore({});
    const listener = vi.fn();
    const off = store.subscribe("a", listener);
    off();
    store.publish({ a: ["x"] });
    expect(listener).not.toHaveBeenCalled();
  });
});
