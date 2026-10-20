/**
 * Detects when an agent CLI is waiting on a person — a trust prompt, a sign-in,
 * an API key, a consent screen — rather than working. Pitwall must not type a
 * task into a pane sitting on one of these, because the keystrokes answer the
 * prompt.
 *
 * The hard part is not recognising prompts; it is *not* recognising an agent
 * that merely wrote about authentication. A council member reporting "four text
 * columns unauthenticated" is doing its job, and stalling its council over that
 * word costs a turn that took twenty minutes to produce.
 *
 * ## Why a line-length rule was not enough
 *
 * Prose is long and prompts are short, so the original check only considered
 * short lines. That works for a CLI that prints lines. It fails completely for
 * one that paints a full-screen interface: Codex's startup renders as a *single
 * 656-character line* once the escapes come out, because the layout is done
 * with cursor movement rather than newlines. Its update prompt — "1. Update now
 * (runs `npm install -g @openai/codex`)" with option 1 preselected — was
 * therefore invisible here, so Pitwall typed a council brief into it, pressed
 * Enter, chose "Update now", and got a failed global npm install and a dead
 * pane.
 *
 * So the tail is segmented on box-drawing characters as well as newlines. A
 * terminal interface is full of them and prose contains none, which restores a
 * meaningful notion of "line" for exactly the output that needed it.
 */

/** Real prompts are short. Prose that happens to mention auth usually is not. */
const GATE_LINE_MAX = 160;

/** How far back to look. A gate is the last thing a stalled pane printed. */
const GATE_TAIL_LINES = 24;

/**
 * Prompt shapes, deliberately anchored. Bare `authenticate` or `authoriz`
 * matched inside "unauthenticated" and "unauthorized", which is what made the
 * old check fire on ordinary agent output.
 *
 * Whitespace is optional between words in the choice patterns. A TUI positions
 * text by moving the cursor rather than by emitting spaces, so stripping the
 * escapes concatenates what was rendered apart: "Yes, I accept" arrives as
 * "Yes,Iaccept".
 */
const GATE_PATTERNS: RegExp[] = [
  /\bdo you trust\b/i,
  /\btrust\s*(this|the)\s*(folder|files?|directory|workspace)\b/i,
  /\b(has )?not (been )?trusted\b/i,
  /\bpress\s*enter\s*to\s*(continue|trust)\b/i,
  /\bplease (sign|log) ?in\b/i,
  /\b(sign|log) ?in (to|with|required|needed)\b/i,
  /\b(sign|log) ?in\b.*\bto continue\b/i,
  /\b(enter|paste) your api key\b/i,
  /\bapi key\b.*\b(required|needed|missing)\b/i,
  /\bauthentication (is )?(required|needed)\b/i,
  /\bauthoriz(ation|e) (is )?(required|needed)\b/i,
  /\b(select|choose) (a |an )?(login|auth\w*)\b/i,
  /\bhow would you like to (authenticate|sign ?in|log ?in)\b/i,
  /\bwaiting for (you to )?(sign|log) ?in\b/i,
  // Claude's one-time acknowledgement for bypass-permissions mode. It cannot be
  // skipped by any flag — verified against every combination the CLI accepts —
  // and nothing answers it, so the process exits 1 and the member never starts.
  /\baccept\s*all\s*responsibility\b/i,
  /\bbypass\s*permissions\s*mode\b/i,
  /\byes,?\s*i\s*accept\b/i,
  /\bno,?\s*exit\b/i,
  // A CLI offering to update itself. Preselected, and answering it runs a
  // global install that fails on a normal npm prefix.
  /\bupdate\s*available\b/i,
  /\bskip\s*until\s*next\s*version\b/i,
  /\b\d\.\s*update\s*now\b/i,
];

/**
 * Advice, not a question.
 *
 * A CLI's opening notices name a command to run later — `run /login to renew`,
 * `run /mcp`, "Run `codex mcp login jira`" — and the pane is ready for input
 * the whole time. One of them, Claude's login-expiry warning, matched the
 * sign-in pattern and stalled a whole council at turn 1: the members sat idle
 * while Pitwall waited for a prompt that was never there.
 *
 * A prompt blocking a pane asks something. It does not tell you what to type
 * somewhere else.
 */
const ADVISORY_PATTERNS: RegExp[] = [
  /\brun\s+[`'"]?[/`]/i,
  /\brun\s+(npm|npx|yarn|pnpm|brew|codex|claude|gemini|gh)\b/i,
  /\bexpires?\s+in\b/i,
];

/**
 * Where a cursor movement leaves the text it separates: on the same row it is
 * a gap between words, on another row it is a line break.
 *
 * Deleting these instead is what hid Codex's sign-in screen. It places each
 * word with `\x1b[9;11H` and rows with `\x1b[3;1H`, so stripped it read
 * "2.SigninwithDeviceCode" on one 500-character line that no pattern and no
 * length rule could see.
 */
function cursorMoveText(params: string, final: string, cursor: { row: number }) {
  if (/^[?<>=]/.test(params)) return "";
  const first = Number.parseInt(params.split(";")[0], 10);
  const count = Number.isFinite(first) && first > 0 ? first : 1;
  const toRow = (row: number) => {
    const same = cursor.row >= 0 && row === cursor.row;
    cursor.row = row;
    return same ? " " : "\n";
  };
  switch (final) {
    case "C":
      return " ".repeat(Math.min(count, GATE_LINE_MAX));
    case "G":
    case "`":
      return " ";
    case "H":
    case "f":
    case "d":
      return toRow(count);
    case "A":
    case "F":
      return toRow(cursor.row >= 0 ? cursor.row - count : -1);
    case "B":
    case "E":
      return toRow(cursor.row >= 0 ? cursor.row + count : -1);
    default:
      return "";
  }
}

/**
 * Terminal output, reduced to what a person would read.
 *
 * The private-parameter forms matter: Codex opens with `\x1b[>4;0m` and
 * `\x1b[>5u`, which the old pattern did not cover, so they survived into the
 * "text" and sat in the middle of the very line being matched.
 */
function stripAnsi(text: string) {
  // A literal newline moves the row by an amount this cannot know: chunks are
  // joined with one whether or not the terminal moved.
  const cursor = { row: -1 };
  return String(text || "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[([0-9;:?<>=!]*)[ -/]*([@-~])|\n/g, (match, params?: string, final?: string) => {
      if (match === "\n") {
        cursor.row = -1;
        return match;
      }
      return cursorMoveText(params ?? "", final ?? "", cursor);
    })
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[()#][0-9A-Za-z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=>NOc7-8]/g, "");
}

/**
 * Box-drawing and the other glyphs a terminal interface frames itself with.
 * Treated as line breaks so a painted screen segments into readable pieces
 * instead of arriving as one unbroken 600-character line.
 */
const TUI_SEPARATORS = /[─-╿▀-▟■-◿•❯›]+/g;

/**
 * Codex's self-update menu. Any one phrase can arrive incomplete: the TUI only
 * repaints cells that changed, so "Update available" has been captured as
 * "Updat" + a cursor jump + " available". Two of three is the match.
 */
const CODEX_UPDATE_MARKERS: RegExp[] = [
  /update\s*available/gi,
  /\d\.\s*update\s*now/gi,
  /skip\s*until\s*next\s*version/gi,
];

/** Codex's own screen. Painted after the menu, it means the menu is gone. */
const CODEX_SCREEN_MARKERS: RegExp[] = [
  /openai\s*codex/gi,
  /ask\s*codex\s*to\s*do/gi,
  /for\s*shortcuts/gi,
  /\/model\s*to\s*change/gi,
  /welcome\s*to\s*codex/gi,
];

/**
 * The menu's footer, which every captured menu ends on: "Press enter to
 * continue" (0.149) or "enter continue · esc skip" (0.157). A reply that quotes
 * the menu goes on to say something about it, so anything after the footer —
 * or no footer at all — means the menu is not what the pane is showing.
 */
const CODEX_UPDATE_FOOTER = /^(press\s*)?enter\s*(to\s*)?continue(\s*·\s*esc\s*skip)?$/i;

/**
 * Verified against codex-cli 0.157.0 in a PTY: the digit selects and confirms
 * at once, and leaves `dismissed_version` alone. No Enter — it would answer
 * whatever screen comes next.
 */
export const CODEX_UPDATE_SKIP_KEY = "2";

function lastMatch(text: string, patterns: RegExp[]) {
  let index = -1;
  let end = -1;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? -1;
      if (at > index) {
        index = at;
        end = at + match[0].length;
      }
    }
  }
  return { index, end };
}

/** Where Codex last painted its own screen after an update menu, or -1. */
function codexScreenAfterUpdateMenu(text: string) {
  const menu = lastMatch(text, CODEX_UPDATE_MARKERS).index;
  const screen = lastMatch(text, CODEX_SCREEN_MARKERS).index;
  return menu >= 0 && screen > menu ? screen : -1;
}

/**
 * True while a Codex pane is sitting on its "Update available" menu — the
 * last thing on screen, not something scrolled past or quoted in a reply.
 */
export function codexUpdatePromptShowing(output: string): boolean {
  if (!output) return false;
  const text = stripAnsi(output);
  const screen = lastMatch(text, CODEX_SCREEN_MARKERS).index;
  const current = screen >= 0 ? text.slice(screen) : text;
  const found = CODEX_UPDATE_MARKERS.filter((pattern) => current.search(pattern) >= 0).length;
  if (found < 2) return false;
  const footer = current.slice(lastMatch(current, CODEX_UPDATE_MARKERS).end).replace(/\s+/g, " ").trim();
  return CODEX_UPDATE_FOOTER.test(footer);
}

/**
 * True when the tail of a pane's output looks like it is waiting on a person.
 * Only short segments near the end qualify, so a paragraph discussing auth
 * reads as work rather than as a prompt.
 */
export function looksLikeAgentGate(output: string): boolean {
  if (!output) return false;
  let text = stripAnsi(output);
  // An answered update menu stays in the tail after Codex repaints over it,
  // and would otherwise hold the pane gated until enough new output arrives.
  const repainted = codexScreenAfterUpdateMenu(text);
  if (repainted >= 0) text = text.slice(repainted);
  const segments = text
    .replace(TUI_SEPARATORS, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-GATE_TAIL_LINES);

  return segments.some(
    (line) =>
      line.length <= GATE_LINE_MAX &&
      !ADVISORY_PATTERNS.some((pattern) => pattern.test(line)) &&
      GATE_PATTERNS.some((pattern) => pattern.test(line)),
  );
}
