/**
 * The composer is a text editor that submits into a terminal, which is a
 * different thing from the terminal itself. A terminal hands every keystroke
 * straight to the program on the other end; that program owns the screen and
 * the cursor, so there is nothing to click into and nowhere to put a caret.
 * Writing more than a few words in one is why people reach for an editor.
 *
 * So the editing happens here, in an ordinary textarea with a real caret,
 * selection, undo and multi-line text, and only the finished message crosses
 * into the PTY. The terminal keeps its own focus and its own raw key handling,
 * because a TUI still needs single keypresses for its own prompts.
 */

import { formatTerminalImagePaths } from "./terminalImages";

/** Staged image paths added to a draft, quoted as the terminal pane quotes them. */
export function withImagePaths(draft: string, paths: string[]) {
  const text = formatTerminalImagePaths(paths);
  if (!text) return draft;
  return `${draft}${draft && !draft.endsWith(" ") ? " " : ""}${text} `;
}

/** Newest first: entry 0 is the last thing submitted. */
export type ComposerHistory = {
  entries: string[];
  /** -1 while editing a fresh draft; otherwise an index into `entries`. */
  index: number;
  /** The fresh draft, parked while the user is walking back through history. */
  draft: string;
};

export const EMPTY_COMPOSER_HISTORY: ComposerHistory = { entries: [], index: -1, draft: "" };

const HISTORY_LIMIT = 100;

export function rememberSubmission(history: ComposerHistory, text: string): ComposerHistory {
  const entry = text.trim();
  // Re-sending the same message is a normal thing to do — a retry, a nudge —
  // and it should not push a second copy in front of everything else.
  if (!entry || history.entries[0] === entry) {
    return { ...history, index: -1, draft: "" };
  }
  return {
    entries: [entry, ...history.entries].slice(0, HISTORY_LIMIT),
    index: -1,
    draft: "",
  };
}

/**
 * Steps through past submissions. `direction` is -1 for older and 1 for newer,
 * matching the arrow keys that drive it.
 *
 * Returns null when there is nothing to step to, so the caller can let the key
 * do its ordinary thing — moving the caret — rather than swallowing it.
 */
export function recallSubmission(
  history: ComposerHistory,
  direction: -1 | 1,
  current: string,
): { history: ComposerHistory; value: string } | null {
  if (history.entries.length === 0) return null;
  const next = history.index - direction;

  if (next < -1 || next >= history.entries.length) return null;

  if (next === -1) {
    // Back out to the draft the user was writing before they went looking.
    return { history: { ...history, index: -1, draft: "" }, value: history.draft };
  }

  // Stash the draft on the way in, once, so returning to it gives back what
  // was actually typed rather than whatever history entry was last shown.
  const draft = history.index === -1 ? current : history.draft;
  return { history: { ...history, index: next, draft }, value: history.entries[next] };
}

export type ComposerKey = {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

export type ComposerAction =
  | "submit"
  | "newline"
  | "recall-older"
  | "recall-newer"
  | "blur-to-terminal"
  | "none";

/**
 * What a keystroke means in the composer.
 *
 * History only answers the arrows when the caret is parked at the very edge of
 * the text and nothing is selected. Anywhere else the user is navigating the
 * message they are writing, and replacing it under them would be the opposite
 * of what an editor does.
 */
export function composerKeyAction(
  event: ComposerKey,
  { value, selectionStart, selectionEnd }: { value: string; selectionStart: number; selectionEnd: number },
): ComposerAction {
  if (event.key === "Escape") return "blur-to-terminal";

  if (event.key === "Enter") {
    if (event.shiftKey || event.altKey) return "newline";
    // Cmd/Ctrl+Enter submits too — the habit from every other composer.
    return value.trim() ? "submit" : "none";
  }

  const collapsed = selectionStart === selectionEnd;
  if (event.key === "ArrowUp" && collapsed && selectionStart === 0) return "recall-older";
  if (event.key === "ArrowDown" && collapsed && selectionEnd === value.length) return "recall-newer";

  return "none";
}
