type KeyLike = { type: string; key: string; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean };

export type TerminalKeyAction = "terminal" | "app" | "copy" | "paste";

// Pitwall's own shortcuts; with Shift, as they reach a US layout (`,` is `<`, `` ` `` is `~`).
const APP_KEYS = new Set(["k", "p", "j", "n", "b", "e", ",", "<", "`", "~"]);

/**
 * What a key pressed inside a terminal is for. A Mac's shortcuts use Command, which xterm never takes. Elsewhere
 * they would use Ctrl, which every agent already reads (Ctrl+J is a newline, Ctrl+K kills a line), so inside a
 * terminal the app's own take Ctrl+Shift, and copy and paste follow Windows Terminal.
 */
export function terminalKeyAction(event: KeyLike, mac: boolean, hasSelection: boolean): TerminalKeyAction {
  if (mac || event.type !== "keydown" || !event.ctrlKey || event.metaKey || event.altKey) return "terminal";
  const key = event.key.toLowerCase();
  if (key === "c") return hasSelection || event.shiftKey ? "copy" : "terminal";
  if (key === "v") return "paste";
  if (event.shiftKey && APP_KEYS.has(key)) return "app";
  return "terminal";
}
