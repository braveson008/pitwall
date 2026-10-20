import type { ValidationResult } from "../domain/contracts";

export function validationSummary(result?: ValidationResult, running = false) {
  if (running) return { label: "Checks running", tone: "running", warning: "Wait for the checks to finish." };
  if (!result) return { label: "Checks not run", tone: "unknown", warning: "No validation results are recorded for this task." };
  const ran = result.checks.filter((check) => !check.skipped);
  const failed = ran.filter((check) => !check.ok);
  const skipped = result.checks.length - ran.length;
  if (failed.length || !result.ok) return {
    label: failed.length ? `${failed.map((check) => check.name).join(", ")} failing` : "Validation failed",
    tone: "failed",
    warning: "Validation failed. Review the output before completing this task.",
  };
  if (!ran.length) return { label: "No checks ran", tone: "unknown", warning: "No checks ran. This work has not been validated." };
  return {
    label: `${ran.length} ${ran.length === 1 ? "check" : "checks"} passed${skipped ? ` · ${skipped} skipped` : ""}`,
    tone: skipped ? "partial" : "passed",
    warning: skipped ? `${skipped} ${skipped === 1 ? "check was" : "checks were"} skipped. Validation coverage is incomplete.` : "",
  };
}
