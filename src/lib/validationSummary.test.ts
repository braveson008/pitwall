import { describe, expect, it } from "vitest";
import type { ValidationResult } from "../domain/contracts";
import { validationSummary } from "./validationSummary";

const check = { name: "tests", command: "npm test", ok: true, skipped: false, output: "passed", durationMs: 10 };
const result = (checks: ValidationResult["checks"], ok = true): ValidationResult => ({ checks, ok, ranAt: "2026-09-06T10:00:00Z" });

describe("validation evidence", () => {
  it("does not present an all-skipped run as passing", () => {
    expect(validationSummary(result([{ ...check, skipped: true }]))).toMatchObject({ label: "No checks ran", tone: "unknown" });
    expect(validationSummary(result([])).warning).not.toBe("");
  });
  it("requires an override when no result exists", () => {
    expect(validationSummary().warning).not.toBe("");
  });
  it("does not hide a failure behind an inconsistent overall success flag", () => {
    expect(validationSummary(result([{ ...check, ok: false }])).tone).toBe("failed");
  });
  it("does not call a failed validation transport successful", () => {
    expect(validationSummary(result([], false)).tone).toBe("failed");
  });
  it("distinguishes partial coverage from a fully passing run", () => {
    expect(validationSummary(result([check, { ...check, name: "lint", skipped: true }]))).toMatchObject({ label: "1 check passed · 1 skipped", tone: "partial" });
    expect(validationSummary(result([check]))).toMatchObject({ tone: "passed", warning: "" });
  });
  it("shows running rather than a previous passing result", () => {
    expect(validationSummary(result([check]), true).tone).toBe("running");
  });
});
