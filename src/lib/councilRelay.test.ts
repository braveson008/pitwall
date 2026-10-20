import { describe, expect, it } from "vitest";
import {
  planCouncilPromptDelivery,
  carryCouncilToNextTask,
  DEFAULT_RUN_BUDGET_MS,
  isWithinRunBudget,
  normalizeRunBudget,
  relayProgressMark,
  resolveStallAction,
  COUNCIL_USER_ID,
  MAX_CONSECUTIVE_TURNS,
  MAX_PANEL_MEMBERS,
  MAX_RELAY_TURNS,
  RELAY_COMPLETE_MARKER,
  RELAY_TURN_CEILING,
  relayMayAutoAdvance,
  relayMayStartTurn,
  RELAY_TURN_LIMITS,
  THREAD_VERBATIM_TURNS,
  CONDUCTOR_DIRECTIVE_LIMIT,
  addConductorDirective,
  buildConductorAnswerPrompt,
  buildConductorPrompt,
  buildCouncilEvidence,
  buildCouncilRelayTurn,
  buildCouncilTaskBrief,
  buildRelayNudge,
  chooseNextMember,
  formatCouncilActivity,
  formatCouncilDuration,
  formatCouncilEvidence,
  formatTurnLimitNote,
  isRestorableRelayState,
  isStuckOn,
  isWithinTurnLimit,
  normalizeTurnLimit,
  mergePanelHandoffs,
  planCouncilPanel,
  snapshotRepoChanges,
  summariseCouncilActivity,
  toPersistedRelayState,
  formatCouncilTaskFilePrompt,
  getCouncilStageFile,
  getCouncilTaskBriefPath,
  getCouncilThreadFile,
  getTurnStageFile,
  isRelayComplete,
  makeCouncilMemberId,
  parseConductorDecision,
  parseHandoffAddress,
  rebuildThreadFromStages,
  relayMemberForTurn,
  renderCouncilThread,
  restoreCouncilWorkingSet,
  restoreCouncilPanel,
  resolveMemberRef,
} from "./councilRelay";
import { emptyWorkingSet, parseWorkingSet } from "./councilBriefing";

const member = (memberId: string, roleLabel: string, agentLabel: string, writesCode = false) => ({
  sessionId: `session-${memberId}`,
  memberId,
  rolePrompt: `Act as ${roleLabel.toLowerCase()}.`,
  roleLabel,
  agentLabel,
  writesCode,
});

const members = [
  member("architect-claude", "Architect", "Claude"),
  member("implementer-codex", "Implementer", "Codex"),
];

const council = [
  member("implementer-codex", "Implementer", "Codex", true),
  member("architect-claude", "Architect", "Claude"),
  member("qa-kimi", "Reviewer / QA", "Kimi"),
];

const turnFor = (turn: number) =>
  buildCouncilRelayTurn({
    runId: "run-1",
    taskPrompt: "Build it",
    member: relayMemberForTurn(members, turn)!,
    members,
    turn,
    isCycle: turn > members.length,
  });

describe("relayMemberForTurn", () => {
  it("cycles through the members forever", () => {
    expect(relayMemberForTurn(members, 1)?.memberId).toBe("architect-claude");
    expect(relayMemberForTurn(members, 2)?.memberId).toBe("implementer-codex");
    expect(relayMemberForTurn(members, 3)?.memberId).toBe("architect-claude");
    expect(relayMemberForTurn(members, 99)?.memberId).toBe("architect-claude");
  });

  it("returns undefined with no members", () => {
    expect(relayMemberForTurn([], 1)).toBeUndefined();
  });
});

describe("makeCouncilMemberId", () => {
  it("builds the handle agents address each other by", () => {
    expect(makeCouncilMemberId("implementer", "Codex")).toBe("implementer-codex");
    expect(makeCouncilMemberId("qa", "Kimi")).toBe("qa-kimi");
  });

  it("keeps duplicate role/agent pairs distinguishable", () => {
    const taken: string[] = [];
    const first = makeCouncilMemberId("implementer", "Claude", taken);
    taken.push(first);
    const second = makeCouncilMemberId("implementer", "Claude", taken);
    expect(first).toBe("implementer-claude");
    expect(second).toBe("implementer-claude-2");
  });
});

describe("resolveMemberRef", () => {
  it("resolves the handle a member was assigned", () => {
    expect(resolveMemberRef(council, "qa-kimi")?.memberId).toBe("qa-kimi");
  });

  it("resolves the role or agent name, since models use all three", () => {
    expect(resolveMemberRef(council, "qa")?.memberId).toBe("qa-kimi");
    expect(resolveMemberRef(council, "Architect")?.memberId).toBe("architect-claude");
    expect(resolveMemberRef(council, "Codex")?.memberId).toBe("implementer-codex");
  });

  it("gives up on a member that is not on the council", () => {
    expect(resolveMemberRef(council, "designer")).toBeUndefined();
    expect(resolveMemberRef(council, "")).toBeUndefined();
    expect(resolveMemberRef(council, null)).toBeUndefined();
  });
});

describe("buildCouncilRelayTurn", () => {
  it("gives every turn its own handoff file so a stale file never re-triggers", () => {
    expect(turnFor(1).stageFile).toBe(".pitwall/council/run-1/stage-1.md");
    expect(turnFor(2).stageFile).toBe(".pitwall/council/run-1/stage-2.md");
    expect(new Set([1, 2, 3, 4].map((t) => turnFor(t).stageFile)).size).toBe(4);
  });

  it("reads the immediately preceding turn's file", () => {
    expect(turnFor(1).upstreamFile).toBeNull();
    expect(turnFor(2).upstreamFile).toBe(".pitwall/council/run-1/stage-1.md");
  });

  it("points later turns at the shared thread, not just the last handoff", () => {
    expect(turnFor(1).prompt).not.toContain("thread.md");
    expect(turnFor(2).prompt).toContain(".pitwall/council/run-1/thread.md");
    expect(turnFor(2).prompt).toContain("full discussion so far");
  });

  it("routes each turn to the right member and role prompt", () => {
    expect(turnFor(1).sessionId).toBe("session-architect-claude");
    expect(turnFor(1).prompt).toContain("Act as architect.");
    expect(turnFor(2).sessionId).toBe("session-implementer-codex");
    expect(turnFor(2).prompt).toContain("Act as implementer.");
  });

  it("names the other members so an agent can address them directly", () => {
    const prompt = buildCouncilRelayTurn({
      runId: "run-1",
      taskPrompt: "Build it",
      member: council[0],
      members: council,
      turn: 2,
      isCycle: false,
    }).prompt;
    expect(prompt).toContain("addressed as architect-claude");
    expect(prompt).toContain("addressed as qa-kimi");
    expect(prompt).not.toContain("addressed as implementer-codex");
    expect(prompt).toContain("TO: <member>");
  });

  it("passes the conductor's directive to the member taking the turn", () => {
    const prompt = buildCouncilRelayTurn({
      runId: "run-1",
      taskPrompt: "Build it",
      member: council[2],
      members: council,
      turn: 3,
      isCycle: false,
      directive: "Verify the rejoin path only.",
      from: council[0],
    }).prompt;
    expect(prompt).toContain("Your specific assignment this turn: Verify the rejoin path only.");
    expect(prompt).toContain("which Implementer (Codex) addressed to you");
  });

  it("briefs reviewers from current evidence and keeps early user instructions", () => {
    const prompt = buildCouncilRelayTurn({
      runId: "run-1", taskPrompt: "Build it", member: council[2], members: council, turn: 8, isCycle: true,
      directives: [{ turn: 1, text: "Keep the migration reversible." }],
      messages: [{ turn: 1, fromMemberId: "you", toMemberId: null, author: "user", content: "Do not add dependencies." }],
      workingSet: parseWorkingSet("DECISION: Use the existing store.", 2, "architect"),
    }).prompt;
    expect(prompt).toContain("Do not add dependencies.");
    expect(prompt).toContain("Keep the migration reversible.");
    expect(prompt).toContain("Use the existing store.");
    expect(prompt).toContain("actual current diff and test evidence");
    expect(prompt).toContain("Begin with the latest handoff");
    expect(prompt).not.toContain("Begin by reading the council thread");
  });

  it("tells agents to iterate once the council has come back around", () => {
    expect(turnFor(2).prompt).not.toContain("ongoing council");
    expect(turnFor(3).prompt).toContain("ongoing council");
  });

  it("always offers the completion marker as a way out", () => {
    expect(turnFor(1).prompt).toContain(RELAY_COMPLETE_MARKER);
    expect(turnFor(5).prompt).toContain(RELAY_COMPLETE_MARKER);
  });
});

describe("isRelayComplete", () => {
  it("ends the relay when the marker leads the handoff", () => {
    expect(isRelayComplete("RELAY-COMPLETE\n\nAll done.")).toBe(true);
    expect(isRelayComplete("  relay-complete — nothing left\n")).toBe(true);
    expect(isRelayComplete("# RELAY-COMPLETE\n")).toBe(true);
  });

  it("ignores the marker mentioned later in the writeup", () => {
    expect(isRelayComplete("Stage 3 notes\n\nWrite RELAY-COMPLETE when finished.")).toBe(false);
  });

  it("treats ordinary handoffs as incomplete", () => {
    expect(isRelayComplete("Implemented the vault loop. Next: QA the rejoin path.")).toBe(false);
    expect(isRelayComplete("")).toBe(false);
  });
});

describe("parseHandoffAddress", () => {
  it("reads who the agent handed the work to", () => {
    expect(parseHandoffAddress("TO: qa-kimi\n\nPlease verify the rejoin path.")).toBe("qa-kimi");
    expect(parseHandoffAddress("## TO: architect-claude\n")).toBe("architect-claude");
    expect(parseHandoffAddress("NEXT: implementer-codex\n")).toBe("implementer-codex");
    expect(parseHandoffAddress("TO: @qa\n")).toBe("qa");
  });

  it("ignores members merely discussed in the body", () => {
    expect(parseHandoffAddress("Implemented the fix.\n\nTO: qa-kimi")).toBeNull();
    expect(parseHandoffAddress("I disagree with architect-claude about the cache.")).toBeNull();
    expect(parseHandoffAddress("")).toBeNull();
  });
});

describe("parseConductorDecision", () => {
  it("reads a bare JSON decision", () => {
    const decision = parseConductorDecision('{"next":"qa-kimi","directive":"Verify it.","reason":"code changed","done":false}');
    expect(decision).toEqual({
      nextMemberId: "qa-kimi",
      directive: "Verify it.",
      reason: "code changed",
      done: false,
    });
  });

  it("digs the decision out of a fenced block or surrounding prose", () => {
    expect(parseConductorDecision('```json\n{"next":"architect-claude"}\n```')?.nextMemberId).toBe("architect-claude");
    expect(
      parseConductorDecision('Here is my routing:\n{"next":"qa-kimi","reason":"needs review"}\nHope that helps.')
        ?.nextMemberId,
    ).toBe("qa-kimi");
  });

  it("accepts a decision that only ends the run", () => {
    expect(parseConductorDecision('{"done":true,"reason":"verified"}')).toEqual({
      nextMemberId: null,
      directive: "",
      reason: "verified",
      done: true,
    });
  });

  it("returns null rather than guessing when the reply is unusable", () => {
    expect(parseConductorDecision("I think QA should go next.")).toBeNull();
    expect(parseConductorDecision("{not json")).toBeNull();
    expect(parseConductorDecision("")).toBeNull();
    expect(parseConductorDecision(null)).toBeNull();
  });
});

describe("chooseNextMember", () => {
  it("follows the conductor over rotation", () => {
    const route = chooseNextMember({
      members: council,
      decision: { nextMemberId: "qa-kimi", directive: "Check the migration.", reason: "code landed", done: false },
      addressed: null,
      history: ["implementer-codex"],
      turn: 2,
    });
    expect(route?.member.memberId).toBe("qa-kimi");
    expect(route?.source).toBe("conductor");
    expect(route?.directive).toBe("Check the migration.");
  });

  it("falls back to who the agent addressed when the conductor gives nothing", () => {
    const route = chooseNextMember({
      members: council,
      decision: null,
      addressed: "architect-claude",
      history: ["implementer-codex"],
      turn: 2,
    });
    expect(route?.member.memberId).toBe("architect-claude");
    expect(route?.source).toBe("addressed");
  });

  it("falls back to rotation when nothing routed the turn", () => {
    const route = chooseNextMember({ members: council, decision: null, addressed: null, history: [], turn: 2 });
    expect(route?.member.memberId).toBe("architect-claude");
    expect(route?.source).toBe("rotation");
  });

  it("resolves a conductor that answered with a role instead of a handle", () => {
    const route = chooseNextMember({
      members: council,
      decision: { nextMemberId: "QA", directive: "", reason: "", done: false },
      addressed: null,
      history: [],
      turn: 2,
    });
    expect(route?.member.memberId).toBe("qa-kimi");
  });

  it("forces the baton on when one member has held it too long", () => {
    const history = Array.from({ length: MAX_CONSECUTIVE_TURNS }, () => "implementer-codex");
    const route = chooseNextMember({
      members: council,
      decision: { nextMemberId: "implementer-codex", directive: "Keep going.", reason: "more work", done: false },
      addressed: null,
      history,
      turn: 4,
    });
    expect(route?.member.memberId).not.toBe("implementer-codex");
    expect(route?.source).toBe("rotation");
    // The directive belonged to the member that was skipped, so it must not
    // follow the baton to whoever actually takes the turn.
    expect(route?.directive).toBe("");
  });

  it("lets a member take a follow-up turn below the limit", () => {
    const route = chooseNextMember({
      members: council,
      decision: { nextMemberId: "implementer-codex", directive: "Finish the migration.", reason: "", done: false },
      addressed: null,
      history: ["architect-claude", "implementer-codex"],
      turn: 3,
    });
    expect(route?.member.memberId).toBe("implementer-codex");
  });

  it("has nowhere to route an empty council", () => {
    expect(chooseNextMember({ members: [], decision: null, addressed: null, history: [], turn: 1 })).toBeNull();
  });
});

describe("buildConductorPrompt", () => {
  const prompt = buildConductorPrompt({
    task: { title: "Fix the rejoin path", description: "Players drop on reconnect." },
    members: council,
    messages: [
      { turn: 1, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", content: "Patched the socket handler." },
    ],
    turn: 1,
    addressed: "qa-kimi",
  });

  it("gives the conductor the roster it must choose from", () => {
    expect(prompt).toContain("implementer-codex — Implementer, running on Codex");
    expect(prompt).toContain("qa-kimi — Reviewer / QA, running on Kimi");
  });

  it("includes the task and the conversation so far", () => {
    expect(prompt).toContain("Fix the rejoin path");
    expect(prompt).toContain("Players drop on reconnect.");
    expect(prompt).toContain("Patched the socket handler.");
  });

  it("passes on who the last member asked for", () => {
    expect(prompt).toContain("asked for `qa-kimi`");
  });

  it("demands a decision it can parse back", () => {
    expect(parseConductorDecision('{"next":"qa-kimi","directive":"x","reason":"y","done":false}')).not.toBeNull();
    expect(prompt).toContain('"next"');
    expect(prompt).toContain('"done"');
  });

  it("truncates long turns so the prompt cannot grow without bound", () => {
    const long = buildConductorPrompt({
      task: { title: "Big" },
      members: council,
      messages: [{ turn: 1, fromMemberId: "implementer-codex", toMemberId: null, content: "x".repeat(9000) }],
      turn: 1,
    });
    expect(long).toContain("[truncated]");
    expect(long.length).toBeLessThan(9000);
  });
});

describe("renderCouncilThread", () => {
  it("gives every member the roster and the whole conversation", () => {
    const thread = renderCouncilThread(
      council,
      [
        { turn: 1, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", content: "Patched it." },
        { turn: 2, fromMemberId: "qa-kimi", toMemberId: null, content: "Found a race." },
      ],
      { title: "Fix the rejoin path" },
    );
    expect(thread).toContain("`qa-kimi` — Reviewer / QA (Kimi)");
    expect(thread).toContain("Turn 1 — Implementer (Codex)");
    expect(thread).toContain("Patched it.");
    expect(thread).toContain("Turn 2 — Reviewer / QA (Kimi)");
    expect(thread).toContain("Found a race.");
  });
});

describe("repository evidence", () => {
  const implementer = council[0];
  const architect = council[1];

  it("reports what a turn actually touched", () => {
    const before = snapshotRepoChanges([{ path: "src/a.ts", status: "M", additions: 3, deletions: 1 }]);
    const after = snapshotRepoChanges([
      { path: "src/a.ts", status: "M", additions: 9, deletions: 1 },
      { path: "src/b.ts", status: "A", additions: 20, deletions: 0 },
    ]);
    const evidence = buildCouncilEvidence({ before, after, member: implementer });
    expect(evidence.changedPaths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(evidence.dirtyPaths).toEqual(["src/a.ts", "src/b.ts"]);
    expect(evidence.claimedWithoutChanges).toBe(false);
  });

  it("ignores the council's own bookkeeping files", () => {
    // Otherwise every member "produces work" merely by writing its handoff,
    // which is the exact claim this evidence exists to check.
    const after = snapshotRepoChanges([
      { path: ".pitwall/council/run-1/stage-2.md", status: "A" },
      { path: ".pitwall/council/run-1/thread.md", status: "A" },
      { path: ".braveli/council/run-0/thread.md", status: "A" },
    ]);
    expect(after).toEqual({});
    expect(buildCouncilEvidence({ before: {}, after, member: implementer }).claimedWithoutChanges).toBe(true);
  });

  it("counts an edit to an already-dirty file as work", () => {
    const before = snapshotRepoChanges([{ path: "src/a.ts", status: "M", additions: 3, deletions: 0 }]);
    const after = snapshotRepoChanges([{ path: "src/a.ts", status: "M", additions: 12, deletions: 0 }]);
    expect(buildCouncilEvidence({ before, after, member: implementer }).changedPaths).toEqual(["src/a.ts"]);
  });

  it("counts a reverted or committed file as movement", () => {
    const before = snapshotRepoChanges([{ path: "src/a.ts", status: "M", additions: 3, deletions: 0 }]);
    const evidence = buildCouncilEvidence({ before, after: {}, member: implementer });
    expect(evidence.changedPaths).toEqual(["src/a.ts"]);
    expect(evidence.claimedWithoutChanges).toBe(false);
  });

  it("flags a code-writing member that produced nothing", () => {
    const evidence = buildCouncilEvidence({ before: {}, after: {}, member: implementer });
    expect(evidence.claimedWithoutChanges).toBe(true);
    expect(formatCouncilEvidence(evidence, implementer.memberId)).toMatch(/WARNING/);
    expect(formatCouncilEvidence(evidence, implementer.memberId)).toMatch(/claim, not as completed work/);
  });

  it("does not flag roles that were never meant to write code", () => {
    const evidence = buildCouncilEvidence({ before: {}, after: {}, member: architect });
    expect(evidence.claimedWithoutChanges).toBe(false);
    expect(formatCouncilEvidence(evidence, architect.memberId)).not.toMatch(/WARNING/);
  });

  it("tells the conductor the evidence is ground truth, not a claim", () => {
    const prompt = buildConductorPrompt({
      task: { title: "Fix it" },
      members: council,
      messages: [{ turn: 1, fromMemberId: "implementer-codex", toMemberId: null, content: "Implemented it." }],
      turn: 1,
      evidence: buildCouncilEvidence({ before: {}, after: {}, member: implementer }),
      lastMemberId: implementer.memberId,
    });
    expect(prompt).toContain("Repository evidence");
    expect(prompt).toContain("ground truth");
    expect(prompt).toMatch(/WARNING: implementer-codex/);
    expect(prompt).toMatch(/repository evidence shows the work exists/);
  });

  it("points members at the diff rather than the description of it", () => {
    const evidence = buildCouncilEvidence({
      before: {},
      after: snapshotRepoChanges([{ path: "src/a.ts", status: "M" }]),
      member: implementer,
    });
    const prompt = buildCouncilRelayTurn({
      runId: "run-1",
      taskPrompt: "Build it",
      member: council[2],
      members: council,
      turn: 2,
      isCycle: false,
      evidence,
    }).prompt;
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("Check the actual diff");
  });

  it("tells a member outright when nothing has been written yet", () => {
    const prompt = buildCouncilRelayTurn({
      runId: "run-1",
      taskPrompt: "Build it",
      member: council[2],
      members: council,
      turn: 2,
      isCycle: false,
      evidence: buildCouncilEvidence({ before: {}, after: {}, member: implementer }),
    }).prompt;
    expect(prompt).toMatch(/Nothing has been written to the repository yet/);
    expect(prompt).toMatch(/whatever their handoff says/);
  });
});

describe("user instructions in the thread", () => {
  const messages = [
    { turn: 1, fromMemberId: "implementer-codex", toMemberId: null, content: "Added a caching layer." },
    { turn: 1, fromMemberId: COUNCIL_USER_ID, toMemberId: null, content: "Stop gold-plating. Ship the minimal fix.", author: "user" as const },
  ];

  it("renders the user as an instruction, not as a council member", () => {
    const thread = renderCouncilThread(council, messages, { title: "Fix it" });
    expect(thread).toContain("Instruction from the person running this council");
    expect(thread).toContain("Stop gold-plating. Ship the minimal fix.");
  });

  it("shows the conductor the instruction and that it outranks the members", () => {
    const prompt = buildConductorPrompt({ task: { title: "Fix it" }, members: council, messages, turn: 1 });
    expect(prompt).toContain("Stop gold-plating. Ship the minimal fix.");
    expect(prompt).toMatch(/overrides the members' own plans/);
  });
});

describe("thread growth", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    turn: index + 1,
    fromMemberId: "implementer-codex",
    toMemberId: null,
    content: `Turn ${index + 1}: ${"detail ".repeat(200)}`,
  }));

  it("keeps recent turns verbatim and trims the older ones", () => {
    const thread = renderCouncilThread(council, many, { title: "Long one" });
    expect(thread).toContain("[trimmed]");
    // The most recent turns must survive intact — they are the working context.
    expect(thread).toContain(`Turn 12: ${"detail ".repeat(200)}`.trim());
    const trimmedCount = (thread.match(/\[trimmed\]/g) || []).length;
    expect(trimmedCount).toBe(many.length - THREAD_VERBATIM_TURNS);
  });

  it("grows by a trimmed turn, not a whole one, as the council runs on", () => {
    const longer = [
      ...Array.from({ length: 18 }, (_, index) => ({
        turn: index + 1,
        fromMemberId: "implementer-codex",
        toMemberId: null,
        content: `Extra ${index}: ${"detail ".repeat(200)}`,
      })),
      ...many,
    ];
    const addedRaw = longer.length - many.length;
    const growth =
      renderCouncilThread(council, longer, { title: "Long one" }).length -
      renderCouncilThread(council, many, { title: "Long one" }).length;
    // 18 further turns of ~1400 chars each would be ~25k unbounded; trimmed they
    // cost a few hundred apiece, which is what keeps a 24-turn council affordable.
    expect(growth).toBeLessThan(addedRaw * 500);
  });

  it("never trims a user instruction, however old", () => {
    const withUser = [
      { turn: 1, fromMemberId: COUNCIL_USER_ID, toMemberId: null, content: `Do not touch the schema. ${"x".repeat(600)}`, author: "user" as const },
      ...many,
    ];
    expect(renderCouncilThread(council, withUser, { title: "Long one" })).toContain(`Do not touch the schema. ${"x".repeat(600)}`);
  });

  it("retains an accepted decision near the end of an old handoff", () => {
    const old = { turn: 1, fromMemberId: "architect-claude", toMemberId: null, content: `${"details ".repeat(200)}\nDECISION: Share knowledge across worktrees.` };
    const messages = [old, ...many];
    expect(renderCouncilThread(council, messages, { title: "Long one" })).toContain("Share knowledge across worktrees.");
    const routing = buildConductorPrompt({ task: { title: "Long one" }, members: council, messages, turn: 12 });
    expect(routing).toContain("Share knowledge across worktrees.");
  });

  it("includes saved decisions whose original handoffs are no longer in the thread", () => {
    const saved = parseWorkingSet("DECISION: [runtime] Use Node 24.", 1, "architect");
    expect(renderCouncilThread(council, many, { title: "Restored" }, saved)).toContain("Use Node 24.");
  });

  it("keeps user instructions outside the conductor tail without truncating them", () => {
    const instruction = `Keep this constraint: ${"unabridged ".repeat(600)}`;
    const messages = [{ turn: 1, fromMemberId: "you", toMemberId: null, content: instruction, author: "user" as const }, ...many];
    expect(buildConductorPrompt({ task: { title: "Long one" }, members: council, messages, turn: 12 })).toContain(instruction.trim());
    expect(buildConductorAnswerPrompt({ task: { title: "Long one" }, members: council, messages, turn: 12, question: "What remains?" })).toContain(instruction.trim());
  });
});

describe("isStuckOn", () => {
  it("spots a member that has held the last turns", () => {
    expect(isStuckOn(council, ["qa-kimi", "qa-kimi"], "qa-kimi")).toBe(true);
  });

  it("leaves a single follow-up turn alone", () => {
    expect(isStuckOn(council, ["implementer-codex", "qa-kimi"], "qa-kimi")).toBe(false);
    expect(isStuckOn(council, [], "qa-kimi")).toBe(false);
    expect(isStuckOn(council, ["qa-kimi", "qa-kimi"], undefined)).toBe(false);
  });

  it("has no meaning for a council with nobody to pass to", () => {
    expect(isStuckOn([council[0]], ["implementer-codex", "implementer-codex"], "implementer-codex")).toBe(false);
  });

  it("tells the conductor who it may not pick again", () => {
    const prompt = buildConductorPrompt({
      task: { title: "Fix it" },
      members: council,
      messages: [],
      turn: 3,
      exclude: "qa-kimi",
    });
    expect(prompt).toMatch(/Do NOT pick `qa-kimi`/);
    expect(prompt).toContain("has already held the last");
  });
});

describe("conductor sees its own routing", () => {
  it("includes recent decisions so it can notice its own pattern", () => {
    const prompt = buildConductorPrompt({
      task: { title: "Fix it" },
      members: council,
      messages: [],
      turn: 3,
      routes: [
        { turn: 2, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", reason: "code landed" },
        { turn: 3, fromMemberId: "qa-kimi", toMemberId: "implementer-codex", reason: "review failed" },
      ],
    });
    expect(prompt).toContain("Your recent routing");
    expect(prompt).toContain("Turn 2: implementer-codex → qa-kimi (code landed)");
    expect(prompt).toContain("Turn 3: qa-kimi → implementer-codex (review failed)");
  });
});

describe("buildRelayNudge", () => {
  it("asks only for the missing handoff, naming the file", () => {
    const nudge = buildRelayNudge(".pitwall/council/run-1/stage-4.md");
    expect(nudge).toContain(".pitwall/council/run-1/stage-4.md");
    expect(nudge).toContain("TO: <member>");
    expect(nudge).toContain(RELAY_COMPLETE_MARKER);
  });

  it("restates the assignment, so a member that lost the thread can answer it", () => {
    // Asking only for the file is unanswerable by an agent that no longer knows
    // what it was doing, which spends the one rescue on a question it cannot act on.
    const nudge = buildRelayNudge(".pitwall/council/run-1/stage-4.md", {
      roleLabel: "Architect",
      assignment: "Settle the rounding boundary before any code is written",
    });
    expect(nudge).toContain("Architect");
    expect(nudge).toContain("Settle the rounding boundary before any code is written");
  });
});

describe("panels", () => {
  const [implementer, architect, qa] = council;
  const secondReviewer = member("qa-grok", "Reviewer / QA", "Grok");
  const wide = [...council, secondReviewer];

  it("consults several advisory members at once", () => {
    const panel = planCouncilPanel(wide, ["qa-grok"], qa);
    expect(panel.map((item) => item.memberId)).toEqual(["qa-kimi", "qa-grok"]);
  });

  it("keeps a solo turn solo when no panel was asked for", () => {
    expect(planCouncilPanel(wide, undefined, qa).map((item) => item.memberId)).toEqual(["qa-kimi"]);
    expect(planCouncilPanel(wide, [], qa).map((item) => item.memberId)).toEqual(["qa-kimi"]);
  });

  it("never runs two code writers at once — they share one worktree", () => {
    const panel = planCouncilPanel(wide, ["implementer-codex", "qa-grok"], qa);
    expect(panel.map((item) => item.memberId)).toEqual(["implementer-codex"]);
  });

  it("collapses to the writer even when it was the primary pick", () => {
    expect(planCouncilPanel(wide, ["qa-kimi", "qa-grok"], implementer).map((item) => item.memberId)).toEqual([
      "implementer-codex",
    ]);
  });

  it("ignores members who are not on the council, and duplicates", () => {
    expect(planCouncilPanel(wide, ["nobody", "qa-kimi", "qa-grok"], qa).map((item) => item.memberId)).toEqual([
      "qa-kimi",
      "qa-grok",
    ]);
  });

  it("caps a panel so the merged result stays reviewable", () => {
    const many = [qa, architect, secondReviewer, member("researcher-gemini", "Researcher", "Gemini")];
    const panel = planCouncilPanel([implementer, ...many], many.map((item) => item.memberId), qa);
    expect(panel.length).toBe(MAX_PANEL_MEMBERS);
  });

  it("gives each panel member its own handoff file", () => {
    expect(getCouncilStageFile("run-1", 3)).toBe(".pitwall/council/run-1/stage-3.md");
    expect(getCouncilStageFile("run-1", 3, "qa-kimi")).toBe(".pitwall/council/run-1/stage-3-qa-kimi.md");
  });

  it("tells a panel member it is one voice of several and must not edit code", () => {
    const prompt = buildCouncilRelayTurn({
      runId: "run-1",
      taskPrompt: "Build it",
      member: qa,
      members: wide,
      turn: 3,
      isCycle: false,
      panel: [qa, secondReviewer],
    }).prompt;
    expect(prompt).toContain("consulted in parallel with Reviewer / QA (Grok)");
    expect(prompt).toContain("do not edit the code");
    expect(prompt).toContain("stage-3-qa-kimi.md");
  });

  it("attributes each voice when merging a panel's findings", () => {
    const merged = mergePanelHandoffs([
      { member: qa, content: "Race on reconnect." },
      { member: secondReviewer, content: "Token is logged in plaintext." },
    ]);
    expect(merged).toContain("Reviewer / QA (Kimi)");
    expect(merged).toContain("Race on reconnect.");
    expect(merged).toContain("Reviewer / QA (Grok)");
    expect(merged).toContain("Token is logged in plaintext.");
  });

  it("leaves a solo handoff exactly as written", () => {
    expect(mergePanelHandoffs([{ member: qa, content: "Just me." }])).toBe("Just me.");
  });

  it("reads a panel out of the conductor's decision", () => {
    const decision = parseConductorDecision('{"next":"qa-kimi","panel":["qa-grok"],"directive":"Review it."}');
    expect(decision?.panel).toEqual(["qa-grok"]);
    expect(parseConductorDecision('{"next":"qa-kimi"}')?.panel).toBeUndefined();
  });

  it("carries the panel through routing", () => {
    const route = chooseNextMember({
      members: wide,
      decision: { nextMemberId: "qa-kimi", panel: ["qa-grok"], directive: "", reason: "", done: false },
      addressed: null,
      history: [],
      turn: 2,
    });
    expect(route?.panel.map((item) => item.memberId)).toEqual(["qa-kimi", "qa-grok"]);
  });

  it("drops the panel when the anti-stall guard overrides the conductor", () => {
    const route = chooseNextMember({
      members: wide,
      decision: { nextMemberId: "qa-kimi", panel: ["qa-grok"], directive: "", reason: "", done: false },
      addressed: null,
      history: ["qa-kimi", "qa-kimi"],
      turn: 4,
    });
    expect(route?.source).toBe("rotation");
    expect(route?.panel.length).toBe(1);
    expect(route?.panel[0].memberId).not.toBe("qa-kimi");
  });
});

describe("test-suite evidence", () => {
  const base = { changedPaths: ["src/a.ts"], dirtyPaths: ["src/a.ts"], claimedWithoutChanges: false };

  it("states a failing suite as the blocker it is", () => {
    const text = formatCouncilEvidence({
      ...base,
      tests: { command: "npm test", passed: false, output: "1 failing" },
    });
    expect(text).toContain("FAILING TESTS");
    expect(text).toContain("not finished, whatever the handoff says");
    expect(text).toContain("1 failing");
  });

  it("reports a passing suite plainly", () => {
    const text = formatCouncilEvidence({ ...base, tests: { command: "npm test", passed: true, output: "" } });
    expect(text).toContain("passes");
    expect(text).not.toContain("FAILING");
  });

  it("treats a suite that never finished as unverified rather than passing", () => {
    const text = formatCouncilEvidence({
      ...base,
      tests: { command: "npm test", passed: false, timedOut: true, output: "" },
    });
    expect(text).toContain("did not finish in time");
    expect(text).toContain("unverified");
  });

  it("says nothing at all when there is no suite to run", () => {
    expect(formatCouncilEvidence({ ...base, tests: null })).not.toMatch(/test suite/i);
  });
});

describe("ambiguous member references", () => {
  const twoReviewers = [
    member("implementer-codex", "Implementer", "Codex", true),
    member("qa-kimi", "Reviewer / QA", "Kimi"),
    member("qa-grok", "Reviewer / QA", "Grok"),
  ];

  it("still resolves an exact handle", () => {
    expect(resolveMemberRef(twoReviewers, "qa-grok")?.memberId).toBe("qa-grok");
  });

  it("refuses to guess which of two reviewers was meant", () => {
    // Picking one would hand the work to a member nobody asked for; the caller's
    // fallback is a better answer than a confident wrong hop.
    expect(resolveMemberRef(twoReviewers, "qa")).toBeUndefined();
    expect(resolveMemberRef(twoReviewers, "Reviewer / QA")).toBeUndefined();
  });

  it("resolves a role that only one member holds", () => {
    expect(resolveMemberRef(twoReviewers, "implementer")?.memberId).toBe("implementer-codex");
    expect(resolveMemberRef(twoReviewers, "Codex")?.memberId).toBe("implementer-codex");
  });
});

describe("persisted relay state", () => {
  const state = {
    projectPath: "/tmp/project",
    taskPrompt: "Build it",
    task: { title: "Build it" },
    members: council,
    turn: 4,
    conductor: { enabled: true, agent: "Claude", model: "opus" },
    messages: [{ turn: 1, fromMemberId: "implementer-codex", toMemberId: null, content: "x".repeat(9000) }],
    history: ["implementer-codex"],
    currentMemberId: "qa-kimi",
    routes: [{ turn: 2, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", source: "conductor" as const, reason: "r", directive: "d" }],
  };

  it("round-trips everything routing needs", () => {
    const persisted = toPersistedRelayState(state);
    expect(isRestorableRelayState(persisted)).toBe(true);
    expect(persisted.members.map((item) => item.memberId)).toEqual(council.map((item) => item.memberId));
    expect(persisted.turn).toBe(4);
    expect(persisted.currentMemberId).toBe("qa-kimi");
    expect(persisted.routes).toHaveLength(1);
  });

  it("trims oversized transcripts, since thread.md holds the full text", () => {
    const persisted = toPersistedRelayState(state);
    expect(persisted.messages[0].content.length).toBeLessThan(9000);
    expect(persisted.messages[0].content).toContain("full text in thread.md");
  });

  it("rejects anything it could only half-restore", () => {
    expect(isRestorableRelayState(null)).toBe(false);
    expect(isRestorableRelayState({})).toBe(false);
    expect(isRestorableRelayState({ ...state, members: [] })).toBe(false);
    // A single member cannot hand work to anyone.
    expect(isRestorableRelayState({ ...state, members: [council[0]] })).toBe(false);
    // Written by an older build that had no member handles.
    expect(isRestorableRelayState({ ...state, members: [{ sessionId: "s" }] })).toBe(false);
    expect(isRestorableRelayState({ ...state, conductor: undefined })).toBe(false);
  });

  it("saves decisions before trimming old transcripts and retains user instructions", () => {
    const messages = [
      { turn: 1, fromMemberId: "you", toMemberId: null, author: "user" as const, content: `Keep this instruction. ${"x".repeat(6000)}` },
      { turn: 2, fromMemberId: "architect-claude", toMemberId: null, content: `${"detail ".repeat(1000)}\nDECISION: [storage] Use the existing store.` },
      ...Array.from({ length: 45 }, (_, index) => ({ turn: index + 3, fromMemberId: "qa-kimi", toMemberId: null, content: "Reviewed." })),
    ];
    const persisted = toPersistedRelayState({ ...state, messages });
    expect(persisted.messages[0].content).toBe(messages[0].content);
    expect(persisted.workingSet?.decisions).toEqual(["[storage] Use the existing store."]);
    expect(restoreCouncilWorkingSet(persisted.messages, persisted.workingSet).decisions).toEqual(persisted.workingSet?.decisions);
  });

  it("round-trips task evidence, assignment, lessons, and verification", () => {
    const enriched = {
      ...state, workingSet: emptyWorkingSet(), lessons: ["[runtime] Use Node 24."],
      projectRoot: "/tmp/repo", taskId: "task-1", currentAssignment: "Verify restart.",
      evidence: { changedPaths: ["a.ts"], dirtyPaths: ["a.ts"], claimedWithoutChanges: false, tests: { command: "npm test", passed: false, output: "failed" } },
      verification: { attempts: 1, pending: false, verdict: { verified: false, gaps: ["Missing restart test"], summary: "Needs restart coverage." } },
    };
    const persisted = toPersistedRelayState(enriched);
    expect(isRestorableRelayState(persisted)).toBe(true);
    expect(persisted).toMatchObject({ lessons: enriched.lessons, evidence: enriched.evidence, verification: enriched.verification, currentAssignment: enriched.currentAssignment });
  });

  it("rejects malformed optional snapshots instead of presenting false verification", () => {
    for (const metadata of [
      { workingSet: { ...emptyWorkingSet(), decisions: [3] } },
      { lessons: "Use Node 24" },
      { evidence: { changedPaths: [], dirtyPaths: [], claimedWithoutChanges: false, tests: { passed: "yes" } } },
      { verification: { attempts: 1, pending: false, verdict: { verified: "yes", gaps: [] } } },
      { verification: null }, { currentAssignment: 12 }, { contextEntryIds: [12] },
      { currentPanelMemberIds: ["not-in-the-roster"] }, { currentPanelMemberIds: [4] },
    ]) expect(isRestorableRelayState({ ...state, ...metadata })).toBe(false);
  });
});

describe("restoreCouncilWorkingSet", () => {
  const messages = [{ turn: 1, fromMemberId: "architect", toMemberId: null, content: "## Working set\n- src/store.ts — shared store\n## Open questions\n- Which runtime?\nDECISION: [runtime] Use Node 20." }];

  it("reconstructs old runs without saved metadata and ignores corrupt optional working sets", () => {
    expect(restoreCouncilWorkingSet(messages).files[0].path).toBe("src/store.ts");
    expect(restoreCouncilWorkingSet(messages, { files: "broken" }).files[0].path).toBe("src/store.ts");
  });

  it("keeps the saved accepted decision and explicit resolution when old handoffs repeat them", () => {
    const saved = parseWorkingSet("DECISION: [runtime] Use Node 24.\nRESOLVED: Which runtime?", 3, "architect");
    const restored = restoreCouncilWorkingSet(messages, saved);
    expect(restored.files[0].path).toBe("src/store.ts");
    expect(restored.decisions).toEqual(["[runtime] Use Node 24."]);
    expect(restored.openQuestions).toEqual([]);
  });
});

describe("restoreCouncilPanel", () => {
  it("keeps all surviving panel members with the primary member first", () => {
    expect(restoreCouncilPanel(council, "architect-claude", ["qa-kimi", "architect-claude", "qa-kimi"]).map((member) => member.memberId))
      .toEqual(["architect-claude", "qa-kimi"]);
  });

  it("falls back to a surviving primary when metadata or a seat is missing", () => {
    expect(restoreCouncilPanel(council, "qa-kimi", ["retired-member"]).map((member) => member.memberId)).toEqual(["qa-kimi"]);
    expect(restoreCouncilPanel(council, "qa-kimi", "bad-metadata").map((member) => member.memberId)).toEqual(["qa-kimi"]);
    expect(restoreCouncilPanel(council, "retired-member")[0]).toBe(council[0]);
    expect(restoreCouncilPanel([], "qa-kimi")).toEqual([]);
  });
});

describe("adopting a council that predates the conductor", () => {
  const stages = [
    { turn: 1, content: "TO: implementer-codex\n\nDesigned the cache." },
    { turn: 2, content: "Built it." },
    { turn: 3, content: "Reviewed it." },
  ];

  it("attributes turns the way the old rotation actually assigned them", () => {
    const messages = rebuildThreadFromStages(council, stages);
    expect(messages.map((message) => message.fromMemberId)).toEqual([
      "implementer-codex",
      "architect-claude",
      "qa-kimi",
    ]);
  });

  it("keeps each handoff's own text and who it addressed", () => {
    const messages = rebuildThreadFromStages(council, stages);
    expect(messages[0].content).toContain("Designed the cache.");
    expect(messages[0].toMemberId).toBe("implementer-codex");
    expect(messages[1].toMemberId).toBeNull();
  });

  it("orders by turn regardless of how the files were read", () => {
    const shuffled = [stages[2], stages[0], stages[1]];
    expect(rebuildThreadFromStages(council, shuffled).map((message) => message.turn)).toEqual([1, 2, 3]);
  });

  it("copes with a council that never produced a handoff", () => {
    expect(rebuildThreadFromStages(council, [])).toEqual([]);
  });
});

describe("council activity", () => {
  const messages = [
    { turn: 1, fromMemberId: "implementer-codex", toMemberId: null, content: "a" },
    { turn: 2, fromMemberId: "qa-kimi", toMemberId: null, content: "b" },
    { turn: 2, fromMemberId: "architect-claude", toMemberId: null, content: "c" },
    { turn: 3, fromMemberId: "qa-kimi", toMemberId: null, content: "d" },
    { turn: 3, fromMemberId: COUNCIL_USER_ID, toMemberId: null, content: "stop gold-plating", author: "user" as const },
  ];

  it("counts handoffs, not turns — a panel is several on one turn", () => {
    expect(summariseCouncilActivity(council, messages).handoffs).toBe(4);
  });

  it("credits every voice on a panel turn, not just the one that led it", () => {
    const panelTurn = [
      {
        turn: 1,
        fromMemberId: "architect-claude",
        toMemberId: null,
        content: "merged findings",
        participants: ["architect-claude", "qa-kimi"],
      },
    ];
    const activity = summariseCouncilActivity(council, panelTurn);
    expect(activity.handoffs).toBe(2);
    expect(activity.perMember.find((member) => member.memberId === "qa-kimi")?.turns).toBe(1);
    expect(activity.perMember.find((member) => member.memberId === "architect-claude")?.turns).toBe(1);
  });

  it("does not count what the user typed as a member's turn", () => {
    const withoutUser = messages.filter((message) => message.author !== "user");
    expect(summariseCouncilActivity(council, withoutUser).handoffs).toBe(
      summariseCouncilActivity(council, messages).handoffs,
    );
  });

  it("does not count the council's own entries as anyone's turn", () => {
    // A settled debate and a turn the user cut short are both recorded in the
    // council's voice, with no member behind them.
    const withCouncilVoice = [
      ...messages,
      { turn: 4, fromMemberId: "", toMemberId: null, content: "## Turn 4 — cut short", author: "council" as const },
    ];
    expect(summariseCouncilActivity(council, withCouncilVoice).handoffs).toBe(
      summariseCouncilActivity(council, messages).handoffs,
    );
    expect(summariseCouncilActivity(council, withCouncilVoice).perMember.map((entry) => entry.turns)).toEqual([2, 1, 1]);
  });

  it("shows who has been doing the talking, busiest first", () => {
    const perMember = summariseCouncilActivity(council, messages).perMember;
    expect(perMember[0]).toMatchObject({ memberId: "qa-kimi", turns: 2 });
    expect(perMember.map((member) => member.turns)).toEqual([2, 1, 1]);
  });

  it("still lists a member that has not spoken", () => {
    const perMember = summariseCouncilActivity(council, []).perMember;
    expect(perMember).toHaveLength(3);
    expect(perMember.every((member) => member.turns === 0)).toBe(true);
  });

  it("renders the breakdown for the tooltip", () => {
    expect(formatCouncilActivity(summariseCouncilActivity(council, messages))).toContain("Reviewer / QA (Kimi): 2");
  });

  it("reports duration in units that suit a council", () => {
    expect(formatCouncilDuration(30 * 1000)).toBe("just started");
    expect(formatCouncilDuration(47 * 60_000)).toBe("47m");
    expect(formatCouncilDuration(72 * 60_000)).toBe("1h 12m");
    expect(formatCouncilDuration(3 * 3600_000)).toBe("3h");
    expect(formatCouncilDuration(27 * 3600_000)).toBe("1d 3h");
    expect(formatCouncilDuration(-1)).toBe("");
  });
});

describe("turn limits", () => {
  it("keeps the familiar default", () => {
    expect(MAX_RELAY_TURNS).toBe(24);
    expect(RELAY_TURN_LIMITS).toContain(MAX_RELAY_TURNS);
  });

  it("accepts the offered limits and typed-in values", () => {
    expect(normalizeTurnLimit(36)).toBe(36);
    expect(normalizeTurnLimit("48")).toBe(48);
    expect(normalizeTurnLimit(7)).toBe(7);
  });

  it("treats unlimited as no cap", () => {
    expect(normalizeTurnLimit(null)).toBeNull();
    expect(isWithinTurnLimit(400, null)).toBe(true);
  });

  it("still stops an unlimited council at the safety ceiling", () => {
    // "Unlimited" must not mean "bills forever if the agents never converge".
    expect(isWithinTurnLimit(RELAY_TURN_CEILING, null)).toBe(true);
    expect(isWithinTurnLimit(RELAY_TURN_CEILING + 1, null)).toBe(false);
    expect(normalizeTurnLimit(99999)).toBe(RELAY_TURN_CEILING);
  });

  it("falls back to the default for nonsense rather than running uncapped", () => {
    expect(normalizeTurnLimit("")).toBe(MAX_RELAY_TURNS);
    expect(normalizeTurnLimit(undefined)).toBe(MAX_RELAY_TURNS);
    expect(normalizeTurnLimit("abc")).toBe(MAX_RELAY_TURNS);
    expect(normalizeTurnLimit(0)).toBe(MAX_RELAY_TURNS);
    expect(normalizeTurnLimit(-5)).toBe(MAX_RELAY_TURNS);
  });

  it("gates advancement on the run's own limit", () => {
    expect(isWithinTurnLimit(36, 36)).toBe(true);
    expect(isWithinTurnLimit(37, 36)).toBe(false);
    // A run stored before limits existed keeps the old behaviour.
    expect(isWithinTurnLimit(MAX_RELAY_TURNS, undefined)).toBe(true);
    expect(isWithinTurnLimit(MAX_RELAY_TURNS + 1, undefined)).toBe(false);
  });

  it("explains the pause in terms of the limit that was actually set", () => {
    expect(formatTurnLimitNote(48)).toContain("48 turns");
    expect(formatTurnLimitNote(48)).toContain("Raise the limit");
    expect(formatTurnLimitNote(null)).toContain(`${RELAY_TURN_CEILING}-turn safety ceiling`);
  });

  it("tells the conductor its budget, and says nothing when there is none", () => {
    const capped = buildConductorPrompt({ task: { title: "t" }, members: council, messages: [], turn: 3, maxTurns: 48 });
    expect(capped).toContain("turn 3 of at most 48");
    const uncapped = buildConductorPrompt({
      task: { title: "t" },
      members: council,
      messages: [],
      turn: 3,
      maxTurns: null,
    });
    expect(uncapped).toContain("turn 3)");
    expect(uncapped).not.toMatch(/turn 3 of at most/);
  });

  it("carries the limit across a restart", () => {
    const persisted = toPersistedRelayState({
      projectPath: "/tmp/p",
      taskPrompt: "t",
      task: { title: "t" },
      members: council,
      turn: 30,
      maxTurns: null,
      conductor: { enabled: true, agent: "Claude", model: "opus" },
      messages: [],
      history: [],
      routes: [],
    });
    expect(persisted.maxTurns).toBeNull();
    expect(isRestorableRelayState(persisted)).toBe(true);
  });
});

describe("relay guards and brief", () => {
  it("caps automatic advancement", () => {
    expect(MAX_RELAY_TURNS).toBeGreaterThan(2);
    expect(Number.isInteger(MAX_RELAY_TURNS)).toBe(true);
  });

  it("numbers stage files from one and keeps one thread per run", () => {
    expect(getCouncilStageFile("run-9", 1)).toBe(".pitwall/council/run-9/stage-1.md");
    expect(getCouncilThreadFile("run-9")).toBe(".pitwall/council/run-9/thread.md");
  });

  it("preserves the complete multiline task in a file-backed brief", () => {
    const description = "Choose a method:\n1. Fingerprick\n2. Venous\n3. Clinic\n\nDo not omit any option.";
    expect(buildCouncilTaskBrief({ title: "Collection picker", description })).toBe(
      `# Collection picker\n\n${description}\n`,
    );
  });

  it("points agents to the complete task brief", () => {
    const path = getCouncilTaskBriefPath("run-1");
    expect(path).toBe(".pitwall/council/run-1/task.md");
    expect(formatCouncilTaskFilePrompt(path)).toContain(`Read the complete task brief at ${path}`);
  });
});

describe("talking to the conductor", () => {
  const standing = addConductorDirective([], 3, "  Stop routing to the architect — QA has the blocking question.  ");

  it("keeps a standing instruction verbatim, without its surrounding whitespace", () => {
    expect(standing).toEqual([{ turn: 3, text: "Stop routing to the architect — QA has the blocking question." }]);
  });

  it("ignores blank instructions and an immediate repeat of the standing one", () => {
    expect(addConductorDirective(standing, 4, "   ")).toBe(standing);
    expect(addConductorDirective(standing, 4, "Stop routing to the architect — QA has the blocking question.")).toBe(
      standing,
    );
  });

  it("drops the oldest instruction rather than growing the prompt without bound", () => {
    let directives = standing;
    for (let turn = 4; turn < 4 + CONDUCTOR_DIRECTIVE_LIMIT + 2; turn += 1) {
      directives = addConductorDirective(directives, turn, `instruction ${turn}`);
    }
    expect(directives).toHaveLength(CONDUCTOR_DIRECTIVE_LIMIT);
    expect(directives.at(-1)?.text).toBe(`instruction ${4 + CONDUCTOR_DIRECTIVE_LIMIT + 1}`);
    expect(directives.some((directive) => directive.turn === 3)).toBe(false);
  });

  it("states standing instructions as binding when routing", () => {
    const prompt = buildConductorPrompt({
      task: { title: "Ship the importer" },
      members: council,
      messages: [],
      turn: 4,
      directives: standing,
    });
    expect(prompt).toContain("Standing instructions from the person running this council");
    expect(prompt).toContain("(given at turn 3) Stop routing to the architect");
    expect(prompt).toContain("do not expire");
  });

  it("still carries the instruction once the thread has moved past it", () => {
    // User instructions survive the member transcript window, whether they
    // arrived in the discussion or were pinned directly to the conductor.
    const messages = [
      { turn: 3, fromMemberId: COUNCIL_USER_ID, toMemberId: null, content: "Stop routing to the architect.", author: "user" as const },
      ...Array.from({ length: 12 }, (_, index) => ({
        turn: index + 4,
        fromMemberId: "implementer-codex",
        toMemberId: null,
        content: `Turn ${index + 4} work.`,
      })),
    ];
    const withoutDirective = buildConductorPrompt({
      task: { title: "Ship the importer" },
      members: council,
      messages,
      turn: 16,
    });
    const withDirective = buildConductorPrompt({
      task: { title: "Ship the importer" },
      members: council,
      messages,
      turn: 16,
      directives: standing,
    });
    expect(withoutDirective).toContain("Stop routing to the architect");
    expect(withDirective).toContain("Stop routing to the architect");
  });

  it("answers a question in prose instead of routing", () => {
    const prompt = buildConductorAnswerPrompt({
      task: { title: "Ship the importer" },
      members: council,
      messages: [
        { turn: 1, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", content: "Parser rewritten." },
      ],
      turn: 2,
      routes: [{ turn: 2, fromMemberId: "implementer-codex", toMemberId: "qa-kimi", reason: "Needs review." }],
      directives: standing,
      question: "Why does qa-kimi keep getting the work back?",
    });
    expect(prompt).toContain("Why does qa-kimi keep getting the work back?");
    expect(prompt).toContain("no JSON");
    expect(prompt).toContain("do not hand the work to anyone");
    // The answer is only worth anything if it is grounded in the same material
    // the routing decisions are made from.
    expect(prompt).toContain("qa-kimi — Reviewer / QA");
    expect(prompt).toContain("Parser rewritten.");
    expect(prompt).toContain("Stop routing to the architect");
    expect(prompt).not.toContain('{"next"');
  });
});

describe("persisting standing instructions", () => {
  it("carries them through a restart", () => {
    const persisted = toPersistedRelayState({
      projectPath: "/tmp/project",
      taskPrompt: "Build it",
      task: { title: "Build it" },
      members: council,
      turn: 5,
      conductor: { enabled: true, agent: "Claude", model: "opus" },
      directives: [{ turn: 2, text: "Prioritise the failing test over new work." }],
      messages: [],
      history: [],
      routes: [],
    });
    expect(persisted.directives).toEqual([{ turn: 2, text: "Prioritise the failing test over new work." }]);
    expect(isRestorableRelayState(persisted)).toBe(true);
  });
});

describe("where a turn's handoff goes", () => {
  it("keeps a solo turn on the unsuffixed file and gives each panel member its own", () => {
    expect(getTurnStageFile("run-7", 4, "qa-kimi", 1)).toBe(".pitwall/council/run-7/stage-4.md");
    expect(getTurnStageFile("run-7", 4, "qa-kimi", 3)).toBe(".pitwall/council/run-7/stage-4-qa-kimi.md");
  });

  it("names the same file the member's own prompt told it to write", () => {
    // The stall this prevents: the prompt names one file while everything
    // waiting on the turn watches another, so the council waits for a handoff
    // that was written somewhere else — or nudges the member towards a file the
    // watcher will never read.
    const panel = [council[1], council[2]];
    for (const member of panel) {
      const plan = buildCouncilRelayTurn({
        runId: "run-7",
        taskPrompt: "Build it",
        member,
        members: council,
        turn: 4,
        isCycle: true,
        panel,
      });
      expect(plan.stageFile).toBe(getTurnStageFile("run-7", 4, member.memberId, panel.length));
      expect(plan.prompt).toContain(plan.stageFile);
      expect(buildRelayNudge(getTurnStageFile("run-7", 4, member.memberId, panel.length))).toContain(plan.stageFile);
    }
  });

  it("agrees with the solo prompt when the conductor called no panel", () => {
    const plan = buildCouncilRelayTurn({
      runId: "run-7",
      taskPrompt: "Build it",
      member: council[0],
      members: council,
      turn: 5,
      isCycle: true,
    });
    expect(plan.stageFile).toBe(getTurnStageFile("run-7", 5, council[0].memberId, 1));
  });

  it("treats a one-member panel as a solo turn", () => {
    const plan = buildCouncilRelayTurn({
      runId: "run-7",
      taskPrompt: "Build it",
      member: council[0],
      members: council,
      turn: 6,
      isCycle: true,
      panel: [council[0]],
    });
    expect(plan.stageFile).toBe(".pitwall/council/run-7/stage-6.md");
  });
});

describe("relayMayAutoAdvance", () => {
  it("advances a running council", () => {
    expect(relayMayAutoAdvance({ auto: true })).toBe(true);
  });

  it("does not advance a council set to manual hand-off", () => {
    expect(relayMayAutoAdvance({ auto: false })).toBe(false);
  });

  it("does not advance a council the relay stopped", () => {
    expect(relayMayAutoAdvance({ auto: true, stopped: true })).toBe(false);
  });

  // The whole point of the pause: a manual hand-off, a raised turn cap and
  // asking the conductor all clear `stopped` deliberately, and none of them
  // may restart a council the user paused.
  it("does not advance a paused council even once stopped is cleared", () => {
    expect(relayMayAutoAdvance({ auto: true, stopped: false, paused: true })).toBe(false);
  });

  it("advances again once the pause is lifted", () => {
    expect(relayMayAutoAdvance({ auto: true, paused: false })).toBe(true);
  });
});

describe("relayMayStartTurn", () => {
  it("starts a turn on a live council", () => {
    expect(relayMayStartTurn({})).toBe(true);
  });

  it("starts nothing while paused, however the turn was asked for", () => {
    expect(relayMayStartTurn({ paused: true })).toBe(false);
  });

  it("starts nothing while stopped", () => {
    expect(relayMayStartTurn({ stopped: true })).toBe(false);
  });
});

describe("carryCouncilToNextTask", () => {
  const previous = {
    runId: "council-1",
    projectPath: "/tmp/work",
    taskPrompt: "old prompt",
    task: { title: "Old task" },
    members: [{ sessionId: "s1", memberId: "arch-claude" }],
    conductor: { enabled: true, agent: "Claude", model: "opus", runTests: true },
    maxTurns: 24,
    turn: 17,
    auto: false,
    stopped: true,
    paused: true,
    messages: [{ role: "member", content: "we are done" }],
    history: ["arch-claude", "impl-codex"],
    routes: [{ turn: 16 }],
    directives: [{ text: "prefer small diffs" }],
    nudgedTurns: [4],
    treeHistory: [{ turn: 3 }],
    repoSnapshot: { "src/a.ts": "abc" },
    evidence: { ok: false },
    pending: { turn: 17 },
    debate: { open: true },
    currentPrompt: "old turn prompt",
    lessons: ["watch the timezone"],
  };
  const next = {
    runId: "council-2",
    taskPrompt: "new prompt",
    task: { title: "New task" },
    startedAt: "2026-08-29T12:00:00.000Z",
  };

  it("keeps the roster, the worktree and the conductor's settings", () => {
    // These are the reason reusing a council is worth doing: booted, signed
    // in, attached to a worktree.
    const run = carryCouncilToNextTask(previous, next);
    expect(run.members).toEqual(previous.members);
    expect(run.projectPath).toBe("/tmp/work");
    expect(run.conductor).toEqual(previous.conductor);
    expect(run.maxTurns).toBe(24);
  });

  it("starts the new task at turn one, running", () => {
    const run = carryCouncilToNextTask(previous, next);
    expect(run.turn).toBe(1);
    expect(run.auto).toBe(true);
    expect(run.stopped).toBe(false);
    // A pause belonged to the finished run and must not silently outlive it.
    expect(run.paused).toBe(false);
  });

  it("leaves nothing of the finished conversation behind", () => {
    const run = carryCouncilToNextTask(previous, next);
    expect(run.messages).toEqual([]);
    expect(run.history).toEqual([]);
    expect(run.routes).toEqual([]);
    expect(run.directives).toEqual([]);
    expect(run.nudgedTurns).toEqual([]);
    expect(run.treeHistory).toEqual([]);
    expect(run.repoSnapshot).toEqual({});
    expect(run.evidence).toBeNull();
    expect(run.pending).toBeUndefined();
    expect(run.debate).toBeNull();
    expect(run.currentPrompt).toBeUndefined();
  });

  it("takes a new run id, so the finished run's files are not written over", () => {
    // Turns write numbered files under the run id; restarting at turn 1 under
    // the old id would overwrite the record of what it already did.
    expect(carryCouncilToNextTask(previous, next).runId).toBe("council-2");
  });

  it("carries the new task and its prompt", () => {
    const run = carryCouncilToNextTask(previous, next);
    expect(run.taskPrompt).toBe("new prompt");
    expect(run.task).toEqual({ title: "New task" });
  });
});

describe("a stall that keeps printing", () => {
  it("reads repeated output as no progress, however much of it there is", () => {
    // The idle check counted lines, so any output at all reset the clock. An
    // agent stuck in a loop prints constantly, so it never tripped and the turn
    // survived to the two-hour ceiling instead of being rescued in ten minutes.
    const stuck = ["Checking remaining test packages", "Checking remaining test packages"];
    expect(relayProgressMark(stuck)).toBe(relayProgressMark([...stuck, "Checking remaining test packages"]));
  });

  it("ignores an elapsed timer, which changes on every frame while nothing happens", () => {
    expect(relayProgressMark(["Crunched for 2m 5s"])).toBe(relayProgressMark(["Crunched for 11m 40s"]));
    expect(relayProgressMark(["esc to interrupt · 42s"])).toBe(relayProgressMark(["esc to interrupt · 305s"]));
  });

  it("sees real work as progress", () => {
    expect(relayProgressMark(["Reading src/billing/totals.ts"])).not.toBe(
      relayProgressMark(["Reading src/billing/rounding.ts"]),
    );
  });

  it("looks only at the tail, so an old line scrolling away is not progress", () => {
    const tail = Array.from({ length: 60 }, (_, index) => `line ${index}`);
    expect(relayProgressMark(tail)).toBe(relayProgressMark(["something older", ...tail]));
  });

  it("treats an empty pane as its own state rather than matching anything", () => {
    expect(relayProgressMark([])).toBe(relayProgressMark([]));
    expect(relayProgressMark([])).not.toBe(relayProgressMark(["working"]));
  });
});

describe("the run's own time budget", () => {
  const started = "2026-09-09T09:00:00.000Z";
  const at = (hours: number) => new Date(Date.parse(started) + hours * 3600_000).toISOString();

  it("allows a run inside its budget", () => {
    expect(isWithinRunBudget(started, at(3.9), DEFAULT_RUN_BUDGET_MS)).toBe(true);
  });

  it("stops one that has outlived it", () => {
    // Turns are capped and each turn is capped, but nothing capped the run, so
    // those ceilings multiplied instead of adding up to a number anyone chose.
    expect(isWithinRunBudget(started, at(4.1), DEFAULT_RUN_BUDGET_MS)).toBe(false);
  });

  it("treats no budget as unlimited, and a missing start as unbounded", () => {
    expect(isWithinRunBudget(started, at(999), null)).toBe(true);
    expect(isWithinRunBudget(undefined, at(999), DEFAULT_RUN_BUDGET_MS)).toBe(true);
  });

  it("normalises whatever the UI or storage supplies", () => {
    expect(normalizeRunBudget(null)).toBe(null);
    expect(normalizeRunBudget(2)).toBe(2 * 3600_000);
    expect(normalizeRunBudget("junk")).toBe(DEFAULT_RUN_BUDGET_MS);
    expect(normalizeRunBudget(-4)).toBe(DEFAULT_RUN_BUDGET_MS);
  });
});

describe("a member waiting on a person", () => {
  // A gated pane is skipped by the rescue, and rightly: typing a nudge into a
  // sign-in dialog is what the guard exists to prevent. But being skipped made
  // it invisible, so nobody was owing, the watcher kept waiting, and a council
  // sat for the full two hours instead of being rescued in ten minutes.
  it("keeps waiting while the gate is fresh", () => {
    expect(resolveStallAction({ owing: [], nudged: [], rerouted: false, gated: ["architect"], gatedForMs: 60_000 }))
      .toEqual({ action: "wait", members: [] });
  });

  it("gives up once a gate has stood too long, and says who is holding it", () => {
    expect(resolveStallAction({ owing: [], nudged: [], rerouted: false, gated: ["architect"], gatedForMs: 20 * 60_000 }))
      .toEqual({ action: "gated", members: ["architect"] });
  });

  it("says nothing about gates when the handoffs are simply all in", () => {
    expect(resolveStallAction({ owing: [], nudged: [], rerouted: false, gated: [], gatedForMs: 9_999_999 }))
      .toEqual({ action: "wait", members: [] });
  });

  it("prefers asking a member that can answer over reporting one that cannot", () => {
    expect(resolveStallAction({ owing: ["qa"], nudged: [], rerouted: false, gated: ["architect"], gatedForMs: 20 * 60_000 }))
      .toEqual({ action: "nudge", members: ["qa"] });
  });
});

describe("what to do when a nudge goes unanswered", () => {
  const owing = ["architect"];

  it("nudges a member that has not been asked yet", () => {
    expect(resolveStallAction({ owing, nudged: [], rerouted: false })).toEqual({ action: "nudge", members: owing });
  });

  it("re-routes rather than stopping once the nudge is spent", () => {
    // The run used to stop here and tell the user to re-route from the
    // Conductor lane, which Pitwall can do itself and already knows who is stuck.
    expect(resolveStallAction({ owing, nudged: owing, rerouted: false })).toEqual({ action: "reroute", members: owing });
  });

  it("stops once the re-route has also been spent, so it cannot loop", () => {
    expect(resolveStallAction({ owing, nudged: owing, rerouted: true })).toEqual({ action: "stop", members: owing });
  });

  it("keeps watching when nobody owes anything", () => {
    expect(resolveStallAction({ owing: [], nudged: [], rerouted: false })).toEqual({ action: "wait", members: [] });
  });
});

describe("council prompts delivered by file", () => {
  const stage = getTurnStageFile("run1", 3, "qa-claude", 2);
  const long = `${"context ".repeat(400)}\nWrite your handoff to ${stage}.`;

  it("leaves a short prompt to be typed as it is", () => {
    expect(planCouncilPromptDelivery({ runId: "run1", turn: 3, memberId: "qa-claude", stageFile: stage, prompt: "Carry on.", stamp: 7 })).toBeNull();
  });

  it("moves a long prompt into a file and types a short pointer that names the handoff", () => {
    const plan = planCouncilPromptDelivery({ runId: "run1", turn: 3, memberId: "qa-claude", stageFile: stage, prompt: long, stamp: 7 })!;
    expect(plan.filePath).toBe(".pitwall/council/run1/prompts/turn-3-qa-claude-7.md");
    expect(plan.content).toBe(long);
    expect(plan.pointer.length).toBeLessThan(400);
    expect(plan.pointer).toContain(plan.filePath);
    expect(plan.pointer).toContain(stage);
    expect(plan.pointer.slice(-120)).toContain(plan.filePath);
  });

  it("does not name a handoff file the prompt itself never asked for", () => {
    const plan = planCouncilPromptDelivery({ runId: "run1", turn: 3, memberId: "qa-claude", stageFile: stage, prompt: "x".repeat(3000), stamp: 7 })!;
    expect(plan.pointer).not.toContain("stage-");
  });
});
