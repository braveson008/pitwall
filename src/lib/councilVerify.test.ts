import { describe, expect, it } from "vitest";
import {
  MAX_VERIFICATION_ROUNDS,
  NOT_VERIFIED_MARKER,
  VERIFIED_MARKER,
  buildRemediationDirective,
  buildVerificationPrompt,
  chooseVerifier,
  parseVerificationVerdict,
  summariseVerification,
} from "./councilVerify";
import type { CouncilRelayMember } from "./councilRelay";

const member = (memberId: string, roleLabel: string): CouncilRelayMember =>
  ({ memberId, roleLabel, agentLabel: "Claude", rolePrompt: "You do things.", sessionId: `s-${memberId}` }) as CouncilRelayMember;

const ROSTER = [
  member("impl-codex", "Implementer"),
  member("qa-claude", "Reviewer / QA"),
  member("arch-gemini", "Architect"),
];

describe("parseVerificationVerdict", () => {
  it("reads a pass", () => {
    expect(parseVerificationVerdict("VERIFIED\n\nAll three endpoints exist and the tests cover them.")).toMatchObject({
      verified: true,
      gaps: [],
    });
  });

  it("reads a fail and collects the gaps as work items", () => {
    const verdict = parseVerificationVerdict(
      `${NOT_VERIFIED_MARKER}\n- The /health endpoint was never added\n- Tests do not cover the error path\n`,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.gaps).toEqual([
      "The /health endpoint was never added",
      "Tests do not cover the error path",
    ]);
  });

  it("treats a missing verdict as not verified", () => {
    // The asymmetry is the whole point: a gate that can be talked past by an
    // enthusiastic summary is not a gate.
    for (const content of [
      "",
      "Looks good to me!",
      "I think this satisfies the request, nice work.",
      "The implementation is complete and well structured.",
    ]) {
      expect(parseVerificationVerdict(content).verified, JSON.stringify(content)).toBe(false);
    }
  });

  it("does not read NOT-VERIFIED as VERIFIED", () => {
    // Substring hazard: NOT-VERIFIED contains VERIFIED.
    expect(parseVerificationVerdict("NOT-VERIFIED\n- missing thing").verified).toBe(false);
    expect(parseVerificationVerdict("not-verified").verified).toBe(false);
  });

  it("tolerates a markdown heading", () => {
    expect(parseVerificationVerdict("## VERIFIED\n\nfine").verified).toBe(true);
  });
});

describe("chooseVerifier", () => {
  it("never lets the member who just worked check its own work", () => {
    const chosen = chooseVerifier(ROSTER, "qa-claude");
    expect(chosen?.memberId).not.toBe("qa-claude");
  });

  it("prefers a reviewing role when one is free", () => {
    expect(chooseVerifier(ROSTER, "impl-codex")?.memberId).toBe("qa-claude");
  });

  it("falls back to anyone else when there is no reviewer", () => {
    const pair = [member("impl-codex", "Implementer"), member("arch-gemini", "Architect")];
    expect(chooseVerifier(pair, "impl-codex")?.memberId).toBe("arch-gemini");
  });

  it("returns null on a one-member council rather than self-verifying", () => {
    expect(chooseVerifier([member("solo", "Implementer")], "solo")).toBeNull();
  });
});

describe("buildVerificationPrompt", () => {
  const base = {
    task: { title: "Add a /health endpoint", description: "It should return 200 and the build SHA." },
    member: ROSTER[1],
    threadFile: ".braveli/council/r1/thread.md",
    verdictFile: ".braveli/council/r1/verify-1.md",
    attempt: 1,
  };

  it("gives the verifier the original task, not the council's retelling", () => {
    const prompt = buildVerificationPrompt({ ...base, evidence: null });
    expect(prompt).toContain("Add a /health endpoint");
    expect(prompt).toContain("It should return 200 and the build SHA.");
    expect(prompt).toMatch(/original request, not against the council's account/i);
  });

  it("scopes it to the gap, not to a code review", () => {
    const prompt = buildVerificationPrompt({ ...base, evidence: null });
    expect(prompt).toMatch(/Do not review style, suggest improvements/i);
    expect(prompt).toMatch(new RegExp(`${VERIFIED_MARKER}`));
    expect(prompt).toMatch(new RegExp(`${NOT_VERIFIED_MARKER}`));
  });

  it("says so when the tree is untouched — a suspicious way to finish", () => {
    const prompt = buildVerificationPrompt({
      ...base,
      evidence: { changedPaths: [], dirtyPaths: [], claimedWithoutChanges: true },
    });
    expect(prompt).toMatch(/no changes against HEAD, which is itself worth explaining/i);
  });

  it("reports a failing suite to the verifier", () => {
    const prompt = buildVerificationPrompt({
      ...base,
      evidence: {
        changedPaths: ["src/a.ts"],
        dirtyPaths: ["src/a.ts"],
        claimedWithoutChanges: false,
        tests: { command: "npm test", passed: false, output: "1 failing" },
      },
    });
    expect(prompt).toMatch(/npm test.*FAILED/);
  });

  it("tells a second attempt to check the previous gaps specifically", () => {
    const prompt = buildVerificationPrompt({ ...base, evidence: null, attempt: 2 });
    expect(prompt).toMatch(/verification attempt 2/i);
    expect(prompt).toMatch(/gaps raised then were closed/i);
  });
});

describe("buildRemediationDirective", () => {
  it("hands the gaps back as numbered work, not as commentary", () => {
    const directive = buildRemediationDirective({
      verified: false,
      gaps: ["Add the /health route", "Cover the 500 path"],
      summary: "not done",
    });
    expect(directive).toMatch(/\(1\) Add the \/health route/);
    expect(directive).toMatch(/\(2\) Cover the 500 path/);
  });

  it("still says something useful when the verifier listed no bullets", () => {
    const directive = buildRemediationDirective({
      verified: false,
      gaps: [],
      summary: "NOT-VERIFIED the endpoint is missing",
    });
    expect(directive).toMatch(/endpoint is missing/);
  });
});

describe("summariseVerification", () => {
  it("says what the council bar needs at a glance", () => {
    expect(summariseVerification(null, 1)).toMatch(/Verifying \(attempt 1\)/);
    expect(summariseVerification({ verified: true, gaps: [], summary: "" }, 1)).toMatch(/Verified/);
    expect(summariseVerification({ verified: false, gaps: ["a", "b"], summary: "" }, 1)).toMatch(/2 gaps/);
    expect(summariseVerification({ verified: false, gaps: ["a"], summary: "" }, 1)).toMatch(/1 gap\b/);
  });
});

describe("the gate is bounded", () => {
  it("stops asking after a fixed number of rounds", () => {
    // Without a ceiling a council and its verifier can ping-pong forever, which
    // is the same failure the relay's turn limit exists to prevent.
    expect(MAX_VERIFICATION_ROUNDS).toBeGreaterThan(0);
    expect(MAX_VERIFICATION_ROUNDS).toBeLessThanOrEqual(3);
  });
});
