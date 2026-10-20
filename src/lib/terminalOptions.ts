import { isMacPlatform } from "./shortcutLabel";
export const TERMINAL_WEBGL_KEY = "pitwall-terminal-webgl";
export const TERMINAL_UNICODE11_KEY = "pitwall-terminal-unicode11";

/**
 * Removes two settings that no longer have a reader.
 *
 * They date from when the renderer was chosen by a stored flag. It is not
 * chosen that way any more: a pane loads the WebGL addon if a context can be
 * had and falls back on its own if one cannot, which is a decision about the
 * machine rather than a preference to remember. The name is kept accurate
 * because the function still does something — it clears the stale keys from an
 * older install — but it does not disable anything, and reading it as though
 * it does is what left every terminal on the slow renderer.
 */
export function clearStaleTerminalRendererOptions() {
  try {
    window.localStorage.removeItem(TERMINAL_WEBGL_KEY);
    window.localStorage.removeItem(TERMINAL_UNICODE11_KEY);
  } catch {
    // A locked-down profile has nothing stale to clear.
  }
}

export const DEFAULT_TERMINAL_FONT_SIZE = 12;
const LILEX = { value: "Lilex, monospace", label: "Lilex (Zed)" };
const MAC_FONT_FAMILIES = [
  LILEX,
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: "Menlo, monospace", label: "Menlo" },
  { value: "Monaco, monospace", label: "Monaco" },
];

// Menlo, Monaco and SF Mono exist only on a Mac, and Chromium resolves
// ui-monospace only there, so Windows would fall back to Courier New.
const WINDOWS_FONT_FAMILIES = [
  LILEX,
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Cascadia Mono", Consolas, monospace', label: "Cascadia Mono (system)" },
  { value: "Consolas, monospace", label: "Consolas" },
];

const mac = isMacPlatform();
export const DEFAULT_TERMINAL_FONT_FAMILY = LILEX.value;
const PREVIOUS_DEFAULT_FONT_FAMILY = mac ? "ui-monospace, monospace" : '"Cascadia Mono", Consolas, monospace';

/** Every launch wrote the default back, so the old default is not a choice; it moves to Zed's face once. */
export const TERMINAL_FONT_FAMILY_MIGRATION = "zed";

export function initialTerminalFontFamily(stored: string | null, migration: string | null) {
  if (migration !== TERMINAL_FONT_FAMILY_MIGRATION && (stored === null || stored === PREVIOUS_DEFAULT_FONT_FAMILY)) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
  return normalizeTerminalFontFamily(stored);
}
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 18;

export const terminalFontFamilies = mac ? MAC_FONT_FAMILIES : WINDOWS_FONT_FAMILIES;

/** Every launch wrote the old default back, so a stored 11 is the old default, not a choice; it moves to 12 once. */
export const TERMINAL_FONT_SIZE_MIGRATION = "12";

export function initialTerminalFontSize(stored: string | null, migration: string | null) {
  if (migration !== TERMINAL_FONT_SIZE_MIGRATION && stored === "11") return DEFAULT_TERMINAL_FONT_SIZE;
  return normalizeTerminalFontSize(stored ?? DEFAULT_TERMINAL_FONT_SIZE);
}

export function normalizeTerminalFontSize(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(parsed)));
}

export function normalizeTerminalFontFamily(value: unknown) {
  return terminalFontFamilies.some((option) => option.value === value)
    ? String(value)
    : DEFAULT_TERMINAL_FONT_FAMILY;
}
