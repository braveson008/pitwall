import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electron } from "./electronLaunch.mjs";

// A dev server an agent starts runs in a session of its own, so stopping the
// PTY's process group never reached it. This starts one the same way — detached,
// no terminal — from inside a real Pitwall PTY, and checks the stop ends it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), "pitwall-process-leak-")));
const workspace = path.join(tempRoot, "workspace");
const elsewhere = path.join(tempRoot, "elsewhere");
await mkdir(workspace, { recursive: true });
await mkdir(elsewhere, { recursive: true });
const launcher = path.join(tempRoot, "detach.cjs");
await writeFile(launcher, `
const { spawn } = require("node:child_process");
const [cwd, pidFile] = process.argv.slice(2);
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { cwd, detached: true, stdio: "ignore" });
require("node:fs").writeFileSync(pidFile, String(child.pid));
child.unref();
`);

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitForFile = async (file) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.trim()) return Number(text);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${file} was never written`);
};

let app;
const pids = [];
try {
  app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(tempRoot, "user-data"), ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  const started = await page.evaluate((cwd) => window.pitwall.startTerminal({
    projectId: "leak-project", projectPath: cwd, sessionId: "leak-session", sessionName: "leak",
    agent: "Leak Shell", model: "auto", command: "/bin/zsh", args: ["-f"], cols: 80, rows: 24,
  }), workspace);
  assert.equal(started.ok, true, started.error);

  const inside = path.join(tempRoot, "inside.pid");
  const outside = path.join(tempRoot, "outside.pid");
  await page.evaluate(({ command }) => window.pitwall.writeTerminal({ sessionId: "leak-session", data: `${command}\r` }),
    { command: `"${process.execPath}" "${launcher}" "${workspace}" "${inside}"; "${process.execPath}" "${launcher}" "${elsewhere}" "${outside}"` });
  const insidePid = await waitForFile(inside);
  const outsidePid = await waitForFile(outside);
  pids.push(insidePid, outsidePid);
  assert.equal(alive(insidePid), true);

  const stopped = await page.evaluate(() => window.pitwall.runSessionAction({ projectId: "leak-project", sessionId: "leak-session", action: "stop" }));
  assert.equal(stopped.ok, true, stopped.error);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(alive(insidePid), false, "the detached process in the session's workspace outlived the stop");
  assert.equal(alive(outsidePid), true, "a process outside the session's workspace was ended");
  console.log("  OK  stopping a session ends the detached processes it left in its own workspace, and only those");
} finally {
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  }
  if (app) await app.close().catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
}
