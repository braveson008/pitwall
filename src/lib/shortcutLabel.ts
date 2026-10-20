/**
 * Keyboard shortcut text for the platform the app is running on.
 *
 * Labels are written the Mac way (⌘K, ⌘↵, ⌘⇧↵) because that is where the app
 * started; on Windows and Linux the same handlers answer to Ctrl, so the text
 * says Ctrl. The platform comes from the preload bridge, falling back to the
 * browser's own idea when the renderer runs on its own (npm run web).
 */
export function isMacPlatform(): boolean {
  const fromBridge = typeof window !== "undefined" ? (window as { braveli?: { platform?: string } }).braveli?.platform : undefined;
  if (fromBridge) return fromBridge === "darwin";
  if (typeof document !== "undefined" && document.documentElement?.dataset.platform) {
    return document.documentElement.dataset.platform === "darwin";
  }
  return typeof navigator === "undefined" || /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function shortcutLabel(text: string, mac: boolean = isMacPlatform()): string {
  if (mac) return text;
  return text
    .replace(/⌘⇧/g, "Ctrl+Shift+")
    .replace(/⌘/g, "Ctrl+")
    .replace(/↵/g, "Enter");
}

/** The Files panel toggle: ⌘E on a Mac, Ctrl+Shift+E elsewhere (Ctrl+E is a terminal's end-of-line). */
export const FILES_SHORTCUT_MAC = "⌘E";
export function filesShortcutLabel(mac: boolean = isMacPlatform()): string {
  return mac ? FILES_SHORTCUT_MAC : "Ctrl+Shift+E";
}

export function isFilesShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, mac: boolean = isMacPlatform()): boolean {
  const key = event.key.toLowerCase();
  if (key !== "e") return false;
  return mac ? event.metaKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}
