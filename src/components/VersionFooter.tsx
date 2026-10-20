import { AlertTriangle, Download, RefreshCw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PitwallMark } from "./PitwallMark";

/**
 * Which Pitwall this is, where it can always be seen.
 *
 * Version numbers matter here in a way they do not in most apps: Pitwall
 * updates itself weekly, and a stale copy running from the wrong place looks
 * identical to a current one. "I am not sure which version I have installed" is
 * a reasonable thing to wonder and a bad thing to have to go and find out.
 *
 * It doubles as the update control — the honest answer to "which version am I
 * on" often includes "and a newer one is waiting" — and it used to hide that
 * completely. With nothing to report it rendered as the words "Pitwall 0.1.12"
 * and nothing else: no icon, no second line, no hint that it did anything at
 * all. The one thing you had to click to find out about updates was the one
 * thing that did not look clickable.
 *
 * So there is always a label saying what the button will do, and always an
 * icon. When there is genuinely something waiting the whole row is tinted,
 * because that is news rather than furniture.
 */

type Presentation = {
  /** What pressing it does, said as a state or an offer. */
  label: string;
  icon: typeof RefreshCw;
  /** Drives the tint. Empty is the resting state. */
  tone: "" | "ready" | "available" | "blocked" | "busy";
  spin?: boolean;
};

export function describeUpdate(state: UpdateState | null, blocked: string | null): Presentation {
  if (blocked) return { label: "Cannot update here", icon: AlertTriangle, tone: "blocked" };

  switch (state?.status) {
    case "ready":
      return { label: "Restart to update", icon: RotateCw, tone: "ready" };
    case "downloading":
      return { label: `Downloading ${state.progress}%`, icon: Download, tone: "busy" };
    case "available":
      return {
        label: state.availableVersion ? `Update to ${state.availableVersion}` : "Update available",
        icon: Download,
        tone: "available",
      };
    case "checking":
      return { label: "Checking for updates…", icon: RefreshCw, tone: "busy", spin: true };
    case "error":
      return { label: "Update check failed — retry", icon: AlertTriangle, tone: "blocked" };
    case "current":
      // Said plainly rather than left blank. "Up to date" is the answer to the
      // question the version number raises, and it still reads as a button.
      return { label: "Up to date — check again", icon: RefreshCw, tone: "" };
    default:
      return { label: "Check for updates", icon: RefreshCw, tone: "" };
  }
}

export function VersionFooter({ updateState }: { updateState: UpdateState | null }) {
  const [version, setVersion] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await window.braveli?.getAppVersion?.();
      if (cancelled || !info) return;
      setVersion(info.version);
      setBlocked(info.installation?.ok === false ? info.installation.message ?? null : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!version) return null;

  const { label, icon: Icon, tone, spin } = describeUpdate(updateState, blocked);

  return (
    <button
      className={`dk-version${tone ? ` is-${tone}` : ""}`}
      type="button"
      title={blocked ?? updateState?.message ?? label}
      onClick={() => {
        if (blocked) void window.braveli?.openPath?.("/Applications");
        else if (updateState?.status === "ready") void window.braveli?.installUpdate?.();
        else if (updateState?.status === "available") void window.braveli?.downloadUpdate?.();
        else void window.braveli?.checkForUpdates?.();
      }}
    >
      <span className="dk-version-number dk-faint"><PitwallMark size={13} />Pitwall {version}</span>
      <span className="dk-version-action">
        {label}
        <Icon size={12} className={spin ? "dk-spin" : undefined} aria-hidden="true" />
      </span>
    </button>
  );
}
