import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeStored, writeStoredJson } from "./storage";

/**
 * A localStorage with a byte budget, so the quota path is exercised for real
 * rather than by asserting that a mock was called.
 */
function fakeStorage(limitBytes: number) {
  const data = new Map<string, string>();
  const used = () =>
    [...data.entries()].reduce((total, [k, v]) => total + (k.length + v.length) * 2, 0);

  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => {
      const previous = data.get(key);
      data.delete(key);
      if (used() + (key.length + value.length) * 2 > limitBytes) {
        if (previous !== undefined) data.set(key, previous);
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, value);
    },
  };
}

function install(storage: ReturnType<typeof fakeStorage>) {
  vi.stubGlobal("window", { localStorage: storage });
}

describe("writeStored", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("stores a value when there is room", () => {
    const storage = fakeStorage(10_000);
    install(storage);
    expect(writeStored("pitwall-projects", "[1,2,3]")).toBe(true);
    expect(storage.getItem("pitwall-projects")).toBe("[1,2,3]");
  });

  it("evicts terminal history rather than lose the projects", () => {
    const storage = fakeStorage(4_000);
    install(storage);
    storage.data.set("pitwall-terminal-history", "x".repeat(1_800));

    const projects = "p".repeat(1_500);
    expect(writeStored("pitwall-projects", projects)).toBe(true);
    expect(storage.getItem("pitwall-projects")).toBe(projects);
    expect(storage.getItem("pitwall-terminal-history")).toBeNull();
  });

  it("keeps evicting until the write fits", () => {
    const storage = fakeStorage(4_000);
    install(storage);
    storage.data.set("pitwall-terminal-history", "x".repeat(900));
    storage.data.set("pitwall-preview-urls", "y".repeat(900));

    expect(writeStored("pitwall-projects", "p".repeat(1_800))).toBe(true);
    expect(storage.getItem("pitwall-terminal-history")).toBeNull();
    expect(storage.getItem("pitwall-preview-urls")).toBeNull();
  });

  it("does not evict terminal history to store terminal history", () => {
    const storage = fakeStorage(2_000);
    install(storage);
    storage.data.set("pitwall-terminal-history", "x".repeat(900));

    // Too large to fit either way. The point is that it reports failure rather
    // than deleting the old history and claiming success.
    expect(writeStored("pitwall-terminal-history", "x".repeat(5_000))).toBe(false);
    expect(storage.getItem("pitwall-terminal-history")).toBe("x".repeat(900));
  });

  it("never throws when the budget cannot be met", () => {
    const storage = fakeStorage(100);
    install(storage);
    expect(() => writeStored("pitwall-projects", "p".repeat(10_000))).not.toThrow();
    expect(writeStored("pitwall-projects", "p".repeat(10_000))).toBe(false);
  });

  it("reports failure for errors that are not about space, without evicting", () => {
    const storage = fakeStorage(10_000);
    install(storage);
    storage.data.set("pitwall-terminal-history", "keep me");
    storage.setItem = () => {
      throw new Error("SecurityError");
    };
    expect(writeStored("pitwall-projects", "x")).toBe(false);
    expect(storage.getItem("pitwall-terminal-history")).toBe("keep me");
  });
});

describe("writeStoredJson", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("serialises and stores", () => {
    const storage = fakeStorage(10_000);
    install(storage);
    expect(writeStoredJson("pitwall-projects", [{ id: "a" }])).toBe(true);
    expect(storage.getItem("pitwall-projects")).toBe('[{"id":"a"}]');
  });

  it("refuses a value it cannot serialise instead of throwing", () => {
    const storage = fakeStorage(10_000);
    install(storage);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(writeStoredJson("pitwall-projects", cyclic)).toBe(false);
  });
});
