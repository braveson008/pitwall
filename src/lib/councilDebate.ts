/**
 * Argument, not just handoff.
 *
 * The relay already made members aware of each other: every turn prompt names
 * the roster and tells them to "raise disagreements and ask direct questions
 * instead of silently working around their decisions". What it could not do is
 * let them *have* the argument. A relay moves work forward one member at a
 * time, so a real disagreement — A objects, B rebuts, A concedes or holds —
 * had nowhere to happen. Worse, `MAX_CONSECUTIVE_TURNS` reads sustained
 * back-and-forth as a stalled council and forces the baton onward, which is
 * exactly backwards when two members are mid-argument.
 *
 * A debate is a bounded exchange between named members about one question,
 * ending in consensus, a conductor ruling, or an escalation to the user. Two
 * things open one:
 *
 *   - **Opening** — before any code is written, everyone states how they would
 *     approach the task and then critiques each other. The council agrees a
 *     plan before it starts executing one.
 *   - **Dispute** — mid-relay, a member writes `DISPUTE: <member>` when
 *     execution contradicts the plan. The relay pauses for that exchange and
 *     resumes after it resolves.
 *
 * Both run through the same engine and produce the same record, so there is one
 * place where "what did they disagree about, and how was it settled" lives.
 *
 * ## Why the outcome is parsed, not inferred
 *
 * Whether a member conceded is decided by a marker it writes, not by a model
 * reading its prose. Asking a model "did they agree?" adds a round-trip to
 * every round and introduces a way for a debate to be recorded as settled when
 * it was not. A closed vocabulary that fails toward "still open" is the right
 * tool, and it is the same choice the voice loop makes for yes/no.
 */

/** Ceiling on exchanges per debate. Beyond this, positions repeat. */
export const MAX_DEBATE_ROUNDS = 3;

/** An opening debate is worth one extra round: nothing has been built yet. */
export const MAX_OPENING_ROUNDS = 4;

export const AGREE_MARKER = "AGREE";
export const HOLD_MARKER = "HOLD";
export const DISPUTE_MARKER = "DISPUTE";

export type DebateKind = "opening" | "dispute";
export type DebateStakes = "routine" | "high";
export type DebateStatus = "open" | "consensus" | "ruled" | "escalated";

/** What a member said in one round. */
export type DebateStance = {
  /** `agree` names whose position they accept; `hold` keeps their own. */
  verdict: "agree" | "hold" | "unclear";
  /** For `agree`, the member whose position was accepted. */
  agreesWith?: string;
  /** The one-line reason, for the record. */
  summary: string;
};

export type DebateTurn = {
  memberId: string;
  round: number;
  stance: DebateStance;
  body: string;
};

export type Debate = {
  id: string;
  kind: DebateKind;
  question: string;
  participants: string[];
  stakes: DebateStakes;
  turns: DebateTurn[];
  status: DebateStatus;
  /** Set once the debate closes. */
  outcome?: {
    /** The position that won, named by the member who held it. */
    settledOn?: string;
    reason: string;
    /** Members who never accepted the outcome, recorded rather than erased. */
    dissenting: string[];
  };
};

const firstMeaningfulLine = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

/**
 * Reads the `DISPUTE: <member>` header a member may put at the top of its
 * handoff to stop the relay and argue. Optional `[high]`/`[routine]` declares
 * how much is riding on it.
 *
 * Only the leading line counts, for the same reason `TO:` only counts there —
 * a member discussing a disagreement mid-writeup is not opening one.
 */
export function parseDisputeRequest(content: string): { target: string; declared: DebateStakes | null } | null {
  const line = firstMeaningfulLine(content);
  if (!line) return null;
  const match = new RegExp(
    `^#*\\s*${DISPUTE_MARKER}\\s*[:>-]\\s*@?([a-z0-9][a-z0-9._-]*)\\s*(?:\\[(high|routine)\\])?`,
    "i",
  ).exec(line);
  if (!match) return null;
  return {
    target: match[1].toLowerCase(),
    declared: match[2] ? (match[2].toLowerCase() as DebateStakes) : null,
  };
}

/**
 * Reads a member's position from its debate handoff.
 *
 * Anything that is not a clear `AGREE`/`HOLD` is `unclear`, which counts as
 * still-open. Treating an ambiguous reply as agreement is how a council
 * concludes on a point nobody actually settled.
 */
export function parseDebateStance(content: string): DebateStance {
  const line = firstMeaningfulLine(content);
  const rest = content
    .split("\n")
    .slice(1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const agree = new RegExp(`^#*\\s*${AGREE_MARKER}\\s*[:>-]\\s*@?([a-z0-9][a-z0-9._-]*)\\s*(.*)$`, "i").exec(line);
  if (agree) {
    return { verdict: "agree", agreesWith: agree[1].toLowerCase(), summary: (agree[2] || rest).trim() };
  }

  const hold = new RegExp(`^#*\\s*${HOLD_MARKER}\\s*[:>-]?\\s*(.*)$`, "i").exec(line);
  if (hold) {
    return { verdict: "hold", summary: (hold[1] || rest).trim() };
  }

  return { verdict: "unclear", summary: line || rest };
}

/**
 * Things that are not safe to settle quietly.
 *
 * The user asked for routine splits to be ruled on automatically and only
 * high-stakes ones escalated, which needs a definition of high-stakes that a
 * member cannot talk its way out of. So stakes only ever escalate: a member may
 * raise a dispute to `high`, and the detector may raise it, but neither a
 * member's `[routine]` claim nor a quiet phrasing can bring it back down.
 */
const HIGH_STAKES_PATTERNS: Array<[RegExp, string]> = [
  // People say "drop the sessions table", not "drop table", so a couple of
  // words are allowed between the verb and the thing being dropped.
  [/\b(drop|truncate|delete)\s+(?:\w+\s+){0,3}(table|column|index|database|collection)s?\b/i, "schema deletion"],
  [/\b(migration|migrate|schema\s+change|alter\s+table|backfill)\b/i, "schema or migration change"],
  [/\b(force[- ]push|reset\s+--hard|rewrite\s+history|revert\s+the\s+branch)\b/i, "destructive git operation"],
  [/\b(add|introduce|swap|replace)\s+(a\s+)?(dependency|package|library|framework)\b/i, "dependency change"],
  [/\b(api|public)\s+(contract|surface|interface)\b|\bbreaking\s+change\b/i, "public contract change"],
  [/\b(auth|authentication|authorisation|authorization|permission|credential|secret|token)\b/i, "security-sensitive area"],
  [/\b(delete|remove|wipe|purge)\s+(user|customer|production|prod)\s+data\b/i, "production data"],
];

export function classifyDebateStakes(text: string, declared: DebateStakes | null = null): {
  stakes: DebateStakes;
  reason: string;
} {
  for (const [pattern, reason] of HIGH_STAKES_PATTERNS) {
    if (pattern.test(text)) return { stakes: "high", reason };
  }
  if (declared === "high") return { stakes: "high", reason: "the member raising it marked it high-stakes" };
  return { stakes: "routine", reason: "" };
}

const maxRoundsFor = (kind: DebateKind) => (kind === "opening" ? MAX_OPENING_ROUNDS : MAX_DEBATE_ROUNDS);

/**
 * Decide what happens after every participant has spoken in a round.
 *
 * Consensus means every participant either holds the same position or has
 * accepted someone else's, and at most one distinct position survives. A member
 * whose stance is `unclear` blocks consensus by design.
 */
export function evaluateDebate(debate: Debate): {
  action: "continue" | "consensus" | "rule" | "escalate";
  settledOn?: string;
  dissenting: string[];
  reason: string;
} {
  const round = Math.max(0, ...debate.turns.map((turn) => turn.round));
  const latest = debate.participants.map((memberId) =>
    debate.turns.filter((turn) => turn.memberId === memberId && turn.round === round).at(-1),
  );

  // Nobody concludes a round that has not finished.
  if (latest.some((turn) => !turn)) {
    return { action: "continue", dissenting: [], reason: "Waiting on the rest of the round." };
  }

  const turns = latest as DebateTurn[];
  const unclear = turns.filter((turn) => turn.stance.verdict === "unclear");
  const holders = turns.filter((turn) => turn.stance.verdict === "hold").map((turn) => turn.memberId);

  if (unclear.length === 0) {
    // Everyone who held is holding the same position only if there is at most
    // one holder; everyone else pointed at someone.
    if (holders.length <= 1) {
      const settledOn =
        holders[0] ??
        turns.find((turn) => turn.stance.agreesWith)?.stance.agreesWith ??
        turns[0]?.memberId;
      return { action: "consensus", settledOn, dissenting: [], reason: "Every member accepted one position." };
    }
  }

  if (round < maxRoundsFor(debate.kind)) {
    return {
      action: "continue",
      dissenting: [],
      reason: unclear.length
        ? `${unclear.map((turn) => turn.memberId).join(", ")} did not state a clear position.`
        : `${holders.join(" and ")} still disagree.`,
    };
  }

  // Out of rounds. Routine splits are the conductor's to settle; high-stakes
  // ones are the user's, because a wrong call there is expensive and quiet.
  const dissenting = holders.length > 1 ? holders : holders;
  if (debate.stakes === "high") {
    return {
      action: "escalate",
      dissenting,
      reason: "The council is split on something high-stakes.",
    };
  }
  return {
    action: "rule",
    dissenting,
    reason: `No consensus after ${round} rounds — the conductor decides and the dissent is recorded.`,
  };
}

/** The brief every member answers to open a council. */
export function buildOpeningDebatePrompt({
  taskPrompt,
  member,
  others,
  threadFile,
  stanceFile,
}: {
  taskPrompt: string;
  member: { memberId: string; roleLabel: string; agentLabel: string; rolePrompt: string };
  others: Array<{ memberId: string; roleLabel: string; agentLabel: string }>;
  threadFile: string;
  stanceFile: string;
}) {
  const roster = others.map((item) => `${item.roleLabel} (${item.agentLabel}), addressed as ${item.memberId}`).join("; ");
  return (
    `${member.rolePrompt} The council is deciding how to approach this work before anyone writes code: ${taskPrompt}. ` +
    `You are debating with ${roster}. ` +
    `State how you would approach it and why, in your own view — do not defer to the others and do not edit any files this turn. ` +
    `Name the risk you think the others are most likely to miss. ` +
    `Write your position to ${stanceFile}. The council thread is at ${threadFile}.`
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** The prompt for round 2+ of any debate, opening or dispute. */
export function buildDebateRoundPrompt({
  debate,
  member,
  positions,
  round,
  stanceFile,
}: {
  debate: Debate;
  member: { memberId: string; roleLabel: string; rolePrompt: string };
  positions: Array<{ memberId: string; roleLabel: string; agentLabel: string; summary: string }>;
  round: number;
  stanceFile: string;
}) {
  const others = positions.filter((item) => item.memberId !== member.memberId);
  const rendered = others.map((item) => `${item.memberId} (${item.roleLabel}) said: ${item.summary}`).join(" | ");
  const rounds = maxRoundsFor(debate.kind);
  const last = round >= rounds;

  return (
    `${member.rolePrompt} Council debate, round ${round} of ${rounds}, on: ${debate.question}. ` +
    `The other positions are — ${rendered}. ` +
    `Engage with them directly. Change your mind if their reasoning is better than yours; hold if it is not, and say precisely why. ` +
    `Do not edit any files this turn. ` +
    `Write to ${stanceFile}, and make the first line either \`${AGREE_MARKER}: <member>\` naming whose position you accept, ` +
    `or \`${HOLD_MARKER}: <one-line reason>\` if you still disagree. Then explain underneath.` +
    (last
      ? ` This is the final round: if the council is still split after it, the disagreement is settled without you.`
      : "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The record a debate leaves behind.
 *
 * A council that quietly overrules a member and moves on is indistinguishable
 * from one that agreed, which is how you end up trusting a conclusion nobody
 * actually reached. Dissent is written down.
 */
export function renderDebateRecord(debate: Debate): string {
  const lines: string[] = [];
  lines.push(`## ${debate.kind === "opening" ? "Opening debate" : "Dispute"}: ${debate.question}`);
  lines.push(`Participants: ${debate.participants.join(", ")}${debate.stakes === "high" ? " · high-stakes" : ""}`);
  lines.push("");

  const rounds = Math.max(0, ...debate.turns.map((turn) => turn.round));
  for (let round = 1; round <= rounds; round += 1) {
    const turns = debate.turns.filter((turn) => turn.round === round);
    if (!turns.length) continue;
    lines.push(`### Round ${round}`);
    for (const turn of turns) {
      const verdict =
        turn.stance.verdict === "agree"
          ? `agreed with ${turn.stance.agreesWith}`
          : turn.stance.verdict === "hold"
            ? "held"
            : "unclear";
      lines.push(`- **${turn.memberId}** (${verdict}): ${turn.stance.summary || "—"}`);
    }
    lines.push("");
  }

  if (debate.outcome) {
    const { settledOn, reason, dissenting } = debate.outcome;
    lines.push(`### Outcome`);
    lines.push(settledOn ? `Settled on ${settledOn}'s position. ${reason}` : reason);
    if (dissenting.length) {
      lines.push(`**Unresolved:** ${dissenting.join(", ")} did not accept this and were overruled.`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Ends a debate whose turn was cut short. Left open, it keeps the stall guard
 * off and every later prompt framed as a debate for the rest of the run.
 */
export function abandonDebate(debate: Debate, why: string): { debate: Debate; record: string } {
  const closed: Debate = {
    ...debate,
    status: "escalated",
    outcome: { reason: `Cut short before the council agreed. ${why}`.trim(), dissenting: [] },
  };
  return { debate: closed, record: renderDebateRecord(closed) };
}

/** A short line for the council pane, so a split is visible without reading the thread. */
export function summariseDebate(debate: Debate): string {
  if (debate.status === "open") {
    const round = Math.max(0, ...debate.turns.map((turn) => turn.round));
    return `Debating · round ${round} of ${maxRoundsFor(debate.kind)}`;
  }
  if (debate.status === "consensus") return "Agreed";
  if (debate.status === "escalated") return "Split · waiting on you";
  const dissent = debate.outcome?.dissenting ?? [];
  return dissent.length ? `Ruled · ${dissent.join(", ")} dissented` : "Ruled";
}

// ---------------------------------------------------------------- the reducer

/**
 * What the relay should do next, given a finished handoff.
 *
 * The relay loop drives live PTYs, so the decision of *what happens next* is
 * kept here as a pure function over state rather than inline among the process
 * management. Everything the caller needs is on the returned step; App.tsx
 * executes it and owns no debate logic of its own.
 */
export type DebateStep =
  | { kind: "none" }
  | { kind: "open"; debate: Debate; speaker: string; round: number }
  | { kind: "continue"; debate: Debate; speaker: string; round: number }
  | { kind: "close"; debate: Debate; record: string; settledOn?: string }
  | { kind: "escalate"; debate: Debate; record: string };

/** Participants who have not yet spoken in `round`, in roster order. */
export function pendingSpeakers(debate: Debate, round: number): string[] {
  const spoken = new Set(
    debate.turns.filter((turn) => turn.round === round).map((turn) => turn.memberId),
  );
  return debate.participants.filter((memberId) => !spoken.has(memberId));
}

/**
 * Open a dispute from a handoff, if it asked for one.
 *
 * Returns null when the handoff carries no `DISPUTE:` header, when it names a
 * member that isn't on the council, or when it names the author — a member
 * cannot open an argument with itself.
 */
export function openDispute({
  content,
  from,
  memberIds,
}: {
  content: string;
  from: string;
  memberIds: string[];
}): Debate | null {
  const request = parseDisputeRequest(content);
  if (!request) return null;
  const target = memberIds.find((id) => id === request.target);
  if (!target || target === from) return null;

  const question = firstMeaningfulLine(content.split("\n").slice(1).join("\n")) || "an unstated disagreement";
  const { stakes } = classifyDebateStakes(`${question} ${content}`, request.declared);

  return {
    id: `dispute-${from}-${target}`,
    kind: "dispute",
    question,
    participants: [from, target],
    stakes,
    // The handoff that opened the dispute is the opener's own position, so it
    // counts as their round-1 turn — otherwise the reducer would wait forever
    // for a member who has already spoken.
    turns: [{ memberId: from, round: 1, stance: { verdict: "hold", summary: question }, body: content }],
    status: "open",
  };
}

/**
 * Open the debate a council holds before it writes any code.
 *
 * The dispute path is reactive: it exists because a member objected. This one
 * is the opposite — nobody has objected yet, because nobody has done anything.
 * That is the point. A relay's first member sets the approach simply by going
 * first, and every member after it inherits that approach as a fait accompli;
 * the Architect gets to critique a decision the Implementer already made and
 * half-built. Asking everyone for their approach *before* the first commit is
 * the only moment where disagreement is cheap.
 *
 * Returns null for a one-member council. A member cannot debate itself, and
 * spending a turn asking it to try produces a monologue rather than a position.
 */
export function openOpeningDebate({
  taskPrompt,
  memberIds,
}: {
  taskPrompt: string;
  memberIds: string[];
}): Debate | null {
  if (memberIds.length < 2) return null;
  const question = firstMeaningfulLine(taskPrompt) || "how to approach this work";
  // Stakes are read from the task itself. Nobody has declared anything yet, so
  // an unresolved split on a risky task escalates to the user rather than being
  // settled by the conductor — the same rule disputes follow.
  const { stakes } = classifyDebateStakes(taskPrompt);
  return {
    id: "opening",
    kind: "opening",
    question,
    participants: [...memberIds],
    stakes,
    turns: [],
    status: "open",
  };
}

/**
 * The instruction the council carries out of its opening debate.
 *
 * Without this the outcome is only *available* — written in the thread, which a
 * member may or may not weigh against its own role prompt. Naming the settled
 * approach as the directive is what makes the debate binding rather than
 * advisory, and it is the difference between deciding something and minuting it.
 */
export function buildOpeningDirective(debate: Debate): string {
  const settledOn = debate.outcome?.settledOn;
  const position = settledOn
    ? debate.turns.filter((turn) => turn.memberId === settledOn).at(-1)?.stance.summary
    : "";
  const dissent = debate.outcome?.dissenting?.length
    ? ` ${debate.outcome.dissenting.join(" and ")} disagreed and were overruled; their objection is in the thread and is worth re-reading if you hit what they warned about.`
    : "";

  if (!settledOn) {
    return `The council debated how to approach this and did not converge. Start from the thread's record of the positions.${dissent}`;
  }
  return (
    `The council debated how to approach this and settled on ${settledOn}'s position` +
    (position ? `: ${position}.` : ".") +
    ` Build that, not your own alternative — if you think it is wrong, say so before you start rather than quietly doing something else.${dissent}`
  );
}

/**
 * Fold one finished handoff into the debate state.
 *
 * `debate` is the run's open debate, or null when none is running — in which
 * case the handoff is only inspected for a `DISPUTE:` header.
 */
export function advanceDebate({
  debate,
  content,
  from,
  memberIds,
}: {
  debate: Debate | null;
  content: string;
  from: string;
  memberIds: string[];
}): DebateStep {
  if (!debate) {
    const opened = openDispute({ content, from, memberIds });
    if (!opened) return { kind: "none" };
    const speaker = pendingSpeakers(opened, 1)[0];
    // A dispute with nobody left to answer it is not a dispute.
    if (!speaker) return { kind: "none" };
    return { kind: "open", debate: opened, speaker, round: 1 };
  }

  // Which round this handoff belongs to. Taking the highest existing round is
  // wrong once that round is complete: the turn would be filed under a round
  // that is already finished, so the round counter never advances and the
  // debate runs forever. If nobody is still owed an answer, this opens the next
  // round instead.
  const lastRound = Math.max(1, ...debate.turns.map((turn) => turn.round));
  const round = pendingSpeakers(debate, lastRound).length === 0 ? lastRound + 1 : lastRound;
  const next: Debate = {
    ...debate,
    turns: [
      ...debate.turns,
      { memberId: from, round, stance: parseDebateStance(content), body: content },
    ],
  };

  // Someone in this round still owes an answer.
  const remaining = pendingSpeakers(next, round);
  if (remaining.length) return { kind: "continue", debate: next, speaker: remaining[0], round };

  const verdict = evaluateDebate(next);
  if (verdict.action === "continue") {
    const opening = pendingSpeakers(next, round + 1)[0] ?? next.participants[0];
    return { kind: "continue", debate: next, speaker: opening, round: round + 1 };
  }

  if (verdict.action === "escalate") {
    const escalated: Debate = {
      ...next,
      status: "escalated",
      outcome: { reason: verdict.reason, dissenting: verdict.dissenting },
    };
    return { kind: "escalate", debate: escalated, record: renderDebateRecord(escalated) };
  }

  const closed: Debate = {
    ...next,
    status: verdict.action === "consensus" ? "consensus" : "ruled",
    outcome: {
      settledOn: verdict.settledOn,
      reason: verdict.reason,
      dissenting: verdict.dissenting,
    },
  };
  return {
    kind: "close",
    debate: closed,
    record: renderDebateRecord(closed),
    settledOn: verdict.settledOn,
  };
}

/**
 * Validate a debate read back from storage.
 *
 * Same reasoning as `isRestorableRelayState`: storage outlives the code that
 * wrote it, and a half-valid debate is worse than none — the relay would wait
 * for a turn from a member that is not there, or file turns into a round it
 * cannot evaluate. Failing here drops the argument and the council resumes
 * working, which is a worse outcome than restoring cleanly but a much better
 * one than a run that cannot advance.
 *
 * `presentMemberIds` is checked because a restore drops members whose pane is
 * gone, and a debate is only resumable if everyone it is waiting on survived.
 */
export function isRestorableDebate(value: unknown, presentMemberIds: string[]): value is Debate {
  if (!value || typeof value !== "object") return false;
  const debate = value as Debate;
  if (debate.kind !== "opening" && debate.kind !== "dispute") return false;
  if (debate.status !== "open") return false;
  if (!Array.isArray(debate.participants) || debate.participants.length < 2) return false;
  if (!Array.isArray(debate.turns)) return false;
  if (typeof debate.question !== "string") return false;
  if (debate.stakes !== "routine" && debate.stakes !== "high") return false;
  if (
    !debate.turns.every(
      (turn) =>
        turn &&
        typeof turn.memberId === "string" &&
        typeof turn.round === "number" &&
        turn.round >= 1 &&
        Boolean(turn.stance),
    )
  ) {
    return false;
  }
  const present = new Set(presentMemberIds);
  return debate.participants.every((memberId) => present.has(memberId));
}

/**
 * Whether the relay's anti-stall guard should stand down.
 *
 * `isStuckOn` treats the same members holding consecutive turns as a stalled
 * council and forces the baton onward. That is exactly the shape of a real
 * argument, so while a debate is open the guard has to be suppressed — the
 * debate is bounded by its own round limit, which is what keeps this from
 * reintroducing the loop the guard exists to break.
 */
export function debateSuppressesStallGuard(debate: Debate | null | undefined): boolean {
  return Boolean(debate && debate.status === "open");
}
