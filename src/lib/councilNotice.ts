import { formatDuration } from "./sessionAttention";
import type { ThreadNotice } from "../components/CouncilThread";

/**
 * What the thread should say happened to the run.
 *
 * Every reason a council stops used to be presented identically — one amber
 * bar behind one warning triangle — so "the work is done", "it ran out of
 * turns" and "you paused it" were the same event as far as the screen was
 * concerned. The most common of the three is a success, and it was being
 * reported as a fault.
 *
 * The tone is the whole point of this function: it decides whether the person
 * reading should feel finished, blocked, or fine.
 */
export function buildThreadNotice(run: {
  note?: string;
  tone?: "done" | "warn" | "attention";
  paused?: boolean;
  atTurnLimit?: boolean;
  awaitingStart?: boolean;
  turn?: number;
  startedAt?: string;
  finishedAt?: string;
} | null | undefined): ThreadNotice | undefined {
  if (!run) return undefined;

  // A pause outranks whatever stopped the relay, because the user did it and is
  // waiting to be told it took effect.
  if (run.paused) {
    return {
      tone: "attention",
      title: "Paused",
      word: "paused",
      detail: "The member on turn finishes its hand-off. Nothing starts after it.",
      meta: turnMeta(run.turn),
    };
  }

  if (!run.note) return undefined;

  // The opening debate's outcome. Not a fault and not a finish — a decision
  // waiting to be acted on, which is its own thing and has to read as one.
  if (run.awaitingStart) {
    return {
      tone: "attention",
      title: "The approach is agreed",
      word: "agreed",
      detail: run.note,
      meta: turnMeta(run.turn),
    };
  }

  if (run.tone === "done") {
    return {
      tone: "done",
      title: "The council finished",
      word: "finished",
      detail: run.note,
      meta: [turnMeta(run.turn), elapsed(run.startedAt, run.finishedAt)].filter(Boolean).join(" · "),
    };
  }

  // Out of turns is not a failure — it is a council that is probably still
  // productive asking whether to keep going. Saying "stopped" at it invites
  // people to throw the run away and start again.
  if (run.atTurnLimit) {
    return {
      tone: "attention",
      title: "Out of turns",
      word: "out of turns",
      detail: run.note,
      meta: turnMeta(run.turn),
    };
  }

  return { tone: "warn", title: "The council stopped", word: "stopped", detail: run.note, meta: turnMeta(run.turn) };
}

function turnMeta(turn?: number): string {
  return typeof turn === "number" && turn > 0 ? `${turn} turn${turn === 1 ? "" : "s"}` : "";
}

/** How long the council took, when both ends of it are known. */
function elapsed(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) return "";
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? formatDuration(ms) : "";
}

/**
 * How much of a note belongs in the bar that shows it.
 *
 * The bar is one line of status. Some notes are built from what an agent
 * wrote — a verification verdict lists every gap it found — and an agent
 * asked to be thorough writes thousands of words. One of those filled the
 * window with a wall of semicolon-separated prose, pushed everything else off
 * screen, and buried the "Hand off" button it was meant to sit beside.
 *
 * The whole verdict is in the thread, in place, with the turn that produced
 * it. This is the part that fits, and it says there is more.
 */
export const MAX_NOTE_CHARACTERS = 240;

export function summariseNote(note: string, limit = MAX_NOTE_CHARACTERS): string {
  const text = String(note || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  // Cut at a sentence if there is one near the limit, so the note ends on a
  // thought rather than mid-word.
  const head = text.slice(0, limit);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  const cut = sentence > limit * 0.6 ? sentence + 1 : head.lastIndexOf(" ");
  return `${text.slice(0, cut > 0 ? cut : limit).trimEnd()}… (the full detail is in the thread)`;
}
