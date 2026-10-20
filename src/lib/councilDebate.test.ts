import { describe, expect, it } from "vitest";
import {
  abandonDebate,
  AGREE_MARKER,
  MAX_DEBATE_ROUNDS,
  MAX_OPENING_ROUNDS,
  buildDebateRoundPrompt,
  buildOpeningDebatePrompt,
  isRestorableDebate,
  buildOpeningDirective,
  openOpeningDebate,
  classifyDebateStakes,
  evaluateDebate,
  parseDebateStance,
  parseDisputeRequest,
  renderDebateRecord,
  summariseDebate,
  type Debate,
  type DebateTurn,
} from "./councilDebate";

const turn = (memberId: string, round: number, content: string): DebateTurn => ({
  memberId,
  round,
  stance: parseDebateStance(content),
  body: content,
});

const debate = (over: Partial<Debate> = {}): Debate => ({
  id: "d1",
  kind: "dispute",
  question: "whether to add a shared store",
  participants: ["impl-codex", "qa-claude"],
  stakes: "routine",
  turns: [],
  status: "open",
  ...over,
});

describe("parseDisputeRequest", () => {
  it("reads a dispute opened against a named member", () => {
    expect(parseDisputeRequest("DISPUTE: qa-claude\nYour test asserts the old contract.")).toEqual({
      target: "qa-claude",
      declared: null,
    });
  });

  it("reads a declared stakes tag", () => {
    expect(parseDisputeRequest("DISPUTE: qa-claude [high]\nThis changes the schema.")).toMatchObject({
      target: "qa-claude",
      declared: "high",
    });
  });

  it("only counts the leading line", () => {
    // Mentioning a disagreement inside a writeup is not opening one.
    expect(parseDisputeRequest("Did the work.\nDISPUTE: qa-claude about naming")).toBeNull();
    expect(parseDisputeRequest("TO: qa-claude\nover to you")).toBeNull();
  });
});

describe("parseDebateStance", () => {
  it("reads agreement and who it is with", () => {
    expect(parseDebateStance("AGREE: impl-codex memoizing is enough")).toMatchObject({
      verdict: "agree",
      agreesWith: "impl-codex",
    });
  });

  it("reads a held position", () => {
    expect(parseDebateStance("HOLD: a store still couples the pages")).toMatchObject({ verdict: "hold" });
  });

  it("treats anything ambiguous as unresolved, never as agreement", () => {
    // The dangerous direction: reading vagueness as consent would close a
    // debate nobody actually settled.
    for (const vague of ["I think they might have a point", "Sounds reasonable either way", ""]) {
      expect(parseDebateStance(vague).verdict).toBe("unclear");
    }
  });
});

describe("classifyDebateStakes", () => {
  it("catches the things that are expensive to get wrong", () => {
    const cases: Array<[string, string]> = [
      ["we should drop the sessions table", "schema deletion"],
      ["this needs a migration to backfill", "schema or migration change"],
      ["just force-push over it", "destructive git operation"],
      ["add a dependency on redux", "dependency change"],
      ["that is a breaking change for the API contract", "public contract change"],
      ["it changes how the auth token is issued", "security-sensitive area"],
    ];
    for (const [text, reason] of cases) {
      expect(classifyDebateStakes(text), text).toMatchObject({ stakes: "high", reason });
    }
  });

  it("leaves ordinary disagreements routine", () => {
    expect(classifyDebateStakes("should this hook be memoized or lifted").stakes).toBe("routine");
  });

  it("escalates on a member's say-so", () => {
    expect(classifyDebateStakes("rename the helper", "high").stakes).toBe("high");
  });

  it("never lets a member talk stakes back down", () => {
    // A member declaring "routine" must not be able to hide a migration.
    expect(classifyDebateStakes("this needs a migration", "routine").stakes).toBe("high");
  });
});

describe("evaluateDebate", () => {
  it("waits for everyone before judging a round", () => {
    const d = debate({ turns: [turn("impl-codex", 1, "HOLD: memoizing is enough")] });
    expect(evaluateDebate(d).action).toBe("continue");
  });

  it("calls consensus when everyone lands on one position", () => {
    const d = debate({
      turns: [turn("impl-codex", 1, "HOLD: memoizing is enough"), turn("qa-claude", 1, "AGREE: impl-codex fair point")],
    });
    expect(evaluateDebate(d)).toMatchObject({ action: "consensus", settledOn: "impl-codex" });
  });

  it("keeps going while they still disagree and rounds remain", () => {
    const d = debate({
      turns: [turn("impl-codex", 1, "HOLD: memoize"), turn("qa-claude", 1, "HOLD: use a store")],
    });
    expect(evaluateDebate(d).action).toBe("continue");
  });

  it("blocks consensus on an unclear answer", () => {
    const d = debate({
      turns: [turn("impl-codex", 1, "HOLD: memoize"), turn("qa-claude", 1, "maybe, could go either way")],
    });
    expect(evaluateDebate(d).action).toBe("continue");
  });

  it("lets the conductor settle a routine split once rounds run out", () => {
    const turns: DebateTurn[] = [];
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round += 1) {
      turns.push(turn("impl-codex", round, "HOLD: memoize"), turn("qa-claude", round, "HOLD: use a store"));
    }
    const result = evaluateDebate(debate({ turns }));
    expect(result.action).toBe("rule");
    expect(result.dissenting.sort()).toEqual(["impl-codex", "qa-claude"]);
  });

  it("escalates a high-stakes split to the user instead of ruling", () => {
    const turns: DebateTurn[] = [];
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round += 1) {
      turns.push(turn("impl-codex", round, "HOLD: migrate in place"), turn("qa-claude", round, "HOLD: new table"));
    }
    expect(evaluateDebate(debate({ stakes: "high", turns })).action).toBe("escalate");
  });

  it("gives an opening debate an extra round before settling", () => {
    const turns: DebateTurn[] = [];
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round += 1) {
      turns.push(turn("a", round, "HOLD: x"), turn("b", round, "HOLD: y"));
    }
    const opening = debate({ kind: "opening", participants: ["a", "b"], turns });
    expect(evaluateDebate(opening).action).toBe("continue");
    expect(MAX_OPENING_ROUNDS).toBeGreaterThan(MAX_DEBATE_ROUNDS);
  });
});

describe("prompts", () => {
  const member = { memberId: "qa-claude", roleLabel: "Reviewer", agentLabel: "Claude", rolePrompt: "You review." };

  it("asks for an independent opening position and forbids editing", () => {
    const prompt = buildOpeningDebatePrompt({
      taskPrompt: "fix the duplicate requests",
      member,
      others: [{ memberId: "impl-codex", roleLabel: "Implementer", agentLabel: "Codex" }],
      threadFile: ".pitwall/council/r1/thread.md",
      stanceFile: ".pitwall/council/r1/stance-1-qa-claude.md",
    });
    expect(prompt).toMatch(/impl-codex/);
    expect(prompt).toMatch(/do not defer/i);
    expect(prompt).toMatch(/do not edit any files/i);
  });

  it("shows the other positions and demands a marker", () => {
    const prompt = buildDebateRoundPrompt({
      debate: debate(),
      member,
      positions: [
        { memberId: "impl-codex", roleLabel: "Implementer", agentLabel: "Codex", summary: "memoize" },
        { memberId: "qa-claude", roleLabel: "Reviewer", agentLabel: "Claude", summary: "use a store" },
      ],
      round: 2,
      stanceFile: ".pitwall/council/r1/stance-2-qa-claude.md",
    });
    expect(prompt).toMatch(/impl-codex \(Implementer\) said: memoize/);
    expect(prompt).toMatch(new RegExp(`${AGREE_MARKER}: <member>`));
    expect(prompt).not.toMatch(/qa-claude \(Reviewer\) said/); // never quotes you to yourself
  });

  it("warns on the final round that it will be settled without them", () => {
    const prompt = buildDebateRoundPrompt({
      debate: debate(),
      member,
      positions: [],
      round: MAX_DEBATE_ROUNDS,
      stanceFile: "s.md",
    });
    expect(prompt).toMatch(/final round/i);
  });
});

describe("renderDebateRecord", () => {
  it("writes the dissent down rather than erasing it", () => {
    const d = debate({
      status: "ruled",
      turns: [turn("impl-codex", 1, "HOLD: memoize"), turn("qa-claude", 1, "HOLD: use a store")],
      outcome: { settledOn: "impl-codex", reason: "Conductor ruled for the simpler change.", dissenting: ["qa-claude"] },
    });
    const record = renderDebateRecord(d);
    expect(record).toMatch(/Round 1/);
    expect(record).toMatch(/impl-codex\*\* \(held\)/);
    expect(record).toMatch(/Unresolved:\*\* qa-claude did not accept this/);
  });
});

describe("summariseDebate", () => {
  it("says what the pane needs to show at a glance", () => {
    expect(summariseDebate(debate({ turns: [turn("a", 2, "HOLD: x")] }))).toMatch(/round 2 of 3/);
    expect(summariseDebate(debate({ status: "consensus" }))).toBe("Agreed");
    expect(summariseDebate(debate({ status: "escalated" }))).toMatch(/waiting on you/);
    expect(
      summariseDebate(debate({ status: "ruled", outcome: { reason: "r", dissenting: ["qa-claude"] } })),
    ).toMatch(/qa-claude dissented/);
  });
});

// ------------------------------------------------------------- the reducer

import {
  advanceDebate,
  debateSuppressesStallGuard,
  openDispute,
  pendingSpeakers,
  type DebateStep,
} from "./councilDebate";

const ROSTER = ["impl-codex", "qa-claude", "arch-gemini"];

const step = (over: {
  debate?: Debate | null;
  content: string;
  from: string;
}): DebateStep =>
  advanceDebate({ debate: over.debate ?? null, content: over.content, from: over.from, memberIds: ROSTER });

describe("openDispute", () => {
  it("opens against a named member and records the opener's own position", () => {
    const d = openDispute({
      content: "DISPUTE: qa-claude\nYour test asserts the old contract.",
      from: "impl-codex",
      memberIds: ROSTER,
    })!;
    expect(d.participants).toEqual(["impl-codex", "qa-claude"]);
    expect(d.turns).toHaveLength(1);
    expect(d.turns[0].memberId).toBe("impl-codex");
    expect(d.question).toMatch(/old contract/);
  });

  it("refuses a member arguing with itself", () => {
    expect(
      openDispute({ content: "DISPUTE: impl-codex\nwhatever", from: "impl-codex", memberIds: ROSTER }),
    ).toBeNull();
  });

  it("refuses a target that is not on the council", () => {
    expect(
      openDispute({ content: "DISPUTE: nobody\nwhatever", from: "impl-codex", memberIds: ROSTER }),
    ).toBeNull();
  });

  it("escalates stakes from the dispute body, not just the tag", () => {
    const d = openDispute({
      content: "DISPUTE: qa-claude [routine]\nThis needs a migration to backfill the column.",
      from: "impl-codex",
      memberIds: ROSTER,
    })!;
    expect(d.stakes).toBe("high");
  });
});

describe("advanceDebate", () => {
  it("does nothing for an ordinary handoff", () => {
    expect(step({ content: "TO: qa-claude\nover to you", from: "impl-codex" }).kind).toBe("none");
  });

  it("opens a dispute and hands the turn to the accused", () => {
    const result = step({ content: "DISPUTE: qa-claude\nthe test is wrong", from: "impl-codex" });
    expect(result).toMatchObject({ kind: "open", speaker: "qa-claude", round: 1 });
  });

  it("closes on consensus once the accused concedes", () => {
    const opened = step({ content: "DISPUTE: qa-claude\nthe test is wrong", from: "impl-codex" });
    if (opened.kind !== "open") throw new Error("expected open");
    const result = step({
      debate: opened.debate,
      content: "AGREE: impl-codex you're right, I'll update the assertion",
      from: "qa-claude",
    });
    expect(result).toMatchObject({ kind: "close", settledOn: "impl-codex" });
    expect(result.kind === "close" && result.debate.outcome?.dissenting).toEqual([]);
  });

  it("runs another round when they still disagree", () => {
    const opened = step({ content: "DISPUTE: qa-claude\nthe test is wrong", from: "impl-codex" });
    if (opened.kind !== "open") throw new Error("expected open");
    const result = step({ debate: opened.debate, content: "HOLD: the contract did change", from: "qa-claude" });
    expect(result).toMatchObject({ kind: "continue", round: 2 });
  });

  it("waits for the round to finish before judging it", () => {
    const three: Debate = debate({
      participants: ROSTER,
      turns: [turn("impl-codex", 1, "HOLD: a")],
    });
    expect(step({ debate: three, content: "HOLD: b", from: "qa-claude" })).toMatchObject({
      kind: "continue",
      speaker: "arch-gemini",
      round: 1,
    });
  });

  it("escalates a high-stakes deadlock to the user instead of ruling", () => {
    let current: Debate = debate({
      stakes: "high",
      participants: ["impl-codex", "qa-claude"],
      turns: [],
    });
    let last: DebateStep = { kind: "none" };
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round += 1) {
      last = step({ debate: current, content: "HOLD: migrate in place", from: "impl-codex" });
      if (last.kind === "continue" || last.kind === "open") current = last.debate;
      last = step({ debate: current, content: "HOLD: new table", from: "qa-claude" });
      if (last.kind === "continue" || last.kind === "open") current = last.debate;
    }
    expect(last.kind).toBe("escalate");
    expect(last.kind === "escalate" && last.record).toMatch(/Unresolved/);
  });

  it("rules a routine deadlock and records who was overruled", () => {
    let current: Debate = debate({ participants: ["impl-codex", "qa-claude"], turns: [] });
    let last: DebateStep = { kind: "none" };
    for (let round = 1; round <= MAX_DEBATE_ROUNDS; round += 1) {
      last = step({ debate: current, content: "HOLD: memoize", from: "impl-codex" });
      if (last.kind === "continue" || last.kind === "open") current = last.debate;
      last = step({ debate: current, content: "HOLD: use a store", from: "qa-claude" });
      if (last.kind === "continue" || last.kind === "open") current = last.debate;
    }
    expect(last.kind).toBe("close");
    expect(last.kind === "close" && last.debate.status).toBe("ruled");
    expect(last.kind === "close" && last.debate.outcome?.dissenting.length).toBeGreaterThan(0);
  });

  it("terminates — a debate cannot run forever", () => {
    // The guard the relay's anti-stall rule used to provide is now the round
    // limit's job, so it has to actually hold.
    let current: Debate | null = null;
    let content = "DISPUTE: qa-claude\nthe test is wrong";
    let from = "impl-codex";
    for (let i = 0; i < 50; i += 1) {
      const result = step({ debate: current, content, from });
      if (result.kind === "close" || result.kind === "escalate") return;
      if (result.kind === "none") throw new Error("debate dropped mid-argument");
      current = result.debate;
      from = result.speaker;
      content = "HOLD: still disagree";
    }
    throw new Error("debate never terminated");
  });
});

describe("debateSuppressesStallGuard", () => {
  it("stands the guard down only while a debate is actually open", () => {
    expect(debateSuppressesStallGuard(null)).toBe(false);
    expect(debateSuppressesStallGuard(debate({ status: "open" }))).toBe(true);
    expect(debateSuppressesStallGuard(debate({ status: "ruled" }))).toBe(false);
    expect(debateSuppressesStallGuard(debate({ status: "consensus" }))).toBe(false);
  });
});

describe("pendingSpeakers", () => {
  it("lists who still owes an answer this round, in roster order", () => {
    const d = debate({ participants: ROSTER, turns: [turn("qa-claude", 1, "HOLD: x")] });
    expect(pendingSpeakers(d, 1)).toEqual(["impl-codex", "arch-gemini"]);
    expect(pendingSpeakers(d, 2)).toEqual(ROSTER);
  });
});

// ---------------------------------------------------------- opening debate

describe("openOpeningDebate", () => {
  it("puts every member on the debate before any code exists", () => {
    const debate = openOpeningDebate({
      taskPrompt: "Add a /health endpoint returning the build SHA",
      memberIds: ["impl-codex", "qa-claude", "arch-gemini"],
    })!;
    expect(debate.kind).toBe("opening");
    expect(debate.status).toBe("open");
    expect(debate.participants).toEqual(["impl-codex", "qa-claude", "arch-gemini"]);
    // No turns yet: the whole roster owes a position, including whoever goes
    // first. Seeding a turn would let the first member set the approach by
    // default, which is the thing this exists to prevent.
    expect(debate.turns).toEqual([]);
    expect(pendingSpeakers(debate, 1)).toHaveLength(3);
  });

  it("refuses a one-member council instead of staging a monologue", () => {
    expect(openOpeningDebate({ taskPrompt: "Do the thing", memberIds: ["solo"] })).toBeNull();
    expect(openOpeningDebate({ taskPrompt: "Do the thing", memberIds: [] })).toBeNull();
  });

  it("reads the stakes from the task, since nobody has declared any", () => {
    const risky = openOpeningDebate({
      taskPrompt: "Migrate the production database schema and drop the legacy columns",
      memberIds: ["a", "b"],
    })!;
    expect(risky.stakes).toBe("high");
  });
});

describe("the opening debate runs to a conclusion", () => {
  const members = ["impl-codex", "qa-claude", "arch-gemini"];
  const advance = (debate: Debate | null, from: string, content: string) =>
    advanceDebate({ debate, content, from, memberIds: members });

  it("collects a position from every member before anyone answers", () => {
    let debate = openOpeningDebate({ taskPrompt: "Add a /health endpoint", memberIds: members })!;

    const first = advance(debate, "impl-codex", "I'd add the route in the existing server module.");
    expect(first.kind).toBe("continue");
    expect((first as any).round).toBe(1);
    expect((first as any).speaker).toBe("qa-claude");

    const second = advance((first as any).debate, "qa-claude", "I'd want a test before the route exists.");
    expect((second as any).speaker).toBe("arch-gemini");
    expect((second as any).round).toBe(1);

    // Round 1 closes with three unmarked positions, so it moves to round 2
    // rather than declaring a consensus nobody stated.
    const third = advance((second as any).debate, "arch-gemini", "I'd put it behind the existing health package.");
    expect(third.kind).toBe("continue");
    expect((third as any).round).toBe(2);
  });

  it("closes once the council converges in round 2", () => {
    let step: any = { debate: openOpeningDebate({ taskPrompt: "Add a /health endpoint", memberIds: members })! };
    for (const [member, text] of [
      ["impl-codex", "Route in the server module."],
      ["qa-claude", "Test first."],
      ["arch-gemini", "Health package."],
    ] as Array<[string, string]>) {
      step = advance(step.debate, member, text);
    }
    // Round 2: everyone lands on the architect's position.
    step = advance(step.debate, "impl-codex", "AGREE: arch-gemini\nThe package boundary is the right call.");
    step = advance(step.debate, "qa-claude", "AGREE: arch-gemini\nFine, as long as it is covered.");
    step = advance(step.debate, "arch-gemini", "HOLD: it is still the cleanest boundary.");

    expect(step.kind).toBe("close");
    expect(step.debate.status).toBe("consensus");
    expect(step.settledOn).toBe("arch-gemini");
    expect(step.debate.outcome.dissenting).toEqual([]);
  });

  it("terminates rather than debating forever when nobody moves", () => {
    // The failure this guards is a council that never starts work. Every member
    // holding its own line each round must still end.
    let step: any = { debate: openOpeningDebate({ taskPrompt: "Add a /health endpoint", memberIds: members })! };
    for (let exchange = 0; exchange < 60; exchange += 1) {
      const speaker = step.speaker ?? members[0];
      step = advance(step.debate, speaker, "HOLD: my approach is still the right one.");
      if (step.kind === "close" || step.kind === "escalate") break;
    }
    expect(["close", "escalate"]).toContain(step.kind);
    expect(step.debate.turns.length).toBeLessThanOrEqual(members.length * MAX_OPENING_ROUNDS);
  });

  it("escalates a high-stakes split to the user instead of letting the conductor rule", () => {
    let step: any = {
      debate: openOpeningDebate({
        taskPrompt: "Migrate the production database and drop the legacy columns",
        memberIds: ["a", "b"],
      })!,
    };
    const two = ["a", "b"];
    for (let exchange = 0; exchange < 40; exchange += 1) {
      const speaker = step.speaker ?? two[0];
      step = advanceDebate({ debate: step.debate, content: "HOLD: I still disagree.", from: speaker, memberIds: two });
      if (step.kind === "close" || step.kind === "escalate") break;
    }
    expect(step.kind).toBe("escalate");
  });
});

describe("buildOpeningDirective", () => {
  const settled = (outcome: any, turns: any[]): Debate => ({
    id: "opening",
    kind: "opening",
    question: "Add a /health endpoint",
    participants: ["impl-codex", "arch-gemini"],
    stakes: "routine",
    turns,
    status: "consensus",
    outcome,
  });

  it("tells the council to build what it just agreed, not its own alternative", () => {
    const directive = buildOpeningDirective(
      settled({ settledOn: "arch-gemini", reason: "", dissenting: [] }, [
        { memberId: "arch-gemini", round: 2, stance: { verdict: "hold", summary: "Put it behind the health package" }, body: "" },
      ]),
    );
    expect(directive).toMatch(/settled on arch-gemini's position: Put it behind the health package/);
    expect(directive).toMatch(/not your own alternative/i);
  });

  it("carries the dissent forward instead of erasing it", () => {
    // A council that overrules a member and says nothing is indistinguishable
    // from one that agreed.
    const directive = buildOpeningDirective(
      settled({ settledOn: "arch-gemini", reason: "", dissenting: ["impl-codex"] }, [
        { memberId: "arch-gemini", round: 3, stance: { verdict: "hold", summary: "Health package" }, body: "" },
      ]),
    );
    expect(directive).toMatch(/impl-codex disagreed and were overruled/);
    expect(directive).toMatch(/worth re-reading/);
  });

  it("says so plainly when nothing was settled", () => {
    const directive = buildOpeningDirective(settled({ reason: "", dissenting: [] }, []));
    expect(directive).toMatch(/did not converge/i);
  });
});

describe("isRestorableDebate", () => {
  const open = openOpeningDebate({ taskPrompt: "Add a /health endpoint", memberIds: ["a", "b", "c"] })!;

  it("restores an argument that is still resumable", () => {
    expect(isRestorableDebate(open, ["a", "b", "c"])).toBe(true);
  });

  it("drops one that is waiting on a member who did not survive the restart", () => {
    // Otherwise the relay waits forever for a turn nobody can take.
    expect(isRestorableDebate(open, ["a", "b"])).toBe(false);
  });

  it("drops anything that is not a live debate", () => {
    for (const value of [null, undefined, {}, "opening", 3, { kind: "opening" }]) {
      expect(isRestorableDebate(value, ["a", "b", "c"]), JSON.stringify(value)).toBe(false);
    }
    expect(isRestorableDebate({ ...open, status: "consensus" }, ["a", "b", "c"])).toBe(false);
    expect(isRestorableDebate({ ...open, kind: "argument" }, ["a", "b", "c"])).toBe(false);
    expect(isRestorableDebate({ ...open, participants: ["a"] }, ["a", "b", "c"])).toBe(false);
  });

  it("drops one whose turns are malformed rather than half-restoring", () => {
    expect(isRestorableDebate({ ...open, turns: [{ memberId: "a" }] }, ["a", "b", "c"])).toBe(false);
    expect(isRestorableDebate({ ...open, turns: "nope" }, ["a", "b", "c"])).toBe(false);
  });
});

describe("abandonDebate", () => {
  it("closes an open debate with a record that says it was cut short, not settled", () => {
    const debate = openOpeningDebate({ taskPrompt: "Add a /health endpoint", memberIds: ["impl-codex", "qa-claude"] })!;
    const { debate: closed, record } = abandonDebate(debate, "qa-claude did not answer round 1.");
    expect(closed.status).not.toBe("open");
    expect(debateSuppressesStallGuard(closed)).toBe(false);
    expect(record).toMatch(/cut short/i);
    expect(record).toContain("qa-claude did not answer round 1.");
    expect(record).not.toMatch(/Settled on/);
  });
});
