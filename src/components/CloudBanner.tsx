import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MonitorSmartphone, X } from "lucide-react";

const PLATFORM_NAMES: Record<string, string> = { darwin: "Mac", win32: "Windows PC", linux: "Linux computer" };

/**
 * On a computer that already syncs: another one asking to join. Approving
 * waits for the new computer to reveal its key, shows the code both screens
 * agree on, and sends the key only once the person says it matches.
 */
export function CloudBanner() {
  const [requests, setRequests] = useState<PitwallCloudJoinRequest[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [code, setCode] = useState<{ linkId: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stop = window.braveli?.onCloudJoinRequests?.((next) => setRequests(next));
    void window.braveli?.cloudCheckJoinRequests?.();
    return stop;
  }, []);

  const request = requests.find((item) => !dismissed.has(item.link_id));
  if (!request) return null;
  const who = request.name || PLATFORM_NAMES[request.platform ?? ""] || "Another computer";
  const close = () => {
    setDismissed((current) => new Set(current).add(request.link_id));
    setCode(null);
    setMessage("");
  };

  return createPortal((
    <div className="dk-toast is-info dk-cloud-banner" role="alertdialog" aria-label="Approve a computer">
      <MonitorSmartphone size={16} aria-hidden="true" />
      <div>
        {code ? (
          <>
            <strong>Does {who} show {code.code}?</strong>
            <span>Approve only if the codes match. It then gets everything this account syncs.</span>
            <div className="dk-cloud-banner-actions">
              <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" disabled={busy} onClick={async () => {
                setBusy(true);
                const reply = await window.braveli?.cloudConfirmJoin?.({ linkId: request.link_id });
                setBusy(false);
                if (reply?.ok) close();
                else setMessage(reply?.message ?? "Approval failed.");
              }}>It matches</button>
              <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" disabled={busy} onClick={async () => {
                await window.braveli?.cloudDenyJoin?.({ linkId: request.link_id });
                close();
              }}>Deny</button>
            </div>
          </>
        ) : (
          <>
            <strong>{who} wants to sync with this account</strong>
            <span>{busy ? "Waiting for it to show a code…" : "Approve it to bring your projects there."}</span>
            <div className="dk-cloud-banner-actions">
              <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" disabled={busy} onClick={async () => {
                setBusy(true);
                setMessage("");
                const reply = await window.braveli?.cloudApproveJoin?.({ linkId: request.link_id });
                setBusy(false);
                if (reply?.ok && reply.code) setCode({ linkId: request.link_id, code: reply.code });
                else setMessage(reply?.message ?? "Couldn't reach that computer.");
              }}>Approve…</button>
              <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" disabled={busy} onClick={async () => {
                await window.braveli?.cloudDenyJoin?.({ linkId: request.link_id });
                close();
              }}>Deny</button>
            </div>
          </>
        )}
        {message ? <span role="alert">{message}</span> : null}
      </div>
      <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={close} title="Not now" aria-label="Not now">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  ), document.body);
}
