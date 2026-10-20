// A real Hermes session, end to end: launched with its first turn, finished,
// its session id recorded, and resumed with the conversation intact.
//
// Uses the installed `hermes` and a real model, so it is a bench rather than a
// smoke test: it needs the network and a signed-in Hermes.
//   npm run build && HERMES_BENCH_HOME=/path/to/scratch-hermes-home node tests/bench/hermes-real.mjs
// HERMES_BENCH_HOME must sign in on its own (an API key in its .env). Never
// give it a copy of ~/.hermes/auth.json: Nous Portal refresh tokens are
// single-use, and a copy that refreshes signs the original out.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const root = process.cwd();
const model = process.env.HERMES_MODEL || "poolside/laguna-s-2.1:free";
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-hermes-"));
// A Hermes home that has already been run once: a brand-new one installs its
// Python dependencies and asks about optional features on first start, which
// is Hermes's own first run, not what this bench measures. Never your real one
// — the bench rewrites its config.
const hermesHome = process.env.HERMES_BENCH_HOME;
assert.ok(hermesHome, "set HERMES_BENCH_HOME to a disposable, already-initialised Hermes home");
// Start with the turn signal off, so the test proves Pitwall turns it on.
const configPath = path.join(hermesHome, "config.yaml");
await writeFile(configPath, (await readFile(configPath, "utf8")).replace(/^(\s*bell_on_complete:\s*)\S+/m, "$1false"));

const dir = path.join(temp, "project");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# hermes bench\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

const launchApp = () => electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HERMES_HOME: hermesHome, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});

async function runTurn(page, payload, expect) {
  return page.evaluate(({ payload, expect }) => new Promise((resolve) => {
    const seen = { nativeId: null, completed: false, output: "" };
    const stops = [
      window.braveli.onSessionNativeId((event) => { if (event.sessionId === payload.sessionId) seen.nativeId = event.nativeSessionId; }),
      window.braveli.onTerminalData((event) => { if (event.sessionId === payload.sessionId) seen.output = (seen.output + event.data).slice(-200_000); }),
      window.braveli.onAgentCompleted((event) => {
        if (event.sessionId !== payload.sessionId) return;
        seen.completed = true;
        // The completion can land before the answer is drawn; give it a beat.
        setTimeout(() => { stops.forEach((stop) => stop()); resolve(seen); }, 1500);
      }),
    ];
    setTimeout(() => { stops.forEach((stop) => stop()); resolve({ ...seen, timedOut: true }); }, 120_000);
    window.braveli.startTerminal({ ...payload, cols: 120, rows: 40 }).then((result) => {
      if (!result?.ok) { stops.forEach((stop) => stop()); resolve({ ...seen, startError: result?.error }); }
    });
  }), { payload, expect });
}

const base = { projectId: "bench", projectPath: dir, agent: "Hermes", model, sessionName: "Hermes bench" };
let app = await launchApp();
let nativeId;
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem("braveli-onboarded", "yes"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const first = await runTurn(page, { ...base, sessionId: "hermes-1", initialPrompt: "Remember the codeword ORCHID-42. Reply with exactly: STORED" });
  if (!first.completed) {
    // What the session drew is the only clue to why a turn never ended.
    console.log(first.output.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").slice(-1500));
  }
  assert.equal(first.startError, undefined, `Hermes started: ${first.startError}`);
  assert.ok(first.completed, "the first turn, handed over at launch, is seen to finish");
  console.log("PASS a Hermes turn given at launch is seen to finish");
  assert.match(first.nativeId || "", /^\d{8}_\d{6}_[0-9a-f]{6}$/, "the session id is read from the banner");
  nativeId = first.nativeId;
  console.log(`PASS the Hermes session id is recorded (${nativeId})`);
  assert.match(await readFile(configPath, "utf8"), /^\s*bell_on_complete:\s*true/m, "the turn signal is switched on");
  console.log("PASS Pitwall switched on Hermes's turn signal");
  await page.evaluate((id) => window.braveli.detachTerminal(id), "hermes-1");
} finally {
  await app.close();
}

app = await launchApp();
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem("braveli-onboarded", "yes"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const second = await runTurn(page, { ...base, sessionId: "hermes-2", resumeSession: true, nativeSessionId: nativeId, initialPrompt: "What codeword did I ask you to remember? Reply with just the codeword." });
  assert.ok(second.completed, "the resumed turn finishes");
  assert.match(second.output, /ORCHID-42/, "the resumed session remembers the earlier turn");
  console.log("PASS a restarted app resumes the Hermes conversation");
  await page.evaluate((id) => window.braveli.detachTerminal(id), "hermes-2");
} finally {
  await app.close();
}
console.log("Pitwall Hermes bench passed.");
