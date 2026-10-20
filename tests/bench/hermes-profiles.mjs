// Each project's Hermes learns in its own profile: a fact Hermes saves to its
// memory while working on one project is in that project's profile and nowhere
// else — not another project's, not the person's main Hermes.
//
// Real Hermes and a real model, so a bench. HERMES_BENCH_HOME is a disposable,
// already-initialised Hermes home.
//   npm run build && HERMES_BENCH_HOME=/path/to/scratch-hermes-home node tests/bench/hermes-profiles.mjs
// HERMES_BENCH_HOME must sign in on its own (an API key in its .env). Never
// give it a copy of ~/.hermes/auth.json: Nous Portal refresh tokens are
// single-use, and a copy that refreshes signs the original out.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const { hermesProfileName } = createRequire(import.meta.url)("../../electron/lib/hermesProfiles.cjs");
const hermesHome = process.env.HERMES_BENCH_HOME;
assert.ok(hermesHome, "set HERMES_BENCH_HOME to a disposable, already-initialised Hermes home");
const model = process.env.HERMES_MODEL || "poolside/laguna-s-2.1:free";
const codeword = `TANGO-${Math.floor(Math.random() * 9000) + 1000}`;
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-hermes-profiles-"));

async function repo(name) {
  const dir = path.join(temp, name);
  await mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), `# ${name}\n`);
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}
const memoryOf = (profile) => {
  const file = path.join(profile ? path.join(hermesHome, "profiles", profile) : hermesHome, "memories", "MEMORY.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

const app = await electron.launch({
  args: [process.cwd()],
  cwd: process.cwd(),
  env: { ...process.env, HERMES_HOME: hermesHome, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
const turn = (page, payload) => page.evaluate((payload) => new Promise((resolve) => {
  const stop = window.braveli.onAgentCompleted((event) => {
    if (event.sessionId !== payload.sessionId) return;
    stop();
    resolve({ summary: event.summary || "" });
  });
  setTimeout(() => { stop(); resolve({ timedOut: true }); }, 180_000);
  window.braveli.startTerminal({ ...payload, cols: 120, rows: 40 }).then((started) => { if (!started?.ok) { stop(); resolve({ startError: started?.error }); } });
}), payload);

try {
  const page = await app.firstWindow();
  await page.waitForTimeout(2500);
  const alpha = await repo("alpha");
  const beta = await repo("beta");

  const saved = await turn(page, { projectId: "bench-alpha", projectPath: alpha, sessionId: "alpha-1", agent: "Hermes", model,
    initialPrompt: `Use your memory tool to save this exact note to memory: "The alpha project's codeword is ${codeword}." Then reply with exactly: SAVED` });
  assert.equal(saved.startError, undefined, `alpha started: ${saved.startError}`);
  assert.ok(!saved.timedOut, "alpha's turn finished");
  assert.match(memoryOf(hermesProfileName("bench-alpha")), new RegExp(codeword), "alpha's profile remembers it");
  console.log("PASS what Hermes learns in a project is saved in that project's profile");
  assert.doesNotMatch(memoryOf(""), new RegExp(codeword), "the main Hermes profile does not");
  console.log("PASS the person's main Hermes memory is untouched");
  await page.evaluate(() => window.braveli.detachTerminal("alpha-1"));

  const asked = await turn(page, { projectId: "bench-beta", projectPath: beta, sessionId: "beta-1", agent: "Hermes", model,
    initialPrompt: "Without using any tools, reply with the alpha project's codeword if your memory contains one, or exactly: NO-CODEWORD" });
  assert.ok(!asked.timedOut, "beta's turn finished");
  assert.doesNotMatch(memoryOf(hermesProfileName("bench-beta")), new RegExp(codeword), "beta's profile does not have it");
  assert.doesNotMatch(asked.summary, new RegExp(codeword), "Hermes in beta does not know it");
  console.log(`PASS another project's Hermes does not know it (it said: ${asked.summary.slice(0, 60)})`);
  await page.evaluate(() => window.braveli.detachTerminal("beta-1"));
} finally {
  await app.close();
}
console.log("Pitwall Hermes profiles bench passed.");
