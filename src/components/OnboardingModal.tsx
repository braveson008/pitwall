import { useState } from "react";
import { Copy, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

export interface OnboardingAgent {
  name: string;
  command: string;
  loginCommand: string;
  /** How to install it, when Pitwall knows. Empty rather than guessed. */
  installCommand?: string;
  installDocs?: string;
  status: string;
  message: string;
}

/**
 * A command the reader is meant to run, with one click to take it away.
 *
 * Telling someone to "install the claude CLI" and stopping there leaves them
 * to go and find out how — at the exact moment they are deciding whether this
 * app is worth the trouble.
 */
function RunThis({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="dk-copy-command"
      type="button"
      title="Copy to clipboard"
      onClick={() => {
        void navigator.clipboard?.writeText(command);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      <span className="dk-mono">{copied ? "Copied" : command}</span>
      <Copy size={12} aria-hidden="true" />
    </button>
  );
}

const loop = [
  ["Add a project", "Any folder on your machine. Pitwall reads its git remote and test command."],
  ["Create a task", "A ticket pulled from your board, or one you write yourself. Give it a role and Pitwall primes the agent for it."],
  ["Start it", "The agent gets its own branch and worktree, so several tasks run at once without editing each other’s files."],
  ["Leave it running", "A session that needs an answer says so in the sidebar, whether or not you have it open."],
  ["Review before you accept", "Every file the agent changed, with its diff. If it is not right, ask for a specific change."],
];

/**
 * First-run guide: shows which agent CLIs are ready, how to fix the missing
 * ones, and the core loop — so someone who didn't build Pitwall can start.
 */
export function OnboardingModal({
  open,
  agents,
  analyticsEnabled,
  onAnalyticsChange,
  hasProjects = false,
  onAddProject,
  onClose,
}: {
  open: boolean;
  /** Reopened from the palette by someone already using it. */
  hasProjects?: boolean;
  agents: OnboardingAgent[];
  analyticsEnabled: boolean;
  onAnalyticsChange: (enabled: boolean) => void;
  onAddProject: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  const readyCount = agents.filter((agent) => agent.status === "ready" || agent.status === "unknown").length;

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog dk-onboarding" role="dialog" aria-modal="true" aria-label="Pitwall guide" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title dk-welcome-title">Welcome to Pitwall</h2>
            <p className="dk-dialog-desc">
              Mission control for coding agents. Claude, Codex, Gemini and Grok each run as their real CLI, right
              here — you’re the orchestrator.
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <section className="dk-section">
            <div className="dk-section-head">
              <div>
                <h3 className="dk-section-title">Your agents</h3>
              </div>
              <span className="dk-faint dk-onboarding-count">{readyCount} of {agents.length} ready</span>
            </div>
            {agents.length ? (
              <div className="dk-list">
                {agents.map((agent) => {
                  const ready = agent.status === "ready" || agent.status === "unknown";
                  const missing = agent.status === "missing";
                  const needsLogin = agent.status === "needs-login";
                  const fix = missing ? agent.installCommand : needsLogin ? agent.loginCommand : "";
                  return (
                    <div className="dk-list-row" key={agent.name}>
                      <span className={`dk-dot ${ready ? "is-ready" : "is-needs"}`} aria-hidden="true" />
                      <div className="dk-row-main">
                        <span className="dk-row-title">{agent.name}</span>
                        {!ready && fix ? (
                          <span className="dk-onboarding-fix">
                            Run <RunThis command={fix} /> then reopen this guide.
                          </span>
                        ) : !ready && agent.installDocs ? (
                          <span className="dk-onboarding-fix">
                            <a className="dk-link" href={agent.installDocs} target="_blank" rel="noreferrer">
                              Installation instructions
                            </a>
                          </span>
                        ) : null}
                      </div>
                      {ready ? (
                        <span className="dk-badge dk-badge--green">Signed in</span>
                      ) : (
                        <span className="dk-badge dk-badge--amber">{missing ? "Not installed" : "Not signed in"}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="dk-section">
            <div className="dk-section-head">
              <div>
                <h3 className="dk-section-title">The loop</h3>
              </div>
            </div>
            <ol className="dk-onboarding-steps">
              {loop.map(([name, rest], index) => (
                <li key={name}>
                  <span className="dk-onboarding-ordinal" aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{name}</strong>
                    <p>{rest}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="dk-section">
            <div className="dk-section-head">
              <div>
                <h3 className="dk-section-title">When one agent is not enough</h3>
              </div>
            </div>
            <dl className="dk-onboarding-modes">
              <div>
                <dt>Council</dt>
                <dd>Several agents on one task, in one conversation. A conductor reads each turn and decides who speaks next.</dd>
              </div>
              <div>
                <dt>Compare</dt>
                <dd>The same task to several agents independently, so you can pick the best answer.</dd>
              </div>
            </dl>
          </section>

          <section className="dk-section dk-onboarding-share">
            <label className="dk-check">
              <input type="checkbox" checked={analyticsEnabled} onChange={(event) => onAnalyticsChange(event.target.checked)} />
              Share anonymous usage counts
            </label>
            <p className="dk-hint">
              Counts only: what you started, and whether it finished. An anonymous install id, the app version and
              which agent — never your code, file names, ticket titles or prompts.
            </p>
          </section>
        </div>

        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="dk-btn dk-btn--primary" onClick={onAddProject}>
            {hasProjects ? "Add a project" : "Add your first project"}
          </button>
        </div>
      </div>
    </div>
  );
}
