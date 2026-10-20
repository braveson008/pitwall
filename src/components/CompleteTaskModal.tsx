import { useState } from "react";
import { X } from "lucide-react";
import type { BraveliTask } from "../domain/types";
import type { ValidationResult } from "../domain/contracts";
import { useModalFocus } from "../hooks/useModalFocus";
import { validationSummary } from "../lib/validationSummary";
import { ValidationEvidence } from "./ValidationEvidence";

export function CompleteTaskModal({ task, result, running, onRun, onClose, onConfirm }: {
  task: BraveliTask;
  result?: ValidationResult;
  running: boolean;
  onRun: () => void;
  onClose: () => void;
  onConfirm: (override: string) => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(true, onClose);
  const [acknowledged, setAcknowledged] = useState("");
  const summary = validationSummary(result, running);
  const evidenceKey = JSON.stringify([result, running]);
  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-task-title" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="complete-task-title">Complete {task.identifier || "task"}?</h2>
            <p className="dk-dialog-desc">{task.title}</p>
          </div>
          <button type="button" className="dk-icon-btn" aria-label="Close completion review" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="dk-dialog-body">
          <ValidationEvidence result={result} running={running} onRun={onRun} />
          {summary.warning ? (
            <div className="dk-notice is-needs" role="status">
              <p>{summary.warning}</p>
              {!running ? (
                <label className="dk-check">
                  <input type="checkbox" checked={acknowledged === evidenceKey} onChange={(event) => setAcknowledged(event.target.checked ? evidenceKey : "")} />
                  I reviewed the available evidence and want to complete this task anyway.
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="dk-btn dk-btn--primary" disabled={running || Boolean(summary.warning && acknowledged !== evidenceKey)} onClick={() => onConfirm(summary.warning)}>{summary.warning ? "Complete with override" : "Complete task"}</button>
        </div>
      </div>
    </div>
  );
}
