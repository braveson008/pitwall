import { describe, expect, it } from "vitest";
import { MIN_FIRST_TIME_RATE, chooseImplementer, classifyRequest, type Candidate } from "./routing";
import { summarise, type AttemptOutcome } from "./modelHistory";

const cheap: Candidate = { provider: "codex", model: "mini", relativeCost: 1, local: false, drivable: true };
const premium: Candidate = { provider: "claude", model: "opus", relativeCost: 30, local: false, drivable: true };
const local: Candidate = { provider: "", model: "qwen3-coder", relativeCost: 0, local: true, drivable: true };

const outcome = (over: Partial<AttemptOutcome> = {}): AttemptOutcome => ({
  projectId: "p1", provider: "codex", model: "mini", riskLevel: "normal",
  passed: true, rounds: 1, at: "2026-08-28T20:00:00Z", ...over,
});

const proven = summarise(Array.from({ length: 5 }, () => outcome()));
const poor = summarise(Array.from({ length: 5 }, (_, i) => outcome({ passed: i === 0, rounds: i === 0 ? 1 : 3 })));

describe("chooseImplementer", () => {
  it("takes the cheapest model with a record good enough to trust", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: proven, policy: "cheapest", riskLevel: "normal",
    });
    expect(choice.candidate?.model).toBe("mini");
    expect(choice.reason).toContain("5 of 5");
  });

  // A model that clears review half the time costs two implementations and
  // two premium reviews. That is not cheap.
  it("skips a cheap model that has measurably failed here", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: poor, policy: "cheapest", riskLevel: "normal",
    });
    expect(choice.candidate?.model).toBe("opus");
    // The sentence has to say what happened: a cheaper model was passed over
    // for its record, not simply absent.
    expect(choice.reason).toContain("Cheaper models have not cleared review here");
  });

  // How the record gets made in the first place.
  it("tries an unmeasured cheap model once on ordinary work", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: [], policy: "cheapest", riskLevel: "normal",
    });
    expect(choice.candidate?.model).toBe("mini");
    expect(choice.speculative).toBe(true);
  });

  // Risk raises the bar on evidence rather than forcing a model — but with no
  // evidence at all, high risk does not gamble.
  it("does not guess on high-risk work", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: [], policy: "cheapest", riskLevel: "high",
    });
    expect(choice.candidate?.model).toBe("opus");
    expect(choice.speculative).toBe(false);
  });

  it("still uses a cheap model on high-risk work when it has earned it", () => {
    const records = summarise(Array.from({ length: 5 }, () => outcome({ riskLevel: "high" })));
    const choice = chooseImplementer({
      candidates: [premium, cheap], records, policy: "cheapest", riskLevel: "high",
    });
    expect(choice.candidate?.model).toBe("mini");
  });

  // The user's decision, which no measurement overrules.
  it("keeps a local-only project local, whatever the evidence says", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap, local], records: proven, policy: "local-only", riskLevel: "normal",
    });
    expect(choice.candidate?.local).toBe(true);
  });

  it("says plainly when local-only leaves nothing to run", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: proven, policy: "local-only", riskLevel: "normal",
    });
    expect(choice.candidate).toBeNull();
    expect(choice.reason).toContain("may not leave the machine");
  });

  it("honours a project that always wants its strongest model", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: poor, policy: "always-premium", riskLevel: "trivial",
    });
    expect(choice.candidate?.model).toBe("opus");
  });

  // A rejection is evidence about the model that was rejected.
  it("sends a fix to the strongest model rather than retrying the same one", () => {
    const choice = chooseImplementer({
      candidates: [premium, cheap], records: proven, policy: "cheapest", riskLevel: "normal", escalate: true,
    });
    expect(choice.candidate?.model).toBe("opus");
    expect(choice.reason).toContain("rejected");
  });

  it("ignores models Pitwall cannot actually start", () => {
    const choice = chooseImplementer({
      candidates: [{ ...cheap, drivable: false }, premium], records: proven, policy: "cheapest", riskLevel: "normal",
    });
    expect(choice.candidate?.model).toBe("opus");
  });

  it("says so rather than choosing nothing silently", () => {
    const choice = chooseImplementer({ candidates: [], records: [], policy: "cheapest", riskLevel: "normal" });
    expect(choice.candidate).toBeNull();
    expect(choice.reason).toContain("No agent is installed");
  });

  it("uses the threshold it documents", () => {
    expect(MIN_FIRST_TIME_RATE).toBe(0.5);
  });
});

describe("classifyRequest", () => {
  // Wrong upward costs one architect; wrong downward sends a migration to a
  // cheap model with no contract.
  it("treats anything touching security as high risk", () => {
    for (const request of [
      "Fix the authentication redirect",
      "Add a permissions check to the admin route",
      "Migrate the sessions schema",
      "Handle the race condition in the queue",
      "Store the API token",
    ]) {
      expect(classifyRequest(request)).toBe("high");
    }
  });

  it("treats a small wording change as trivial", () => {
    expect(classifyRequest("Fix the typo in the welcome copy", 1)).toBe("trivial");
    expect(classifyRequest("Bump the changelog", 1)).toBe("trivial");
  });

  // "Rename the auth cookie" reads trivial and is not.
  it("does not let a trivial word downgrade a risky change", () => {
    expect(classifyRequest("Rename the auth cookie", 1)).toBe("high");
  });

  it("raises anything touching many files", () => {
    expect(classifyRequest("Tidy up the imports", 20)).toBe("high");
  });

  it("calls ordinary work ordinary", () => {
    expect(classifyRequest("Add an endpoint for archiving projects", 3)).toBe("normal");
    expect(classifyRequest("")).toBe("normal");
  });
});
