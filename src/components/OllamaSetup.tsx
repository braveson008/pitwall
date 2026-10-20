import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { stripAnsi } from "../lib/ansi";
import { ModelTuning } from "./ModelTuning";

interface OllamaModel {
  name: string;
  size: number;
  parameters: string;
}

interface Status {
  installed: boolean;
  serving: boolean;
  models: OllamaModel[];
  state: "missing" | "stopped" | "empty" | "ready";
  message: string;
}

/**
 * A few models worth having, by what you would use them for.
 *
 * Deliberately short. A list of everything on the registry is a decision to
 * make rather than an answer, and somebody setting up local models for the
 * first time wants one that works on their machine.
 */
/**
 * A pull's output, made readable.
 *
 * `ollama pull` draws a progress bar by rewriting one line thousands of times,
 * with the cursor and screen-mode escapes that implies. Rendered into a plain
 * `<pre>` those escapes show as literal `[?25l [K` and every redraw becomes
 * another line, so the log grows without end and says the same thing.
 *
 * Keeping only the last state of the bar is both shorter and more accurate:
 * what is wanted is where the download has got to, not how it got there.
 */
export function cleanProgress(raw: string): string {
  const withoutEscapes = stripAnsi(raw).replace(/\r/g, "\n");

  const lines = withoutEscapes.split("\n").map((line) => line.trimEnd()).filter(Boolean);

  // Collapse consecutive redraws of the same layer into their latest state.
  const out: string[] = [];
  for (const line of lines) {
    const key = line.split(/\s{2,}/)[0];
    const previous = out[out.length - 1];
    if (previous && previous.split(/\s{2,}/)[0] === key) out[out.length - 1] = line;
    else out.push(line);
  }
  return out.slice(-40).join("\n");
}

const SUGGESTED = [
  { name: "qwen3-coder:30b", note: "Coding. Wants a good deal of memory." },
  { name: "llama3.3", note: "General purpose, a sensible first pull." },
  { name: "gemma3", note: "Small and quick." },
];

/**
 * Getting local models working, without the errands.
 *
 * Installing the binary is the easy part. What makes this a chore is what
 * comes after: the server has to be running, a model has to be pulled before
 * anything answers, and when either is missing the failure surfaces inside
 * whichever agent you pointed at Ollama — a connection refused, or a 404
 * naming a model you thought you had. Neither of those says "start Ollama"
 * or "pull one first".
 *
 * So the three states are shown in the order they have to be fixed, and each
 * one has the single button that fixes it.
 */
/** A harness Pitwall can install to drive a local model. */
interface BridgeSuggestion {
  id: string;
  name: string;
  catalogueId: string;
  licence: string;
  why: string;
  tradeoff: string;
  setup: string;
}

export function OllamaSetup({ onAgentReady, onInstallAgent }: {
  onAgentReady?: (agent: {
    name: string; command: string; args: string; models: string; modelDiscoveryCommand: string; login: string;
  }) => void;
  /** Installs one of the suggested harnesses through the catalogue's own flow. */
  onInstallAgent?: (catalogueId: string) => void;
} = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [pulling, setPulling] = useState("");
  const [output, setOutput] = useState("");
  const [custom, setCustom] = useState("");
  const [bridge, setBridge] = useState<{
    state: string;
    message: string;
    agents?: string[];
    suggestion?: string;
    suggestions?: BridgeSuggestion[];
    via?: string;
    fallback?: { id: string; name: string; vendor: string } | null;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState("");
  const [confirmRemove, setConfirmRemove] = useState("");
  // Which model is being fitted to the machine, if any.
  const [tuning, setTuning] = useState("");
  const [connecting, setConnecting] = useState("");
  const [connected, setConnected] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const refresh = async () => {
    const next = await window.braveli?.ollamaStatus?.();
    if (!next) return;
    setStatus(next as Status);
    // A model on its own cannot edit code. Ask what could drive it.
    const names = (next.models ?? []).map((model: OllamaModel) => model.name);
    const status = await window.braveli?.ollamaBridgeStatus?.({ models: names });
    if (status?.ok) setBridge(status);
  };

  useEffect(() => { void refresh(); }, []);

  // A pull is gigabytes over a network; showing its progress is the difference
  // between waiting and wondering whether it has hung.
  useEffect(() => window.braveli?.onOllamaPullOutput?.((data) => {
    setOutput((current) => `${current}${data.chunk}`);
  }), []);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [output]);

  const serve = async () => {
    setBusy("serve");
    try {
      await window.braveli?.ollamaServe?.();
      await refresh();
    } finally { setBusy(""); }
  };

  const pull = async (model: string) => {
    if (!model.trim()) return;
    setPulling(model);
    setOutput("");
    try {
      await window.braveli?.ollamaPull?.({ model: model.trim() });
      await refresh();
    } finally { setPulling(""); }
  };

  /**
   * Deleting a model asks first, and says how much it frees.
   *
   * These are the largest things Pitwall puts on a disk — twenty gigabytes
   * for one — and pulling it again is an hour. A one-press delete beside a
   * one-press pull would eventually be pressed by mistake.
   */
  const remove = async (model: string) => {
    if (confirmRemove !== model) { setConfirmRemove(model); return; }
    setRemoving(model);
    try {
      const result = await window.braveli?.ollamaRemove?.({ model });
      if (!result?.ok && result?.error) setOutput(result.error);
      await refresh();
    } finally { setRemoving(""); setConfirmRemove(""); }
  };

  const cancelPull = async () => {
    if (!pulling) return;
    setCancelling(true);
    try {
      await window.braveli?.ollamaPullCancel?.({ model: pulling });
    } finally { setCancelling(false); }
  };

  const use = async (model: string) => {
    const agentId = bridge?.agents?.[0] ?? bridge?.fallback?.id;
    if (!agentId) return;
    setConnecting(model);
    try {
      const result = await window.braveli?.connectOllamaAgent?.({
        agentId,
        model,
        models: status?.models.map((entry) => entry.name) ?? [model],
      });
      if (result?.ok && result.agent) {
        onAgentReady?.(result.agent);
        setConnected(model);
      }
    } finally { setConnecting(""); }
  };

  if (!status) return <p className="dk-hint">Checking Ollama…</p>;

  return (
    <div className="dk-ollama">
      {status.message ? <p className="dk-hint">{status.message}</p> : null}

      {status.installed && !status.serving ? (
        <span>
          <button className="dk-btn dk-btn--sm dk-btn--primary" type="button" disabled={busy === "serve"} onClick={() => void serve()}>
            {busy === "serve" ? <LoaderCircle className="dk-spin" size={13} /> : null}
            {busy === "serve" ? "Starting" : "Start Ollama"}
          </button>
        </span>
      ) : null}

      {status.serving ? (
        <>
          {status.models.length > 0 ? (
            <div className="dk-section">
              <h3 className="dk-section-title">On this machine</h3>
              {/* Each model gets the action that makes it usable. Showing a
                  model with nothing to do next was the whole complaint: Pitwall
                  installed Ollama, pulled the model, listed it, and stopped. */}
              <ul className="dk-list">
                {status.models.map((model: OllamaModel) => (
                  <li className="dk-list-row dk-ollama-model" key={model.name}>
                    <span className="dk-row-main">
                      <span className="dk-row-title dk-mono">{model.name}</span>
                      <span className="dk-row-sub">
                        {[model.parameters, model.size ? `${(model.size / 1e9).toFixed(1)} GB` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>

                    {bridge?.state === "automatic" ? (
                      // Already offered in the session dialog, so there is
                      // nothing to press. Saying so beats a button whose only
                      // effect would be a duplicate row.
                      <span className="dk-status"><span className="dk-dot is-ready" aria-hidden="true" />Ready</span>
                    ) : connected === model.name ? (
                      <span className="dk-status"><span className="dk-dot is-ready" aria-hidden="true" />Added</span>
                    ) : bridge?.state === "ready" || bridge?.fallback ? (
                      <button type="button" className="dk-btn dk-btn--sm" disabled={Boolean(connecting)} onClick={() => void use(model.name)}>
                        {connecting === model.name ? "Connecting…" : "Use this model"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`dk-btn dk-btn--sm dk-btn--ghost${tuning === model.name ? " is-current" : ""}`}
                      onClick={() => setTuning(tuning === model.name ? "" : model.name)}
                      aria-expanded={tuning === model.name}
                      title={`Set the context window and memory behaviour for ${model.name}`}
                    >
                      Configure
                    </button>
                    <button
                      type="button"
                      className={`dk-btn dk-btn--sm dk-btn--ghost dk-btn--danger${confirmRemove === model.name ? " is-confirming" : ""}`}
                      disabled={Boolean(removing)}
                      onClick={() => void remove(model.name)}
                      onBlur={() => setConfirmRemove("")}
                      title={`Delete ${model.name} from this machine`}
                    >
                      {removing === model.name
                        ? "Deleting…"
                        : confirmRemove === model.name
                          ? `Delete ${(model.size / 1e9).toFixed(1)} GB?`
                          : "Delete"}
                    </button>

                    {tuning === model.name ? (
                      <ModelTuning model={model.name} onClose={() => setTuning("")} />
                    ) : null}
                  </li>
                ))}
              </ul>
              {bridge?.state === "needs-agent" || bridge?.state === "automatic" ? (
                <p className="dk-hint">{bridge.message}</p>
              ) : null}

              {/* Installed, works, and deliberately not reached for on its
                  own. Naming it is the honest middle: the default stays
                  neutral, and the user can still choose the tool they
                  already have. */}
              {bridge?.state === "needs-agent" && bridge.fallback ? (
                <p className="dk-hint">
                  You already have {bridge.fallback.name}. It drives local models fine and sends nothing to{" "}
                  {bridge.fallback.vendor} — pick a model below to use it anyway.
                </p>
              ) : null}

              {/* A choice, rather than a sentence telling you to go and make
                  one elsewhere. Not installed silently — Aider alone pulls
                  three hundred dependencies and a Python toolchain, and it is
                  the one that cannot use your MCP servers, so which harness
                  you end up with is not a detail to decide on somebody's
                  behalf. */}
              {bridge?.state === "needs-agent" && bridge.suggestions?.length ? (
                <ul className="dk-list">
                  {bridge.suggestions.map((suggestion) => (
                    <li className="dk-list-row" key={suggestion.id}>
                      <div className="dk-row-main">
                        <span className="dk-row-title">
                          {suggestion.name} <span className="dk-faint">{suggestion.licence}</span>
                        </span>
                        <p className="dk-step-desc">{suggestion.why}</p>
                        <p className="dk-step-desc dk-faint">{suggestion.tradeoff}</p>
                        <p className="dk-step-desc dk-faint">{suggestion.setup}</p>
                      </div>
                      <button
                        type="button"
                        className="dk-btn dk-btn--sm"
                        onClick={() => onInstallAgent?.(suggestion.catalogueId)}
                      >
                        Install {suggestion.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="dk-section">
            <h3 className="dk-section-title">Pull a model</h3>
            <div className="dk-toolbar">
              {SUGGESTED.filter((model) => !status.models.some((have: OllamaModel) => have.name.startsWith(model.name.split(":")[0]))).map((model) => (
                <button
                  key={model.name}
                  type="button"
                  className="dk-chip dk-mono"
                  title={model.note}
                  disabled={Boolean(pulling)}
                  onClick={() => void pull(model.name)}
                >
                  {pulling === model.name ? <LoaderCircle className="dk-spin" size={12} /> : null}
                  {model.name}
                </button>
              ))}
            </div>
            <div className="dk-toolbar">
              <input
                className="dk-input dk-ollama-input"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="or a name from ollama.com/library"
                aria-label="Model to pull"
                onKeyDown={(event) => { if (event.key === "Enter") void pull(custom); }}
              />
              <button type="button" className="dk-btn" disabled={!custom.trim() || Boolean(pulling)} onClick={() => void pull(custom)}>
                Pull
              </button>
            </div>
          </div>
        </>
      ) : null}

      {pulling ? (
        <div className="dk-toolbar">
          <span className="dk-status is-working">
            <LoaderCircle className="dk-spin" size={13} />
            Pulling <code className="dk-mono">{pulling}</code>
          </span>
          {/* A model is tens of gigabytes over somebody's connection. Starting
              one with no way out spends an hour of their bandwidth for them. */}
          <button type="button" className="dk-btn dk-btn--sm" disabled={cancelling} onClick={() => void cancelPull()}>
            {cancelling ? "Stopping…" : "Stop"}
          </button>
        </div>
      ) : null}

      {output ? <pre className="dk-log" ref={logRef}>{cleanProgress(output)}</pre> : null}
    </div>
  );
}
