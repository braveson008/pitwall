// Hermes's first run, from a brand-new Hermes home, does not leave a session
// stuck: Pitwall says it is setting Hermes up, answers the optional-feature
// question Hermes asks before its prompt, and the turn still finishes. Then a
// model that no longer exists is reported, not left to look like a hang.
//
// Real Hermes and a real model, so a bench: it needs the network and a Hermes
// that can sign in on its own. The fresh home gets HERMES_FIRST_RUN_SOURCE's
// config.yaml and .env — never an auth.json. Nous Portal's refresh tokens are
// single-use: a copied login that refreshes revokes the original, and this
// bench once signed its author out of Hermes that way. Point it at a
// throwaway home whose model is reached with an API key in its .env.
//   npm run build && HERMES_FIRST_RUN_SOURCE=/path/to/api-key-hermes-home node tests/bench/hermes-first-run.mjs
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const root = process.cwd();
const model = process.env.HERMES_MODEL || "poolside/laguna-s-2.1:free";
const sourceHome = process.env.HERMES_FIRST_RUN_SOURCE;
assert.ok(sourceHome, "set HERMES_FIRST_RUN_SOURCE to a throwaway Hermes home that signs in with an API key");
assert.notEqual(path.resolve(sourceHome), path.join(os.homedir(), ".hermes"), "never your own Hermes home");
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-hermes-first-"));
const hermesHome = path.join(temp, "hermes-home");
await mkdir(hermesHome, { recursive: true });
for (const name of ["config.yaml", ".env"]) await copyFile(path.join(sourceHome, name), path.join(hermesHome, name)).catch(() => {});

const dir = path.join(temp, "project");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# hermes first run\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

function runSession(page, payload, { until = "completed", waitMs = 240_000 } = {}) {
  return page.evaluate(({ payload, until, waitMs }) => new Promise((resolve) => {
    const seen = { completed: false, notices: [], output: "" };
    let done = false;
    const finish = (extra = {}) => {
      if (done) return;
      done = true;
      stops.forEach((stop) => stop());
      resolve({ ...seen, ...extra });
    };
    const stops = [
      window.braveli.onAgentNotice((event) => {
        seen.notices.push(event.notice);
        if (until === "notice" && event.notice.tone === "error") setTimeout(() => finish(), 500);
      }),
      window.braveli.onTerminalData((event) => { if (event.sessionId === payload.sessionId) seen.output = (seen.output + event.data).slice(-200_000); }),
      window.braveli.onAgentCompleted((event) => {
        if (event.sessionId !== payload.sessionId) return;
        seen.completed = true;
        if (until === "completed") setTimeout(() => finish(), 1500);
      }),
    ];
    setTimeout(() => finish({ timedOut: true }), waitMs);
    window.braveli.startTerminal({ ...payload, cols: 120, rows: 40 }).then((result) => {
      if (!result?.ok) finish({ startError: result?.error });
    });
  }), { payload, until, waitMs });
}

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HERMES_HOME: hermesHome, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem("braveli-onboarded", "yes"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const base = { projectId: "bench", projectPath: dir, agent: "Hermes", sessionName: "Hermes first run" };
  const first = await runSession(page, { ...base, sessionId: "hermes-first", model, initialPrompt: "Reply with exactly: FIRST-RUN-OK" });
  const titles = first.notices.map((notice) => notice.title);
  console.log("notices:", JSON.stringify(titles), "completed:", first.completed, "timedOut:", first.timedOut, "startError:", first.startError);
  if (!first.completed || process.env.BENCH_VERBOSE) console.log(first.output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").slice(-1500));
  assert.equal(first.startError, undefined, `Hermes started: ${first.startError}`);
  assert.ok(titles.includes("Setting up Hermes"), "the user is told Hermes is being set up");
  assert.ok(first.completed, "the first turn finishes instead of stalling on a setup question");
  // An exit also ends a turn; only the answer proves Hermes actually ran it.
  assert.match(first.output, /FIRST-RUN-OK/, "Hermes answered the first turn");
  assert.doesNotMatch(first.output.slice(-4000), /Install it now\? \[Y\/n\]\s*$/, "no question is left waiting");
  console.log("PASS a brand-new Hermes is set up visibly and its first turn finishes");
  await page.evaluate((id) => window.braveli.detachTerminal(id), "hermes-first");

  const retired = await runSession(page, { ...base, sessionId: "hermes-retired", model: "stealth/space-bunny-alpha", initialPrompt: "hello" }, { until: "notice", waitMs: 90_000 });
  const problem = retired.notices.find((notice) => notice.tone === "error");
  assert.ok(problem, "a model that cannot answer is reported");
  assert.equal(problem.title, "Hermes needs a different model");
  console.log(`PASS a model that cannot answer is reported: “${problem.message}”`);
  await page.evaluate((id) => window.braveli.detachTerminal(id), "hermes-retired");
} finally {
  await app.close();
}
console.log("Pitwall Hermes first-run bench passed.");
