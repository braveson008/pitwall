import { describe, expect, it } from "vitest";
import {
  buildThread,
  buildTurnStrip,
  isLongMessage,
  memberAgent,
  memberLabel,
  summariseMessage,
  type RouteRecord,
} from "./councilThread";
import type { CouncilRelayMember, CouncilThreadMessage } from "./councilRelay";

const members = [
  { sessionId: "c1", memberId: "architect-claude", rolePrompt: "", roleLabel: "Architect", agentLabel: "Claude 1", writesCode: false },
  { sessionId: "c2", memberId: "implementer-codex", rolePrompt: "", roleLabel: "Implementer", agentLabel: "Codex", writesCode: true },
  { sessionId: "c3", memberId: "qa-claude", rolePrompt: "", roleLabel: "Reviewer / QA", agentLabel: "Claude 2", writesCode: false },
] as CouncilRelayMember[];

const said = (turn: number, from: string, content: string, extra: Partial<CouncilThreadMessage> = {}) =>
  ({ turn, fromMemberId: from, toMemberId: null, content, ...extra }) as CouncilThreadMessage;

const routed = (turn: number, from: string, to: string, reason = ""): RouteRecord =>
  ({ turn, fromMemberId: from, toMemberId: to, source: "conductor", reason, directive: "" });

describe("buildThread", () => {
  it("keeps a turn's messages before the decision that ended it", () => {
    const thread = buildThread(
      [said(1, "architect-claude", "Here is my approach.")],
      [routed(1, "architect-claude", "implementer-codex")],
    );
    expect(thread.map((entry) => entry.kind)).toEqual(["said", "routed"]);
  });

  it("orders across turns, not by kind", () => {
    const thread = buildThread(
      [said(2, "implementer-codex", "Built it."), said(1, "architect-claude", "Approach.")],
      [routed(1, "architect-claude", "implementer-codex"), routed(2, "implementer-codex", "qa-claude")],
    );
    expect(thread.map((entry) => `${entry.turn}:${entry.kind}`)).toEqual([
      "1:said",
      "1:routed",
      "2:said",
      "2:routed",
    ]);
  });

  it("keeps several messages in one turn in arrival order", () => {
    const thread = buildThread(
      [said(1, "architect-claude", "first"), said(1, "qa-claude", "second")],
      [],
    );
    expect(thread.map((entry) => (entry.kind === "said" ? entry.content : ""))).toEqual(["first", "second"]);
  });

  it("carries the author through, so a ruling is not read as a member's opinion", () => {
    const thread = buildThread([said(1, "council", "Debate settled: take approach B.", { author: "council" })], []);
    expect(thread[0].kind === "said" && thread[0].author).toBe("council");
  });

  it("defaults an unlabelled message to a member", () => {
    const thread = buildThread([said(1, "architect-claude", "x")], []);
    expect(thread[0].kind === "said" && thread[0].author).toBe("member");
  });

  it("copes with an empty council", () => {
    expect(buildThread([], [])).toEqual([]);
  });

  it("gives every entry a distinct key", () => {
    const thread = buildThread(
      [said(1, "a", "one"), said(1, "a", "two")],
      [routed(1, "a", "b"), routed(1, "a", "b")],
    );
    expect(new Set(thread.map((entry) => entry.key)).size).toBe(thread.length);
  });
});

describe("memberLabel", () => {
  it("uses the role, not the addressing handle", () => {
    expect(memberLabel(members, "implementer-codex")).toBe("Implementer");
  });

  it("falls back to the handle for a member that has left", () => {
    expect(memberLabel(members, "ghost")).toBe("ghost");
  });

  it("returns nothing for no member", () => {
    expect(memberLabel(members, null)).toBe("");
  });

  it("reports the agent separately", () => {
    expect(memberAgent(members, "implementer-codex")).toBe("Codex");
  });
});

describe("buildTurnStrip", () => {
  it("lists where the work has been, in order", () => {
    const strip = buildTurnStrip(
      [routed(1, "", "architect-claude"), routed(2, "architect-claude", "implementer-codex")],
      "implementer-codex",
      2,
    );
    expect(strip.map((stop) => stop.memberId)).toEqual(["architect-claude", "implementer-codex"]);
  });

  it("marks where the work is now", () => {
    const strip = buildTurnStrip([routed(1, "", "architect-claude")], "architect-claude", 1);
    expect(strip.filter((stop) => stop.current)).toHaveLength(1);
    expect(strip[strip.length - 1].current).toBe(true);
  });

  it("shows the member holding the turn even before a route records it", () => {
    const strip = buildTurnStrip([], "architect-claude", 1);
    expect(strip).toEqual([{ turn: 1, memberId: "architect-claude", current: true }]);
  });

  it("collapses a re-route to the same member inside one turn", () => {
    const strip = buildTurnStrip(
      [routed(1, "", "architect-claude"), routed(1, "", "architect-claude")],
      null,
      1,
    );
    expect(strip).toHaveLength(1);
  });

  it("keeps a member that genuinely takes two turns in a row", () => {
    const strip = buildTurnStrip(
      [routed(1, "", "implementer-codex"), routed(2, "qa-claude", "implementer-codex")],
      null,
      2,
    );
    expect(strip).toHaveLength(2);
  });

  it("ignores a route with no destination", () => {
    expect(buildTurnStrip([routed(1, "a", "")], null, 1)).toEqual([]);
  });

  it("is empty for a council that has not started", () => {
    expect(buildTurnStrip([], null, 0)).toEqual([]);
  });
});

describe("summariseMessage", () => {
  it("uses the opening heading when it says something", () => {
    expect(summariseMessage("## Why the mapping layer\n\nBecause…")).toBe("Why the mapping layer");
  });

  it("skips the boilerplate stage heading the card already shows", () => {
    const content = "# Stage 1 — Architect\n\n**Ticket:** WEB-903\n\nCollapse the markers at the mapping layer.";
    expect(summariseMessage(content)).toBe("Ticket: WEB-903");
  });

  it("skips rules and blank lines", () => {
    expect(summariseMessage("\n\n---\n\nThe real first line.")).toBe("The real first line.");
  });

  it("strips list markers and inline markup", () => {
    expect(summariseMessage("- **Done:** shipped `analyzeAllMarkers`")).toBe("Done: shipped analyzeAllMarkers");
  });

  it("truncates a very long opening line", () => {
    const summary = summariseMessage("x".repeat(400));
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("returns nothing for an empty message", () => {
    expect(summariseMessage("   \n\n  ")).toBe("");
  });
});

describe("isLongMessage", () => {
  it("folds a document", () => {
    expect(isLongMessage(Array.from({ length: 40 }, () => "line").join("\n"))).toBe(true);
  });

  it("leaves a short remark alone", () => {
    expect(isLongMessage("Agreed — add that case before handing off.")).toBe(false);
  });

  it("folds a single very long paragraph", () => {
    expect(isLongMessage("word ".repeat(300))).toBe(true);
  });
});
