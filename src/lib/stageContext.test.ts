import { describe, expect, it } from "vitest";
import { failingOutput, fixerContext, implementerContext, repairContext, reviewerContext } from "./stageContext";
import type { FixContract, ImplementationContract, ValidationResult } from "../domain/contracts";

const contract: ImplementationContract = {
  id: "c1", taskId: "t1", projectId: "p1",
  task: "Add project archiving.",
  objective: "Archive projects without deleting them.",
  affectedFiles: ["src/projects/projectService.ts"],
  requiredChanges: ["Add archivedAt", "Add archiveProject(id)"],
  constraints: ["Do not delete projects"],
  acceptanceCriteria: ["Archiving persists after restart"],
  requiredTests: ["archive persistence"],
  forbiddenChanges: ["src/billing/**"],
  assumptions: ["Projects are stored in SQLite"],
  riskLevel: "normal",
  architectModel: "opus", architectProvider: "claude",
  createdAt: "2026-08-28T20:00:00Z",
};

const validation = (ok: boolean): ValidationResult => ({
  ok, ranAt: "2026-08-28T20:00:00Z",
  checks: [
    { name: "typecheck", command: "tsc --noEmit", ok, output: ok ? "" : "x".repeat(5000) + "TS2345: the real error", skipped: false, durationMs: 5 },
    { name: "lint", command: "eslint .", ok: true, output: "", skipped: true, durationMs: 0 },
  ],
});

describe("implementerContext", () => {
  it("carries the contract and nothing about how it was reached", () => {
    const context = implementerContext(contract);
    expect(context.prompt).toContain("Add project archiving.");
    expect(context.prompt).toContain("Archiving persists after restart");
    expect(context.includes).toEqual(["contract"]);
    // The architect's reasoning produced the contract; sending both pays
    // twice for one decision.
    expect(context.prompt).not.toContain("Projects are stored in SQLite");
  });

  // The expensive failure: an implementer that invents an architecture
  // produces work rejected for reasons it could not have known.
  it("tells it to stop rather than invent when the contract does not say", () => {
    expect(implementerContext(contract).prompt).toContain("say so and stop rather than inventing");
  });
});

describe("reviewerContext", () => {
  const base = { contract, diff: "diff --git a/x b/x\n+added" };

  it("gets the contract, the diff and what the checks said", () => {
    const context = reviewerContext({ ...base, validation: validation(true) });
    expect(context.includes).toEqual(["contract", "diff", "validation"]);
    expect(context.prompt).toContain("typecheck: pass");
    expect(context.prompt).toContain("lint: not configured");
  });

  // A reviewer told why the implementer believes it is correct is being asked
  // to agree rather than to check.
  it("is never told the implementer's reasoning", () => {
    const context = reviewerContext({ ...base, implementerNotes: "I chose a Map because it felt cleaner." });
    expect(context.prompt).toContain("THE IMPLEMENTER REPORTED");
    expect(context.prompt).not.toContain("architect");
  });

  it("says plainly that it wrote neither the contract nor the code", () => {
    expect(reviewerContext(base).prompt).toContain("You did not write either");
  });

  // A gate that can be talked past by an enthusiastic summary is not a gate.
  it("asks for a parsed verdict rather than an opinion", () => {
    const prompt = reviewerContext(base).prompt;
    expect(prompt).toContain("VERDICT: PASS or FAIL");
    expect(prompt).toContain("CONTRACT-WRONG:");
  });

  it("truncates a diff that would cost more than it tells", () => {
    const context = reviewerContext({ ...base, diff: "x".repeat(200_000), maxDiffChars: 1000 });
    expect(context.prompt).toContain("diff truncated at 1000 characters");
    expect(context.approxChars).toBeLessThan(5000);
  });
});

describe("failingOutput", () => {
  it("says nothing when nothing failed", () => {
    expect(failingOutput(validation(true))).toBe("");
    expect(failingOutput(undefined)).toBe("");
  });

  // The tail, because a compiler puts the error at the end and the first
  // 4000 characters are usually the files it read.
  it("keeps the end of a long failure, where the error is", () => {
    const output = failingOutput(validation(false), 200);
    expect(output).toContain("TS2345: the real error");
    expect(output.length).toBeLessThan(400);
  });

  it("leaves out checks that were never configured", () => {
    expect(failingOutput(validation(false))).not.toContain("eslint");
  });
});

describe("fixerContext", () => {
  const fix: FixContract = {
    id: "f1", parentContractId: "c1", reportId: "q1",
    issuesToFix: ["archivedAt is not persisted"],
    filesLikelyAffected: ["projectRepository.ts"],
    requiredChanges: ["Persist archivedAt in update()"],
    constraints: ["Do not delete projects"],
    acceptanceCriteria: ["Archiving persists after restart"],
    createdAt: "2026-08-28T20:00:00Z",
  };

  // Resending the whole contract would cost as much as the first
  // implementation to communicate a subset of it.
  it("carries only what is still wrong", () => {
    const context = fixerContext({ fix });
    expect(context.prompt).toContain("archivedAt is not persisted");
    expect(context.prompt).not.toContain("Add archiveProject(id)");
  });

  it("keeps the constraints, since a fix that breaks one is not a fix", () => {
    expect(fixerContext({ fix }).prompt).toContain("Do not delete projects");
  });

  it("tells it not to revisit what the review accepted", () => {
    expect(fixerContext({ fix }).prompt).toContain("Do not revisit parts of the implementation the review accepted");
  });
});

describe("repairContext", () => {
  // No model has been asked anything at this point; this is a compiler error
  // going back to whoever caused it.
  it("carries the failure and no contract at all", () => {
    const context = repairContext(validation(false));
    expect(context.includes).toEqual(["validation"]);
    expect(context.prompt).toContain("TS2345");
    expect(context.prompt).not.toContain("ACCEPTANCE");
  });
});

describe("what each stage costs", () => {
  // The whole point: the reviewer's brief is a diff and a contract, not a
  // conversation, so it does not grow with the number of turns taken.
  it("keeps the review smaller than the sum of what came before it", () => {
    const implement = implementerContext(contract);
    const review = reviewerContext({ contract, diff: "diff --git a/x b/x\n+one line", validation: validation(true) });
    expect(review.approxChars).toBeLessThan(implement.approxChars * 3);
    expect(review.includes).not.toContain("thread");
  });
});
