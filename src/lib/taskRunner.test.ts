import { describe, expect, it } from "vitest";
import {
  decide,
  startRun,
  withAttempt,
  withAttemptFinished,
  withContract,
  withReport,
  withValidation,
  type RunnerInputs,
} from "./taskRunner";
import { parseContract, architectContext, contractFile } from "./contractDraft";
import { parseVerdict, toReport, toFixContract } from "./qaVerdict";
import type { ImplementationContract, TaskRun, ValidationResult } from "../domain/contracts";

const AT = "2026-08-29T10:00:00.000Z";

const contract: ImplementationContract = {
  id: "c1",
  taskId: "t1",
  projectId: "p1",
  task: "Rate limit the public API",
  objective: "Stop one caller exhausting the API for everyone.",
  affectedFiles: ["src/api/limit.ts"],
  requiredChanges: ["Add a token bucket per API key"],
  constraints: ["Do not change the auth middleware"],
  acceptanceCriteria: ["A key over its limit gets a 429"],
  requiredTests: ["A test for the 429 path"],
  forbiddenChanges: [],
  assumptions: [],
  riskLevel: "normal",
  architectModel: "opus",
  architectProvider: "claude",
  createdAt: AT,
};

const passing: ValidationResult = { ok: true, checks: [], ranAt: AT };
const failing: ValidationResult = {
  ok: false,
  checks: [{ name: "typecheck", command: "tsc", ok: false, output: "TS2345", skipped: false, durationMs: 10 }],
  ranAt: AT,
};

const cheap = { provider: "" as const, model: "qwen3-coder:30b", relativeCost: 0, local: true, drivable: true };
const premium = { provider: "claude" as const, model: "opus", relativeCost: 3, local: false, drivable: true };

const inputs = (run: TaskRun, over: Partial<RunnerInputs> = {}): RunnerInputs => ({
  run,
  request: "Rate limit the public API",
  candidates: [cheap, premium],
  records: [],
  policy: "cheapest",
  reviewer: { provider: "claude", model: "opus" },
  architect: { provider: "claude", model: "opus" },
  ...over,
});

const attemptOn = (run: TaskRun, id = "a1") =>
  withAttempt(run, {
    id,
    contractId: "c1",
    provider: "",
    model: "qwen3-coder:30b",
    role: "implementation",
    sessionId: `s-${id}`,
    startedAt: AT,
  });

describe("decide", () => {
  it("sends a new run to the architect first", () => {
    const action = decide(inputs(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT })));
    expect(action.kind).toBe("start-session");
    if (action.kind !== "start-session") throw new Error("unreachable");
    expect(action.stage).toBe("architect");
    // The architect must be told where to put the contract, or nothing
    // downstream can find it.
    expect(action.outputFile).toBe(contractFile("r1"));
  });

  it("skips the architect for trivial work and implements from the request", () => {
    const run = startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "trivial", at: AT });
    const action = decide(inputs(run, { request: "Fix the typo in the README" }));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("implement");
    // Paying for a planning stage to plan a typo costs more than the typo.
    expect(action.prompt).toContain("Fix the typo in the README");
  });

  it("still reviews trivial work, against the request", () => {
    // The loop holds that nothing reaches "passed" without a verdict. Small
    // enough to skip planning is not the same as certainly correct.
    let run = startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "trivial", at: AT });
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const action = decide(inputs(run, { request: "Fix the typo", diff: "d" }));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("review");
    expect(action.prompt).toContain("Fix the typo");
  });

  it("implements once a contract exists", () => {
    let run = startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT });
    run = withContract(run, contract, AT);
    const action = decide(inputs(run));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("implement");
    // Cheapest first, and said to be a guess because nothing is measured yet.
    expect(action.model).toBe("qwen3-coder:30b");
    expect(action.speculative).toBe(true);
  });

  it("will not start a second session while one is running", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = attemptOn(run);
    expect(decide(inputs(run)).kind).toBe("blocked");
  });

  it("runs the checks before asking anyone to review", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withAttemptFinished(attemptOn(run), "a1", AT);
    const action = decide(inputs(run));
    expect(action.kind).toBe("run-validation");
  });

  it("sends failing checks back to the implementer, not to a reviewer", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", failing);
    const action = decide(inputs(run));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("implement");
    // The errors, not another copy of the contract it has already read.
    expect(action.prompt).toContain("TS2345");
    expect(action.prompt).not.toContain("Stop one caller exhausting");
  });

  it("reviews once the checks pass", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const action = decide(inputs(run, { diff: "diff --git a/x b/x" }));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("review");
    expect(action.model).toBe("opus");
    expect(action.prompt).toContain("A key over its limit gets a 429");
  });

  it("never shows the reviewer how the implementation went", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const action = decide(inputs(run, { diff: "d" }));
    if (action.kind !== "start-session") throw new Error("expected a session");
    // A reviewer told why the implementer believes it is correct is being
    // asked to agree rather than to check.
    expect(action.prompt).not.toMatch(/qwen3-coder|implementer (said|reported|believes)/i);
  });

  it("stops rather than looping when the contract itself was wrong", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const parsed = parseVerdict("VERDICT: FAIL\nCRITICAL: wrong approach\nCONTRACT-WRONG: yes");
    const report = toReport({ parsed, contractId: "c1", qaModel: "opus", qaProvider: "claude", id: "q1", createdAt: AT });
    run = withReport(run, report);
    expect(run.stage).toBe("architecture-escalation");
    const action = decide(inputs(run));
    expect(action.kind).toBe("blocked");
  });

  it("escalates the fix to a stronger model after a rejection", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const parsed = parseVerdict("VERDICT: FAIL\nCRITICAL: the 429 path is untested\nFIX: add the test");
    const report = toReport({ parsed, contractId: "c1", qaModel: "opus", qaProvider: "claude", id: "q1", createdAt: AT });
    const fix = toFixContract({ report, contract, id: "f1", createdAt: AT });
    run = withReport(run, report, fix);

    const action = decide(inputs(run));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.stage).toBe("fix");
    // One rejection buys a better implementer: three rounds of a cheap model
    // plus three premium reviews costs more than one good implementation.
    expect(action.model).toBe("opus");
  });

  it("settles when the review passed", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const parsed = parseVerdict("VERDICT: PASS\nCRITICAL: none\nCRITERIA: A key over its limit gets a 429 — met");
    const report = toReport({ parsed, contractId: "c1", qaModel: "opus", qaProvider: "claude", id: "q1", createdAt: AT });
    run = withReport(run, report);
    expect(run.stage).toBe("passed");
    expect(decide(inputs(run)).kind).toBe("settled");
  });

  it("blocks rather than guessing when nothing can be driven", () => {
    const run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    const action = decide(inputs(run, { candidates: [] }));
    expect(action.kind).toBe("blocked");
  });

  it("keeps work on the machine when the project says so", () => {
    const run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    const action = decide(inputs(run, { policy: "local-only" }));
    if (action.kind !== "start-session") throw new Error("expected a session");
    expect(action.model).toBe("qwen3-coder:30b");
  });
});

describe("withReport", () => {
  it("counts rejections rather than reviews", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const pass = toReport({
      parsed: parseVerdict("VERDICT: PASS\nCRITICAL: none"),
      contractId: "c1", qaModel: "opus", qaProvider: "claude", id: "q1", createdAt: AT,
    });
    expect(withReport(run, pass).qaRounds).toBe(0);
  });

  it("marks the attempt with how it was judged", () => {
    let run = withContract(startRun({ id: "r1", taskId: "t1", projectId: "p1", riskLevel: "normal", at: AT }), contract, AT);
    run = withValidation(withAttemptFinished(attemptOn(run), "a1", AT), "a1", passing);
    const fail = toReport({
      parsed: parseVerdict("VERDICT: FAIL\nCRITICAL: no"),
      contractId: "c1", qaModel: "opus", qaProvider: "claude", id: "q1", createdAt: AT,
    });
    expect(withReport(run, fail).attempts[0].outcome).toBe("failed");
  });
});

describe("the architect's contract", () => {
  const meta = {
    id: "c1", taskId: "t1", projectId: "p1",
    architectModel: "opus", architectProvider: "claude" as const, createdAt: AT,
  };

  it("reads a well-formed contract", () => {
    const draft = parseContract(
      [
        "TASK: Rate limit the public API",
        "OBJECTIVE: Stop one caller exhausting it for everyone.",
        "FILES:",
        "- src/api/limit.ts",
        "REQUIRED-CHANGES:",
        "1. Add a token bucket per API key",
        "ACCEPTANCE-CRITERIA:",
        "- A key over its limit gets a 429",
        "RISK: high",
      ].join("\n"),
      meta,
    );
    expect(draft.problems).toEqual([]);
    expect(draft.contract?.requiredChanges).toEqual(["Add a token bucket per API key"]);
    expect(draft.contract?.riskLevel).toBe("high");
  });

  it("refuses a contract with nothing to check against", () => {
    // Without criteria the reviewer has no question to answer, so the whole
    // stage after this one is meaningless.
    const draft = parseContract("OBJECTIVE: something\nREQUIRED-CHANGES:\n- do it", meta);
    expect(draft.contract).toBeUndefined();
    expect(draft.problems.join(" ")).toMatch(/ACCEPTANCE-CRITERIA/);
  });

  it("produces no contract at all from an unreadable answer", () => {
    const draft = parseContract("Sure! I'd be happy to help with that.", meta);
    expect(draft.contract).toBeUndefined();
    expect(draft.problems.length).toBeGreaterThan(0);
  });

  it("treats an unrecognised risk as normal rather than trivial", () => {
    const draft = parseContract(
      "OBJECTIVE: o\nREQUIRED-CHANGES:\n- c\nACCEPTANCE-CRITERIA:\n- a\nRISK: medium-ish",
      meta,
    );
    expect(draft.contract?.riskLevel).toBe("normal");
  });

  it("tells the architect not to implement anything", () => {
    const brief = architectContext({ request: "add a thing", filePath: "x.md" });
    expect(brief.prompt).toMatch(/Do not implement/i);
    expect(brief.prompt).toContain("x.md");
  });
});
