import type { ITheme } from "@xterm/xterm";

/**
 * The terminal canvas, in the app's own colours.
 *
 * Ground, text, cursor and selection come from the same tokens as the window
 * around it. The sixteen ANSI colours are a set tuned for each ground, since
 * CLIs pick them assuming a dark terminal; xterm's minimum contrast ratio
 * (set alongside) lifts anything a CLI paints in truecolor that would vanish.
 */

const LIGHT_ANSI = {
  black: "#1d1d1f",
  red: "#c4332f",
  green: "#1a7f44",
  yellow: "#8f5d00",
  blue: "#1f62d9",
  magenta: "#9a3fb5",
  cyan: "#0f7681",
  white: "#6e6e73",
  brightBlack: "#86868b",
  brightRed: "#d9483f",
  brightGreen: "#248a4f",
  brightYellow: "#a36d00",
  brightBlue: "#2f6fe0",
  brightMagenta: "#a64dc1",
  brightCyan: "#128591",
  // CLIs use bright white for emphasis on a dark ground; here that is ink.
  brightWhite: "#1d1d1f",
};

// Zed's Ayu Dark terminal. Its "bright" row is darker than the normal one; that is Zed's
// choice, and the minimum contrast ratio keeps anything a CLI draws with it readable.
const DARK_ANSI = {
  black: "#0d1016",
  red: "#ef7177",
  green: "#aad84c",
  yellow: "#feb454",
  blue: "#5ac1fe",
  magenta: "#39bae5",
  cyan: "#95e5cb",
  white: "#bfbdb6",
  brightBlack: "#545557",
  brightRed: "#83353b",
  brightGreen: "#567627",
  brightYellow: "#92582b",
  brightBlue: "#27618c",
  brightMagenta: "#205a78",
  brightCyan: "#4c806f",
  brightWhite: "#fafafa",
};

export const TERMINAL_MINIMUM_CONTRAST = 4.5;

/** Relative luminance of a #rrggbb colour; anything unreadable counts as dark. */
export function isLightColour(value: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

function withAlpha(hex: string, alpha: number) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function terminalThemeFrom(tokens: { background: string; foreground: string; accent: string }): ITheme {
  const light = isLightColour(tokens.background);
  return {
    background: tokens.background,
    foreground: tokens.foreground,
    cursor: tokens.accent,
    cursorAccent: tokens.background,
    selectionBackground: withAlpha(tokens.accent, light ? 0.18 : 0.32),
    selectionInactiveBackground: withAlpha(tokens.accent, light ? 0.1 : 0.18),
    ...(light ? LIGHT_ANSI : DARK_ANSI),
  };
}

/**
 * The terminal is dark in both appearances: the CLIs inside it are designed
 * for a dark ground, and a light one made their own colour choices fight it.
 * It wears the app's dark window colours, so it still belongs to the window.
 */
export const TERMINAL_COLOURS = { background: "#0d1016", foreground: "#bfbdb6", accent: "#5ac1fe" };

// The Pitlane themes bring their own terminals, palettes copied from Pitlane's themes.ts.
const COLOR_THEME_TERMINALS: Record<string, ITheme> = {
  vt220: {
    background: "#0a0a08", foreground: "#e8a33c", cursor: "#ffd38a", cursorAccent: "#0a0a08", selectionBackground: "#3a2a0e",
    black: "#0a0a08", red: "#ff6b4a", green: "#9be37a", yellow: "#ffb000", blue: "#8fb3ff", magenta: "#d7a6ff", cyan: "#6fd3e8", white: "#e8a33c",
    brightBlack: "#7d5c26", brightRed: "#ff8f73", brightGreen: "#b9f09d", brightYellow: "#ffd38a", brightBlue: "#b3cbff", brightMagenta: "#e6c4ff", brightCyan: "#9ce4f2", brightWhite: "#fff1d6",
  },
  acme: {
    background: "#ffffea", foreground: "#1a1a1a", cursor: "#1a1a1a", cursorAccent: "#ffffea", selectionBackground: "#eeee9e",
    black: "#1a1a1a", red: "#b0261c", green: "#2c7a33", yellow: "#8a6d00", blue: "#1d3fa0", magenta: "#7a2e8f", cyan: "#0f6e7a", white: "#8a8a7a",
    brightBlack: "#8a8a7a", brightRed: "#d0372b", brightGreen: "#3a9442", brightYellow: "#a68400", brightBlue: "#2f55c4", brightMagenta: "#9440ab", brightCyan: "#168896", brightWhite: "#5a5a50",
  },
  "night-city": {
    background: "#07080b", foreground: "#d9f9ff", cursor: "#fcee0a", cursorAccent: "#07080b", selectionBackground: "rgba(5,217,232,.14)",
    black: "#07080b", red: "#ff2a6d", green: "#3cf2a0", yellow: "#fcee0a", blue: "#3d8bff", magenta: "#c86bff", cyan: "#05d9e8", white: "#d9f9ff",
    brightBlack: "#4a5560", brightRed: "#ff5c8f", brightGreen: "#7affc4", brightYellow: "#fff35c", brightBlue: "#70a9ff", brightMagenta: "#dc9bff", brightCyan: "#5ceaf4", brightWhite: "#ffffff",
  },
  "green-screen": {
    background: "#040a05", foreground: "#4af07a", cursor: "#b6ffc8", cursorAccent: "#040a05", selectionBackground: "#0f2a16",
    black: "#040a05", red: "#ff7a59", green: "#4af07a", yellow: "#d8f56a", blue: "#6fb8ff", magenta: "#c49bff", cyan: "#7fe8e0", white: "#4af07a",
    brightBlack: "#1f6b33", brightRed: "#ff9c82", brightGreen: "#8dffaa", brightYellow: "#ecff9a", brightBlue: "#9fd0ff", brightMagenta: "#dcc0ff", brightCyan: "#aef5ef", brightWhite: "#d9ffe2",
  },
  daylight: {
    background: "#fafafa", foreground: "#24292f", cursor: "#24292f", cursorAccent: "#fafafa", selectionBackground: "#dbe7f7",
    black: "#24292f", red: "#cf222e", green: "#1a7f37", yellow: "#9a6700", blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
    brightBlack: "#8c959f", brightRed: "#e0444f", brightGreen: "#2a9d4b", brightYellow: "#bf8700", brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#57606a",
  },
  synthwave: {
    background: "#1a1033", foreground: "#f3e8ff", cursor: "#ff7edb", cursorAccent: "#1a1033", selectionBackground: "rgba(255,126,219,.18)",
    black: "#1a1033", red: "#fe4450", green: "#72f1b8", yellow: "#fede5d", blue: "#6d77ff", magenta: "#ff7edb", cyan: "#36f9f6", white: "#f3e8ff",
    brightBlack: "#7a6a9e", brightRed: "#ff6b74", brightGreen: "#9cf7cf", brightYellow: "#ffe98a", brightBlue: "#959cff", brightMagenta: "#ffa5e6", brightCyan: "#7cfbf9", brightWhite: "#ffffff",
  },
  midnight: {
    background: "#0e1320", foreground: "#c9d4e5", cursor: "#e8eef8", cursorAccent: "#0e1320", selectionBackground: "#1f2a47",
    black: "#0e1320", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#c9d4e5",
    brightBlack: "#56637d", brightRed: "#ff94a8", brightGreen: "#b5e08a", brightYellow: "#f0c88c", brightBlue: "#9cbcff", brightMagenta: "#cfb6ff", brightCyan: "#a4ddff", brightWhite: "#eef3fb",
  },
};

export function terminalThemeForColorTheme(colorTheme: string | undefined): ITheme {
  return (colorTheme && COLOR_THEME_TERMINALS[colorTheme]) || terminalThemeFrom(TERMINAL_COLOURS);
}

export function currentTerminalTheme(): ITheme {
  return terminalThemeForColorTheme(typeof document === "undefined" ? undefined : document.documentElement.dataset.colorTheme);
}
