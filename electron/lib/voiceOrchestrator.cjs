/**
 * The conversation loop: wake word in, work done, sentence out.
 *
 * This module holds the *turn*, not the business logic. It decides when an
 * utterance is an answer to a question Pitwall asked versus a fresh request,
 * when to stop talking, and what to say when something fails. What a request
 * actually does is the capability registry's problem, and how to interpret it
 * is the router's — which is what keeps voice a transport.
 *
 * ## Why yes/no never reaches the model
 *
 * Confirmations are matched here with a fixed word list. Sending "yes" to a
 * language model to ask whether it meant yes adds a second of latency to the
 * most latency-sensitive moment in the interaction, and introduces a way for a
 * destructive action to be approved by a misread. A short, closed vocabulary
 * that fails safe is the right tool.
 *
 * Anything that is *not* clearly yes or no cancels the pending confirmation and
 * is treated as a new request. Silence, a cough, or a sentence about something
 * else must never approve a delete.
 */

const { parseUndoRequest, parseCorrection } = require("./voiceCorrections.cjs");

const AFFIRMATIONS = [
  "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed",
  "do it", "go ahead", "go for it", "please do", "affirmative", "correct", "that's right",
];

const NEGATIONS = [
  "no", "nope", "nah", "cancel", "stop", "don't", "dont", "do not", "never mind",
  "nevermind", "abort", "forget it", "leave it", "negative",
];

const INTERRUPTIONS = ["stop", "stop talking", "be quiet", "shut up", "quiet", "cancel", "never mind", "nevermind"];

/** Said only when routing needs the model, which costs several seconds. */
const THINKING_ACKNOWLEDGEMENT = "One moment.";
/** Long enough that a locally-routed command never triggers it. */
const THINKING_ACKNOWLEDGEMENT_DELAY_MS = 700;

/** When a slow capability says nothing about its own timing. */
const DEFAULT_PROGRESS_DELAY_MS = 10_000;

function normalizeAnswer(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a short utterance as an answer to a yes/no question.
 * Returns "yes", "no", or null when it is not an answer at all.
 */
function classifyConfirmation(text) {
  const normalized = normalizeAnswer(text);
  if (!normalized) return null;

  // A long sentence is a new instruction that happens to start with "no",
  // not an answer. Treating it as an answer is how "no, open the other file"
  // would silently become a refusal and lose the actual request.
  const wordCount = normalized.split(" ").length;
  if (wordCount > 5) return null;

  const matches = (phrases) =>
    phrases.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `) || normalized.endsWith(` ${phrase}`));

  // Negation is checked first: "no, go ahead" is contradictory, and refusing
  // is the safe reading of a contradiction.
  if (matches(NEGATIONS)) return "no";
  if (AFFIRMATIONS.includes(normalized)) return "yes";
  return null;
}

function isInterruption(text) {
  const normalized = normalizeAnswer(text);
  return INTERRUPTIONS.includes(normalized);
}

const STATES = Object.freeze({
  OFF: "off",
  LISTENING: "listening",
  CAPTURING: "capturing",
  THINKING: "thinking",
  WORKING: "working",
  SPEAKING: "speaking",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
});

function createVoiceOrchestrator(deps) {
  const { sidecar, registry, router, memory, getContext, emit, log = () => {} } = deps;

  let state = STATES.OFF;
  let enabled = false;
  let pendingConfirmation = null;
  let lastTranscript = "";
  const history = [];

  function setState(next, extra = {}) {
    state = next;
    emit({ type: "voice:state", state: next, enabled, ...extra });
  }

  function say(text, { id = `speak-${Date.now()}` } = {}) {
    if (!text) return;
    emit({ type: "voice:say", text });
    sidecar.speak(text, id);
  }

  /**
   * Speech is capped before it reaches the synthesiser. A capability that
   * returns a wall of text would otherwise have the assistant read a diff
   * aloud for two minutes with no way to skip.
   */
  function trimForSpeech(text, limit = 700) {
    const clean = String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*_`#>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit);
    const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return `${boundary > limit * 0.5 ? cut.slice(0, boundary + 1) : cut}…`;
  }

  async function handleTranscript(text) {
    lastTranscript = text;
    emit({ type: "voice:heard", text });

    if (pendingConfirmation) {
      const answer = classifyConfirmation(text);
      if (answer === "yes") return runConfirmed();
      if (answer === "no") {
        registry.cancelPendingConfirmation();
        pendingConfirmation = null;
        say("Okay, I won't.");
        setState(STATES.LISTENING);
        return { ok: true, cancelled: true };
      }
      // Neither: the user moved on. Drop the dangerous pending action rather
      // than leave it armed while a new request runs.
      log(`Pending confirmation for ${pendingConfirmation.capabilityId} dropped: user said something else.`);
      registry.cancelPendingConfirmation();
      pendingConfirmation = null;
      emit({ type: "voice:confirmation", confirmation: null });
    }

    if (isInterruption(text)) {
      sidecar.stopSpeaking();
      setState(STATES.LISTENING);
      return { ok: true, interrupted: true };
    }

    // Checked before routing, and before the correction below: "no, undo that"
    // is an undo, not a correction whose content happens to be the word undo.
    if (parseUndoRequest(text)) return runUndo();

    // A correction is re-routed as if the corrected words had been said alone.
    // Stripping "no, I meant" is not cosmetic — it is what lets the remainder
    // hit the local matcher instead of paying a model round-trip at the exact
    // moment the user is already annoyed.
    let request = text;
    const correction = parseCorrection(text);
    if (correction) {
      log(`Correction: "${correction.original}" → "${correction.corrected}"`);
      request = correction.corrected;
      emit({ type: "voice:corrected", from: correction.original, to: correction.corrected });
    }

    setState(STATES.THINKING, { transcript: request });

    // Routing is instant when it resolves locally and takes seconds when it
    // needs the model. Silence is indistinguishable from not having been heard,
    // so the slow path gets an acknowledgement — fired on a delay so the fast
    // path never says anything before simply doing the thing.
    let acknowledged = false;
    const acknowledgement = setTimeout(() => {
      acknowledged = true;
      say(THINKING_ACKNOWLEDGEMENT);
    }, THINKING_ACKNOWLEDGEMENT_DELAY_MS);

    let routed;
    try {
      routed = await router.route({ transcript: request, registry, context: await getContext(), history });
    } finally {
      clearTimeout(acknowledgement);
    }

    if (!routed.ok) {
      say(routed.error || "I didn't catch that.");
      setState(STATES.LISTENING);
      return routed;
    }

    emit({ type: "voice:intent", intent: routed.intent, transcript: routed.transcript });
    history.push({ transcript: routed.transcript, capabilityId: routed.intent.capabilityId });
    if (history.length > 12) history.shift();

    // The router's own sentence is spoken before the work starts, so a slow
    // capability does not feel like the assistant ignored the request. Skipped
    // when the delay already prompted an acknowledgement — saying "one moment"
    // and then "checking git status" before actually checking it is two
    // sentences of throat-clearing.
    if (routed.intent.say && !acknowledged) say(routed.intent.say);

    return execute(routed.intent);
  }

  /**
   * Say something while a slow capability runs.
   *
   * "One moment" covers the routing hop, which is seconds. Running a test suite
   * is a different order of magnitude, and to someone not looking at the screen
   * forty seconds of silence after "one moment" is indistinguishable from a
   * crash. The line is spoken once and only by capabilities that declare
   * themselves slow — a reassurance on every action would be chatter, and
   * chatter is what makes people turn an assistant off.
   */
  function startProgressReassurance(capabilityId) {
    const progress = registry.get?.(capabilityId)?.progress;
    if (!progress?.say) return () => {};
    const timer = setTimeout(() => say(progress.say), progress.afterMs ?? DEFAULT_PROGRESS_DELAY_MS);
    timer.unref?.();
    return () => clearTimeout(timer);
  }

  async function execute(intent, confirmationId = null) {
    setState(STATES.WORKING, { capabilityId: intent.capabilityId });

    const context = await getContext();
    const stopReassurance = startProgressReassurance(intent.capabilityId);
    let result;
    try {
      result = await registry.dispatch(
        { capabilityId: intent.capabilityId, params: intent.params, confirmationId },
        context,
      );
    } finally {
      stopReassurance();
    }

    if (result.code === "confirmation_required") {
      pendingConfirmation = { ...result.confirmation, intent };
      emit({ type: "voice:confirmation", confirmation: result.confirmation });
      say(trimForSpeech(result.speak));
      setState(STATES.AWAITING_CONFIRMATION);
      return result;
    }

    emit({ type: "voice:result", result });

    const spoken = trimForSpeech(result.speak);
    // A silent success is indistinguishable from a crash to someone not
    // looking at the screen, so every turn ends with something said.
    say(spoken || (result.ok ? "Done." : "That didn't work."));
    setState(STATES.LISTENING);

    if (result.ok) recordSnapshotQuietly(context);
    return result;
  }

  /**
   * Reverse the last action.
   *
   * The registry decides whether that is possible and refuses with a reason
   * when it is not — "that commit has already been pushed" is a far more
   * useful thing to hear than a generic failure, and it is the difference
   * between an assistant that is being careful and one that is broken.
   */
  async function runUndo() {
    setState(STATES.WORKING, { capabilityId: "undo" });
    const result = await registry.undoLast(await getContext());
    emit({ type: "voice:result", result });
    say(trimForSpeech(result.speak) || "I couldn't undo that.");
    setState(STATES.LISTENING);
    return result;
  }

  async function runConfirmed() {
    const confirmation = pendingConfirmation;
    pendingConfirmation = null;
    emit({ type: "voice:confirmation", confirmation: null });
    if (!confirmation) return { ok: false, error: "Nothing to confirm." };
    return execute(confirmation.intent, confirmation.id);
  }

  function recordSnapshotQuietly(context) {
    try {
      memory?.recordSnapshot({
        projectId: context.projectId,
        projectName: context.projectName,
        projectPath: context.projectPath,
        branch: context.branch,
        openFiles: context.openFile ? [context.openFile] : [],
        sessions: context.sessions || [],
        task: context.activeTask || null,
      });
    } catch (error) {
      log(`Snapshot failed: ${error.message}`);
    }
  }

  function onSidecarEvent(event) {
    switch (event.type) {
      case "ready":
        emit({ type: "voice:ready", granted: event.granted, backend: event.backend, onDevice: event.onDevice });
        if (!event.granted) {
          emit({
            type: "voice:error",
            message: "Pitwall needs Microphone and Speech Recognition access. Grant them in System Settings › Privacy & Security.",
            fatal: true,
          });
        }
        break;

      case "wake":
        setState(STATES.CAPTURING);
        emit({ type: "voice:wake" });
        break;

      case "partial":
        emit({ type: "voice:partial", text: event.text });
        break;

      case "settling":
        // The user has gone quiet and the endpoint countdown is running. Shown
        // in the HUD so "it is about to act" is visible before it acts.
        emit({ type: "voice:settling", seconds: event.in });
        break;

      case "resumed":
        emit({ type: "voice:settling", seconds: null });
        break;

      case "transcript":
        if (event.text) void handleTranscript(event.text);
        break;

      case "cancelled":
        if (state === STATES.CAPTURING) setState(STATES.LISTENING);
        break;

      case "barge_in":
        // The user talked over the assistant. Stop, and let the capture that
        // follows become the next request.
        emit({ type: "voice:barge_in" });
        setState(STATES.LISTENING);
        break;

      case "speaking_started":
        if (state !== STATES.AWAITING_CONFIRMATION) setState(STATES.SPEAKING);
        break;

      case "speaking_finished":
        if (state === STATES.SPEAKING) setState(enabled ? STATES.LISTENING : STATES.OFF);
        break;

      case "level":
        emit({ type: "voice:level", rms: event.rms, speaking: event.speaking });
        break;

      case "state":
        if (event.mode === "idle" && enabled) emit({ type: "voice:engine_idle" });
        break;

      case "error":
        emit({ type: "voice:error", message: event.message, fatal: Boolean(event.fatal) });
        if (event.fatal) {
          enabled = false;
          setState(STATES.OFF);
        }
        break;

      default:
        break;
    }
  }

  function start(config = {}) {
    const started = sidecar.start();
    if (!started.ok) return started;
    enabled = true;
    sidecar.configure(config);
    sidecar.startListening();
    setState(STATES.LISTENING);
    return { ok: true };
  }

  function stop() {
    enabled = false;
    pendingConfirmation = null;
    registry.cancelPendingConfirmation();
    sidecar.stopListening();
    sidecar.stopSpeaking();
    setState(STATES.OFF);
    return { ok: true };
  }

  /** Push-to-talk: skip the wake word and capture one utterance now. */
  function listenOnce() {
    if (!sidecar.getState().running) {
      const started = sidecar.start();
      if (!started.ok) return started;
      enabled = true;
    }
    sidecar.listenOnce();
    setState(STATES.CAPTURING);
    return { ok: true };
  }

  /** Typed input takes the identical path, which is how the text box stays honest. */
  async function submitText(text) {
    if (!text?.trim()) return { ok: false, error: "Nothing to do." };
    return handleTranscript(text.trim());
  }

  function getStatus() {
    return {
      state,
      enabled,
      lastTranscript,
      pendingConfirmation: pendingConfirmation
        ? { id: pendingConfirmation.id, question: pendingConfirmation.question, capabilityId: pendingConfirmation.capabilityId }
        : null,
      engine: sidecar.getState(),
      // Surfaced so the UI can offer undo as a button too — the phrase is not
      // discoverable, and a capability that can be reversed should say so.
      undoable: registry.getUndoable?.() || null,
      history: history.slice(-6),
    };
  }

  return {
    start,
    stop,
    listenOnce,
    submitText,
    confirm: runConfirmed,
    undo: runUndo,
    cancelConfirmation: () => {
      registry.cancelPendingConfirmation();
      pendingConfirmation = null;
      emit({ type: "voice:confirmation", confirmation: null });
      setState(enabled ? STATES.LISTENING : STATES.OFF);
    },
    stopSpeaking: () => sidecar.stopSpeaking(),
    /**
     * Stop the current exchange without turning voice off: stop talking, drop
     * any pending confirmation, and hand control back to the wake word. The
     * microphone stays on, which is the difference between this and `stop`.
     */
    endTurn: () => {
      registry.cancelPendingConfirmation();
      pendingConfirmation = null;
      emit({ type: "voice:confirmation", confirmation: null });
      sidecar.stopSpeaking();
      sidecar.send({ type: "end_turn" });
      setState(enabled ? STATES.LISTENING : STATES.OFF);
      return { ok: true };
    },
    onSidecarEvent,
    getStatus,
    STATES,
  };
}

module.exports = { createVoiceOrchestrator, classifyConfirmation, isInterruption, STATES };
