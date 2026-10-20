// A session that drew before its pane existed is shown the way it drew.
//
// Full-screen agents repaint only what changed, and a whole screen only when
// their terminal is resized. A pane opened onto one that is already running
// replays what it drew; replayed into a grid of another size, every later
// change lands on the wrong cells, and nothing ever repaints it.
//   npm run build && node tests/terminal-late-pane-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-late-pane-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
// Draws a rule exactly as wide as its terminal, once, and again only on SIGWINCH.
await writeFile(path.join(fakeBin, "codex"), `#!/bin/bash
case "$1" in --version) echo "codex-cli 0.160.1"; exit 0 ;; login) echo "Logged in"; exit 0 ;; exec|debug|mcp|features|app-server) exit 0 ;; esac
stty raw -echo 2>/dev/null
n=0; draw() { n=$((n+1)); read -r rows cols < <(stty size); printf '\\033[2J\\033[H'; printf '%*s' "$cols" '' | tr ' ' '#'; printf '\\033[3;1Hdrawn for %s columns (draw %s)' "$cols" "$n"; printf '\\033[%s;%sHMARK' "$((rows - 2))" "$((cols - 10))"; }
trap draw WINCH
printf '\\033[?1049h'
draw
while true; do sleep 0.1; done
`);
await chmod(path.join(fakeBin, "codex"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# repo\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
const now = new Date().toISOString();
const session = (id, name) => ({ id, name, agent: "Codex", status: "running", model: "auto", branch: "main", worktreePath: dir, task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] });
// Two projects: a pane exists only for the open project's sessions.
const project = (id, sessions) => ({ id, name: id, path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: sessions.length, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] });
const projects = [project("repo", [session("first", "First Codex")]), project("other", [session("later", "Later Codex")])];
const workspace = { version: 1, projects: projects.map((item) => ({ id: item.id, name: item.name, path: dir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now })), tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ projects, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify(projects));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { projects, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  await page.locator("[data-sidebar-row]", { hasText: "First Codex" }).click();
  await page.waitForFunction(() => document.querySelector(".dk-terminal.is-active .xterm-rows")?.textContent?.includes("drawn for"), null, { timeout: 30000 });
  // The size a pane here fits to, which is the size Pitwall starts a CLI at.
  await page.waitForTimeout(1200);
  const size = await page.evaluate(() => window.braveli.getTerminalSize("first"));
  assert.ok(size.ok && size.cols > 80, `the first pane is wider than xterm's default (${size.cols})`);

  // Started in the other project — as an automation would — at the size its pane will have.
  const started = await page.evaluate(({ dir, cols, rows }) => window.braveli.startTerminal({
    projectId: "other", projectPath: dir, projectRoot: dir, sessionId: "later", sessionName: "Later Codex", agent: "Codex", command: "codex", args: [], cols, rows,
  }), { dir, cols: size.cols, rows: size.rows });
  assert.ok(started?.ok, `the background session started: ${started?.error ?? ""}`);
  await page.waitForTimeout(1500);

  await openProject(page, "other");
  await page.locator("[data-sidebar-row]", { hasText: "Later Codex" }).click();
  await page.waitForFunction(() => document.querySelector(".dk-terminal.is-active .xterm-rows")?.textContent?.includes("drawn for"), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const lines = await page.locator(".dk-terminal.is-active .xterm-rows > div").evaluateAll((rows) => rows.map((line) => (line.textContent ?? "").replace(/\u00a0/g, " ").trimEnd()));
  assert.equal(lines[0], "#".repeat(size.cols), `the rule spans the pane in one row, as drawn (got ${lines[0].length} wide)`);
  assert.equal(lines[size.rows - 3]?.indexOf("MARK"), size.cols - 11, `what was drawn near the bottom right is still there, not pinned to an 80x24 corner (row ${size.rows - 2}: "${lines[size.rows - 3]}")`);
  console.log(`PASS a pane opened onto a full-screen session already running in another project shows it at the size it drew (${size.cols} columns)`);
} finally {
  await app.close();
}
console.log("Pitwall late pane smoke test passed.");
