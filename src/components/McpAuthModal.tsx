import { useState } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import { Check, Copy, ExternalLink, KeyRound, LoaderCircle, ShieldCheck, Trash2, X } from "lucide-react";

export function McpAuthModal({
  open,
  projectName,
  providerLabel,
  server,
  profile,
  busy,
  notice,
  noticeTone,
  signInUrl,
  onConnect,
  onCancel,
  onOpenUrl,
  onForget,
  onClose,
}: {
  open: boolean;
  projectName: string;
  providerLabel: string;
  server: McpServerInfo | null;
  profile: McpAuthProfile | null;
  busy: boolean;
  notice: string;
  noticeTone: "neutral" | "success" | "error";
  /** The sign-in page the running sign-in printed, once it has. */
  signInUrl: string;
  onConnect: () => void;
  /** Stops a sign-in that is waiting on the browser. */
  onCancel: () => void;
  onOpenUrl: (url: string) => void;
  onForget: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Closing is always allowed; while a sign-in waits, it stops the sign-in too.
  const close = () => {
    if (busy) onCancel();
    onClose();
  };
  const dialogRef = useModalFocus<HTMLDivElement>(open && Boolean(server), close);
  if (!open || !server) return null;
  const connected = Boolean(profile?.authenticatedAt);

  return (
    <div className="dk-backdrop" onClick={close}>
      <div ref={dialogRef} className="dk-dialog dk-dialog--narrow" role="dialog" aria-modal="true" aria-label="Project MCP authentication" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{server.name}</h2>
            <p className="dk-dialog-desc">{projectName} · {providerLabel}</p>
          </div>
          <button className="dk-icon-btn" type="button" onClick={close} aria-label={busy ? "Cancel sign-in and close" : "Close"}>
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <p className={`dk-status${connected ? " is-working" : ""}`}>
            {connected ? <ShieldCheck size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
            {connected ? "Project account connected" : "Project account not connected"}
          </p>

          <dl className="dk-facts dk-card">
            <div><dt>Server</dt><dd className="dk-mono">{server.target}</dd></div>
            <div><dt>Profile</dt><dd>{profile?.alias ?? "Created after sign-in"}</dd></div>
            <div><dt>Storage</dt><dd>{providerLabel} secure OAuth store</dd></div>
          </dl>

          {!connected ? (
            <p className="dk-hint">
              Sign in with the account you use for <strong>{projectName}</strong>. If the browser picks up another
              account on its own, switch accounts on the sign-in page before you approve.
            </p>
          ) : null}

          {busy ? (
            <div className="dk-auth-wait">
              <p className="dk-status">
                <LoaderCircle size={14} className="dk-spin" aria-hidden="true" />
                {signInUrl ? "Waiting for you to approve in the browser" : "Starting the sign-in…"}
              </p>
              {signInUrl ? (
                <>
                  <p className="dk-hint">
                    It opened in your default browser. To sign in somewhere else — another browser or profile — copy the link and open it there.
                  </p>
                  <div className="dk-auth-link">
                    <code className="dk-mono" title={signInUrl}>{signInUrl}</code>
                    <button
                      type="button"
                      className="dk-btn dk-btn--sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(signInUrl).then(() => {
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1600);
                        }).catch(() => {});
                      }}
                    >
                      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copied ? "Copied" : "Copy link"}
                    </button>
                    <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={() => onOpenUrl(signInUrl)}>
                      <ExternalLink size={13} aria-hidden="true" />
                      Open
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <p className={`dk-notice${noticeTone === "error" ? " is-failed" : noticeTone === "success" ? " is-ok" : ""}`}>{notice}</p>
          ) : null}
        </div>

        <div className="dk-dialog-footer">
          {profile ? (
            <button className="dk-btn dk-btn--ghost dk-btn--danger" type="button" onClick={onForget} disabled={busy}>
              <Trash2 size={14} />
              Forget project login
            </button>
          ) : null}
          <span className="dk-spacer" />
          {busy ? (
            <button className="dk-btn" type="button" onClick={onCancel}>
              <X size={14} />
              Cancel sign-in
            </button>
          ) : (
            <button className="dk-btn dk-btn--primary" type="button" onClick={onConnect}>
              <KeyRound size={14} />
              {connected ? "Reconnect" : "Connect account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
