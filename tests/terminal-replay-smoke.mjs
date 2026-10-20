// A long, chatty session keeps its terminal steady: once its output passes the
// bounded buffer, the pane must not reset and replay itself on every frame.
//   npm run build && node tests/terminal-replay-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-replay-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
// A full-screen agent that prints far more than the buffer keeps, in many reads.
await writeFile(path.join(fakeBin, "codex"), `#!/bin/bash
case "$1" in --version) echo "codex-cli 0.160.1"; exit 0 ;; login) echo "Logged in"; exit 0 ;; exec|debug|mcp|features|app-server) exit 0 ;; esac
stty raw -echo 2>/dev/null
printf '\\033[?1049h\\033[?1000h\\033[?1006h\\033[?2004h'
line=$(printf '%0.s=' $(seq 1 900))
for i in $(seq 1 500); do printf '\\033[2;1H\\033[K\\033[32mframe %s\\033[0m %s\\r\\n' "$i" "$line"; sleep 0.004; done
printf '\\033[3;1Hdone\\r\\n'
exec cat >/dev/null
`);
await chmod(path.join(fakeBin, "codex"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# repo\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
const now = new Date().toISOString();
const session = { id: "chatty", name: "Chatty Codex", agent: "Codex", status: "running", model: "auto", branch: "main", worktreePath: dir, task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] };
const project = { id: "repo", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "repo", name: "repo", path: dir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  await page.locator("[data-sidebar-row]", { hasText: "Chatty Codex" }).click();
  const pane = page.locator(".dk-terminal.is-active .dk-xterm");
  await pane.waitFor();
  await page.waitForFunction(() => document.querySelector(".dk-terminal.is-active .xterm-rows")?.textContent?.includes("done"), null, { timeout: 60000 });
  const resets = Number(await pane.getAttribute("data-resets") || 0);
  assert.ok(resets <= 1, `a long session's pane must not keep resetting (it reset ${resets} times)`);
  const mouse = await page.locator(".dk-terminal.is-active .xterm").evaluate((element) => element.classList.contains("enable-mouse-events"));
  assert.equal(mouse, true, "the agent's mouse reporting is still on");
  console.log(`PASS a chatty full-screen session past the buffer limit stays steady (${resets} resets) and keeps its mouse reporting`);
} finally {
  await app.close();
}
console.log("Pitwall terminal replay smoke test passed.");
