import { describe, expect, it } from "vitest";
import { terminalThemeForColorTheme } from "./terminalTheme";

describe("terminal palettes for the Pitlane themes", () => {
  it("gives each theme its own ground and all sixteen colours", () => {
    expect(terminalThemeForColorTheme("vt220").background).toBe("#0a0a08");
    expect(terminalThemeForColorTheme("acme").background).toBe("#ffffea");
    expect(terminalThemeForColorTheme("night-city").background).toBe("#07080b");
    for (const id of ["vt220", "acme", "night-city"]) {
      const theme = terminalThemeForColorTheme(id) as Record<string, string>;
      for (const key of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"]) {
        expect(theme[key], `${id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("night city selection is the flat cyan tint", () => {
    expect(terminalThemeForColorTheme("night-city").selectionBackground).toBe("rgba(5,217,232,.14)");
  });

  it("the Pitwall theme keeps its dark terminal", () => {
    expect(terminalThemeForColorTheme("braveli").background).toBe("#0d1016");
  });
});
