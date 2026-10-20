import { emptyWorkingSet, formatWorkingSetForPrompt, isWorkingSet, mergeWorkingSet, parseWorkingSet, workingSetContract, type WorkingSet } from "./councilBriefing";
import type { VerificationVerdict } from "./councilVerify";
export type CouncilRelayMember = {
  sessionId: string;
  /**
   * Stable, short handle the agents and the conductor use to address this
   * member — "implementer-codex", "qa-kimi". Session ids carry timestamps and
   * are hostile to type into a handoff, so addressing uses this instead.
   */
  memberId: string;
  rolePrompt: string;
  roleLabel: string;
  agentLabel: string;
  /** True for roles whose work should show up as changed files. */
  writesCode: boolean;
};

export type CouncilRelayTurn = {
  /** 1-based, monotonically increasing across the whole run. */
  turn: number;
  sessionId: string;
  prompt: string;
  stageFile: string;
  upstreamFile: string | null;
};

/**
 * One contribution to the shared thread. The user is an author here too — an
 * instruction typed into the council that the conductor never saw would send
 * the next member off against what it was just told.
 */
export type CouncilThreadMessage = {
  turn: number;
  fromMemberId: string;
  toMemberId: string | null;
  content: string;
  /**
   * User messages outrank member opinion and are labelled as such. `council` is
   * the council's own voice — how a debate was settled, and who was overruled.
   * It is not a member's opinion, and attributing it to one would make a ruling
   * look like the winner's own claim about the argument.
   */
  author?: "member" | "user" | "council";
  /**
   * Everyone who contributed, when a panel answered together. The thread keeps
   * their findings as one entry because it reads better and the conductor wants
   * one place to look — but crediting only the first member would lose the fact
   * that two agents spent a turn each on it.
   */
  participants?: string[];
};

/** Handle reserved for the person running the council. */
export const COUNCIL_USER_ID = "you";

/** A path differing from HEAD, as reported by the Git bridge. */
export type RepoChange = {
  path: string;
  status?: string;
  additions?: number | null;
  deletions?: number | null;
};

/**
 * What the repository says happened, as opposed to what the member said
 * happened. Handoffs are self-reported, so a council with no ground truth can
 * route "implemented it" straight to review and reach completion having written
 * nothing at all.
 */
export type CouncilEvidence = {
  /** Paths that changed during the turn just finished. */
  changedPaths: string[];
  /** Every path currently differing from HEAD. */
  dirtyPaths: string[];
  /** A member whose role writes code finished the turn touching no files. */
  claimedWithoutChanges: boolean;
  /** The project's own test suite, when there is one and code changed. */
  tests?: CouncilTestResult | null;
};

/** Outcome of running the project's test command between turns. */
export type CouncilTestResult = {
  command: string;
  passed: boolean;
  /** True when the run was cut short rather than finishing. */
  timedOut?: boolean;
  /** Tail of the output — enough to see the failure, not the whole log. */
  output: string;
};

/**
 * A standing instruction the user gave the conductor directly.
 *
 * Ordinary user messages live in the thread and reach the conductor through it,
 * but the conductor only ever sees the tail of that thread — an instruction
 * given ten turns ago has scrolled out of its view while still being the thing
 * the user expects it to be routing by. A directive is held separately and
 * re-stated on every routing call until the user withdraws it.
 */
export type ConductorDirective = {
  /** The turn it was given on, so the conductor can weigh it against events. */
  turn: number;
  text: string;
};

/**
 * How many standing instructions are kept. They are re-sent in full on every
 * routing call, so an unbounded list would quietly become the largest part of
 * the prompt; the oldest are dropped rather than trimmed, because half an
 * instruction is worse than none.
 */
export const CONDUCTOR_DIRECTIVE_LIMIT = 8;

/**
 * Adds a directive, ignoring blank text and an instruction identical to the one
 * already standing — a user pressing send twice should not have the conductor
 * told the same thing twice, since repetition in a prompt reads as emphasis.
 */
export function addConductorDirective(
  existing: ConductorDirective[] | undefined,
  turn: number,
  text: string,
): ConductorDirective[] {
  const trimmed = text.trim();
  const current = existing ?? [];
  if (!trimmed) return current;
  if (current.at(-1)?.text === trimmed) return current;
  return [...current, { turn, text: trimmed }].slice(-CONDUCTOR_DIRECTIVE_LIMIT);
}

/**
 * The standing-instruction block. Stated as binding and placed above the
 * conversation, because its whole purpose is to outrank what the members are
 * saying to each other.
 */
export function renderConductorDirectives(directives: ConductorDirective[] | undefined) {
  if (!directives?.length) return "";
  const lines = directives.map((directive) => `- (given at turn ${directive.turn}) ${directive.text}`).join("\n");
  return (
    "## Standing instructions from the person running this council\n" +
    "These come from the person the council is working for. They outrank every handoff below and do not expire — honour them on this turn and on every turn after it, until you are told otherwise.\n" +
    lines
  );
}

/** Where the conductor sent the baton, and why. */
export type ConductorDecision = {
  nextMemberId: string | null;
  directive: string;
  reason: string;
  done: boolean;
  /**
   * Members to consult simultaneously instead of one after another. Only roles
   * that do not write code are eligible — see `planCouncilPanel`.
   */
  panel?: string[];
};

/**
 * How many members may be consulted at once. Beyond this the merged findings
 * stop being reviewable and every extra member is another full agent turn.
 */
export const MAX_PANEL_MEMBERS = 3;

/** How the next member was picked — shown in the UI so routing is auditable. */
export type RelayRouteSource = "conductor" | "addressed" | "rotation";

export type RelayRoute = {
  member: CouncilRelayMember;
  /** Everyone taking this turn. One member unless the conductor called a panel. */
  panel: CouncilRelayMember[];
  source: RelayRouteSource;
  directive: string;
  reason: string;
};

/**
 * Default stop on automatic advancement. Two agents handing work back and forth
 * will happily continue forever, and every turn costs real tokens — so the loop
 * is capped unless the user chooses otherwise. `null` means no cap at all.
 */
/** How many lines from the end of a pane are read to judge progress. */
const PROGRESS_TAIL_LINES = 40;

/**
 * A mark that changes when a turn is getting somewhere, and does not when it
 * is only making noise.
 *
 * The idle check used to count lines, so any output reset its clock. An agent
 * stuck in a loop prints constantly, so a noisy stall never tripped it and the
 * turn survived to the two-hour ceiling instead of being rescued in ten
 * minutes. Volume is not progress.
 *
 * Digits are flattened before comparing, because the panes carry an elapsed
 * timer that changes on every frame while nothing at all is happening.
 */
export function relayProgressMark(lines: readonly string[]): string {
  const tail = lines.slice(-PROGRESS_TAIL_LINES);
  const normalized = tail
    .map((line) =>
      String(line ?? "")
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
  // Repetition is not progress either, so a pane cycling through the same few
  // lines settles to the same mark however many times it repeats them.
  const distinct = [...new Set(normalized)];
  return distinct.length ? `${distinct.length}:${distinct.join("\u0001")}` : "empty";
}

/** Hours offered as a run budget. `null` is unlimited, up to the turn ceiling. */
export const RUN_BUDGET_HOURS = [2, 4, 8] as const;

/** How long a council may run before it stops and asks whether to go on. */
export const DEFAULT_RUN_BUDGET_MS = 4 * 60 * 60 * 1000;

/** Normalises a budget in hours from the UI or storage into milliseconds. */
export function normalizeRunBudget(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RUN_BUDGET_MS;
  return Math.round(parsed * 60 * 60 * 1000);
}

/**
 * Whether the run as a whole still has time left.
 *
 * Each turn was capped at two hours and the run at 24 turns, but nothing capped
 * the run itself, so those two ceilings multiplied instead of adding up to a
 * number anyone had chosen.
 */
export function isWithinRunBudget(
  startedAt: string | undefined | null,
  now: string | number | Date,
  budgetMs: number | null | undefined,
): boolean {
  if (budgetMs === null) return true;
  if (!startedAt) return true;
  const start = Date.parse(startedAt);
  const at = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(at)) return true;
  return at - start <= (budgetMs ?? DEFAULT_RUN_BUDGET_MS);
}

export type StallAction = { action: "wait" | "nudge" | "reroute" | "stop" | "gated"; members: string[] };

/**
 * How long a council waits on a person before it says so.
 *
 * A gated pane is skipped by the rescue, and rightly — typing a nudge into a
 * sign-in dialog is the thing the guard exists to prevent. But skipped meant
 * invisible: nobody was owing a handoff, so the watcher kept waiting and the
 * run sat out its full two-hour poll rather than being rescued in ten minutes.
 */
export const GATE_PATIENCE_MS = 15 * 60 * 1000;

/**
 * What to do about members that owe a handoff and have gone quiet.
 *
 * The run used to stop as soon as one nudge went unanswered, telling the user
 * to hand off manually or re-route from the Conductor lane — something Pitwall
 * can do itself, and already knows who is stuck. It re-routes once instead, and
 * stops only when that is spent too, so a stuck council cannot loop forever and
 * does not need a person to keep it moving.
 */
export function resolveStallAction({
  owing,
  nudged,
  rerouted,
  gated = [],
  gatedForMs = 0,
}: {
  owing: readonly string[];
  nudged: readonly string[];
  rerouted: boolean;
  /** Members skipped because their pane is waiting on a person. */
  gated?: readonly string[];
  /** How long that has been true for this turn. */
  gatedForMs?: number;
}): StallAction {
  const members = [...owing];
  if (!members.length) {
    // Nobody owes anything because everyone is blocked, not because the work is
    // in. Waiting forever on that is how a council loses an afternoon.
    if (gated.length && gatedForMs >= GATE_PATIENCE_MS) return { action: "gated", members: [...gated] };
    return { action: "wait", members };
  }
  const fresh = members.filter((memberId) => !nudged.includes(memberId));
  if (fresh.length) return { action: "nudge", members: fresh };
  return { action: rerouted ? "stop" : "reroute", members };
}

export const MAX_RELAY_TURNS = 24;

/** Offered turn limits. `null` is unlimited; anything else may be typed in. */
export const RELAY_TURN_LIMITS = [24, 36, 48, 96] as const;

/**
 * A council cannot run past this even when the user asks for "unlimited" — an
 * agent loop with no ceiling at all is a runaway bill, not a feature. It is set
 * far above any council a person would sit through.
 */
export const RELAY_TURN_CEILING = 500;

/** Normalises whatever the UI or storage supplies into a usable cap. */
export function normalizeTurnLimit(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return MAX_RELAY_TURNS;
  return Math.min(Math.floor(parsed), RELAY_TURN_CEILING);
}

/** Whether an automatic hand-off to `turn` is still within the run's budget. */
export function isWithinTurnLimit(turn: number, limit: number | null | undefined) {
  if (limit === null) return turn <= RELAY_TURN_CEILING;
  return turn <= (limit ?? MAX_RELAY_TURNS);
}

/** The note shown when a council stops because it ran out of turns. */
export function formatTurnLimitNote(limit: number | null | undefined) {
  if (limit === null) {
    return `Stopped at the ${RELAY_TURN_CEILING}-turn safety ceiling. Hand off manually to continue.`;
  }
  return `Paused after ${limit ?? MAX_RELAY_TURNS} turns so the agents don't loop indefinitely. Raise the limit or hand off manually to continue.`;
}

/**
 * A stage file whose first non-empty line is this marker ends the relay. It
 * gives the agents a way to say "we're done" instead of ping-ponging until the
 * turn cap.
 */
export const RELAY_COMPLETE_MARKER = "RELAY-COMPLETE";

/**
 * A member may not hold the baton more than this many turns in a row. The
 * conductor is free to send work back to the same agent — following up on its
 * own change is legitimate — but an agent that keeps electing itself is a
 * stalled council, not a conversation.
 */
export const MAX_CONSECUTIVE_TURNS = 2;

/** How much of each thread message the conductor sees. Routing needs the gist,
 * not the diff, and the whole thread is re-sent every turn. */
const CONDUCTOR_EXCERPT_CHARS = 1200;

/** How many recent messages the conductor sees. Older turns are summarised by
 * the fact that the work moved on. */
const CONDUCTOR_THREAD_DEPTH = 8;

/** Everything the council writes about itself lives here, inside the worktree. */
export const COUNCIL_ARTEFACT_DIR = ".braveli";

export function getCouncilTaskBriefPath(runId: string) {
  return `.braveli/council/${runId}/task.md`;
}

export function buildCouncilTaskBrief(task: { identifier?: string; title: string; description: string }) {
  const title = task.title.trim() || "Untitled task";
  const description = task.description.trim();
  const identity = task.identifier ? `[${task.identifier}] ` : "";
  return `# ${identity}${title}\n\n${description || "No description provided."}\n`;
}

export function formatCouncilTaskFilePrompt(taskBriefPath: string) {
  return `Read the complete task brief at ${taskBriefPath} before doing any work. Read the entire file; its contents are the authoritative task specification.`;
}

/**
 * Where a turn's handoff goes. A panel turn has several members answering at
 * once, so each writes its own file; a solo turn keeps the unsuffixed name.
 */
export function getCouncilStageFile(runId: string, turn: number, memberId?: string) {
  return memberId
    ? `.braveli/council/${runId}/stage-${turn}-${memberId}.md`
    : `.braveli/council/${runId}/stage-${turn}.md`;
}

/**
 * Where a given member of a turn writes its handoff.
 *
 * The rule is one line — a solo turn keeps the unsuffixed name, a panel gives
 * every member its own file — but it has to hold in four places at once: the
 * prompt that tells the member where to write, the watcher waiting on the file,
 * the nudge that asks again when nothing appeared, and the manual hand-off that
 * reads what a turn produced. Any of those disagreeing is a council waiting
 * forever on a file its member was never asked for, so they all resolve it here.
 */
export function getTurnStageFile(runId: string, turn: number, memberId: string, panelSize: number) {
  return panelSize > 1 ? getCouncilStageFile(runId, turn, memberId) : getCouncilStageFile(runId, turn);
}

/**
 * Typed into a TUI, a prompt of tens of kilobytes arrives as several pastes
 * with stray fragments between them, and the part most often lost is the line
 * naming the handoff file — so the member never writes it and the council never
 * advances. A long prompt goes into a file; only a short pointer is typed.
 */
const COUNCIL_PROMPT_INLINE_LIMIT = 1200;

export function planCouncilPromptDelivery({
  runId,
  turn,
  memberId,
  stageFile,
  prompt,
  stamp,
}: {
  runId: string;
  turn: number;
  memberId: string;
  stageFile: string;
  prompt: string;
  stamp: number;
}): { filePath: string; content: string; pointer: string } | null {
  if (prompt.length <= COUNCIL_PROMPT_INLINE_LIMIT) return null;
  const filePath = `.braveli/council/${runId}/prompts/turn-${turn}-${memberId}-${stamp}.md`;
  const handoff = prompt.includes(stageFile)
    ? ` When you are done, write your handoff to ${stageFile} — the council moves on only once that file exists.`
    : "";
  return {
    filePath,
    content: prompt,
    // The path again at the end: a pointer typed into an agent that is still
    // starting can lose its first words, and the tail must still say where to look.
    pointer: `Your full instructions for this turn are in ${filePath}. Read the whole file now and follow it exactly.${handoff} (Instructions: ${filePath})`,
  };
}

/**
 * The whole council conversation in one file. Stage files are per-turn and only
 * ever show the last baton; this is what makes the relay a discussion — every
 * member reads what everyone said, not just the agent immediately upstream.
 */
export function getCouncilThreadFile(runId: string) {
  return `.braveli/council/${runId}/thread.md`;
}

/**
 * The map of the repository this council has built up.
 *
 * Separate from the thread on purpose: the thread is the argument and grows
 * without bound, while this is the current state of what is known and is
 * rewritten each turn, so a member can read it without reading everything.
 */
export function getCouncilWorkingSetFile(runId: string) {
  return `.braveli/council/${runId}/working-set.md`;
}

/** Append-only log of the conductor's routing decisions, for auditing a run. */
export function getCouncilConductorLogFile(runId: string) {
  return `.braveli/council/${runId}/conductor.md`;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds a member's handle from its role and agent — "architect-claude". A
 * council can hold two Claudes in different roles, or two implementers on
 * different agents, so uniqueness is enforced against the handles already
 * taken rather than assumed.
 */
export function makeCouncilMemberId(roleKey: string, agentLabel: string, taken: Iterable<string> = []) {
  const used = new Set(taken);
  const base = [slug(roleKey), slug(agentLabel)].filter(Boolean).join("-") || "member";
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Which member owns a turn when nothing smarter is available. Turns cycle
 * through the members forever, so a two-member council alternates
 * architect -> implementer -> architect -> ...
 */
export function relayMemberForTurn<T>(members: T[], turn: number): T | undefined {
  if (members.length === 0) return undefined;
  return members[(turn - 1) % members.length];
}

/**
 * True when a handoff file signals the relay is finished. Checked against the
 * first non-empty line so a passing mention of the marker deeper in the writeup
 * does not end the run.
 */
export function isRelayComplete(stageContent: string) {
  const firstLine = stageContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return false;
  return new RegExp(`^#*\\s*${RELAY_COMPLETE_MARKER}\\b`, "i").test(firstLine);
}

/**
 * Reads the `TO: <handle>` header an agent may put at the top of its handoff to
 * hand work to a specific member. Only the leading line counts — an agent
 * discussing another member mid-writeup is not addressing them.
 */
export function parseHandoffAddress(stageContent: string): string | null {
  const firstLine = stageContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const match = /^#*\s*(?:TO|NEXT)\s*[:>-]\s*@?([a-z0-9][a-z0-9._-]*)/i.exec(firstLine);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolves whatever an agent or the conductor wrote — a handle, a role name, an
 * agent name — to an actual member. Models are inconsistent about which of the
 * three they use, and a routing miss would stall the relay, so matching is
 * deliberately forgiving.
 */
export function resolveMemberRef(
  members: CouncilRelayMember[],
  ref: string | null | undefined,
): CouncilRelayMember | undefined {
  if (!ref) return undefined;
  const needle = slug(ref);
  if (!needle) return undefined;

  const exact = members.find((member) => member.memberId === needle);
  if (exact) return exact;

  // Loose tiers must be unambiguous. With two QA members on the council, "qa"
  // names neither of them — guessing would hand the work to a member nobody
  // asked for, and the caller's fallback is better than a confident wrong hop.
  for (const match of [
    (member: CouncilRelayMember) => slug(member.roleLabel) === needle,
    (member: CouncilRelayMember) => slug(member.agentLabel) === needle,
    (member: CouncilRelayMember) => member.memberId.startsWith(`${needle}-`),
    (member: CouncilRelayMember) => member.memberId.includes(needle),
  ]) {
    const found = members.filter(match);
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined;
  }
  return undefined;
}

/**
 * Reduces the Git bridge's change list to a comparable fingerprint. Line counts
 * are part of the key so a member that edits a file already dirty from an
 * earlier turn still registers as having done something.
 */
export function snapshotRepoChanges(changes: RepoChange[] | undefined | null): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const change of changes ?? []) {
    if (!change?.path) continue;
    // The council's own task brief, thread, stage files and conductor log live
    // in the worktree, so they show up as changes. Counting them as evidence
    // would mean every member "produced work" simply by writing its handoff —
    // which is exactly the claim this evidence exists to check.
    if (change.path === COUNCIL_ARTEFACT_DIR || change.path.startsWith(`${COUNCIL_ARTEFACT_DIR}/`)) continue;
    snapshot[change.path] = `${change.status ?? ""}:${change.additions ?? ""}:${change.deletions ?? ""}`;
  }
  return snapshot;
}

/** Compares two snapshots to find what a single turn actually touched. */
export function buildCouncilEvidence({
  before,
  after,
  member,
}: {
  before: Record<string, string>;
  after: Record<string, string>;
  member?: Pick<CouncilRelayMember, "writesCode"> | null;
}): CouncilEvidence {
  const touched = new Set<string>();
  for (const [path, fingerprint] of Object.entries(after)) {
    if (before[path] !== fingerprint) touched.add(path);
  }
  // A reverted or committed file is movement too, and its absence from `after`
  // would otherwise read as a member having done nothing.
  for (const path of Object.keys(before)) {
    if (!(path in after)) touched.add(path);
  }
  const changedPaths = [...touched].sort();
  return {
    changedPaths,
    dirtyPaths: Object.keys(after).sort(),
    claimedWithoutChanges: Boolean(member?.writesCode) && changedPaths.length === 0,
  };
}

/** How many changed paths to name before the list stops being useful. */
const EVIDENCE_PATH_LIMIT = 12;

function formatPathList(paths: string[]) {
  if (paths.length <= EVIDENCE_PATH_LIMIT) return paths.join(", ");
  return `${paths.slice(0, EVIDENCE_PATH_LIMIT).join(", ")} (+${paths.length - EVIDENCE_PATH_LIMIT} more)`;
}

/**
 * The evidence block for the conductor. Stated as ground truth precisely
 * because the rest of its prompt is self-reported.
 */
export function formatCouncilEvidence(evidence: CouncilEvidence | null | undefined, memberId?: string) {
  if (!evidence) return "";
  const lines = [
    evidence.changedPaths.length
      ? `Files changed during this turn: ${formatPathList(evidence.changedPaths)}`
      : "No files changed during this turn.",
    evidence.dirtyPaths.length
      ? `The working tree differs from HEAD in ${evidence.dirtyPaths.length} file(s): ${formatPathList(evidence.dirtyPaths)}`
      : "The working tree is clean — nothing has been written yet in this council.",
  ];
  if (evidence.claimedWithoutChanges) {
    lines.push(
      `WARNING: ${memberId || "that member"} holds a role that writes code but changed no files this turn.` +
        " Treat its handoff as a claim, not as completed work, and do not route the task towards completion on the strength of it.",
    );
  }
  if (evidence.tests) {
    const { command, passed, timedOut, output } = evidence.tests;
    lines.push(
      timedOut
        ? `The project's test suite (\`${command}\`) did not finish in time. Treat the work as unverified.`
        : passed
          ? `The project's test suite (\`${command}\`) passes.`
          : `FAILING TESTS: \`${command}\` exited non-zero. The work is not finished, whatever the handoff says. Output tail:\n${output}`,
    );
  }
  return lines.join("\n");
}

/** The evidence line handed to a member taking its turn. */
export function formatMemberEvidence(evidence: CouncilEvidence | null | undefined) {
  if (!evidence) return "";
  if (!evidence.dirtyPaths.length) {
    return " Nothing has been written to the repository yet in this council — no earlier member has produced code, whatever their handoff says.";
  }
  return (
    ` The repository currently differs from HEAD in these files: ${formatPathList(evidence.dirtyPaths)}.` +
    " Check the actual diff rather than trusting the handoff's description of it."
  );
}

/**
 * Turns kept in full. Every member re-reads the whole thread each turn, so
 * without a bound the token cost of a long council grows quadratically.
 */
export const THREAD_VERBATIM_TURNS = 6;

/** How much of an older turn survives the trim. */
const THREAD_SUMMARY_CHARS = 240;

function condense(content: string, limit: number) {
  const collapsed = content.trim().replace(/\s+/g, " ");
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit)}… [trimmed]`;
}

/** Reconstruct old runs from handoffs; a saved snapshot includes findings already trimmed out. */
export function restoreCouncilWorkingSet(messages: CouncilThreadMessage[], saved?: unknown): WorkingSet {
  const rebuilt = messages.reduce(
    (set, message) => mergeWorkingSet(set, parseWorkingSet(message.content, message.turn, message.fromMemberId)),
    emptyWorkingSet(),
  );
  return isWorkingSet(saved) ? mergeWorkingSet(rebuilt, saved) : rebuilt;
}

/** A restored panel keeps its original stage filenames while dropping removed seats. */
export function restoreCouncilPanel(members: CouncilRelayMember[], currentMemberId?: string, savedIds?: unknown): CouncilRelayMember[] {
  const current = members.find((member) => member.memberId === currentMemberId) ?? members[0];
  if (!current) return [];
  const ids = isStringList(savedIds) ? new Set(savedIds) : new Set<string>();
  return [current, ...members.filter((member) => member.memberId !== current.memberId && ids.has(member.memberId))];
}

function renderCouncilDecisions(set: WorkingSet) {
  const sections: string[] = [];
  if (set.decisions?.length) sections.push(`## Accepted decisions\n\n${set.decisions.map((decision) => `- ${decision}`).join("\n")}`);
  if (set.openQuestions.length) sections.push(`## Open questions\n\n${set.openQuestions.map((question) => `- ${question}`).join("\n")}`);
  if (set.resolvedQuestions?.length) sections.push(`## Resolved questions\n\n${set.resolvedQuestions.map((question) => `- ${question}`).join("\n")}`);
  return sections.join("\n\n");
}

function renderUserInstructions(messages: CouncilThreadMessage[]) {
  const instructions = [...new Set(messages.filter((message) => message.author === "user").map((message) => message.content.trim()).filter(Boolean))];
  return instructions.length
    ? `## Instructions from the person running this council\nThese outrank member plans and remembered findings. They are in chronological order; a later user correction replaces the earlier instruction it changes.\n${instructions.map((instruction) => `- ${instruction}`).join("\n")}`
    : "";
}

/**
 * Renders the shared thread every member reads before taking its turn. Recent
 * turns are verbatim; older ones are trimmed to a gist, and user instructions
 * are never trimmed — they are the one thing in the thread that outranks
 * everything else.
 */
export function renderCouncilThread(
  members: CouncilRelayMember[],
  messages: CouncilThreadMessage[],
  task: { title: string },
  workingSet?: WorkingSet,
) {
  const roster = members
    .map((member) => `- \`${member.memberId}\` — ${member.roleLabel} (${member.agentLabel})`)
    .join("\n");

  const verbatimFrom = Math.max(0, messages.length - THREAD_VERBATIM_TURNS);
  const body = messages
    .map((message, index) => {
      if (message.author === "user") {
        return `## Instruction from the person running this council\n\n${message.content.trim()}`;
      }
      if (message.author === "council") {
        return message.content.trim();
      }
      const from = resolveMemberRef(members, message.fromMemberId);
      const heading = `## Turn ${message.turn} — ${from ? `${from.roleLabel} (${from.agentLabel})` : message.fromMemberId}`;
      const addressed = message.toMemberId ? ` → \`${message.toMemberId}\`` : "";
      const content =
        index >= verbatimFrom ? message.content.trim() : condense(message.content, THREAD_SUMMARY_CHARS);
      return `${heading}${addressed}\n\n${content}`;
    })
    .join("\n\n---\n\n");

  const decisions = renderCouncilDecisions(restoreCouncilWorkingSet(messages, workingSet));
  return `# Council thread — ${task.title}\n\n${roster}\n\n${decisions ? `${decisions}\n\n---\n\n` : ""}${body}\n`;
}

/**
 * Builds the prompt for one turn. Each turn reads the shared thread and writes
 * its own handoff to a fresh file — the ever-increasing turn number is what
 * lets the watcher tell a new handoff from the one it already acted on.
 */
export function buildCouncilRelayTurn({
  runId,
  taskPrompt,
  member,
  members,
  turn,
  isCycle,
  directive,
  from,
  evidence,
  panel,
  workingSet,
  directives,
  messages = [],
}: {
  runId: string;
  taskPrompt: string;
  member: CouncilRelayMember;
  /** The full roster, so the agent knows who it can hand work to. */
  members?: CouncilRelayMember[];
  turn: number;
  /** True once every member has had a turn — the work is now iterative. */
  isCycle: boolean;
  /** The conductor's instruction for this specific turn. */
  directive?: string;
  /** The member that handed work over, when someone did. */
  from?: CouncilRelayMember;
  /** What the repository actually holds, so the member reviews reality. */
  evidence?: CouncilEvidence | null;
  /** Everyone taking this turn, when the conductor consulted several at once. */
  panel?: CouncilRelayMember[];
  /**
   * What earlier turns already found out about the repository. Passed forward
   * so a member opens the files the council has read instead of finding them
   * again — on a five-turn council that was five explorations of one codebase.
   */
  workingSet?: WorkingSet | null;
  directives?: ConductorDirective[];
  messages?: CouncilThreadMessage[];
}): CouncilRelayTurn {
  const alongside = (panel ?? []).filter((item) => item.memberId !== member.memberId);
  const stageFile = getTurnStageFile(runId, turn, member.memberId, panel?.length ?? 1);
  const upstreamFile = turn > 1 ? getCouncilStageFile(runId, turn - 1) : null;
  const threadFile = getCouncilThreadFile(runId);
  const roster = (members ?? []).filter((item) => item.memberId !== member.memberId);

  const read = upstreamFile
    ? ` Begin with the latest handoff at ${upstreamFile}${
        from ? `, which ${from.roleLabel} (${from.agentLabel}) addressed to you` : ""
      }. Use ${threadFile} for the full discussion so far when a decision, dependency, or disagreement needs more context.`
    : "";
  const instruction = directive ? ` Your specific assignment this turn: ${directive}` : "";
  const ground = turn > 1 ? formatMemberEvidence(evidence) : "";
  // A panel member must know it is one voice of several, or it writes as though
  // its handoff is the turn's conclusion and the merged result reads as three
  // agents talking over each other.
  const concurrent = alongside.length
    ? ` You are being consulted in parallel with ${alongside
        .map((item) => `${item.roleLabel} (${item.agentLabel})`)
        .join(" and ")}. Give your own independent assessment — do not wait for them, do not edit the code, and do not assume your view is the council's conclusion.`
    : "";
  const iterate = isCycle
    ? " This is an ongoing council: review what came back, then take the work further rather than restarting it."
    : "";
  const talk = roster.length
    ? ` You are working with ${roster
        .map((item) => `${item.roleLabel} (${item.agentLabel}), addressed as ${item.memberId}`)
        .join("; ")}. Raise disagreements and ask them direct questions instead of silently working around their decisions.`
    : "";
  const workingSetFile = getCouncilWorkingSetFile(runId);
  const briefing = formatWorkingSetForPrompt(restoreCouncilWorkingSet(messages, workingSet), workingSetFile);
  const standing = `${renderUserInstructions(messages)} ${renderConductorDirectives(directives)}`;
  const focus = member.writesCode
    ? " Work from the accepted specification and mapped entry points; inspect the current source before editing, then report the resulting diff and verification output."
    : /qa|review|security|test/i.test(`${member.memberId} ${member.roleLabel}`)
      ? " Review the accepted specification against the actual current diff and test evidence. Treat the previous member's claims as unverified until supported; inspect neighbouring code needed to assess the change."
      : " Focus on the decisions, constraints, and open questions relevant to your assignment; use the existing project map to find their source.";
  const write =
    ` When you finish, write your handoff to ${stageFile}: what you did, key decisions, and anything you want another member to answer or verify.` +
    (roster.length
      ? ` Make the first line \`TO: <member>\` naming who should pick the work up next (${roster
          .map((item) => item.memberId)
          .join(", ")}) — the conductor takes that as your recommendation.`
      : "") +
    ` If the task is genuinely complete and nothing remains for anyone, make ${RELAY_COMPLETE_MARKER} the first line of that file instead.`;

  const prompt = `${member.rolePrompt} ${taskPrompt}. ${standing}${read}${briefing}${ground}${instruction}${focus}${concurrent}${iterate}${talk}${write}${workingSetContract(turn === 1)}`
    .replace(/\s+/g, " ")
    .trim();

  return { turn, sessionId: member.sessionId, prompt, stageFile, upstreamFile };
}

/**
 * Prompt for a member that ended its turn without writing a handoff. Agents
 * routinely finish by printing to the terminal and consider themselves done, so
 * the relay asks once rather than waiting out the poll deadline.
 */
export function buildRelayNudge(
  stageFile: string,
  context: { roleLabel?: string; assignment?: string } = {},
) {
  // A member that lost the thread cannot answer a request for a file it does
  // not remember owing, so the assignment comes with the ask. Both are optional
  // because a turn can stall before either is known.
  const reminder = [
    context.roleLabel ? `You are the ${context.roleLabel} on this council.` : "",
    context.assignment ? `Your assignment this turn: ${context.assignment}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    (reminder ? `${reminder} ` : "") +
    `Your turn is not finished: the council is waiting on your handoff file. Write it to ${stageFile} now —` +
    ` what you did, key decisions, and what the next member should do or verify. Start it with \`TO: <member>\`,` +
    ` or with ${RELAY_COMPLETE_MARKER} if nothing remains for anyone.` +
    // Asked here too: a nudged turn is still a turn, and a handoff written
    // without the map costs the next member the exploration all over again.
    workingSetContract(false)
  );
}

/**
 * Works out who can sit on a panel for one turn.
 *
 * Members share a single worktree, so two agents writing code at once would
 * clobber each other with no way to tell whose change survived. Advisory roles
 * only read the tree and write their own handoff, so consulting several of them
 * simultaneously is safe and is where the real time is won — three reviewers
 * with different priorities in the time one takes. Anything that writes code is
 * therefore dropped from a panel and takes its turn alone.
 */
export function planCouncilPanel(
  members: CouncilRelayMember[],
  requested: string[] | null | undefined,
  primary: CouncilRelayMember,
): CouncilRelayMember[] {
  if (!requested?.length) return [primary];

  const seen = new Set<string>();
  const panel: CouncilRelayMember[] = [];
  for (const ref of [primary.memberId, ...requested]) {
    const member = resolveMemberRef(members, ref);
    if (!member || seen.has(member.memberId)) continue;
    seen.add(member.memberId);
    panel.push(member);
  }

  const advisory = panel.filter((member) => !member.writesCode);
  // A panel containing a writer collapses to that writer alone: its changes are
  // what the next turn has to review, and the advice would be about stale code.
  const writer = panel.find((member) => member.writesCode);
  if (writer) return [writer];
  return advisory.slice(0, MAX_PANEL_MEMBERS);
}

/** Merges a panel's separate handoffs into the one entry the thread records. */
export function mergePanelHandoffs(entries: Array<{ member: CouncilRelayMember; content: string }>) {
  if (entries.length === 1) return entries[0].content;
  return entries
    .map(({ member, content }) => `### ${member.roleLabel} (${member.agentLabel}) — \`${member.memberId}\`\n\n${content.trim()}`)
    .join("\n\n");
}

/**
 * Whether a member has just held the last `MAX_CONSECUTIVE_TURNS` turns. Used to
 * re-ask the conductor with that member excluded before the blunt rotation
 * fallback takes over.
 */
export function isStuckOn(members: CouncilRelayMember[], history: string[] | undefined, memberId: string | undefined) {
  if (!memberId || members.length < 2) return false;
  const recent = (history ?? []).slice(-MAX_CONSECUTIVE_TURNS);
  return recent.length === MAX_CONSECUTIVE_TURNS && recent.every((entry) => entry === memberId);
}

/**
 * The part of a running council worth keeping across a restart. The panes and
 * their CLIs do not survive one, but the conversation, the roster and the
 * routing history do — and without them a restarted council is unresumable
 * even though `thread.md` is still sitting in the worktree.
 */
export type PersistedRelayState = {
  projectPath: string;
  taskPrompt: string;
  task: { title: string; description?: string };
  members: CouncilRelayMember[];
  turn: number;
  /** When the council first started, so elapsed time survives a restart. */
  startedAt?: string;
  /** The run's turn budget. null is unlimited (up to the safety ceiling). */
  maxTurns?: number | null;
  conductor: { enabled: boolean; agent: string; model: string; runTests?: boolean; openingDebate?: boolean };
  /**
   * Standing instructions the user gave the conductor. Kept because they are
   * binding for the rest of the run — a council resumed without them routes by
   * the members' plans again, silently discarding what the user asked for.
   */
  directives?: ConductorDirective[];
  messages: CouncilThreadMessage[];
  history: string[];
  currentMemberId?: string;
  currentPanelMemberIds?: string[];
  workingSet?: WorkingSet;
  lessons?: string[];
  evidence?: CouncilEvidence | null;
  verification?: { attempts: number; pending: boolean; verdict: VerificationVerdict | null };
  currentAssignment?: string;
  projectRoot?: string;
  taskId?: string;
  contextEntryIds?: string[];
  /**
   * An argument in progress. Restored so a council interrupted mid-debate
   * resumes arguing rather than silently dropping back to work — for an opening
   * debate that would mean writing code with no agreed approach, which is the
   * exact outcome it exists to prevent.
   */
  debate?: unknown;
  /** The opening debate's outcome, if it is still owed to a working turn. */
  openingDirective?: string;
  /** Advancing on its own when last saved — a restart picks such a run back up. */
  running?: boolean;
  routes: Array<{
    turn: number;
    fromMemberId: string;
    toMemberId: string;
    source: RelayRouteSource;
    reason: string;
    directive: string;
  }>;
  conductorCostUsd?: number;
};

/**
 * Kept per message when persisting. The authoritative transcript is `thread.md`
 * on disk; this copy only has to be good enough to resume routing, and local
 * storage is a few megabytes for the entire workspace.
 */
const PERSISTED_MESSAGE_CHARS = 4000;

/** How many messages survive into storage, newest first. */
const PERSISTED_MESSAGE_LIMIT = 40;

export function toPersistedRelayState(run: PersistedRelayState): PersistedRelayState {
  return {
    ...run,
    workingSet: restoreCouncilWorkingSet(run.messages, run.workingSet),
    messages: run.messages.filter((message, index) => message.author === "user" || index >= run.messages.length - PERSISTED_MESSAGE_LIMIT).map((message) => ({
      ...message,
      content:
        message.author !== "user" && message.content.length > PERSISTED_MESSAGE_CHARS
          ? `${message.content.slice(0, PERSISTED_MESSAGE_CHARS)}\n[trimmed — full text in thread.md]`
          : message.content,
    })),
    history: run.history.slice(-PERSISTED_MESSAGE_LIMIT),
    routes: run.routes.slice(-PERSISTED_MESSAGE_LIMIT),
  };
}

/**
 * Validates a stored relay before it is trusted. Storage outlives the code that
 * wrote it, so a council persisted by an older build must fail to restore
 * rather than half-restore into a run that cannot advance.
 */
export function isRestorableRelayState(value: unknown): value is PersistedRelayState {
  if (!value || typeof value !== "object") return false;
  const state = value as PersistedRelayState;
  return (
    Array.isArray(state.members) &&
    state.members.length > 1 &&
    state.members.every(
      (member) => typeof member?.memberId === "string" && typeof member?.sessionId === "string" && typeof member?.rolePrompt === "string",
    ) &&
    Array.isArray(state.messages) &&
    state.messages.every((message) => message && Number.isFinite(message.turn) && typeof message.fromMemberId === "string" && typeof message.content === "string") &&
    Array.isArray(state.history) &&
    Number.isFinite(state.turn) &&
    Boolean(state.conductor) &&
    (state.workingSet === undefined || isWorkingSet(state.workingSet)) &&
    (state.lessons === undefined || isStringList(state.lessons)) &&
    (state.evidence == null || isCouncilEvidence(state.evidence)) &&
    (state.verification === undefined || isCouncilVerification(state.verification)) &&
    (state.currentAssignment === undefined || typeof state.currentAssignment === "string") &&
    (state.projectRoot === undefined || typeof state.projectRoot === "string") &&
    (state.taskId === undefined || typeof state.taskId === "string") &&
    (state.contextEntryIds === undefined || isStringList(state.contextEntryIds)) &&
    (state.currentPanelMemberIds === undefined || (isStringList(state.currentPanelMemberIds) &&
      state.currentPanelMemberIds.every((id) => state.members.some((member) => member.memberId === id))))
  );
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

function isCouncilEvidence(evidence: CouncilEvidence) {
  return typeof evidence === "object" && isStringList(evidence.changedPaths) && isStringList(evidence.dirtyPaths) &&
    typeof evidence.claimedWithoutChanges === "boolean" && (evidence.tests == null || (
      typeof evidence.tests.command === "string" && typeof evidence.tests.passed === "boolean" &&
      typeof evidence.tests.output === "string" && (evidence.tests.timedOut === undefined || typeof evidence.tests.timedOut === "boolean")
    ));
}

function isCouncilVerification(verification: NonNullable<PersistedRelayState["verification"]>) {
  return Boolean(verification) && Number.isInteger(verification.attempts) && verification.attempts >= 0 &&
    typeof verification.pending === "boolean" && (verification.verdict === null || (
      Boolean(verification.verdict) && typeof verification.verdict.verified === "boolean" &&
      isStringList(verification.verdict.gaps) && typeof verification.verdict.summary === "string"
    ));
}

/**
 * Rebuilds a thread from the stage files a council already wrote. Councils
 * started before the conductor existed have no stored conversation, only the
 * numbered handoffs on disk — and those are enough to adopt the run rather than
 * abandon a session that has hours of work in it.
 *
 * Authorship is derived by rotation because that is exactly how those councils
 * assigned turns, so the reconstruction matches what actually happened.
 */
export function rebuildThreadFromStages(
  members: CouncilRelayMember[],
  stages: Array<{ turn: number; content: string }>,
): CouncilThreadMessage[] {
  return stages
    .slice()
    .sort((a, b) => a.turn - b.turn)
    .map((stage) => {
      const author = relayMemberForTurn(members, stage.turn);
      const addressed = parseHandoffAddress(stage.content);
      return {
        turn: stage.turn,
        fromMemberId: author?.memberId ?? "",
        toMemberId: resolveMemberRef(members, addressed)?.memberId ?? null,
        content: stage.content,
      };
    });
}

/** How much a council has actually done, as opposed to how far it has counted. */
export type CouncilActivity = {
  /** Handoffs written by members. User instructions are not turns. */
  handoffs: number;
  /** Turns taken per member, busiest first. */
  perMember: Array<{ memberId: string; roleLabel: string; agentLabel: string; turns: number }>;
};

/**
 * Counts what each member has contributed. The turn number alone understates a
 * council that ran panels (several members answering one turn) and overstates
 * one that was pushed along by hand, so the handoffs are counted directly.
 */
export function summariseCouncilActivity(
  members: CouncilRelayMember[],
  messages: CouncilThreadMessage[],
): CouncilActivity {
  const turns = new Map<string, number>();
  let handoffs = 0;
  for (const message of messages) {
    // Neither the user's instructions nor the council's own entries — a settled
    // debate, a turn cut short — are work a member did. Counting them would
    // credit a handoff to nobody and inflate the total the bar reports.
    if (message.author === "user" || message.author === "council") continue;
    const contributors = message.participants?.length ? message.participants : [message.fromMemberId];
    handoffs += contributors.length;
    for (const contributor of contributors) {
      turns.set(contributor, (turns.get(contributor) ?? 0) + 1);
    }
  }

  return {
    handoffs,
    perMember: members
      .map((member) => ({
        memberId: member.memberId,
        roleLabel: member.roleLabel,
        agentLabel: member.agentLabel,
        turns: turns.get(member.memberId) ?? 0,
      }))
      .sort((a, b) => b.turns - a.turns || a.memberId.localeCompare(b.memberId)),
  };
}

/**
 * How long a council has been going, in the roughest useful unit. Councils run
 * for hours, so seconds are noise and a precise figure invites reading more into
 * it than it means.
 */
export function formatCouncilDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** One line summarising who has been doing the talking. */
export function formatCouncilActivity(activity: CouncilActivity): string {
  return activity.perMember
    .filter((member) => member.turns > 0)
    .map((member) => `${member.roleLabel} (${member.agentLabel}): ${member.turns}`)
    .join("\n");
}

/** Renders the conductor's decision history — why the work went where it did. */
export function renderConductorLog(
  routes: Array<{
    turn: number;
    fromMemberId: string;
    toMemberId: string;
    source: RelayRouteSource;
    reason: string;
    directive: string;
  }>,
) {
  const body = routes
    .map((route) => {
      const lines = [
        `## Turn ${route.turn} — ${route.fromMemberId || "start"} → ${route.toMemberId}`,
        `Routed by: ${route.source}`,
        route.reason ? `Reason: ${route.reason}` : "",
        route.directive ? `Directive: ${route.directive}` : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");

  return `# Conductor log\n\n${body || "No routing decisions yet."}\n`;
}

/**
 * Builds the routing prompt for the conductor. It sees the task, the roster and
 * the conversation, and answers with nothing but a decision — the whole point
 * of a separate orchestrator is that no member gets to route itself.
 */
export function buildConductorPrompt({
  task,
  members,
  messages,
  turn,
  maxTurns = MAX_RELAY_TURNS,
  addressed,
  evidence,
  lastMemberId,
  routes,
  exclude,
  directives,
  workingSet,
}: {
  task: { title: string; description?: string };
  members: CouncilRelayMember[];
  messages: CouncilThreadMessage[];
  /** The turn that just finished. */
  turn: number;
  maxTurns?: number | null;
  /** Who the last member asked for, if anyone. */
  addressed?: string | null;
  /** What the repository says the last turn actually did. */
  evidence?: CouncilEvidence | null;
  /** The member whose turn just finished, for attributing the evidence. */
  lastMemberId?: string;
  /** The conductor's own recent decisions, so it can see its pattern. */
  routes?: Array<{ turn: number; fromMemberId: string; toMemberId: string; reason: string }>;
  /** A member it may not pick this time. */
  exclude?: string | null;
  /** Standing instructions from the user, re-stated on every call. */
  directives?: ConductorDirective[];
  workingSet?: WorkingSet;
}) {
  const roster = members
    .map((member) => `- ${member.memberId} — ${member.roleLabel}, running on ${member.agentLabel}`)
    .join("\n");

  const recent = messages.slice(-CONDUCTOR_THREAD_DEPTH);
  const thread = recent
    .map((message) => {
      const excerpt =
        message.content.length > CONDUCTOR_EXCERPT_CHARS
          ? `${message.content.slice(0, CONDUCTOR_EXCERPT_CHARS)}\n[truncated]`
          : message.content;
      if (message.author === "user") {
        return `### Instruction from the person running this council\n${excerpt.trim()}`;
      }
      return `### Turn ${message.turn} — ${message.fromMemberId}${
        message.toMemberId ? ` (asked for ${message.toMemberId})` : ""
      }\n${excerpt.trim()}`;
    })
    .join("\n\n");

  const evidenceBlock = formatCouncilEvidence(evidence, lastMemberId);
  const history = (routes ?? [])
    .slice(-CONDUCTOR_THREAD_DEPTH)
    .map((route) => `- Turn ${route.turn}: ${route.fromMemberId || "start"} → ${route.toMemberId}${route.reason ? ` (${route.reason})` : ""}`)
    .join("\n");

  const hint = addressed
    ? `\nThe member that just finished asked for \`${addressed}\`. Treat that as a strong recommendation, but override it if the state of the work needs someone else first.\n`
    : "";
  const ban = exclude
    ? `\nDo NOT pick \`${exclude}\` this time: it has already held the last ${MAX_CONSECUTIVE_TURNS} turns and the work is not moving. Choose someone who can approach this differently.\n`
    : "";

  return [
    "You are the Conductor of a multi-agent engineering council. Each member is a separate AI coding agent working in the same repository on one task. After every turn you decide which member speaks next and what they should do.",
    "",
    `## Task\n${task.title}${task.description ? `\n\n${task.description}` : ""}`,
    "",
    renderConductorDirectives(directives),
    renderUserInstructions(messages),
    renderCouncilDecisions(restoreCouncilWorkingSet(messages, workingSet)),
    "",
    `## Council members\n${roster}`,
    "",
    evidenceBlock
      ? `## Repository evidence\nThis is ground truth from the working tree, unlike the handoffs below, which are self-reported.\n${evidenceBlock}\n`
      : "",
    `## Conversation so far (turn ${turn}${maxTurns === null ? "" : ` of at most ${maxTurns}`})\n${thread || "Nothing yet."}`,
    history ? `\n## Your recent routing\n${history}\n` : "",
    hint,
    ban,
    "## Your decision",
    "Route the work to whichever member the current state of it actually needs — not to whoever is next in some rotation. Send code back for review, send failed review back to the implementer, bring in the architect when a decision is contested or the approach is drifting. Prefer the member who can unblock the work now.",
    "Any instruction from the person running the council — the standing instructions above, or anything they said in the thread — overrides the members' own plans; route so that it is carried out.",
    `Set "done" to true only when the task is genuinely finished AND the repository evidence shows the work exists AND someone has verified it — not merely when the last member sounded satisfied. When you set "done" to true, leave "next" empty; naming a member means the work continues.`,
    `You may optionally consult several members at once by listing them in "panel" — use it when independent perspectives on the same code are worth more than another round trip, for example a security review and a correctness review of one change. Only members whose role does not write code can sit on a panel, at most ${MAX_PANEL_MEMBERS}; anything else takes its turn alone.`,
    "",
    "Reply with ONLY a JSON object and nothing else:",
    `{"next":"<member id>","panel":[],"directive":"<one or two sentences telling that member exactly what to do now>","reason":"<short justification>","done":false}`,
  ]
    .filter((section) => section !== "")
    .join("\n");
}

/**
 * How long an answer to the user may run. The conductor is being asked about a
 * run the user is watching, not for a report — a screenful of prose in a lane
 * beside four live terminals does not get read.
 */
const CONDUCTOR_ANSWER_SENTENCES = 6;

/**
 * Builds the prompt for a direct question from the user to the conductor.
 *
 * This is the same headless call as routing, pointed at a different job: the
 * conductor already holds the only whole-run view in the system — the roster,
 * the thread and its own routing history — and until now the user could see the
 * conclusion of that view (one hop, one reason) but never interrogate it.
 *
 * It answers in prose and routes nothing. Asking a question must not move the
 * baton: the member holding it is mid-turn, and a decision taken here would
 * collide with the one the handoff is about to trigger.
 */
export function buildConductorAnswerPrompt({
  task,
  members,
  messages,
  turn,
  maxTurns = MAX_RELAY_TURNS,
  evidence,
  lastMemberId,
  routes,
  directives,
  question,
  workingSet,
}: {
  task: { title: string; description?: string };
  members: CouncilRelayMember[];
  messages: CouncilThreadMessage[];
  /** The turn in flight. */
  turn: number;
  maxTurns?: number | null;
  evidence?: CouncilEvidence | null;
  lastMemberId?: string;
  routes?: Array<{ turn: number; fromMemberId: string; toMemberId: string; reason: string }>;
  directives?: ConductorDirective[];
  question: string;
  workingSet?: WorkingSet;
}) {
  const roster = members
    .map((member) => `- ${member.memberId} — ${member.roleLabel}, running on ${member.agentLabel}`)
    .join("\n");

  const thread = messages
    .slice(-CONDUCTOR_THREAD_DEPTH)
    .map((message) => {
      const excerpt =
        message.content.length > CONDUCTOR_EXCERPT_CHARS
          ? `${message.content.slice(0, CONDUCTOR_EXCERPT_CHARS)}\n[truncated]`
          : message.content;
      if (message.author === "user") {
        return `### Instruction from the person running this council\n${excerpt.trim()}`;
      }
      return `### Turn ${message.turn} — ${message.fromMemberId}${
        message.toMemberId ? ` (asked for ${message.toMemberId})` : ""
      }\n${excerpt.trim()}`;
    })
    .join("\n\n");

  const history = (routes ?? [])
    .slice(-CONDUCTOR_THREAD_DEPTH)
    .map(
      (route) =>
        `- Turn ${route.turn}: ${route.fromMemberId || "start"} → ${route.toMemberId}${route.reason ? ` (${route.reason})` : ""}`,
    )
    .join("\n");

  const evidenceBlock = formatCouncilEvidence(evidence, lastMemberId);

  return [
    "You are the Conductor of a multi-agent engineering council: each member is a separate AI coding agent working in the same repository on one task, and you decide after every turn who speaks next. The person running the council has stopped to ask you something directly.",
    "",
    `## Task\n${task.title}${task.description ? `\n\n${task.description}` : ""}`,
    "",
    renderConductorDirectives(directives),
    renderUserInstructions(messages),
    renderCouncilDecisions(restoreCouncilWorkingSet(messages, workingSet)),
    "",
    `## Council members\n${roster}`,
    "",
    evidenceBlock
      ? `## Repository evidence\nThis is ground truth from the working tree, unlike the handoffs below, which are self-reported.\n${evidenceBlock}\n`
      : "",
    `## Conversation so far (turn ${turn}${maxTurns === null ? "" : ` of at most ${maxTurns}`})\n${thread || "Nothing yet."}`,
    history ? `\n## Your routing so far\n${history}\n` : "",
    "## Their question",
    question.trim(),
    "",
    `Answer it directly, in plain prose — no JSON, no headings, at most ${CONDUCTOR_ANSWER_SENTENCES} sentences. Name members by their handle. Ground what you say in the thread, your routing history and the repository evidence above; where you are guessing, say so rather than presenting it as fact. If the honest answer is that the council is stuck or going in circles, say that plainly and say what you would need in order to move it.`,
    "You are answering, not routing: do not hand the work to anyone, and do not treat this question as the instruction for the next turn unless they say so.",
  ]
    .filter((section) => section !== "")
    .join("\n");
}

/**
 * Pulls a decision out of the conductor's reply. Models wrap JSON in fences and
 * prose no matter how firmly they are asked not to, so this scans for the
 * outermost object rather than trusting the whole response to parse.
 */
export function parseConductorDecision(raw: string | null | undefined): ConductorDecision | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) candidates.push(fenced[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.trim());
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    const next = typeof record.next === "string" ? record.next.trim() : "";
    const done = record.done === true || record.done === "true";
    if (!next && !done) continue;
    const panel = Array.isArray(record.panel)
      ? record.panel.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : undefined;
    return {
      nextMemberId: next || null,
      directive: typeof record.directive === "string" ? record.directive.trim() : "",
      reason: typeof record.reason === "string" ? record.reason.trim() : "",
      done,
      ...(panel?.length ? { panel: panel.map((entry) => entry.trim()) } : {}),
    };
  }
  return null;
}

/**
 * Picks who speaks next. The conductor's choice wins; a failed or unusable
 * routing call falls back to the member the last agent addressed, and then to
 * plain rotation — a council whose orchestrator is down should degrade to the
 * old carousel, never stall.
 */
export function chooseNextMember({
  members,
  decision,
  addressed,
  history,
  turn,
}: {
  members: CouncilRelayMember[];
  decision?: ConductorDecision | null;
  /** The `TO:` handle from the finished handoff. */
  addressed?: string | null;
  /** Member ids in turn order, oldest first. */
  history?: string[];
  /** The turn about to begin. */
  turn: number;
}): RelayRoute | null {
  if (members.length === 0) return null;

  const conductorPick = resolveMemberRef(members, decision?.nextMemberId);
  const addressedPick = resolveMemberRef(members, addressed);
  const rotationPick = relayMemberForTurn(members, turn) ?? members[0];

  let member = conductorPick ?? addressedPick ?? rotationPick;
  let source: RelayRouteSource = conductorPick ? "conductor" : addressedPick ? "addressed" : "rotation";
  let reason = conductorPick
    ? decision?.reason || "Conductor routed this turn."
    : addressedPick
      ? "The previous member addressed this handoff to them."
      : "No routing decision available — falling back to rotation.";

  // A member that keeps being handed its own work back is a stalled council, so
  // the baton is forced onward. The caller re-asks the conductor with this
  // member excluded first; reaching here means that did not help either.
  const stuck = isStuckOn(members, history, member.memberId);
  if (stuck) {
    const stalled = member.memberId;
    const index = members.findIndex((item) => item.memberId === stalled);
    member = members[(index + 1) % members.length];
    source = "rotation";
    reason = `${stalled} has held the last ${MAX_CONSECUTIVE_TURNS} turns — passing on to keep the council moving.`;
  }

  // A forced rotation is the conductor's plan being overridden, so its panel
  // goes with it — those members were chosen to advise on a different hop.
  const panel = stuck ? [member] : planCouncilPanel(members, decision?.panel, member);

  return {
    member: panel[0] ?? member,
    panel,
    source,
    directive: (!stuck && decision?.directive) || "",
    reason,
  };
}

// ------------------------------------------------------- progress, not motion

/**
 * How many turns of a repeating working tree count as thrash.
 *
 * Two is a coincidence — a member reverting its own change and trying again is
 * ordinary. Three separate returns to a state the tree has already been in is a
 * council undoing each other's work.
 */
export const MAX_REPEATED_TREE_STATES = 3;

/** A stable, comparable fingerprint of a working tree snapshot. */
export function fingerprintTree(snapshot: Record<string, string>): string {
  return Object.keys(snapshot)
    .sort()
    .map((path) => `${path}=${snapshot[path]}`)
    .join("\n");
}

/**
 * Whether the council is going round in circles.
 *
 * `isStuckOn` catches a *member* holding turns; it says nothing about whether
 * the work is moving. Two members can hand a file back and forth indefinitely —
 * each turn genuinely edits code, so the evidence check passes and the stall
 * guard never fires, while the repository ends every other turn in a state it
 * has already been in.
 *
 * An empty tree is excluded deliberately: a council that has not yet written
 * anything is at its starting state on every turn, which is not oscillation.
 */
export function detectTreeOscillation(fingerprints: string[]): {
  oscillating: boolean;
  repeats: number;
  reason: string;
} {
  const meaningful = fingerprints.filter((entry) => entry.length > 0);
  const current = meaningful.at(-1);
  if (!current) return { oscillating: false, repeats: 0, reason: "" };

  // Consecutive duplicates are collapsed first, because a tree that simply
  // stays the same is not oscillating — it is a council that stopped changing
  // anything, which the evidence check already reports as work claimed without
  // changes. Oscillation is leaving a state and coming back to it, so only a
  // return after something else intervened counts.
  const distinctRuns = meaningful.filter((entry, index) => index === 0 || entry !== meaningful[index - 1]);
  const repeats = distinctRuns.filter((entry) => entry === current).length;
  if (repeats < MAX_REPEATED_TREE_STATES) return { oscillating: false, repeats, reason: "" };

  return {
    oscillating: true,
    repeats,
    reason:
      `The working tree has returned to the same state ${repeats} times. ` +
      `Members are undoing each other rather than making progress — the disagreement behind that has to be settled before more turns are spent on it.`,
  };
}

/**
 * Whether a relay may take another turn on its own.
 *
 * `stopped` and `paused` mean different things and both have to be checked.
 * The relay sets `stopped` for its own reasons — the turn cap is reached, a
 * member finished, the conductor is being asked something — and several paths
 * clear it again on purpose: a manual hand-off, a raised cap, switching back to
 * automatic. `paused` is the user's, and none of those may lift it. Folding the
 * two together would make Pause a suggestion that the next hand-off overrides.
 */
export function relayMayAutoAdvance(run: {
  stopped?: boolean;
  paused?: boolean;
  auto?: boolean;
}): boolean {
  return Boolean(run.auto) && !run.stopped && !run.paused;
}

/** Whether a turn may start at all, however it was asked for. */
export function relayMayStartTurn(run: { stopped?: boolean; paused?: boolean }): boolean {
  return !run.stopped && !run.paused;
}

/**
 * The run state for handing a finished council a new task.
 *
 * Extracted from the caller because what it *clears* is the part worth being
 * sure about, and being wrong is quiet: a field left behind means the new task
 * inherits the last one's argument, its turn counter, or its evidence, and the
 * council behaves oddly for reasons nobody can see.
 *
 * The roster, the worktree and the conductor's settings are deliberately kept.
 * Those are what makes reusing a council worth doing at all — the agents are
 * booted, signed in and attached, and only the conversation is finished.
 */
export interface NextCouncilTask {
  runId: string;
  taskPrompt: string;
  task: { title: string; description?: string };
  startedAt: string;
}

export function carryCouncilToNextTask<T extends object>(
  previous: T,
  next: NextCouncilTask,
): T {
  return {
    ...previous,
    runId: next.runId,
    taskPrompt: next.taskPrompt,
    task: next.task,
    startedAt: next.startedAt,
    turn: 1,
    auto: true,
    stopped: false,
    paused: false,
    // Everything the finished conversation left behind. Carrying the thread
    // over would make every member read a settled argument about different
    // work before starting this one — the context cost this design exists to
    // avoid — and would invite them to continue it.
    messages: [],
    history: [],
    routes: [],
    directives: [],
    nudgedTurns: [],
    treeHistory: [],
    repoSnapshot: {},
    evidence: null,
    pending: undefined,
    debate: null,
    currentPrompt: undefined,
  } as unknown as T;
}
