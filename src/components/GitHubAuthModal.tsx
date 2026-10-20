import { useModalFocus } from "../hooks/useModalFocus";
import { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Github, KeyRound, LoaderCircle, ShieldCheck, Trash2, X } from "lucide-react";
import { GITHUB_WORDS, type RepositoryHostWords } from "./ConnectionsModal";

export function GitHubAuthModal({
  open,
  projectName,
  host = GITHUB_WORDS,
  status,
  accounts,
  accountsLoading,
  busy,
  notice,
  onRemember,
  onForget,
  onClose,
}: {
  open: boolean;
  projectName: string;
  /** The service the project's code lives on, which this account belongs to. */
  host?: RepositoryHostWords;
  status: GitHubAuthResult | null;
  accounts: GitHubAccountsResult | null;
  accountsLoading: boolean;
  busy: boolean;
  notice: string;
  onRemember: (input: { login?: string; token?: string; source?: "gh" | "remote" }) => void;
  onForget: () => void;
  onClose: () => void;
}) {
  const [selectedAccountKey, setSelectedAccountKey] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const configured = Boolean(status?.configured);
  const gitlab = host.kind === "gitlab";
  const HostIcon = gitlab ? KeyRound : Github;

  const preferredAccountKey = useMemo(() => {
    const options = accounts?.accounts ?? [];
    const remembered = options.find((account) => account.login === status?.login);
    const preferred = (
      (remembered?.repositoryAccess ? remembered : undefined) ??
      options.find((account) => account.repositoryAccess) ??
      remembered ??
      options.find((account) => account.active) ??
      options[0]
    );
    return preferred ? `${preferred.source}:${preferred.login}` : "";
  }, [accounts, status?.login]);

  const selectedAccount = accounts?.accounts.find(
    (account) => `${account.source}:${account.login}` === selectedAccountKey,
  );

  useEffect(() => {
    if (!open) return;
    setSelectedAccountKey(preferredAccountKey);
    setToken("");
    setShowToken(false);
  }, [open, preferredAccountKey, projectName]);

  const dialogRef = useModalFocus<HTMLDivElement>(open, () => { if (!busy) onClose(); });
  if (!open) return null;

  return (
    <div className="dk-backdrop" onClick={() => !busy && onClose()}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-label={`Project ${host.label} account`} onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{host.label} account</h2>
            <p className="dk-dialog-desc">The account {projectName} pushes and opens {host.requestNoun}s as.</p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-list">
            <div className="dk-list-row">
              <span className={`dk-tile${configured ? " is-ready" : ""}`} aria-hidden="true">
                {configured ? <ShieldCheck size={15} /> : <HostIcon size={15} />}
              </span>
              <span className="dk-row-main">
                <span className="dk-row-title">{configured ? `@${status?.login}` : "No account selected"}</span>
                <span className="dk-row-sub">
                  {configured
                    ? `${status?.host} · ${status?.source === "manual" ? "manual token" : status?.source === "remote" ? "origin token" : gitlab ? "glab account" : "gh account"}`
                    : projectName}
                </span>
              </span>
            </div>
          </div>

          <section className="dk-section" aria-labelledby="github-account-options">
            <div className="dk-section-head">
              <div>
                <h3 className="dk-section-title" id="github-account-options">Available credentials</h3>
                <p className="dk-section-desc">
                  {accounts?.repository ? `${accounts.repository} · ${accounts.protocol}` : accounts?.host ?? "Checking origin"}
                </p>
              </div>
              {accountsLoading ? <LoaderCircle className="dk-spin dk-faint" size={16} /> : null}
            </div>

            {!accountsLoading && accounts?.accounts.length ? (
              <div className="dk-list">
                {accounts.accounts.map((account) => {
                  const accountKey = `${account.source}:${account.login}`;
                  const selected = selectedAccountKey === accountKey;
                  return (
                    <button
                      key={accountKey}
                      type="button"
                      className={`dk-list-row${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedAccountKey(accountKey)}
                      disabled={busy}
                    >
                      <span className="dk-radio-mark" aria-hidden="true">{selected ? <Check size={12} /> : null}</span>
                      <span className="dk-row-main">
                        <span className="dk-row-title">@{account.login}</span>
                        <span className="dk-row-sub">
                          {account.source === "remote"
                            ? "Token embedded in origin URL"
                            : account.repositoryAccess
                              ? "Origin repository access"
                              : account.active
                                ? `Active in ${gitlab ? "glab" : "gh"}`
                                : `Stored in ${gitlab ? "glab" : "gh"}`}
                        </span>
                      </span>
                      {account.repositoryAccess ? <span className="dk-badge dk-badge--green">Repo match</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {!accountsLoading && accounts && !accounts.accounts.length ? (
              <p className="dk-hint">
                {accounts.error ?? `No authenticated accounts were found for ${accounts.host ?? "this host"}.`}
              </p>
            ) : null}

            <span>
              <button
                className="dk-btn dk-btn--sm"
                type="button"
                onClick={() => onRemember({ login: selectedAccount?.login, source: selectedAccount?.source })}
                disabled={busy || accountsLoading || !selectedAccount || !status?.encryptionAvailable}
              >
                <HostIcon size={14} />
                Use selected account
              </button>
            </span>
          </section>

          <section className="dk-section" aria-labelledby="github-token-label">
            <div className="dk-section-head">
              <div>
                <h3 className="dk-section-title" id="github-token-label">Personal access token</h3>
                <p className="dk-section-desc">Validated against {host.label} before encrypted storage{gitlab ? " · needs the api scope" : ""}</p>
              </div>
            </div>
            <div className="dk-search dk-secret">
              <KeyRound size={14} aria-hidden="true" />
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={gitlab ? "glpat-…" : "github_pat_…"}
                autoComplete="off"
                spellCheck={false}
                aria-label={`${host.label} personal access token`}
                disabled={busy}
              />
              <button
                type="button"
                className="dk-icon-btn dk-icon-btn--sm"
                onClick={() => setShowToken((current) => !current)}
                aria-label={showToken ? "Hide token" : "Show token"}
                title={showToken ? "Hide token" : "Show token"}
                disabled={busy}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <span>
              <button
                className="dk-btn dk-btn--sm"
                type="button"
                onClick={() => onRemember({ token: token.trim() })}
                disabled={busy || !token.trim() || !status?.encryptionAvailable}
              >
                <KeyRound size={14} />
                Use this token
              </button>
            </span>
          </section>

          {notice ? <p className="dk-notice is-neutral" role="status">{notice}</p> : null}
          {status && !status.encryptionAvailable ? (
            <p className="dk-notice is-error">Secure credential storage is unavailable on this system.</p>
          ) : null}
        </div>

        <div className="dk-dialog-footer">
          {configured ? (
            <button type="button" className="dk-btn dk-btn--ghost dk-btn--danger" onClick={onForget} disabled={busy}>
              <Trash2 size={14} />
              Forget account
            </button>
          ) : null}
          <span className="dk-spacer" />
          <button type="button" className="dk-btn dk-btn--primary" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
    </div>
  );
}
