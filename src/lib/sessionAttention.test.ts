import { describe, expect, it } from "vitest";
import type { AgentSession } from "../data";
import { QUIET_AFTER_MS, attentionDuration, formatDuration, readSessionAttention } from "./sessionAttention";

const NOW = 1_700_000_000_000;
const session = (over: Partial<AgentSession> = {}): AgentSession =>
  ({ id: "s1", name: "a session", agent: "Claude", status: "running", logs: [], ...over }) as AgentSession;
const activity = (lastAt: number, busySince = lastAt - 60_000) => ({ chunks: 10, firstAt: lastAt - 60_000, lastAt, busySince });

describe("readSessionAttention", () => {
  it("puts a session that asked a question above everything", () => {
    // The only state where the work cannot continue without you.
    const attention = readSessionAttention(session(), activity(NOW), NOW, { waiting: true, attached: true });
    expect(attention).toMatchObject({ level: "needs-you", label: "Waiting on you" });
  });

  it("still says a failed session failed", () => {
    expect(readSessionAttention(session({ status: "failed" }), activity(NOW), NOW, { attached: true }).level).toBe("failed");
  });

  it("marks a working session that has gone silent", () => {
    // The signal nothing showed before: an agent that is working produces
    // output continuously, so a long gap means finished, wedged, or waiting on
    // something it cannot ask for.
    const attention = readSessionAttention(session(), activity(NOW - 4 * 60_000), NOW, { attached: true });
    expect(attention.level).toBe("quiet");
    expect(attention.label).toBe("Quiet");
    // The label names the state, the duration says how long — never both.
    expect(attentionDuration(attention)).toBe(4 * 60_000);
  });

  it("leaves a session that is producing output alone", () => {
    const attention = readSessionAttention(session(), activity(NOW - 5_000), NOW, { attached: true });
    expect(attention).toMatchObject({ level: "working", label: "Working" });
  });

  it("believes the pane over recent output", () => {
    // A CLI at its prompt redraws its status bar, so output alone looks busy.
    const atPrompt = readSessionAttention(session(), activity(NOW - 1_000), NOW, { attached: true, busy: false });
    expect(atPrompt.level).toBe("quiet");
    expect(attentionDuration(atPrompt)).toBeNull();
    const midTurn = readSessionAttention(session(), activity(NOW - 4 * 60_000), NOW, { attached: true, busy: true });
    expect(midTurn.level).toBe("working");
    // A question still outranks what the pane says.
    expect(readSessionAttention(session(), activity(NOW), NOW, { attached: true, busy: false, waiting: true }).level).toBe("needs-you");
  });

  it("does not call a session quiet until it has been quiet a while", () => {
    const justUnder = readSessionAttention(session(), activity(NOW - QUIET_AFTER_MS + 1), NOW, { attached: true });
    const justOver = readSessionAttention(session(), activity(NOW - QUIET_AFTER_MS), NOW, { attached: true });
    expect(justUnder.level).toBe("working");
    expect(justOver.level).toBe("quiet");
  });

  it("says when a session has no CLI behind it", () => {
    expect(readSessionAttention(session(), undefined, NOW, { attached: false }).level).toBe("idle");
  });

  it("says when a session has finished", () => {
    expect(readSessionAttention(session({ status: "completed" }), activity(NOW), NOW, { attached: true }).level).toBe("done");
  });
});


describe("formatDuration", () => {
  it("says a duration the way a person would", () => {
    expect(formatDuration(40_000)).toBe("40s");
    expect(formatDuration(4 * 60_000)).toBe("4m");
    expect(formatDuration(72 * 60_000)).toBe("1h 12m");
    expect(formatDuration(60 * 60_000)).toBe("1h");
  });
});

describe("attentionDuration", () => {
  it("measures a working session by how long it has been going", () => {
    // Not by time since its last chunk: a working agent produces output
    // constantly, so that number sits at zero and flickers.
    const attention = readSessionAttention(session(), activity(NOW - 500, NOW - 67_000), NOW, { attached: true });
    expect(attention.level).toBe("working");
    expect(formatDuration(attentionDuration(attention)!)).toBe("1m");
  });

  it("measures a quiet session by how long it has been silent", () => {
    const attention = readSessionAttention(session(), activity(NOW - 4 * 60_000), NOW, { attached: true });
    expect(attentionDuration(attention)).toBe(4 * 60_000);
  });

  it("says how long an answer has been owed", () => {
    const attention = readSessionAttention(session(), activity(NOW - 3 * 60_000), NOW, { waiting: true, attached: true });
    expect(attention.level).toBe("needs-you");
    expect(attentionDuration(attention)).toBe(3 * 60_000);
  });

  it("shows nothing for states where no clock is meaningful", () => {
    for (const status of ["completed", "failed"] as const) {
      expect(attentionDuration(readSessionAttention(session({ status }), activity(NOW), NOW, { attached: true }))).toBeNull();
    }
    expect(attentionDuration(readSessionAttention(session(), undefined, NOW, { attached: false }))).toBeNull();
  });
});
