import { describe, expect, it } from "vitest";
import { filesShortcutLabel, isFilesShortcut, shortcutLabel } from "./shortcutLabel";

describe("shortcutLabel", () => {
  it("keeps Mac labels on a Mac", () => {
    expect(shortcutLabel("Search  ⌘K", true)).toBe("Search  ⌘K");
  });

  it("says Ctrl elsewhere", () => {
    expect(shortcutLabel("Search  ⌘K", false)).toBe("Search  Ctrl+K");
    expect(shortcutLabel("⌘↵ to send", false)).toBe("Ctrl+Enter to send");
    expect(shortcutLabel("Send back  ⌘⇧↵", false)).toBe("Send back  Ctrl+Shift+Enter");
    expect(shortcutLabel("Settings  ⌘,", false)).toBe("Settings  Ctrl+,");
  });

  it("toggles Files without taking Ctrl+E from the terminal", () => {
    const press = (mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }>) =>
      ({ key: "e", metaKey: false, ctrlKey: false, shiftKey: false, ...mods });
    expect(isFilesShortcut(press({ metaKey: true }), true)).toBe(true);
    expect(isFilesShortcut(press({ ctrlKey: true }), false)).toBe(false);
    expect(isFilesShortcut(press({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(filesShortcutLabel(false)).toBe("Ctrl+Shift+E");
  });
});
