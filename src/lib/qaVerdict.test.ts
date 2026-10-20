import { describe, expect, it } from "vitest";
import { parseVerdict, reconcile, toFixContract, toReport } from "./qaVerdict";
import type { ImplementationContract } from "../domain/contracts";

const answer = `
VERDICT: FAIL
CRITICAL:
- archiveProject updates memory but does not persist archivedAt
- archived projects are excluded from every query
WARNINGS: missing a persistence test
CRITERIA:
- Archiving persists after restart — not met, nothing is written
- Existing behaviour unchanged — met
CONTRACT-WRONG: no
FIX:
1. Persist archivedAt in update()
`;

describe("parseVerdict", () => {
  it("reads the sections a reviewer was asked for", () => {
    const parsed = parseVerdict(answer);
    expect(parsed.verdict).toBe("fail");
    expect(parsed.criticalIssues).toHaveLength(2);
    expect(parsed.warnings).toEqual(["missing a persistence test"]);
    expect(parsed.fixes).toEqual(["Persist archivedAt in update()"]);
    expect(parsed.contractWrong).toBe(false);
  });

  it("reads each criterion and whether it was met", () => {
    const criteria = parseVerdict(answer).criteria;
    expect(criteria[0]).toMatchObject({ met: false });
    expect(criteria[1]).toMatchObject({ met: true });
  });

  // A model bullets a list one time and numbers it the next.
  it("does not care how the list was punctuated", () => {
    const parsed = parseVerdict("VERDICT: PASS\nCRITICAL: none\nWARNINGS:\n* one\n2. two");
    expect(parsed.warnings).toEqual(["one", "two"]);
  });

  it("treats 'none' as nothing rather than as an item", () => {
    const parsed = parseVerdict("VERDICT: PASS\nCRITICAL: none\nWARNINGS: n/a");
    expect(parsed.criticalIssues).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });

  // A gate that opens when it cannot understand the answer is not a gate.
  it("fails on an answer it cannot read", () => {
    for (const text of ["", "   ", "Looks great to me!", "I think this is fine, ship it."]) {
      const parsed = parseVerdict(text);
      expect(parsed.verdict).toBe("fail");
      expect(parsed.unreadable).toBe(true);
    }
  });

  // "PASS with caveats" is a caveat, and a caveat is a finding.
  it("only accepts an unqualified PASS", () => {
    expect(parseVerdict("VERDICT: PASS").verdict).toBe("pass");
    expect(parseVerdict("VERDICT: PASS with caveats").verdict).toBe("fail");
    expect(parseVerdict("VERDICT: mostly passes").verdict).toBe("fail");
  });

  it("notices when the reviewer says the contract itself was wrong", () => {
    expect(parseVerdict("VERDICT: FAIL\nCONTRACT-WRONG: yes").contractWrong).toBe(true);
  });
});

describe("reconcile", () => {
  // The failure this exists for: a reviewer writes PASS out of politeness and
  // then describes two bugs. Believing the marker over its own findings is
  // how a loop converges confidently on the wrong thing.
  it("does not let a pass stand beside critical issues", () => {
    const settled = reconcile(parseVerdict("VERDICT: PASS\nCRITICAL:\n- it crashes on an empty list"));
    expect(settled.verdict).toBe("fail");
  });

  it("does not let a pass stand beside an unmet criterion", () => {
    const settled = reconcile(parseVerdict("VERDICT: PASS\nCRITERIA:\n- persists after restart — not met"));
    expect(settled.verdict).toBe("fail");
  });

  it("leaves a clean pass alone", () => {
    const settled = reconcile(parseVerdict("VERDICT: PASS\nCRITICAL: none\nCRITERIA:\n- persists — met"));
    expect(settled.verdict).toBe("pass");
  });
});

describe("toFixContract", () => {
  const contract: ImplementationContract = {
    id: "c1", taskId: "t1", projectId: "p1", task: "t", objective: "o",
    affectedFiles: ["a.ts"], requiredChanges: ["one", "two", "three"],
    constraints: ["Do not delete projects"], acceptanceCriteria: ["A", "B"],
    requiredTests: [], forbiddenChanges: [], assumptions: [],
    riskLevel: "normal", architectModel: "opus", architectProvider: "claude",
    createdAt: "2026-08-28T20:00:00Z",
  };

  const report = toReport({
    parsed: parseVerdict(answer), contractId: "c1", qaModel: "auto",
    qaProvider: "codex", id: "q1", createdAt: "2026-08-28T21:00:00Z",
  });

  // Resending the contract would cost as much as the first implementation to
  // communicate a subset of it.
  it("carries the findings, not the original requirements", () => {
    const fix = toFixContract({ report, contract, id: "f1", createdAt: "2026-08-28T21:00:00Z" });
    expect(fix.issuesToFix).toHaveLength(2);
    expect(fix.requiredChanges).not.toContain("two");
  });

  // A fix that breaks a constraint is not a fix.
  it("keeps the constraints in force", () => {
    const fix = toFixContract({ report, contract, id: "f1", createdAt: "2026-08-28T21:00:00Z" });
    expect(fix.constraints).toEqual(["Do not delete projects"]);
  });

  it("asks only about the criteria that failed", () => {
    const fix = toFixContract({ report, contract, id: "f1", createdAt: "2026-08-28T21:00:00Z" });
    expect(fix.acceptanceCriteria).toEqual(["Archiving persists after restart"]);
  });
});

describe("toReport", () => {
  it("records who judged it, so a bad review can be traced", () => {
    const report = toReport({
      parsed: parseVerdict("VERDICT: PASS"), contractId: "c1",
      qaModel: "gpt-5.2-codex", qaProvider: "codex", id: "q1", createdAt: "2026-08-28T21:00:00Z",
    });
    expect(report).toMatchObject({ qaModel: "gpt-5.2-codex", qaProvider: "codex", verdict: "pass" });
  });

  it("carries the escalation signal through to the record", () => {
    const report = toReport({
      parsed: parseVerdict("VERDICT: FAIL\nCONTRACT-WRONG: yes"), contractId: "c1",
      qaModel: "m", qaProvider: "claude", id: "q1", createdAt: "2026-08-28T21:00:00Z",
    });
    expect(report.requiresArchitectEscalation).toBe(true);
  });
});
