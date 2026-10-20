import { useCallback, useEffect, useState } from "react";

function size(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function syncLine(status: PitwallCloudSyncStatus | undefined) {
  switch (status?.state) {
    case "syncing": return "Syncing…";
    case "offline": return "Offline. Changes sync when you're back online.";
    case "quota": return "Cloud is full (2 GB). Agent history takes the most space; turn it off for a project to make room.";
    case "error": return status.error || "Sync stopped on an error. It tries again by itself.";
    default: {
      if (!status?.lastSyncedAt) return "Up to date";
      const seconds = Math.round((Date.now() - Date.parse(status.lastSyncedAt)) / 1000);
      return seconds < 60 ? "Synced just now" : `Synced ${new Date(status.lastSyncedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    }
  }
}

const PLATFORM_NAMES: Record<string, string> = { darwin: "Mac", win32: "Windows", linux: "Linux" };

function Devices() {
  const [devices, setDevices] = useState<PitwallCloudDevice[] | null>(null);
  const load = useCallback(async () => {
    const reply = await window.braveli?.cloudDevices?.();
    if (reply?.ok && reply.data) setDevices(reply.data.devices);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!devices?.length) return null;
  return (
    <ul className="dk-cloud-devices" aria-label="Computers that sync">
      {devices.map((device) => (
        <li key={device.id}>
          <div>
            <strong>{device.name || PLATFORM_NAMES[device.platform ?? ""] || "Computer"}</strong>
            <span>{device.current ? "This computer" : [PLATFORM_NAMES[device.platform ?? ""], device.last_seen ? `last seen ${new Date(device.last_seen).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""].filter(Boolean).join(", ")}</span>
          </div>
          {device.current ? null : (
            <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={async () => { await window.braveli?.cloudRemoveDevice?.({ id: device.id }); await load(); }}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A new computer: approved from one that already syncs, or unlocked with the recovery key. */
function JoinThisComputer({ onJoined }: { onJoined: () => Promise<void> }) {
  const [mode, setMode] = useState<"approve" | "key">("approve");
  const [step, setStep] = useState<{ state: string; code?: string; message?: string } | null>(null);
  const [typedKey, setTypedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => window.braveli?.onCloudJoinState?.((next) => {
    setStep(next);
    if (next.state === "joined") void onJoined();
  }), [onJoined]);
  useEffect(() => () => { void window.braveli?.cloudCancelJoin?.(); }, []);

  const ask = async () => {
    setMessage("");
    setStep({ state: "waiting" });
    const reply = await window.braveli?.cloudRequestJoin?.();
    if (!reply?.ok) {
      setStep(null);
      setMessage(reply?.message ?? "Couldn't ask for approval.");
    }
  };

  if (mode === "key") {
    return (
      <section className="dk-plans-intro dk-cloud">
        <h3>Sync</h3>
        <p>Enter the recovery key you saved when you turned sync on.</p>
        <form
          className="dk-plans-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setMessage("");
            void window.braveli?.cloudJoinWithRecovery?.({ recoveryKey: typedKey }).then(async (reply) => {
              setBusy(false);
              if (!reply?.ok) setMessage(reply?.message ?? "That recovery key didn't work.");
              else await onJoined();
            });
          }}
        >
          <label htmlFor="cloud-recovery">Recovery key</label>
          <div className="dk-plans-row">
            <input id="cloud-recovery" className="dk-input dk-cloud-key-input" autoComplete="off" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X" value={typedKey} onChange={(event) => setTypedKey(event.target.value)} />
            <button type="submit" className="dk-btn dk-btn--primary" disabled={busy || typedKey.replace(/[\s-]/g, "").length !== 26}>Unlock</button>
          </div>
        </form>
        <button type="button" className="dk-link dk-cloud-reset" onClick={() => setMode("approve")}>Approve from another computer instead</button>
        {message ? <p className="dk-plans-message" role="alert">{message}</p> : null}
      </section>
    );
  }

  const waiting = step && (step.state === "waiting" || step.state === "approving");
  return (
    <section className="dk-plans-intro dk-cloud">
      <h3>Sync</h3>
      {step?.state === "confirm" && step.code ? (
        <>
          <p>The other computer approved this one. Is this the code it showed?</p>
          <code className="dk-cloud-code" aria-label="Approval code">{step.code}</code>
          <div className="dk-plans-row">
            <button type="button" className="dk-btn dk-btn--primary" onClick={() => void window.braveli?.cloudConfirmJoinHere?.()}>It matches</button>
            <button type="button" className="dk-btn dk-btn--ghost" onClick={() => { void window.braveli?.cloudCancelJoin?.(); setStep(null); }}>It doesn't</button>
          </div>
        </>
      ) : step?.state === "revealed" && step.code ? (
        <>
          <p>Check that the other computer shows this code, then approve it there.</p>
          <code className="dk-cloud-code" aria-label="Approval code">{step.code}</code>
        </>
      ) : waiting ? (
        <p>On a computer that already syncs, open Pitwall. It will ask to approve this one.</p>
      ) : step?.state === "denied" ? (
        <p>The other computer said no. Ask again, or use your recovery key.</p>
      ) : step?.state === "expired" ? (
        <p>The request timed out. Ask again when the other computer is open.</p>
      ) : (
        <p>Your account already syncs from another computer. Approve this one from there to bring everything here.</p>
      )}
      {!waiting && step?.state !== "revealed" && step?.state !== "confirm" ? (
        <div className="dk-plans-row">
          <button type="button" className="dk-btn dk-btn--primary" onClick={() => void ask()}>
            {step ? "Ask again" : "Approve from another computer"}
          </button>
        </div>
      ) : null}
      <button type="button" className="dk-link dk-cloud-reset" onClick={() => { void window.braveli?.cloudCancelJoin?.(); setStep(null); setMode("key"); }}>Use recovery key instead</button>
      {message || step?.message ? <p className="dk-plans-message" role="alert">{message || step?.message}</p> : null}
    </section>
  );
}

function RecoveryKey({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const download = () => {
    const blob = new Blob([`Pitwall recovery key\n\n${recoveryKey}\n\nYou need this to open your synced projects on a new computer if no other computer is signed in.\n`], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Pitwall recovery key.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <section className="dk-cloud-key" aria-label="Recovery key">
      <h3>Save your recovery key</h3>
      <p>Your projects are encrypted on this computer with a key only you have. If you lose every signed-in computer, this is the only way back in. Pitwall can't recover it for you.</p>
      <code className="dk-cloud-key-value">{recoveryKey}</code>
      <div className="dk-plans-row">
        <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => { void navigator.clipboard?.writeText(recoveryKey); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={download}>Save as file…</button>
      </div>
      <label className="dk-cloud-check">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        I've saved it somewhere safe
      </label>
      <button type="button" className="dk-btn dk-btn--primary" disabled={!saved} onClick={onDone}>Done</button>
    </section>
  );
}

/**
 * Pitwall Cloud: turn sync on, join from another computer, see where it stands.
 * Lives under the account, as it needs the same sign-in.
 */
export function CloudPanel({
  signedIn,
  projects = [],
  onToggleHistory,
}: {
  signedIn: boolean;
  /** Projects and whether their agent conversations sync. */
  projects?: Array<{ id: string; name: string; cloudHistory?: boolean }>;
  onToggleHistory?: (projectId: string, on: boolean) => void;
}) {
  const [status, setStatus] = useState<PitwallCloudStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = useCallback(async () => {
    const next = await window.braveli?.cloudStatus?.();
    if (next) setStatus(next);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, signedIn]);
  useEffect(() => window.braveli?.onCloudStatus?.((sync) => setStatus((current) => (current ? { ...current, sync } : current))), []);

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage("");
    try {
      const said = await work();
      if (said) setMessage(said);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!window.braveli?.cloudStatus || !status || status.vault === "signed-out" || !signedIn) {
    return (
      <section className="dk-plans-intro dk-cloud">
        <h3>Sync</h3>
        <p>Sign in above to keep your projects, tasks and agent conversations on every computer you use.</p>
      </section>
    );
  }

  if (recoveryKey) return <RecoveryKey recoveryKey={recoveryKey} onDone={() => setRecoveryKey("")} />;

  if (status.vault === "off" || status.vault === "needs-setup") {
    return (
      <section className="dk-plans-intro dk-cloud">
        <h3>Sync</h3>
        <p>Keep projects, tasks, memory and agent conversations on every computer you sign in to. Everything is encrypted on this computer before it leaves; Pitwall can't read it.</p>
        <div className="dk-plans-row">
          <button
            type="button"
            className="dk-btn dk-btn--primary"
            disabled={busy}
            onClick={() => void run(async () => {
              const reply = await window.braveli?.cloudSetUp?.();
              if (!reply?.ok || !reply.recoveryKey) return reply?.message ?? "Sync could not be turned on.";
              setRecoveryKey(reply.recoveryKey);
              return "";
            })}
          >
            Turn on sync
          </button>
        </div>
        {message ? <p className="dk-plans-message" role="alert">{message}</p> : null}
      </section>
    );
  }

  if (status.vault === "needs-join") {
    return <JoinThisComputer onJoined={refresh} />;
  }

  if (status.vault === "unreachable") {
    return (
      <section className="dk-plans-intro dk-cloud">
        <h3>Sync</h3>
        <p>Pitwall can't reach the sync service right now. Your work is safe on this computer and syncs when the connection is back.</p>
      </section>
    );
  }

  const usage = status.usage;
  return (
    <section className="dk-plans-month dk-cloud" aria-label="Sync">
      <div className="dk-plans-month-head">
        <strong>Sync</strong>
        <span>{syncLine(status.sync)}</span>
      </div>
      {usage ? (
        <>
          <div className="dk-plans-meter" role="meter" aria-valuemin={0} aria-valuemax={usage.quota} aria-valuenow={usage.bytes} aria-label="Cloud storage used">
            <span style={{ width: `${Math.min(100, (usage.bytes / usage.quota) * 100)}%` }} />
          </div>
          <p className="dk-plans-figures"><strong>{size(usage.bytes)}</strong> of {size(usage.quota)} used</p>
        </>
      ) : null}
      {status.sync?.heldDeletions ? (
        <div className="dk-cloud-danger" role="alert">
          <p>{status.sync.heldDeletions} items are missing on this computer. Deleting that many at once is usually an accident, so they haven't been removed from your other computers.</p>
          <div className="dk-plans-row">
            <button type="button" className="dk-btn dk-btn--primary dk-btn--sm" disabled={busy} onClick={() => void run(async () => { await window.braveli?.cloudHeldDeletions?.({ action: "restore" }); })}>Bring them back here</button>
            <button type="button" className="dk-btn dk-btn--danger dk-btn--sm" disabled={busy} onClick={() => void run(async () => { await window.braveli?.cloudHeldDeletions?.({ action: "confirm" }); })}>Delete everywhere</button>
          </div>
        </div>
      ) : null}
      <div className="dk-plans-row">
        <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" disabled={busy} onClick={() => void run(async () => { await window.braveli?.cloudSyncNow?.(); })}>Sync now</button>
        <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" disabled={busy} onClick={() => void run(async () => { await window.braveli?.cloudTurnOff?.(); })}>Turn off on this computer</button>
      </div>
      {projects.length && onToggleHistory ? (
        <div className="dk-cloud-history">
          <strong>Agent conversations</strong>
          <span>Resume an agent's conversation on another computer. Turn off for a project to keep its conversations here.</span>
          <ul aria-label="Sync agent conversations">
            {projects.map((project) => (
              <li key={project.id}>
                <label>
                  <input type="checkbox" checked={project.cloudHistory !== false} onChange={(event) => onToggleHistory(project.id, event.target.checked)} />
                  {project.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Devices />
      {confirmReset ? (
        <div className="dk-cloud-danger">
          <p>Resetting makes a new key and deletes the cloud copy. Other computers stop syncing until they're set up again. Work on this computer stays.</p>
          <div className="dk-plans-row">
            <button type="button" className="dk-btn dk-btn--danger dk-btn--sm" disabled={busy} onClick={() => void run(async () => {
              const reply = await window.braveli?.cloudReset?.();
              setConfirmReset(false);
              if (!reply?.ok || !reply.recoveryKey) return reply?.message ?? "Reset failed.";
              setRecoveryKey(reply.recoveryKey);
              return "";
            })}>Reset and delete cloud copy</button>
            <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dk-link dk-cloud-reset" onClick={() => setConfirmReset(true)}>Reset encryption…</button>
      )}
      {message ? <p className="dk-plans-message" role="alert">{message}</p> : null}
    </section>
  );
}
