import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_FAMILY_MIGRATION,
  initialTerminalFontFamily,
  initialTerminalFontSize,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSize,
} from "./terminalOptions";

describe("terminal typography options", () => {
  it("normalizes font sizes into the supported range", () => {
    expect(normalizeTerminalFontSize("12")).toBe(12);
    expect(normalizeTerminalFontSize(2)).toBe(10);
    expect(normalizeTerminalFontSize(42)).toBe(18);
    expect(normalizeTerminalFontSize("invalid")).toBe(12);
  });

  it("keeps a size someone stored under the old default", () => {
    expect(normalizeTerminalFontSize("11")).toBe(11);
  });

  it("only restores supported font families", () => {
    expect(normalizeTerminalFontFamily('"JetBrains Mono", monospace')).toBe('"JetBrains Mono", monospace');
    expect(normalizeTerminalFontFamily('"Intel One Mono", monospace')).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
    expect(normalizeTerminalFontFamily("Comic Sans MS")).toBe(DEFAULT_TERMINAL_FONT_FAMILY);
  });
});

describe("initialTerminalFontSize", () => {
  it("moves the old stored default to 12 once, and keeps any size chosen", () => {
    expect(initialTerminalFontSize("11", null)).toBe(12);
    expect(initialTerminalFontSize("11", "12")).toBe(11);
    expect(initialTerminalFontSize("14", null)).toBe(14);
    expect(initialTerminalFontSize(null, null)).toBe(12);
  });
});

describe("initialTerminalFontFamily", () => {
  it("moves the old stored default to Zed's Lilex once, and keeps any face chosen", () => {
    expect(DEFAULT_TERMINAL_FONT_FAMILY).toBe("Lilex, monospace");
    expect(initialTerminalFontFamily("ui-monospace, monospace", null)).toBe("Lilex, monospace");
    expect(initialTerminalFontFamily(null, null)).toBe("Lilex, monospace");
    expect(initialTerminalFontFamily('"JetBrains Mono", monospace', null)).toBe('"JetBrains Mono", monospace');
    expect(initialTerminalFontFamily("Menlo, monospace", TERMINAL_FONT_FAMILY_MIGRATION)).toBe("Menlo, monospace");
    // "SF Mono (system)" drew Menlo in Electron, so it is no longer offered.
    expect(initialTerminalFontFamily("ui-monospace, monospace", TERMINAL_FONT_FAMILY_MIGRATION)).toBe("Lilex, monospace");
  });
});
