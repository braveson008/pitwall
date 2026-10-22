import { describe, expect, it } from "vitest";
import { terminalKeyAction } from "./terminalKeys";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
  ({ type: "keydown", key: k, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...mods });

describe("keys inside a terminal on Windows", () => {
  it("copies a selection with Ctrl+C and interrupts without one", () => {
    expect(terminalKeyAction(key("c", { ctrlKey: true }), false, true)).toBe("copy");
    expect(terminalKeyAction(key("c", { ctrlKey: true }), false, false)).toBe("terminal");
    expect(terminalKeyAction(key("C", { ctrlKey: true, shiftKey: true }), false, true)).toBe("copy");
  });

  it("pastes with Ctrl+V and Ctrl+Shift+V instead of sending ^V", () => {
    expect(terminalKeyAction(key("v", { ctrlKey: true }), false, false)).toBe("paste");
    expect(terminalKeyAction(key("V", { ctrlKey: true, shiftKey: true }), false, false)).toBe("paste");
  });

  it("hands Ctrl+Shift app shortcuts to Pitwall and keeps plain Ctrl keys for the agent", () => {
    for (const k of ["K", "P", "J", "N", "B", "E", "<", "~"]) {
      expect(terminalKeyAction(key(k, { ctrlKey: true, shiftKey: true }), false, false)).toBe("app");
    }
    for (const k of ["k", "p", "j", "n", "b", "e", "a"]) {
      expect(terminalKeyAction(key(k, { ctrlKey: true }), false, false)).toBe("terminal");
    }
  });

  it("only acts on key presses", () => {
    expect(terminalKeyAction({ ...key("v", { ctrlKey: true }), type: "keyup" }, false, false)).toBe("terminal");
  });
});

describe("keys inside a terminal on a Mac", () => {
  it("leaves every key as it was: Command shortcuts already pass xterm by", () => {
    expect(terminalKeyAction(key("c", { ctrlKey: true }), true, true)).toBe("terminal");
    expect(terminalKeyAction(key("v", { ctrlKey: true }), true, false)).toBe("terminal");
    expect(terminalKeyAction(key("K", { ctrlKey: true, shiftKey: true }), true, false)).toBe("terminal");
  });
});
