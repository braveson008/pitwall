/**
 * Supervises the Swift voice daemon and turns its stdout into events.
 *
 * The daemon owns the microphone and the synthesiser; this module owns its
 * lifecycle. That split matters because the daemon can die for reasons Pitwall
 * cannot prevent — the user revokes microphone access, an audio device is
 * unplugged mid-sentence, the process is killed. None of those should be able
 * to take the app down or leave voice silently dead, so the failure path is
 * explicit: restart with backoff, and stop retrying once it is clear the
 * problem is not transient.
 */

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const MAX_RESTARTS = 5;
const RESTART_BACKOFF_MS = [500, 1000, 2000, 5000, 10000];

/**
 * Where the compiled daemon lives. Packaged builds copy it into Resources via
 * electron-builder's `extraResources`; a dev checkout builds it into
 * `electron/voice/bin`.
 */
function resolveSidecarPath(options = {}) {
  const candidates = [
    options.explicitPath,
    process.env.PITWALL_VOICE_SIDECAR,
    options.resourcesPath ? path.join(options.resourcesPath, "voice", "pitwall-voice") : null,
    path.join(__dirname, "..", "voice", "bin", "pitwall-voice"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

class VoiceSidecar extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.child = null;
    this.buffer = "";
    this.restarts = 0;
    this.stopping = false;
    this.lastError = null;
    this.state = { running: false, mode: "idle", speaking: false, granted: null };
  }

  get available() {
    // The sidecar is a Swift program for macOS speech recognition; elsewhere
    // nothing could run even if a stray binary were found (X_OK only checks
    // that a file exists on Windows).
    if (process.platform !== "darwin") return false;
    return Boolean(resolveSidecarPath(this.options));
  }

  start() {
    if (this.child) return { ok: true, alreadyRunning: true };

    const binary = resolveSidecarPath(this.options);
    if (!binary) {
      const error = "The voice engine has not been built. Run `npm run build:voice`.";
      this.lastError = error;
      return { ok: false, error };
    }

    this.stopping = false;
    let child;
    try {
      child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      this.lastError = error.message;
      return { ok: false, error: error.message };
    }

    this.child = child;
    this.state.running = true;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#consume(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      // Swift runtime noise is not an event; surface it as diagnostics only.
      this.emit("stderr", chunk.trim());
    });

    child.on("error", (error) => {
      this.lastError = error.message;
      this.emit("event", { type: "error", message: error.message, fatal: true });
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.state = { ...this.state, running: false, mode: "idle", speaking: false };
      this.emit("event", { type: "state", listening: false, mode: "idle" });
      if (this.stopping) return;
      this.#restart(code, signal);
    });

    return { ok: true, binary };
  }

  #restart(code, signal) {
    if (this.restarts >= MAX_RESTARTS) {
      this.emit("event", {
        type: "error",
        message: `The voice engine stopped repeatedly (last exit ${signal || code}). Voice is off until you restart it.`,
        fatal: true,
      });
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(this.restarts, RESTART_BACKOFF_MS.length - 1)];
    this.restarts += 1;
    this.emit("event", { type: "restarting", attempt: this.restarts, delay });
    setTimeout(() => {
      if (this.stopping) return;
      const result = this.start();
      // A restart is only useful if the user was listening before; the
      // orchestrator decides that, so it is told rather than assumed here.
      if (result.ok) this.emit("restarted", this.restarts);
    }, delay).unref?.();
  }

  #consume(chunk) {
    this.buffer += chunk;
    // Guard against a wedged child producing an unbounded line.
    if (this.buffer.length > 1_000_000) this.buffer = this.buffer.slice(-10_000);

    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.emit("stderr", `unparseable line: ${line.slice(0, 200)}`);
        continue;
      }
      this.#track(event);
      this.emit("event", event);
    }
  }

  #track(event) {
    switch (event.type) {
      case "ready":
        this.restarts = 0; // A clean start clears the backoff ladder.
        this.state.granted = Boolean(event.granted);
        break;
      case "permission":
        this.state.granted = Boolean(event.ok);
        break;
      case "state":
        this.state.mode = event.mode || this.state.mode;
        break;
      case "speaking_started":
        this.state.speaking = true;
        break;
      case "speaking_finished":
        this.state.speaking = false;
        break;
      default:
        break;
    }
  }

  send(command) {
    if (!this.child?.stdin?.writable) return { ok: false, error: "The voice engine is not running." };
    try {
      this.child.stdin.write(`${JSON.stringify(command)}\n`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  configure(config) {
    return this.send({ type: "configure", ...config });
  }

  startListening() {
    return this.send({ type: "start_listening" });
  }

  listenOnce() {
    return this.send({ type: "listen_once" });
  }

  stopListening() {
    return this.send({ type: "stop_listening" });
  }

  speak(text, id) {
    return this.send({ type: "speak", text, id });
  }

  stopSpeaking() {
    return this.send({ type: "stop_speaking" });
  }

  requestVoices() {
    return this.send({ type: "voices" });
  }

  getState() {
    return { ...this.state, available: this.available, lastError: this.lastError };
  }

  stop() {
    this.stopping = true;
    if (!this.child) return;
    // Ask politely first: the daemon releases the audio device on shutdown,
    // and a killed process leaves the input node claimed for a few seconds.
    this.send({ type: "shutdown" });
    const child = this.child;
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }, 300).unref?.();
  }
}

module.exports = { VoiceSidecar, resolveSidecarPath };
