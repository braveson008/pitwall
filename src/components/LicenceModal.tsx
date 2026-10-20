import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { Licence } from "../lib/licence";
import { useModalFocus } from "../hooks/useModalFocus";

/**
 * Why the key was not accepted, said in a way that tells the person what to do.
 *
 * The distinction that matters is between "the merchant said no" and "we could
 * not ask". The first is the user's problem to fix; the second is ours, costs
 * them nothing, and must not read like a rejection.
 */
function explain(reason: string | undefined): string {
  switch (reason) {
    case "malformed":
      return "That does not look like a licence key. Keys are at least eight characters, letters and numbers.";
    case "inactive":
      return "That licence is not active. Check your subscription, or try a different key.";
    case "timeout":
    case "unreachable":
      return "Could not reach the licence service. Your key is saved and Pitwall will try again on its own.";
    case "not-configured":
      return "This build has no licence service configured, so keys cannot be checked.";
    default:
      return reason?.startsWith("http-")
        ? "The licence service returned an error. Try again in a moment."
        : "Could not check that key. Your key is saved and Pitwall will try again on its own.";
  }
}

export function LicenceModal({
  open,
  licence,
  hasKey,
  checkoutUrl,
  onActivate,
  onClear,
  onOpenCheckout,
  onClose,
}: {
  open: boolean;
  licence: Licence;
  hasKey: boolean;
  checkoutUrl: string;
  onActivate: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  onClear: () => Promise<void>;
  onOpenCheckout: (url: string) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);

  if (!open) return null;

  const licensed = licence.status === "licensed" || licence.status === "grace";
  const locked = !licence.canStartWork;
  const ended = licence.status === "trial-expired" || licence.status === "lapsed";

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await onActivate(key);
      if (result.ok) {
        setKey("");
        onClose();
      } else {
        setError(explain(result.reason));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dk-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="dk-dialog dk-dialog--narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Licence"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{licensed ? "Pitwall is licensed" : locked ? "Subscribe to keep going" : "Your free month"}</h2>
            <p className={`dk-dialog-desc${ended ? " dk-licence-ended" : ""}`}>{licence.message}</p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {!licensed && (
          <div className="dk-dialog-body">
            <div className="dk-card dk-card--pad dk-licence-offer">
              <div className="dk-licence-price">
                <strong>$10</strong>
                <span className="dk-faint">per month</span>
              </div>
              <p className="dk-muted">
                Every feature, on every Mac you own. Cancel whenever you like — your projects and
                history are files on this machine and stay yours either way.
              </p>
            </div>

            <div className="dk-field">
              <label className="dk-label" htmlFor="licence-key">
                Already subscribed? Enter your key.
              </label>
              <div className="dk-licence-key-row">
                <input
                  id="licence-key"
                  className="dk-input dk-mono"
                  value={key}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  disabled={busy}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => {
                    setKey(event.target.value);
                    if (error) setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                />
                <button type="button" className="dk-btn" onClick={() => void submit()} disabled={busy || !key.trim()}>
                  {busy ? "Checking…" : "Activate"}
                </button>
              </div>
              {error && <p className="dk-error">{error}</p>}
            </div>
          </div>
        )}

        <div className="dk-dialog-footer">
          {licensed ? (
            <>
              <button
                type="button"
                className="dk-btn dk-btn--danger"
                onClick={() => {
                  void onClear();
                  onClose();
                }}
                disabled={busy}
              >
                Remove key
              </button>
              <span className="dk-spacer" />
              <button type="button" className="dk-btn dk-btn--primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              {hasKey && (
                <>
                  <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => void onClear()} disabled={busy}>
                    Remove the stored key
                  </button>
                  <span className="dk-spacer" />
                </>
              )}
              <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose} disabled={busy}>
                Not now
              </button>
              <button type="button" className="dk-btn dk-btn--primary" onClick={() => onOpenCheckout(checkoutUrl)} disabled={busy}>
                Subscribe
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
