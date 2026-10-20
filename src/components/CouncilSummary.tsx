import { Send } from "lucide-react";
import type { DeliveryReceipt } from "../domain/projectKnowledge";
import type { WorkingSet } from "../lib/councilBriefing";
import type { CouncilEvidence } from "../lib/councilRelay";
import type { VerificationVerdict } from "../lib/councilVerify";
import { formatActivityTime } from "../lib/format";

export interface CouncilSummaryProps {
  objective: string;
  description?: string;
  workingSet?: WorkingSet;
  decisions?: string[];
  evidence?: CouncilEvidence | null;
  verification?: { attempt: number; verdict: VerificationVerdict | null; pending?: boolean };
  currentAssignment?: { member: string; directive?: string };
  contextReceipts?: DeliveryReceipt[];
  status?: string;
}

const fullTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const RECEIPT_STATUS: Record<DeliveryReceipt["status"], { label: string; tone: string }> = {
  delivered: { label: "Delivered", tone: " dk-badge--green" },
  prepared: { label: "Prepared", tone: "" },
  failed: { label: "Failed", tone: " dk-badge--red" },
};

export function ContextReceiptList({ receipts }: { receipts: DeliveryReceipt[] }) {
  if (!receipts.length) {
    return (
      <p className="dk-hint">
        No context delivery has been recorded yet. Receipts appear when an agent receives a task or council turn.
      </p>
    );
  }
  return (
    <div className="dk-receipts">
      <p className="dk-hint">
        Delivered confirms transport to the agent. It does not confirm the agent read or understood the context.
      </p>
      <div className="dk-list">
        {[...receipts]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((receipt) => (
            <details className="dk-receipt" key={receipt.id}>
              <summary className="dk-list-row dk-receipt-summary">
                <Send size={14} aria-hidden="true" className="dk-faint" />
                <span className="dk-row-main">
                  <strong className="dk-row-title">
                    {receipt.role || "Agent"} · {receipt.provider}
                  </strong>
                  <span className="dk-row-sub" title={fullTime(receipt.createdAt)}>{formatActivityTime(receipt.createdAt)}</span>
                </span>
                <span className={`dk-badge${RECEIPT_STATUS[receipt.status]?.tone ?? ""}`}>
                  {RECEIPT_STATUS[receipt.status]?.label ?? receipt.status}
                </span>
              </summary>
              <div className="dk-receipt-body">
                <p>
                  {count(receipt.records.length, "knowledge record", "knowledge records")},{" "}
                  {count(receipt.manualEntryIds.length, "manual entry", "manual entries")}, approximately{" "}
                  {receipt.approximateChars.toLocaleString()} characters
                </p>
                {receipt.error ? <p className="dk-error">{receipt.error}</p> : null}
                {receipt.warnings.map((warning, index) => (
                  <p className="dk-receipt-warning" key={`${index}-${warning}`}>
                    {warning}
                  </p>
                ))}
                {receipt.records.length ? (
                  <ul className="dk-receipt-list">
                    {receipt.records.map((record) => (
                      <li key={`${record.id}-${record.version}`}>
                        <strong>{record.title}</strong> · v{record.version} · {record.freshness}
                        {record.sources.length ? (
                          <span className="dk-receipt-source dk-mono">
                            {record.sources.map((source) => source.path).join(", ")}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {receipt.manualEntries.length ? (
                  <ul className="dk-receipt-list">
                    {receipt.manualEntries.map((entry) => (
                      <li key={entry.id}>
                        {entry.title} <span className="dk-faint">· manual context</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <dl className="dk-receipt-meta">
                  <dt>Workspace</dt>
                  <dd>
                    <code className="dk-mono">{receipt.workspacePath}</code>
                  </dd>
                  {receipt.branch ? (
                    <>
                      <dt>Branch</dt>
                      <dd>
                        <code className="dk-mono">{receipt.branch}</code>
                      </dd>
                    </>
                  ) : null}
                  {receipt.revision ? (
                    <>
                      <dt>Revision</dt>
                      <dd>
                        <code className="dk-mono">{receipt.revision}</code>
                      </dd>
                    </>
                  ) : null}
                  <dt>Payload hash</dt>
                  <dd>
                    <code className="dk-mono">{receipt.payloadHash}</code>
                  </dd>
                  {receipt.exportPath ? (
                    <>
                      <dt>Context file</dt>
                      <dd>
                        <code className="dk-mono">{receipt.exportPath}</code>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </details>
          ))}
      </div>
    </div>
  );
}

export function CouncilSummary({
  objective,
  description,
  workingSet,
  decisions = [],
  evidence,
  verification,
  currentAssignment,
  contextReceipts = [],
  status,
}: CouncilSummaryProps) {
  const tests = evidence?.tests;
  const verdict = verification?.verdict;
  return (
    <div className="dk-council-summary" aria-label="Council summary">
      <section className="dk-section">
        <h3 className="dk-section-title">Objective</h3>
        <p className="dk-council-summary-objective">{objective}</p>
        {description ? <p className="dk-council-summary-text">{description}</p> : null}
        {status ? <p className="dk-council-summary-text dk-muted">{status}</p> : null}
      </section>
      <div className="dk-council-summary-columns">
        <section className="dk-card dk-card--pad dk-council-summary-card">
          <h3 className="dk-section-title">Current assignment</h3>
          {currentAssignment ? (
            <>
              <strong>{currentAssignment.member}</strong>
              <p className="dk-council-summary-text">{currentAssignment.directive || "Working on the current council turn."}</p>
            </>
          ) : (
            <p className="dk-hint">No member has an active assignment.</p>
          )}
        </section>
        <section className="dk-card dk-card--pad dk-council-summary-card">
          <h3 className="dk-section-title">Verification</h3>
          <p className="dk-council-summary-text">
            {verification?.pending
              ? `Verification in progress · attempt ${verification.attempt}`
              : verdict
                ? verdict.verified
                  ? "Verified against the original task"
                  : "Not verified"
                : "No verification verdict recorded."}
          </p>
          {verdict?.summary ? <p className="dk-hint">{verdict.summary}</p> : null}
          {verdict?.gaps.length ? (
            <ul className="dk-council-summary-list">
              {verdict.gaps.map((gap, index) => (
                <li key={`${index}-${gap}`}>{gap}</li>
              ))}
            </ul>
          ) : null}
          <p className="dk-hint">Workflow completion and verification are recorded separately.</p>
        </section>
        <section className="dk-card dk-card--pad dk-council-summary-card">
          <h3 className="dk-section-title">Accepted decisions</h3>
          {decisions.length ? (
            <ul className="dk-council-summary-list">
              {decisions.map((decision, index) => (
                <li key={`${index}-${decision}`}>{decision}</li>
              ))}
            </ul>
          ) : (
            <p className="dk-hint">No accepted decisions recorded in the handoffs yet.</p>
          )}
        </section>
        <section className="dk-card dk-card--pad dk-council-summary-card">
          <h3 className="dk-section-title">Open questions</h3>
          {workingSet?.openQuestions.length ? (
            <ul className="dk-council-summary-list">
              {workingSet.openQuestions.map((question, index) => (
                <li key={`${index}-${question}`}>{question}</li>
              ))}
            </ul>
          ) : (
            <p className="dk-hint">No unresolved questions recorded.</p>
          )}
        </section>
      </div>
      <section className="dk-section">
        <h3 className="dk-section-title">Test evidence</h3>
        {tests ? (
          <>
            <p className="dk-council-summary-text">
              <span className={`dk-badge ${tests.timedOut || !tests.passed ? "dk-badge--red" : "dk-badge--green"}`}>
                {tests.timedOut ? "Timed out" : tests.passed ? "Passed" : "Failed"}
              </span>{" "}
              <code className="dk-mono">{tests.command}</code>
            </p>
            <details className="dk-council-summary-details">
              <summary>Recorded test output</summary>
              <pre className="dk-mono">{tests.output || "No output was captured."}</pre>
            </details>
          </>
        ) : (
          <p className="dk-hint">
            No test result recorded. Commands listed in a handoff do not establish a passing check.
          </p>
        )}
        {evidence?.claimedWithoutChanges ? (
          <p className="dk-council-summary-warning">The last implementation turn reported completion without changing files.</p>
        ) : null}
      </section>
      <section className="dk-section">
        <h3 className="dk-section-title">Files and repository knowledge</h3>
        {evidence?.dirtyPaths.length ? (
          <details className="dk-council-summary-details">
            <summary>{count(evidence.dirtyPaths.length, "path differs", "paths differ")} from HEAD</summary>
            <ul className="dk-council-summary-list">
              {evidence.dirtyPaths.map((path) => (
                <li key={path}>
                  <code className="dk-mono">{path}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="dk-hint">No changed paths recorded.</p>
        )}
        {workingSet?.files.length ? (
          <details className="dk-council-summary-details">
            <summary>{count(workingSet.files.length, "file", "files")} in the working set</summary>
            <ul className="dk-council-summary-list">
              {workingSet.files.map((file) => (
                <li key={file.path}>
                  <code className="dk-mono">{file.path}</code>
                  {file.note ? ` — ${file.note}` : ""}
                  <span className="dk-hint">
                    {" "}Turn {file.turn} · {file.by}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {workingSet?.commands.length ? (
          <details className="dk-council-summary-details">
            <summary>Commands from handoffs</summary>
            <ul className="dk-council-summary-list">
              {workingSet.commands.map((command) => (
                <li key={command}>
                  <code className="dk-mono">{command}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {workingSet?.conventions.length ? (
          <details className="dk-council-summary-details">
            <summary>Observed conventions</summary>
            <ul className="dk-council-summary-list">
              {workingSet.conventions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section className="dk-section">
        <h3 className="dk-section-title">Context used</h3>
        <ContextReceiptList receipts={contextReceipts} />
      </section>
    </div>
  );
}
