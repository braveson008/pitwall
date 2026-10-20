import { Check, Minus, X } from "lucide-react";
import type { ValidationResult } from "../domain/contracts";
import { validationSummary } from "../lib/validationSummary";

export function ValidationEvidence({ result, running = false, onRun }: {
  result?: ValidationResult;
  running?: boolean;
  onRun?: () => void;
}) {
  const summary = validationSummary(result, running);
  return (
    <section className={`dk-checks is-${summary.tone}`} aria-label="Validation evidence">
      <div className="dk-checks-head">
        <strong role="status">{summary.label}</strong>
        {onRun ? (
          <button className="dk-btn dk-btn--sm" type="button" disabled={running} onClick={onRun}>
            {running ? "Running…" : result ? "Run checks again" : "Run checks"}
          </button>
        ) : null}
      </div>
      {result ? (
        <>
          {result.checks.length ? (
            <div className="dk-checks-grid">
              {result.checks.map((check, index) => (
                <div className={`dk-check-card${check.skipped ? " is-skipped" : check.ok ? " is-ok" : " is-failed"}`} key={`${check.name}:${index}`}>
                  <span className="dk-check-name">
                    {check.skipped ? <Minus size={13} aria-hidden="true" /> : check.ok ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
                    {check.name}
                  </span>
                  <span className="dk-mono dk-faint">{check.skipped ? "Skipped" : check.ok ? "Passed" : "Failed"}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="dk-hint">
            Finished {new Date(result.ranAt).toLocaleString()} · Revision <code className="dk-mono">{result.revision ? result.revision.slice(0, 12) : "not recorded"}</code>{result.worktreeDirty ? " + uncommitted work" : ""}
          </p>
          <details className="dk-checks-output">
            <summary>Check commands and output</summary>
            {result.checks.map((check, index) => (
              <div className="dk-checks-run" key={`${check.name}:${index}`}>
                <strong>{check.name} — {check.skipped ? "Skipped" : check.ok ? "Passed" : "Failed"}</strong>
                {check.command ? <code className="dk-mono">{check.command}</code> : <span className="dk-faint">No command configured</span>}
                {!check.skipped ? <pre>{check.output || "No output captured."}</pre> : null}
              </div>
            ))}
          </details>
        </>
      ) : <p className="dk-hint">Run the project’s checks to record evidence before completion.</p>}
    </section>
  );
}
