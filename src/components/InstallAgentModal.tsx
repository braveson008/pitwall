import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";
import { InstallTerminal } from "./InstallTerminal";

interface Plan {
  action: "run" | "copy" | "docs" | "none";
  command?: string;
  docs?: string;
  reason?: string;
  tool?: string;
}

/**
 * Installing an agent's CLI, in the open.
 *
 * Pitwall runs every agent through its own CLI, so an agent whose CLI is
 * missing is the one thing it cannot work around — and the answer until now
 * was a command printed on a row for you to copy elsewhere.
 *
 * This runs it instead, and the whole design of the dialog is about that
 * being third-party code running on your machine: the command is shown
 * before anything happens, you press the button, and the output appears as
 * it arrives. There is no version of this that runs on its own.
 */
export function InstallAgentModal({
  provider,
  onClose,
  onInstalled,
}: {
  provider: { id: string; displayName: string; command: string; installCommand?: string; installDocs?: string } | null;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dialogRef = useModalFocus<HTMLElement>(Boolean(provider), () => { if (!running) onClose(); });

  useEffect(() => {
    if (!provider) { setPlan(null); setStarted(false); setResult(null); return; }
    let live = true;
    void (async () => {
      const next = await window.pitwall?.planAgentInstall?.({
        installCommand: provider.installCommand ?? "",
        installDocs: provider.installDocs ?? "",
      });
      if (live) setPlan(next ?? { action: "none" });
    })();
    return () => { live = false; };
  }, [provider]);

  /** Handed to the terminal so it can subscribe for itself. */
  const subscribe = useCallback(
    (handler: (chunk: string) => void) =>
      window.pitwall?.onAgentInstallOutput?.((data) => {
        if (data.providerId !== provider?.id) return;
        handler(data.chunk);
      }),
    [provider?.id],
  );

  if (!provider) return null;

  const install = async () => {
    setRunning(true);
    setResult(null);
    setStarted(true);
    try {
      const outcome = await window.pitwall?.installAgent?.({
        providerId: provider.id,
        installCommand: provider.installCommand ?? "",
        installDocs: provider.installDocs ?? "",
        verifyCommand: provider.command,
      });
      const done = outcome ?? { ok: false, error: "Install is unavailable." };
      setResult({ ok: Boolean(done.ok), message: done.ok ? "" : done.message || done.error || "The install did not finish." });
      if (done.ok) onInstalled();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="dk-backdrop" onClick={() => { if (!running) onClose(); }}>
      <section
        ref={dialogRef}
        className="dk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-agent-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="install-agent-title">Install {provider.displayName}</h2>
          </div>
          <button data-dialog-autofocus className="dk-icon-btn" type="button" disabled={running} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          {plan === null ? <p className="dk-hint">Checking what this needs…</p> : null}

          {plan?.action === "run" ? (
            <>
              {/* Shown before it runs, every time. */}
              <p className="dk-install-note">Pitwall will run this in your shell:</p>
              <pre className="dk-code">{plan.command}</pre>
              {/* Which tool is doing the installing decides what can go wrong,
                  so the sentence follows the command rather than assuming npm. */}
              <p className="dk-install-note">
                It installs {provider.displayName}&rsquo;s own CLI from its publisher
                {plan.tool === "npm" ? ", and may ask for your password if your Node is system-owned" : ""}
                {plan.tool === "brew" ? " through Homebrew" : ""}
                {plan.tool === "uv" || plan.tool === "pipx" ? ` through ${plan.tool}` : ""}.
              </p>
            </>
          ) : null}

          {plan && plan.action !== "run" && plan.action !== "none" ? (
            <>
              <p className="dk-install-note">{plan.reason}</p>
              {plan.command ? <pre className="dk-code">{plan.command}</pre> : null}
            </>
          ) : null}

          {plan?.action === "none" ? (
            <p className="dk-install-note">
              Pitwall does not know a confirmed install command for {provider.displayName}, and will not
              guess at one.
            </p>
          ) : null}

          {started ? <InstallTerminal providerId={provider.id} onData={subscribe} /> : null}

          {result ? (
            <p className={`dk-notice ${result.ok ? "is-success" : "is-error"}`} role="status">
              {result.ok ? `${provider.displayName} is installed and ready.` : result.message}
            </p>
          ) : null}
        </div>

        <div className="dk-dialog-footer">
          {plan?.docs ? <a className="dk-link" href={plan.docs} target="_blank" rel="noreferrer">Installation docs</a> : null}
          <span className="dk-spacer" />
          <button type="button" className="dk-btn" disabled={running} onClick={onClose}>
            {result?.ok ? "Done" : "Cancel"}
          </button>
          {plan?.action === "run" && !result?.ok ? (
            <button className="dk-btn dk-btn--primary" type="button" disabled={running} onClick={() => void install()}>
              {running ? <LoaderCircle className="dk-spin" size={14} /> : null}
              {running ? "Installing" : "Run it"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
