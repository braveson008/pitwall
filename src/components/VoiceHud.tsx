import { AlertTriangle, Check, ChevronDown, ChevronUp, Mic, MicOff, Play, Settings2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceLogEntry } from "../hooks/useVoice";
import { writeStored } from "../lib/storage";

const qualityLabel: Record<string, string> = {
  premium: "Premium",
  enhanced: "Enhanced",
  default: "Compact",
};

/**
 * Voice, tone and how long a pause counts as "finished talking".
 *
 * The quality notice is the important part. Only Apple's compact voices ship
 * by default, and they sound thin no matter which one is chosen — so when no
 * neural voice is installed the panel says so and gives the exact path, rather
 * than leaving the user to conclude the feature is simply poor.
 */
function VoiceSettings({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    const result = await window.braveli?.listVoices();
    if (result) setCatalog(result);
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (patch: { voiceIdentifier?: string; preset?: string; silenceTimeout?: number }) => {
    setCatalog((current) => (current ? { ...current, ...patch, selected: patch.voiceIdentifier ?? current.selected } : current));
    await window.braveli?.setVoice(patch);
    // Audition every change immediately — picking a voice you cannot hear is
    // guesswork, and the whole point of this panel is how it sounds.
    await window.braveli?.previewVoice({
      voiceIdentifier: patch.voiceIdentifier ?? catalog?.selected,
      preset: patch.preset ?? catalog?.preset,
    });
  };

  return (
    <div className="dk-voice-settings">
      <header className="dk-voice-settings-head">
        <span>Voice</span>
        <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={onClose} aria-label="Close voice settings">
          <X size={13} />
        </button>
      </header>

      {busy ? <p className="dk-hint">Loading voices…</p> : null}

      {catalog?.quality?.needsDownload ? (
        <p className="dk-voice-warning">{catalog.quality.message}</p>
      ) : null}

      {catalog?.voices?.length ? (
        <label className="dk-field">
          <span className="dk-label">Voice</span>
          <select
            className="dk-select"
            value={catalog.selected}
            onChange={(changeEvent) => void update({ voiceIdentifier: changeEvent.target.value })}
          >
            {catalog.voices.map((voice) => (
              <option key={voice.identifier} value={voice.identifier}>
                {voice.name} · {voice.language} · {qualityLabel[voice.quality] ?? voice.quality}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {catalog?.presets?.length ? (
        <div className="dk-field">
          <span className="dk-label">Tone</span>
          <div className="dk-voice-presets">
            {catalog.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`dk-chip${preset.id === catalog.preset ? " is-on" : ""}`}
                aria-pressed={preset.id === catalog.preset}
                title={preset.description}
                onClick={() => void update({ preset: preset.id })}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {catalog ? (
        <label className="dk-field">
          <span className="dk-label">
            Act after <strong className="dk-voice-value">{catalog.silenceTimeout.toFixed(1)}s</strong> of silence
          </span>
          <input
            className="dk-voice-range"
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={catalog.silenceTimeout}
            onChange={(changeEvent) => {
              const silenceTimeout = Number(changeEvent.target.value);
              setCatalog((current) => (current ? { ...current, silenceTimeout } : current));
            }}
            onPointerUp={(pointerEvent) =>
              void window.braveli?.setVoice({ silenceTimeout: Number(pointerEvent.currentTarget.value) })
            }
          />
        </label>
      ) : null}

      <button
        type="button"
        className="dk-btn dk-btn--sm dk-voice-preview"
        onClick={() => void window.braveli?.previewVoice({})}
      >
        <Play size={12} /> Hear it
      </button>
    </div>
  );
}

const stateLabel: Record<VoiceState, string> = {
  off: "Voice off",
  listening: "Listening for “Pitwall”",
  capturing: "Listening…",
  thinking: "Working out what you meant…",
  working: "Working…",
  speaking: "Speaking",
  awaiting_confirmation: "Waiting for you to confirm",
};

/**
 * The voice HUD.
 *
 * Its real job is to make an audio-first interaction inspectable. Someone who
 * did not hear what Pitwall said, or who is not sure whether it heard them,
 * needs to be able to look. So the panel shows the live transcript as it is
 * being recognised, what was actually understood, and — most importantly — a
 * confirmation prompt with real buttons.
 *
 * The buttons matter for a reason beyond convenience: a destructive action
 * should never be approvable *only* by saying a word out loud, because that is
 * the one input channel that can be triggered by a television in the next room.
 */
export function VoiceHud({
  state,
  enabled,
  available,
  partial,
  settling,
  level,
  confirmation,
  error,
  log,
  onToggle,
  onPushToTalk,
  onConfirm,
  onCancelConfirmation,
  onStopSpeaking,
  onEndTurn,
  onSubmitText,
  onDismissError,
}: {
  state: VoiceState;
  enabled: boolean;
  available: boolean;
  partial: string;
  settling: number | null;
  level: number;
  confirmation: { id: string; question: string; capabilityId: string } | null;
  error: { message: string; fatal: boolean } | null;
  log: VoiceLogEntry[];
  onToggle: () => void;
  onPushToTalk: () => void;
  onConfirm: () => void;
  onCancelConfirmation: () => void;
  onStopSpeaking: () => void;
  onEndTurn: () => void;
  onSubmitText: (text: string) => void;
  onDismissError: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Collapsed state outlives a reload: an assistant panel you have deliberately
  // put away should stay away.
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem("braveli-voice-minimized") === "true";
    } catch {
      return false;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      writeStored("braveli-voice-minimized", String(minimized));
    } catch {
      // A private-mode profile is not a reason to break the panel.
    }
  }, [minimized]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log.length, partial]);

  const listening = enabled && state !== "off";
  // A meter that only moves in the top decade of its range reads as broken;
  // speech RMS lives around 0.02–0.2, so it is scaled to that.
  const meter = Math.min(100, Math.round(Math.sqrt(Math.min(level, 0.35) / 0.35) * 100));

  const confirmPrompt = confirmation ? (
    <div className="dk-voice-confirm" role="alertdialog" aria-label="Confirm action">
      <p>{confirmation.question}</p>
      <div className="dk-voice-confirm-actions">
        <button type="button" className="dk-btn dk-btn--sm" onClick={onCancelConfirmation}>
          Cancel
        </button>
        <button type="button" className="dk-btn dk-btn--danger dk-btn--primary dk-btn--sm" onClick={onConfirm}>
          <Check size={13} /> Yes, do it
        </button>
      </div>
    </div>
  ) : null;

  return (
    <aside
      className={`dk-voice${listening ? " is-live" : ""}${minimized ? " is-minimized" : ""}`}
      aria-label="Voice assistant"
      aria-live="polite"
    >
      <header className="dk-voice-header">
        <button
          type="button"
          className={`dk-icon-btn dk-voice-toggle${listening ? " is-on" : ""}`}
          onClick={onToggle}
          disabled={!available}
          title={available ? (listening ? "Turn voice off" : "Turn voice on") : "Run npm run build:voice first"}
          aria-label={listening ? "Turn voice off" : "Turn voice on"}
          aria-pressed={listening}
        >
          {listening ? <Mic size={15} /> : <MicOff size={15} />}
        </button>

        <div className="dk-voice-status">
          <span className={`dk-voice-state is-${state}`}>{stateLabel[state]}</span>
          <div className="dk-voice-meter" aria-hidden="true">
            <span style={{ width: `${listening ? meter : 0}%` }} />
          </div>
        </div>

        {state === "speaking" ? (
          <button type="button" className="dk-icon-btn dk-icon-btn--sm dk-voice-extra" onClick={onStopSpeaking} title="Stop speaking" aria-label="Stop speaking">
            <Square size={13} />
          </button>
        ) : state === "capturing" || state === "thinking" || state === "working" || state === "awaiting_confirmation" ? (
          <button type="button" className="dk-icon-btn dk-icon-btn--sm dk-voice-extra" onClick={onEndTurn} title="Stop — end this exchange" aria-label="Stop — end this exchange">
            <Square size={13} />
          </button>
        ) : (
          <button
            type="button"
            className="dk-icon-btn dk-icon-btn--sm dk-voice-extra"
            onClick={onPushToTalk}
            disabled={!available}
            title="Listen now, without the wake word"
            aria-label="Listen now, without the wake word"
          >
            <Mic size={13} />
          </button>
        )}

        <button
          type="button"
          className={`dk-icon-btn dk-icon-btn--sm dk-voice-extra${settingsOpen ? " is-current" : ""}`}
          onClick={() => setSettingsOpen((open) => !open)}
          title="Voice and tone"
          aria-label="Voice and tone"
          aria-expanded={settingsOpen}
        >
          <Settings2 size={13} />
        </button>

        <button
          type="button"
          className="dk-icon-btn dk-icon-btn--sm"
          onClick={() => setMinimized((value) => !value)}
          title={minimized ? "Show the conversation" : "Minimise to the status bar"}
          aria-label={minimized ? "Show the conversation" : "Minimise"}
          aria-expanded={!minimized}
        >
          {minimized ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </header>

      {minimized ? (
        confirmPrompt
      ) : (
        <>
          {settingsOpen ? <VoiceSettings onClose={() => setSettingsOpen(false)} /> : null}

          {error ? (
            <div className={`dk-voice-alert${error.fatal ? " is-fatal" : ""}`}>
              <AlertTriangle size={14} />
              <p>{error.message}</p>
              <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={onDismissError} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          ) : null}

          <div className="dk-voice-transcript" ref={scrollRef}>
            {log.length === 0 && !partial ? (
              <p className="dk-voice-empty">
                Say “Pitwall, what am I looking at?” — or type below. Destructive actions always ask first.
              </p>
            ) : null}

            {log.map((entry) => (
              <p
                key={entry.id}
                className={`dk-voice-line is-${entry.role}${entry.ok === false ? " is-error" : ""}`}
              >
                {entry.text}
              </p>
            ))}

            {partial ? (
              <p className="dk-voice-line is-user is-partial">
                {partial}
                {settling !== null ? <span className="dk-faint"> · acting in {settling.toFixed(1)}s</span> : null}
              </p>
            ) : null}
          </div>

          {confirmPrompt}

          <form
            className="dk-voice-input"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              const text = draft.trim();
              if (!text) return;
              setDraft("");
              onSubmitText(text);
            }}
          >
            <input
              className="dk-input"
              value={draft}
              onChange={(changeEvent) => setDraft(changeEvent.target.value)}
              placeholder="Type a request instead…"
              aria-label="Type a request for Pitwall"
            />
            <button type="submit" className="dk-btn" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
