import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The renderer's half of the voice loop.
 *
 * Two jobs, and deliberately no third one:
 *
 *  1. Mirror the main process's voice state so the HUD can render it.
 *  2. Answer capability calls whose state lives up here — switching projects,
 *     opening files, starting sessions. Those handlers are passed in from
 *     `App.tsx` because that is where the state already is; this hook only
 *     routes to them and guarantees every call gets exactly one reply.
 *
 * It contains no interpretation of what the user said. That is the router's
 * job in main, which is what keeps voice from becoming a second, divergent
 * copy of the app's logic.
 */

export type VoiceHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;
export type VoiceHandlers = Record<string, VoiceHandler>;

export interface VoiceLogEntry {
  id: string;
  role: "user" | "braveli";
  text: string;
  at: number;
  capabilityId?: string;
  ok?: boolean;
}

const MAX_LOG = 40;

export function useVoice(handlers: VoiceHandlers) {
  const [state, setState] = useState<VoiceState>("off");
  const [enabled, setEnabled] = useState(false);
  const [partial, setPartial] = useState("");
  const [settling, setSettling] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [confirmation, setConfirmation] = useState<{ id: string; question: string; capabilityId: string } | null>(null);
  const [error, setError] = useState<{ message: string; fatal: boolean } | null>(null);
  const [available, setAvailable] = useState(false);
  const [log, setLog] = useState<VoiceLogEntry[]>([]);

  // Handlers are re-created every render in App.tsx; a ref keeps the IPC
  // subscription from tearing down and re-subscribing on each one, which would
  // drop calls that arrive mid-swap.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const append = useCallback((entry: Omit<VoiceLogEntry, "id" | "at">) => {
    setLog((current) => [...current, { ...entry, id: `${Date.now()}-${current.length}`, at: Date.now() }].slice(-MAX_LOG));
  }, []);

  useEffect(() => {
    const api = window.braveli;
    if (!api?.onVoiceEvent) return;

    void api.getVoiceStatus().then((status) => {
      if (!status?.ok) return;
      setState(status.state);
      setEnabled(status.enabled);
      setConfirmation(status.pendingConfirmation);
      setAvailable(status.engineBuilt);
      if (!status.engineBuilt) {
        setError({ message: "The voice engine hasn't been built. Run `npm run build:voice`.", fatal: false });
      }
    });

    return api.onVoiceEvent((event) => {
      switch (event.type) {
        case "voice:state":
          setState(event.state);
          setEnabled(event.enabled);
          if (event.state !== "capturing") {
            setPartial("");
            setSettling(null);
          }
          break;
        case "voice:ready":
          setAvailable(true);
          if (!event.granted) {
            setError({
              message: "Pitwall needs Microphone and Speech Recognition access in System Settings › Privacy & Security.",
              fatal: true,
            });
          } else {
            setError(null);
          }
          break;
        case "voice:partial":
          setPartial(event.text);
          break;
        case "voice:settling":
          // The mic has gone quiet and the endpoint countdown is running.
          setSettling(event.seconds);
          break;
        case "voice:heard":
          setPartial("");
          setSettling(null);
          append({ role: "user", text: event.text });
          break;
        case "voice:say":
          append({ role: "braveli", text: event.text });
          break;
        case "voice:result":
          setLog((current) => {
            // Attach the outcome to the line Pitwall just spoke, so a failure
            // reads as a failure rather than as a confident sentence.
            const index = current.map((entry) => entry.role).lastIndexOf("braveli");
            if (index === -1) return current;
            const next = [...current];
            next[index] = { ...next[index], ok: event.result.ok, capabilityId: event.result.capabilityId };
            return next;
          });
          break;
        case "voice:confirmation":
          setConfirmation(event.confirmation);
          break;
        case "voice:level":
          setLevel(event.rms);
          break;
        case "voice:error":
          setError({ message: event.message, fatal: event.fatal });
          if (event.fatal) setEnabled(false);
          break;
        default:
          break;
      }
    });
  }, [append]);

  // Renderer-surface capabilities. Every call must be answered exactly once —
  // main is holding a promise with a timeout behind each one.
  useEffect(() => {
    const api = window.braveli;
    if (!api?.onVoiceRendererCall) return;

    return api.onVoiceRendererCall(async ({ id, capabilityId, params }) => {
      const handler = handlersRef.current[capabilityId];
      if (!handler) {
        api.respondToVoiceCall({ id, result: { ok: false, error: `${capabilityId} is not wired up in the UI.` } });
        return;
      }
      try {
        const result = await handler(params);
        api.respondToVoiceCall({
          id,
          result: result && typeof result === "object" ? result : { ok: true },
        });
      } catch (thrown) {
        api.respondToVoiceCall({
          id,
          result: { ok: false, error: thrown instanceof Error ? thrown.message : String(thrown) },
        });
      }
    });
  }, []);

  const start = useCallback(async (config?: VoiceConfig) => {
    const result = await window.braveli?.startVoice(config);
    if (result && !result.ok) setError({ message: result.error || "Voice could not start.", fatal: false });
    else setError(null);
    return result;
  }, []);

  const stop = useCallback(async () => window.braveli?.stopVoice(), []);
  const listenOnce = useCallback(async () => window.braveli?.voiceListenOnce(), []);
  const submitText = useCallback(async (text: string) => window.braveli?.submitVoiceText({ text }), []);
  const confirm = useCallback(async () => window.braveli?.confirmVoiceAction(), []);
  const cancelConfirmation = useCallback(async () => window.braveli?.cancelVoiceConfirmation(), []);
  const stopSpeaking = useCallback(async () => window.braveli?.stopVoiceSpeaking(), []);
  /** End the exchange but keep the microphone on. */
  const endTurn = useCallback(async () => window.braveli?.endVoiceTurn(), []);
  const clearLog = useCallback(() => setLog([]), []);

  const busy = useMemo(() => state === "thinking" || state === "working", [state]);

  return {
    state,
    enabled,
    available,
    busy,
    partial,
    settling,
    level,
    confirmation,
    error,
    log,
    start,
    stop,
    listenOnce,
    submitText,
    confirm,
    cancelConfirmation,
    stopSpeaking,
    endTurn,
    clearLog,
    dismissError: () => setError(null),
  };
}
