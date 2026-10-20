import { describe, expect, it } from "vitest";
import { markerPattern, migrateLegacyStorage } from "./legacyNames";

function fakeStorage(entries: Record<string, string>, { quota = Infinity } = {}): Storage {
  const map = new Map(Object.entries(entries));
  const size = () => [...map].reduce((total, [key, value]) => total + key.length + value.length, 0);
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      const previous = map.get(key);
      map.set(key, String(value));
      if (size() > quota) {
        if (previous === undefined) map.delete(key);
        else map.set(key, previous);
        throw new DOMException("full", "QuotaExceededError");
      }
    },
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const contents = (storage: Storage) =>
  Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)!).map((key) => [key, storage.getItem(key)]));

describe("migrateLegacyStorage", () => {
  it("moves every braveli- key to its pitwall- name and leaves other keys alone", () => {
    const storage = fakeStorage({
      "braveli-projects": '[{"id":"p1"}]',
      "braveli-workspace-state": '{"tasks":[]}',
      "braveli-watch-p1": "on",
      "braveli-onboarded": "yes",
      "agent-studio-projects": "[]",
      "bravely-theme": "dark",
    });
    migrateLegacyStorage(storage);
    expect(contents(storage)).toEqual({
      "agent-studio-projects": "[]",
      "bravely-theme": "dark",
      "pitwall-projects": '[{"id":"p1"}]',
      "pitwall-workspace-state": '{"tasks":[]}',
      "pitwall-watch-p1": "on",
      "pitwall-onboarded": "yes",
    });
  });

  it("keeps a value already stored under the new name", () => {
    const storage = fakeStorage({ "braveli-notifications": "old", "pitwall-notifications": "new" });
    migrateLegacyStorage(storage);
    expect(contents(storage)).toEqual({ "pitwall-notifications": "new" });
  });

  it("renames the stored colour theme", () => {
    const storage = fakeStorage({ "braveli-color-theme": "braveli" });
    migrateLegacyStorage(storage);
    expect(contents(storage)).toEqual({ "pitwall-color-theme": "pitwall" });

    const other = fakeStorage({ "braveli-color-theme": "acme" });
    migrateLegacyStorage(other);
    expect(contents(other)).toEqual({ "pitwall-color-theme": "acme" });
  });

  it("moves a key even when storage is full", () => {
    const history = "x".repeat(1000);
    const storage = fakeStorage({ "braveli-terminal-history": history }, { quota: 1030 });
    migrateLegacyStorage(storage);
    expect(contents(storage)).toEqual({ "pitwall-terminal-history": history });
  });

  it("is a no-op the second time", () => {
    const storage = fakeStorage({ "braveli-projects": "[]" });
    migrateLegacyStorage(storage);
    migrateLegacyStorage(storage);
    expect(contents(storage)).toEqual({ "pitwall-projects": "[]" });
  });
});

describe("markerPattern", () => {
  it("matches a marker under its current and its old name", () => {
    const pattern = new RegExp(`^${markerPattern("PITWALL_TASK_SUMMARY")}$`);
    expect(pattern.test("PITWALL_TASK_SUMMARY")).toBe(true);
    expect(pattern.test("BRAVELI_TASK_SUMMARY")).toBe(true);
    expect(pattern.test("OTHER_TASK_SUMMARY")).toBe(false);
  });
});
