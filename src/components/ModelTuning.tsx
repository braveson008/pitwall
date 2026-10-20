import { useEffect, useState } from "react";

/**
 * Fitting a model to the machine it runs on.
 *
 * The context window is the only setting here that changes whether a local
 * agent works, and it is the one nobody can guess: it is a memory allocation,
 * not a preference. Ask for more than the machine has and Ollama does not
 * refuse — it serves less and says nothing, and the harness on the other end
 * fills the window it was promised. That is how a working model ends up
 * printing tool calls as plain text: its prompt is truncated from the front and
 * the tool definitions go with it.
 *
 * So this panel is arithmetic rather than a slider. Every window is priced
 * against this machine from the model's own dimensions, what will not fit is
 * said plainly, and after applying, what Ollama actually loaded is read back
 * and shown — because what was asked for is not evidence of anything.
 */

type Choice = { tokens: number; cacheBytes: number; totalBytes: number; fits: boolean; tight: boolean };

type Tuning = {
  ok: boolean;
  error?: string;
  totalMemoryBytes?: number;
  modelBytes?: number;
  bytesPerToken?: number;
  exact?: boolean;
  declaredMax?: number;
  choices?: Choice[];
  recommended?: number;
  servedContext?: number;
  residentBytes?: number;
  saved?: { context: number; keepAlive: string };
  keepAliveChoices?: Array<{ value: string; label: string; hint?: string }>;
};

/**
 * Bytes in the unit that suits them.
 *
 * Forcing gigabytes printed the per-token cost as "0.1 GB per 1k tokens",
 * which is both imprecise and hard to hold in your head next to a 22 GB total.
 * The same number as "98 MB" is neither.
 */
const size = (bytes: number) => {
  const value = Number(bytes) || 0;
  if (value < 1e9) return `${Math.round(value / 1e6)} MB`;
  const gigabytes = value / 1e9;
  return gigabytes >= 10 ? `${Math.round(gigabytes)} GB` : `${gigabytes.toFixed(1)} GB`;
};

const windowLabel = (tokens: number) => (tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens));

export function ModelTuning({ model, onClose }: { model: string; onClose: () => void }) {
  const [tuning, setTuning] = useState<Tuning | null>(null);
  const [context, setContext] = useState(0);
  const [keepAlive, setKeepAlive] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ served: number; short: boolean; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const next = await window.pitwall?.ollamaTuning?.({ model });
      if (!live || !next) return;
      setTuning(next);
      // What is set, else what is loaded, else what this machine can afford.
      setContext(next.saved?.context || next.servedContext || next.recommended || 0);
      setKeepAlive(next.saved?.keepAlive || "30m");
    })();
    return () => { live = false; };
  }, [model]);

  async function apply() {
    setApplying(true);
    setResult(null);
    const next = await window.pitwall?.ollamaTune?.({ model, context, keepAlive });
    setApplying(false);
    if (!next) return;
    setResult({ served: next.served ?? 0, short: Boolean(next.short), error: next.error });
    // Re-read rather than assume: the panel should show what is true now.
    const refreshed = await window.pitwall?.ollamaTuning?.({ model });
    if (refreshed) setTuning(refreshed);
  }

  // Closing is the Configure button's job — it is a toggle and already says so
  // with aria-expanded. A second control for the same thing, flung to the far
  // side of the panel, was one more thing to read and nothing more to do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!tuning) return <div className="dk-tuning dk-hint">Reading what this model costs…</div>;
  if (!tuning.ok) return <div className="dk-tuning dk-error">{tuning.error}</div>;

  const choices = tuning.choices ?? [];
  const perToken = tuning.bytesPerToken ?? 0;
  const chosen = choices.find((choice) => choice.tokens === context);

  /**
   * One line about the window in hand, replacing the four-column table of
   * facts and the two paragraphs of prose that surrounded it. Everything the
   * table held is either here or on the option itself.
   */
  const verdict = !chosen
    ? ""
    : !chosen.fits
      ? `needs ${size(chosen.totalBytes)} — more than this machine can spare`
      : chosen.tight
        ? `${size(chosen.totalBytes)} — fits, with little left over`
        : `${size(chosen.totalBytes)} of ${size(tuning.totalMemoryBytes ?? 0)}`;

  return (
    <div className="dk-tuning">
      <div className="dk-tuning-head">
        <span className="dk-section-title">Fit to this machine</span>
        <span className="dk-hint">
          {size(tuning.modelBytes ?? 0)} model
          {perToken ? ` · ${size(perToken * 1024)} per 1k tokens` : ""}
          {perToken && !tuning.exact ? " (est.)" : ""}
          {tuning.servedContext ? ` · loaded at ${windowLabel(tuning.servedContext)}` : ""}
        </span>
      </div>

      <div className="dk-toolbar">
        <div className="dk-segmented" role="radiogroup" aria-label="Context window">
          {choices.map((choice) => (
            <button
              key={choice.tokens}
              type="button"
              role="radio"
              aria-checked={context === choice.tokens}
              className={[
                context === choice.tokens ? "is-current" : "",
                choice.fits ? (choice.tight ? "is-tight" : "") : "is-over",
              ].filter(Boolean).join(" ") || undefined}
              title={`${size(choice.totalBytes)} resident`}
              onClick={() => setContext(choice.tokens)}
            >
              {windowLabel(choice.tokens)}
            </button>
          ))}
        </div>
        {/* The cost of the one you are on, rather than a number under every
            option — six totals to read when only one of them applies. */}
        <span className={`dk-tuning-verdict${chosen && !chosen.fits ? " is-over" : ""}`}>{verdict}</span>
      </div>

      <div className="dk-toolbar">
        <label className="dk-tuning-keep">
          <span className="dk-label">Keep loaded</span>
          <select className="dk-select" value={keepAlive} onChange={(event) => setKeepAlive(event.target.value)}>
            {(tuning.keepAliveChoices ?? []).map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="dk-btn dk-btn--sm" disabled={applying || !context} onClick={() => void apply()}>
          {applying ? "Loading…" : "Apply"}
        </button>
        {result ? (
          <span className={`dk-status ${result.error || result.short ? "is-needs" : "is-working"}`}>
            {result.error
              ? result.error
              : result.short
                // The one thing worth a sentence: Ollama serving less than it
                // was asked for, silently, is the failure this panel exists for.
                ? `Ollama served ${windowLabel(result.served)}, not ${windowLabel(context)} — not enough memory.`
                : `Serving ${windowLabel(result.served)}.`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
