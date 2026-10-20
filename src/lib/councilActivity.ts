/**
 * What each Council member is doing, right now.
 *
 * A Council with two agents working showed an empty thread until the first one
 * finished talking. The rail said "Working" and the panel said nothing, so the
 * only honest reading of the screen was that nothing was happening — for
 * minutes at a time, on the surface whose entire purpose is to make the work
 * legible.
 *
 * Everything needed was already being collected. Pitwall mirrors every
 * session's screen whether or not its pane is mounted, which is how a session
 * that needs an answer can say so from behind another tab. This reads the same
 * mirror for a different question: not "does this need me" but "what is it
 * doing".
 */

/** The last line an agent printed, cleaned up enough to put in a sentence. */
const NOISE = [
  /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬▔▁·.\-_=*#]+$/, // rules, boxes, separators
  /^[>❯$%#]\s*$/,                                    // an empty prompt
  /^\s*$/,
  /**
   * A rule with a label inside it — `———— Architect · Claude 1 —`.
   *
   * Pitwall writes these into a council member's pane itself, to mark whose
   * turn it is. The all-separators rule above does not catch them, because
   * they are not all separators, so the thread reported Pitwall's own banner
   * back as the thing the agent was doing.
   *
   * Eight in a row is the test rather than the wording: no sentence an agent
   * writes contains a run of eight dashes, and every CLI that draws a divider
   * draws a long one.
   */
  /[─━—–\-=_]{8,}/,
];

/**
 * The CLI describing itself rather than the work: its spinner, the line a turn
 * ends on, a tip, a key hint. Shapes, not wording, so a new spinner verb or tip
 * is still caught.
 */
const TUI_STATUS = [
  // A way out of a turn, which every CLI offers only on its spinner line:
  // `◦ Working (20s • esc to interrupt)`, `✻ Sautéing… (esc to interrupt)`.
  /\b(?:esc|ctrl\s*[+-]\s*c|⌃c)\s+to\s+(?:interrupt|stop|cancel)\b/i,
  // A key hint in a footer: `auto mode on (shift+tab to cycle)`, `ctrl+t to show todos`.
  /\b(?:shift\s*\+\s*tab|ctrl\s*\+\s*\w|tab|enter)\s+to\s+\p{L}+/iu,
  /\?\s+for\s+shortcuts\b/i,
  /\bcontext\s+left\b|\bauto-compact\b/i,
  // A spinner verb and nothing else: `✻ Thinking…`, `· Brewing… (12s · ↑ 1.2k tokens)`.
  /^[^\p{L}\p{N}\s]?\s*\p{L}+(?:…|\.{3})(?:\s|\(|$)/u,
  // The line a turn ends on: `* Baked for 1m 24s · done 12:12 AM`, `✻ Worked for 3m`.
  /^[^\p{L}\p{N}\s]?\s*\p{L}+\s+for\s+\d+[hms]\b/u,
  // A tip, however it is indented under the spinner: `⎿  Tip: Use /hooks to …`.
  /^[^\p{L}\p{N}]*Tip:\s/u,
];

/** Whether a screen line is the CLI's own live status rather than something the agent did. */
export function isTuiStatusLine(line: string): boolean {
  const text = line.trim();
  return TUI_STATUS.some((pattern) => pattern.test(text));
}

/** The input line: `>`, `❯` or `›`, with or without what is being typed. */
const PROMPT = /^\s*[>❯›]\s/;
const EMPTY_PROMPT = /^\s*[>❯›]\s*$/;

/**
 * The last line above the input box that says something about the work.
 *
 * Everything at or below the input line is the CLI's own chrome — the mode
 * indicator, the key hints, the branch and PR it is pinned to — and it redraws
 * constantly whether or not anything is happening. Read from the bottom of the
 * screen it wins every time, which is how a card meant to say what the agent
 * was doing came to report "auto mode on (shift+tab to cycle) · ← for agents"
 * as a step.
 *
 * So the input line is the boundary: the work is above it, the furniture is
 * below. Every REPL has one, which is what makes this hold for a CLI nobody
 * here has looked at.
 *
 * Above it, the CLI's own status is skipped too. Its spinner carries a timer
 * that changes every second, so each redraw passed as a new step and the trail
 * filled with four copies of "Working (20s • esc to interrupt)".
 */
export function currentStep(screen: string | null | undefined, maxLength = 90): string | null {
  if (!screen) return null;

  const lines = String(screen).split(/\r?\n/);

  // Below the last input line is the CLI talking about itself.
  let ceiling = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (PROMPT.test(lines[index]) || EMPTY_PROMPT.test(lines[index])) {
      ceiling = index;
      break;
    }
  }

  for (let index = ceiling - 1; index >= 0; index -= 1) {
    const line = lines[index].replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (NOISE.some((pattern) => pattern.test(line))) continue;
    if (PROMPT.test(line)) continue;
    if (isTuiStatusLine(line)) continue;

    const text = line.trim();
    // A line of one or two characters carries nothing and reads as a glitch.
    if (text.length < 3) continue;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  return null;
}

export type MemberState = "working" | "waiting" | "quiet" | "done" | "idle";

/** How many recent steps a member's card carries. */
export const TRAIL_LENGTH = 4;

/**
 * The last few lines a member printed, oldest first.
 *
 * One live line that rewrites itself every couple of seconds reads as a
 * glitch — you cannot tell progress from a redraw. A short trail shows the
 * work moving: three steps that differ are three things done.
 *
 * Pushing the same step twice running is one entry, which is what makes this
 * safe to build during render: StrictMode invokes it twice and the second
 * call changes nothing.
 */
export function pushStep(
  trail: readonly string[] | undefined,
  step: string | null,
  limit = TRAIL_LENGTH,
): string[] {
  const existing = trail ? [...trail] : [];
  if (!step) return existing;
  if (existing[existing.length - 1] === step) return existing;
  existing.push(step);
  return existing.slice(-limit);
}

export type MemberWork = {
  memberId: string;
  sessionId: string;
  roleLabel: string;
  agentLabel: string;
  state: MemberState;
  /** What it last printed, when that is worth showing. */
  step: string | null;
  /** The last few things it printed, oldest first. Movement, rather than a flicker. */
  steps: string[];
  /** How long it has been in this state, in milliseconds. Null when unknown. */
  forMs: number | null;
  /** Whose turn it is. */
  isCurrent: boolean;
};

/** Said plainly. These appear next to a member's name, so they stay short. */
export function stateLabel(state: MemberState): string {
  switch (state) {
    case "working": return "Working";
    case "waiting": return "Needs you";
    case "quiet": return "Quiet";
    case "done": return "Finished";
    default: return "Idle";
  }
}

/**
 * Whether anything is worth showing at all.
 *
 * A panel that is always on screen becomes furniture. This one appears while
 * members are actually doing something and gets out of the way afterwards.
 */
export function hasLiveWork(work: readonly MemberWork[]): boolean {
  return work.some((member) => member.state === "working" || member.state === "waiting");
}

/** Longest-running first: the one that has been going the longest is the one worth looking at. */
export function orderForDisplay(work: readonly MemberWork[]): MemberWork[] {
  const rank: Record<MemberState, number> = { waiting: 0, working: 1, quiet: 2, done: 3, idle: 4 };
  return [...work].sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      rank[a.state] - rank[b.state] ||
      (b.forMs ?? 0) - (a.forMs ?? 0),
  );
}
