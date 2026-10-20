import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyedThrottle } from "./keyedThrottle";

describe("keyed throttle", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => vi.useRealTimers());

  it("sends a lone call at once", () => {
    const sent: Array<[string, number]> = [];
    const throttle = createKeyedThrottle<number>(100, (key, value) => sent.push([key, value]));
    throttle("a", 1);
    expect(sent).toEqual([["a", 1]]);
  });

  it("collapses a burst to the first and the last", () => {
    const sent: number[] = [];
    const throttle = createKeyedThrottle<number>(100, (_key, value) => sent.push(value));
    for (let value = 1; value <= 10; value += 1) { throttle("a", value); vi.advanceTimersByTime(10); }
    vi.advanceTimersByTime(200);
    expect(sent[0]).toBe(1);
    expect(sent.at(-1)).toBe(10);
    expect(sent.length).toBeLessThanOrEqual(3);
  });

  it("keys do not hold each other back", () => {
    const sent: string[] = [];
    const throttle = createKeyedThrottle<number>(100, (key) => sent.push(key));
    throttle("a", 1);
    throttle("b", 1);
    expect(sent).toEqual(["a", "b"]);
  });
});
