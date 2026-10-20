import { ArrowUpRight, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { writeStoredJson } from "../lib/storage";

const LATER_KEY = "pitwall-update-later";
/** "Later" holds for this long before the banner asks once more. */
const ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;
const CHANGELOG_URL = "https://github.com/braveson008/pitwall/releases";

type Later = { version: string; at: number };

function readLater(): Later | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(LATER_KEY) || "null");
    return value && typeof value.version === "string" && typeof value.at === "number" ? value : null;
  } catch {
    return null;
  }
}

export function shouldOfferUpdate(state: UpdateState | null, later: Later | null, now = Date.now()) {
  if (state?.status !== "ready" || !state.availableVersion) return false;
  if (!later || later.version !== state.availableVersion) return true;
  return now - later.at > ASK_AGAIN_MS;
}

/**
 * A downloaded update, said once, where the work is.
 *
 * The version line in the sidebar always knew, but it is furniture; with
 * agents working, nobody quits, and an update that installs on quit waited
 * days. This asks once per version and is gone after either answer — "Later"
 * still installs the next time Pitwall quits.
 */
export function UpdateBanner({ state, workingCount, onRestart }: {
  state: UpdateState | null;
  /** Sessions whose agent is mid-turn: restarting interrupts them. */
  workingCount: number;
  onRestart: () => void;
}) {
  const [later, setLater] = useState<Later | null>(readLater);
  const offered = shouldOfferUpdate(state, later);
  useEffect(() => {
    if (offered) void window.pitwall?.captureEvent?.("update_offered", { surface: "update" });
  }, [offered]);
  if (!offered) return null;
  const version = state!.availableVersion!;

  const dismiss = () => {
    const next = { version, at: Date.now() };
    writeStoredJson(LATER_KEY, next);
    setLater(next);
  };

  return (
    <div className="dk-update-banner" role="status">
      <RotateCw size={15} aria-hidden="true" />
      <span className="dk-update-text">
        <strong>Pitwall {version} is ready.</strong>{" "}
        {workingCount > 0
          ? `Restarting interrupts ${workingCount === 1 ? "the agent that is" : `the ${workingCount} agents that are`} working; sessions reopen afterwards.`
          : "Restart to use it — your sessions reopen afterwards."}
      </span>
      <button type="button" className="dk-link-btn dk-update-notes" onClick={() => void window.pitwall?.openExternalUrl?.(CHANGELOG_URL)}>
        What&rsquo;s new <ArrowUpRight size={12} aria-hidden="true" />
      </button>
      <span className="dk-spacer" />
      <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={dismiss} title="It installs the next time Pitwall quits">
        Later
      </button>
      <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" onClick={() => {
        void window.pitwall?.captureEvent?.("update_restart_clicked", { surface: "update" });
        onRestart();
      }}>
        Restart now
      </button>
      <button type="button" className="dk-icon-btn" onClick={dismiss} aria-label="Dismiss">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
