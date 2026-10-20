import { useModalFocus } from "../hooks/useModalFocus";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { providerRegistry } from "../domain/providers";
import { getRole } from "../domain/roles";
import type { BraveliProviderId } from "../domain/types";
import {
  IMPLEMENTER_ROLE,
  SCOPING_ROLE,
  slugifyProjectName,
  validateProjectDescription,
  validateProjectName,
} from "../lib/projectScaffold";

export interface DescribedProjectDraft {
  name: string;
  description: string;
  scopingProviderId: BraveliProviderId;
  implementerProviderId: BraveliProviderId;
}

/**
 * Description-first project wizard. Step one captures the idea; step two picks
 * who scopes it and who builds it. Submitting creates the folder and starts a
 * two-stage council relay — the scoping agent writes a handoff, the implementer
 * picks it up from there.
 */
export function CreateProjectFlowModal({
  open,
  busy,
  error,
  agentChecks,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  agentChecks: Partial<Record<string, { status: string; message?: string }>>;
  onClose: () => void;
  onCreate: (draft: DescribedProjectDraft) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopingProviderId, setScopingProviderId] = useState<BraveliProviderId>("");
  const [implementerProviderId, setImplementerProviderId] = useState<BraveliProviderId>("");
  const [touched, setTouched] = useState(false);

  const installed = providerRegistry.filter((provider) => agentChecks[provider.agent]?.status !== "missing");

  useEffect(() => {
    if (!open) return;
    // Reset per opening so a cancelled draft never leaks into the next project.
    setStep(1);
    setName("");
    setDescription("");
    setTouched(false);
    const available = installed.length > 0 ? installed : providerRegistry;
    setScopingProviderId(available[0]?.id ?? "");
    setImplementerProviderId((available[1] ?? available[0])?.id ?? "");
    // Seed only on open; keep edits while the modal stays mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dialogRef = useModalFocus<HTMLDivElement>(open, () => { if (!busy) onClose(); });
  if (!open) return null;

  const nameError = validateProjectName(name);
  const descriptionError = validateProjectDescription(description);
  const slug = slugifyProjectName(name);
  const canContinue = !nameError && !descriptionError;
  const canCreate =
    canContinue && Boolean(scopingProviderId) && Boolean(implementerProviderId) && !busy;

  const continueToAgents = () => {
    setTouched(true);
    if (!canContinue) return;
    setStep(2);
  };

  const agentList = (
    heading: string,
    hint: string,
    selected: BraveliProviderId,
    onSelect: (id: BraveliProviderId) => void,
  ) => (
    <section className="dk-flow-stage" aria-label={heading}>
      <div className="dk-flow-stage-head">
        <strong>{heading}</strong>
        <span className="dk-hint">{hint}</span>
      </div>
      <div className="dk-list">
        {providerRegistry.map((provider) => {
          const status = agentChecks[provider.agent]?.status;
          const missing = status === "missing";
          // Don't claim "ready" for a CLI whose check has not come back yet.
          const tone = missing || status === "needs-login" ? "is-needs" : status === "ready" ? "is-ready" : "";
          const isSelected = provider.id === selected;
          return (
            <button
              type="button"
              key={provider.id}
              disabled={missing}
              aria-pressed={isSelected}
              className={`dk-list-row dk-flow-agent${isSelected ? " is-selected" : ""}`}
              onClick={() => onSelect(provider.id)}
            >
              <span className={`dk-dot ${tone}`} aria-hidden="true" />
              <span className="dk-row-main">
                <span className="dk-row-title">{provider.displayName}</span>
                <span className="dk-row-sub dk-mono">{provider.command}</span>
              </span>
              {isSelected ? <Check size={15} className="dk-flow-check" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="dk-backdrop" onClick={busy ? undefined : onClose}>
      <div ref={dialogRef}
        className={`dk-dialog${step === 2 ? " dk-dialog--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Describe a new project"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{step === 1 ? "What do you want to build?" : "Who scopes it, who builds it?"}</h2>
            <p className="dk-dialog-desc">
              {step === 1
                ? "Describe the project. A scoping agent plans it, then an implementer builds it."
                : "The scoping agent designs the approach and writes a handoff. The implementer reads that handoff and builds from it — Pitwall passes the work over automatically."}
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={16} />
          </button>
        </div>

        {step === 1 ? (
          <div className="dk-dialog-body">
            <label className="dk-field">
              <span className="dk-label">Project name</span>
              <input
                className="dk-input"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="Todo App"
                aria-invalid={touched && Boolean(nameError)}
              />
              {touched && nameError ? (
                <small className="dk-error">{nameError}</small>
              ) : (
                <small className="dk-hint">Folder: <span className="dk-mono">{slug || "project-name"}</span></small>
              )}
            </label>

            <label className="dk-field">
              <span className="dk-label">Description</span>
              <textarea
                className="dk-textarea dk-flow-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe what you want to build — what it does, who it's for, and any constraints that matter. The scoping agent starts from this."
                aria-invalid={touched && Boolean(descriptionError)}
              />
              {touched && descriptionError ? (
                <small className="dk-error">{descriptionError}</small>
              ) : (
                <small className="dk-hint">
                  Pitwall creates the folder, commits this as BRIEF.md, and hands it to your scoping agent.
                </small>
              )}
            </label>
          </div>
        ) : (
          <div className="dk-dialog-body">
            <div className="dk-flow-pipeline">
              {agentList("1 · Scope & brainstorm", getRole(SCOPING_ROLE).summary, scopingProviderId, setScopingProviderId)}
              <ArrowRight size={16} className="dk-flow-arrow" aria-hidden="true" />
              {agentList(
                "2 · Implement",
                getRole(IMPLEMENTER_ROLE).summary,
                implementerProviderId,
                setImplementerProviderId,
              )}
            </div>

            {error ? <p className="dk-error">{error}</p> : null}
          </div>
        )}

        <div className="dk-dialog-footer">
          <span className="dk-hint">Step {step} of 2</span>
          {step === 1 ? (
            <>
              <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="dk-btn dk-btn--primary" onClick={continueToAgents}>
                Continue
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                className="dk-btn dk-btn--primary"
                disabled={!canCreate}
                onClick={() =>
                  onCreate({ name, description, scopingProviderId, implementerProviderId })
                }
              >
                {busy ? <Loader2 size={15} className="dk-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
                {busy ? "Creating…" : "Create & start"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
