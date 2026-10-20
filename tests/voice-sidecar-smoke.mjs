import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Liveness check for the real Swift daemon: after a full turn — listening, then
 * speaking a reply — is it still listening?
 *
 * That property is worth pinning down because when it breaks there is no
 * visible symptom. The HUD still says "listening", the process is still alive,
 * and the only evidence is that nothing is ever heard again. Anything that
 * silently loses the recogniser (an unhandled task end, a cancelled task
 * restarting itself in a loop, an audio device change) shows up here as either
 * a storm of `state` events or a final state of `listening: false`.
 *
 * Note on scope: this does NOT reproduce the cancel-restart race the generation
 * guard in `startRecognition` defends against — that race needs a specific
 * interleaving this script does not force, and an unguarded build passes this
 * test. The guard is a defensive fix for a real hazard in the API contract
 * (cancelling a task invokes its completion handler), not something proven to
 * have caused a field failure. Do not read a pass here as proof of its absence.
 *
 * Skips cleanly when the binary is unbuilt or the microphone is unavailable, so
 * it can live in CI without being flaky.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "electron", "voice", "bin", "braveli-voice");

if (!fs.existsSync(binary)) {
  console.log("Voice sidecar not built — skipping. Run `npm run build:voice`.");
  process.exit(0);
}

const events = [];
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Not a message.
    }
  }
});

const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seen = (type) => events.filter((event) => event.type === type);

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) process.stdout.write(`  OK  ${name}\n`);
  else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
};

try {
  await wait(1500);

  const ready = seen("ready")[0];
  if (!ready) {
    console.log("Daemon did not become ready (no audio device or permission) — skipping.");
    child.kill();
    process.exit(0);
  }
  check("reports an on-device backend", ready.onDevice === true, JSON.stringify(ready));

  if (!ready.granted) {
    console.log("Microphone/speech permission not granted to this process — skipping the listening checks.");
    child.kill();
    process.exit(0);
  }

  send({ type: "configure", silenceTimeout: 3, wakeWords: ["braveli"] });
  await wait(300);
  check("applies configuration", seen("configured").length === 1);

  // --- the regression -----------------------------------------------------
  const before = seen("state").length;
  send({ type: "start_listening" });
  await wait(6000);
  const stateEvents = seen("state").length - before;

  // One `state` per recognition task. On-device tasks last ~60s, so six
  // seconds of listening should produce one — a handful at most. Dozens means
  // the restart loop is back.
  check(
    "the recogniser settles instead of restarting in a loop",
    stateEvents <= 4,
    `${stateEvents} state events in 6s — the recogniser is oscillating`,
  );
  check("no fatal errors while listening", !seen("error").some((event) => event.fatal), JSON.stringify(seen("error")));
  check("the microphone is producing audio", seen("level").length > 0, "no level events — the tap is not delivering buffers");

  // --- speaking must not kill listening -----------------------------------
  const beforeSpeech = seen("state").length;
  send({ type: "speak", text: "Ready.", id: "t1" });
  await wait(3000);
  check("speech starts and finishes", seen("speaking_finished").length >= 1);
  check(
    "listening survives a spoken reply",
    seen("state").length - beforeSpeech <= 3,
    `${seen("state").length - beforeSpeech} state events around one utterance`,
  );

  // A turn ends with the daemon still listening, which is the property that
  // was actually broken: the first command worked, the next was never heard.
  const lastState = seen("state").at(-1);
  check("still listening after a full turn", lastState?.listening === true, JSON.stringify(lastState));

  send({ type: "stop_listening" });
  await wait(300);
  check("stops cleanly", seen("state").at(-1)?.listening === false);

  console.log(`\nVoice sidecar smoke test ${failures ? "FAILED" : "passed"}.`);
} finally {
  send({ type: "shutdown" });
  await wait(300);
  child.kill();
}

assert.equal(failures, 0, `${failures} sidecar check(s) failed`);
