import { describe, expect, it } from "vitest";
import { applySwap, planSwap, swapMessage, swapNotice } from "./councilSwap";
import type { CouncilRelayMember } from "./councilRelay";

const member = (over: Partial<CouncilRelayMember> = {}): CouncilRelayMember => ({
  sessionId: "s-qa",
  memberId: "qa-claude",
  rolePrompt: "You are the QA Reviewer.",
  roleLabel: "Reviewer / QA",
  agentLabel: "claude",
  writesCode: false,
  ...over,
});

const roster = [
  member({ sessionId: "s-impl", memberId: "implementer-codex", roleLabel: "Implementer", agentLabel: "codex", writesCode: true }),
  member(),
];

const context = { members: roster, currentMemberId: "implementer-codex", turn: 4 };

describe("planSwap", () => {
  it("plans a swap and keeps the seat's handle", () => {
    const result = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "Auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The whole design: thread.md is already full of "TO: qa-claude".
    expect(result.plan.memberId).toBe("qa-claude");
    expect(result.plan.fromAgent).toBe("claude");
    expect(result.plan.toAgent).toBe("codex");
    expect(result.plan.holdsTurn).toBe(false);
  });

  it("says when the seat being swapped is the one holding the turn", () => {
    const result = planSwap(context, { sessionId: "s-impl", agent: "claude", model: "Auto" });
    expect(result.ok && result.plan.holdsTurn).toBe(true);
  });

  it("refuses a pane that is not in this council", () => {
    const result = planSwap(context, { sessionId: "s-nobody", agent: "codex", model: "" });
    expect(result).toEqual({ ok: false, reason: "That pane is not part of a council." });
  });

  it("refuses to swap an agent for itself", () => {
    // It is not free: the replacement boots a CLI and loses the turn.
    const result = planSwap(context, { sessionId: "s-qa", agent: "Claude", model: "" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("already running on Claude");
  });

  it("still allows the same agent on a different model", () => {
    expect(planSwap(context, { sessionId: "s-qa", agent: "claude", model: "opus" }).ok).toBe(true);
  });

  it("refuses to empty a council down to one member", () => {
    const solo = { ...context, members: [roster[1]] };
    const result = planSwap(solo, { sessionId: "s-qa", agent: "codex", model: "" });
    expect(result.ok === false && result.reason).toContain("at least two members");
  });

  it("still allows a swap once the council has stopped", () => {
    // A stalled council is the main reason to reach for this: a member whose
    // CLI will not start is repaired by putting a different agent in the seat.
    // Refusing here blocked the fix at the moment it was wanted.
    expect(planSwap({ ...context, stopped: true }, { sessionId: "s-qa", agent: "codex", model: "" }).ok).toBe(true);
  });

  it("refuses with no agent chosen", () => {
    expect(planSwap(context, { sessionId: "s-qa", agent: "", model: "" }).ok).toBe(false);
  });
});

describe("applySwap", () => {
  it("changes only who is in the seat", () => {
    const plan = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "Auto" });
    if (!plan.ok) throw new Error("expected a plan");
    const next = applySwap(roster, plan.plan, "s-qa-2");
    const swapped = next.find((item) => item.memberId === "qa-claude")!;
    expect(swapped.sessionId).toBe("s-qa-2");
    expect(swapped.agentLabel).toBe("codex");
    // The seat's job is unchanged — that is what makes this a substitution.
    expect(swapped.roleLabel).toBe("Reviewer / QA");
    expect(swapped.rolePrompt).toBe(roster[1].rolePrompt);
    expect(swapped.writesCode).toBe(false);
  });

  it("leaves every other member exactly as it was", () => {
    const plan = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "Auto" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(applySwap(roster, plan.plan, "s-qa-2")[0]).toEqual(roster[0]);
  });
});

describe("swapNotice", () => {
  it("records the handover so the thread does not silently change reviewer", () => {
    const plan = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "gpt-5" });
    if (!plan.ok) throw new Error("expected a plan");
    const notice = swapNotice(plan.plan);
    expect(notice).toContain("claude handed it to codex");
    expect(notice).toContain("gpt-5");
    expect(notice).toContain("`qa-claude`");
    expect(notice).toContain("still stands");
    // Nothing was in progress in this seat, so nothing to warn about.
    expect(notice).not.toContain("unfinished");
  });

  it("warns the replacement when it inherits a turn already underway", () => {
    const plan = planSwap(context, { sessionId: "s-impl", agent: "claude", model: "Auto" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(swapNotice(plan.plan)).toContain("unfinished");
  });

  it("leaves an unspecified model out rather than writing (Auto)", () => {
    const plan = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(swapNotice(plan.plan)).not.toContain("Auto");
  });
});

describe("swapMessage", () => {
  it("is addressed to the seat, and attributed to the user who made the call", () => {
    const plan = planSwap(context, { sessionId: "s-qa", agent: "codex", model: "Auto" });
    if (!plan.ok) throw new Error("expected a plan");
    const message = swapMessage(plan.plan, "user");
    expect(message.toMemberId).toBe("qa-claude");
    expect(message.fromMemberId).toBe("user");
    expect(message.author).toBe("user");
    expect(message.turn).toBe(4);
  });
});
