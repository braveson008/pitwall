/**
 * The choice a terminal is currently waiting on.
 *
 * A pending question never reaches the session history: the CLI writes the
 * record only once the tool completes, so a menu that is still open is invisible
 * to anything reading that file. The only place it exists is on screen, which
 * means the pane's own output is the only live signal that the agent is waiting.
 *
 * This reads that output for one narrow purpose — is a menu open, and what are
 * its options — rather than trying to reconstruct the conversation from it.
 * Everything it matches on is literal text the CLI prints, not escape-sequence
 * structure, so a change of colour or layout does not silently break it.
 */

/**
 * Words that appear in the hint under a menu, in any CLI that prints one.
 *
 * Deliberately not a list of footers to match against. Matching whole phrases
 * is what hid every Codex menu ever drawn: the strings were taken from Claude,
 * Codex words it differently, and an exact-match list only ever works for the
 * CLIs somebody has already looked at. These are used the other way round —
 * to recognise that a trailing line is a *hint* rather than real output, so
 * the menu above it still counts as open.
 */
const HINT_WORDS = ["enter", "esc", "escape", "select", "confirm", "choose", "cancel", "arrow", "↑", "↓", "tab"];

/** A numbered choice: `1. Something`, with an optional selection marker. */
const NUMBERED = /^\s*(❯|>|›|\*)?\s*(\d+)[.):]\s+(\S.*?)\s*$/;

/**
 * Numbered only, deliberately.
 *
 * A menu is answered by sending the digit beside the choice. Some CLIs draw an
 * arrow-key list with no numbers at all, and those are detectable by the same
 * shape — but detecting one would put buttons on screen that send a keystroke
 * the CLI ignores. A control that silently does nothing is worse than one that
 * is not offered, so an unnumbered menu is left to the terminal, where the
 * arrow keys work.
 */

/**
 * Whether a line under the options is a key hint rather than real output.
 *
 * Short and naming a key is what a hint looks like in every CLI that draws one.
 * Anything longer is output, and output under a menu means the choice was made
 * and the screen moved on.
 */
function isHintLine(line: string) {
  const text = line.trim();
  if (!text || text.length > 90) return false;
  const lowered = text.toLowerCase();
  return HINT_WORDS.some((word) => lowered.includes(word));
}

/** An option's own description, indented under it. */
function isContinuation(line: string) {
  return /^\s{2,}\S/.test(line) && !NUMBERED.test(line);
}

export type MenuOption = { index: number; label: string; selected: boolean };
export type TerminalMenu = { prompt: string; options: MenuOption[] };

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[<>=][0-9;]*[a-zA-Z]?/g;

export function stripAnsi(text: string) {
  return text.replace(ANSI, "");
}

/**
 * The menu at the end of `output`, or null when nothing is waiting.
 *
 * Only the last screenful is considered: a pane holds the whole session, and an
 * answered menu from ten minutes ago is not something the agent is waiting on.
 */
/**
 * The menu a terminal is waiting on, or null.
 *
 * Found by its shape rather than by anything it says. A menu is two or more
 * consecutive choices numbered from one, with nothing but blank lines and key
 * hints beneath them — which is true of every CLI that draws one, including the
 * ones nobody has looked at yet. The previous version searched for a footer
 * phrase, which meant it recognised exactly the CLIs whose phrasing had been
 * copied into it, and silently ignored the rest.
 *
 * The "nothing beneath it" test is what separates an open menu from one already
 * answered, and from a numbered list in ordinary prose: prose is followed by
 * more prose.
 */
export function readTerminalMenu(output: string, { window = 6000 } = {}): TerminalMenu | null {
  const lines = stripAnsi(String(output ?? "")).slice(-window).split("\n");

  // Backwards: a pane holds several menus over its lifetime and the live one is
  // the last.
  let last = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (NUMBERED.test(lines[index])) {
      last = index;
      break;
    }
  }
  if (last === -1) return null;

  /**
   * A hint under the options is what says the menu is still open.
   *
   * Not a phrase to match — matching phrases is what hid every Codex menu ever
   * drawn — but its presence. Every CLI that waits on a choice tells you which
   * key answers it; a numbered list in prose does not, which is exactly the
   * difference worth detecting.
   */
  const below = lines.slice(last + 1);
  if (!below.some(isHintLine)) return null;
  if (below.some((line) => line.trim() && !isHintLine(line))) return null;

  // Options may carry an indented description of their own, so the block is
  // walked through those rather than stopping at the first one.
  let first = last;
  while (first > 0) {
    const previous = lines[first - 1];
    if (NUMBERED.test(previous) || isContinuation(previous)) first -= 1;
    else break;
  }

  const options: MenuOption[] = [];
  for (let index = first; index <= last; index += 1) {
    const numbered = NUMBERED.exec(lines[index]);
    if (numbered) options.push({ index: Number(numbered[2]), label: numbered[3], selected: Boolean(numbered[1]) });
  }

  // A single stray "1." in a sentence is not a menu. Two consecutive choices
  // are — and they have to be numbered from one, in order, or it is prose that
  // happens to contain numbers.
  if (options.length < 2) return null;
  if (!options.every((option, position) => option.index === position + 1)) return null;

  // The question itself: the last ordinary line above the options.
  let prompt = "";
  for (let index = first - 1; index >= 0; index -= 1) {
    const candidate = lines[index].trim();
    if (!candidate || /^[─━│┃╭╮╰╯┌┐└┘═╔╗╚╝▔▁·.\-_=*#]+$/.test(candidate)) continue;
    prompt = candidate;
    break;
  }

  return { prompt, options };
}

/**
 * The single keystroke that answers a menu.
 *
 * The number, not arrow keys. Arrows have to be sent before anything is
 * verified, so a verification that then fails leaves the highlight moved with
 * nobody told — click twice and it has drifted two rows, and the next confirm
 * takes whatever it landed on. That is how a menu answered "Fix the checkbox"
 * with something else entirely.
 *
 * A digit is atomic: the CLI acts on the number it was given, or it does
 * nothing. The numbers are the ones drawn on screen, so what is sent is what
 * the reader clicked, and there is no intermediate state to get lost in.
 */
export function menuChoiceKey(index: number): string {
  return index >= 1 && index <= 9 ? String(index) : "";
}

/**
 * What a CLI offers only while a turn is actually in flight.
 *
 * Phrased as "how do I stop this", which is the one thing no CLI prints at an
 * idle prompt. Matched on the fragment rather than the whole line, and
 * case-insensitively, for the same reason the menu parser stopped matching
 * footers: an exact string taken from one agent recognises only that agent.
 *
 * Deliberately not "to cancel" — that appears under menus, and a menu means
 * the agent is waiting on you, which is the opposite of busy.
 */
const INTERRUPT_HINTS = ["to interrupt", "to stop"];

/**
 * Whether the pane is working, read off its own footer.
 *
 * Not inferred from the conversation. Completion is written as a `stop_reason`
 * on the message that ends a turn, and a turn that is abandoned — interrupted,
 * errored, or simply stopped — never writes one, so anything waiting for that
 * signal waits forever. That is why chat sat on "Thinking" while the terminal
 * beside it was idle at a prompt.
 *
 * The CLI offers a way to interrupt exactly when there is something to
 * interrupt, so the offer is the state. `null` means the screen said nothing
 * either way and the caller should fall back to what the records imply.
 */
export function readTerminalBusy(screen: string): boolean | null {
  const text = stripAnsi(screen);
  if (!text.trim()) return null;
  const lowered = text.toLowerCase();
  return INTERRUPT_HINTS.some((hint) => lowered.includes(hint));
}
