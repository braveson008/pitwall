// Typing into a running session with a large workspace: how long does each
// keystroke keep the main thread busy?
//   npm run build && node tests/bench/typing-bench.mjs
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-typing-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
await writeFile(path.join(fakeBin, "claude"), `#!/bin/sh\ncase "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) exit 0 ;; esac\necho ready\nexec cat >/dev/null\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);
const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });

const now = new Date().toISOString();
const sessions = [{ id: "s1", name: "Agent 1", agent: "Claude", status: "running", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir }];
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] };
const tasks = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, projectId: "p", identifier: `delta-${i}`, title: `Task number ${i} with a reasonably long title like the real ones`, description: "A description ".repeat(40), status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: `delta-${i}`, source: { kind: "mcp", name: "atlassian", status: "To Do" }, createdAt: now, updatedAt: now }));
const activity = Array.from({ length: 5000 }, (_, i) => ({ id: `a${i}`, projectId: "p", type: "system", message: `Activity line ${i} with some words in it`, createdAt: now }));
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks, contextEntries: [], contextSnapshots: [], sessions: [{ id: "s1", projectId: "p", taskId: "", type: "implementation", provider: "claude", status: "running", createdAt: now, updatedAt: now }], activity, taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([project]));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  await page.locator(".dk-session-item .dk-session", { hasText: "Agent 1" }).click();
  await page.waitForTimeout(2500);
  await page.locator(".dk-terminal.is-active .xterm").click();
  await page.evaluate(() => {
    window.__busy = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__busy.push(entry.duration); }).observe({ type: "longtask" });
    const original = Storage.prototype.setItem;
    window.__writes = { count: 0, ms: 0 };
    Storage.prototype.setItem = function (key, value) {
      const started = performance.now();
      original.call(this, key, value);
      if (key === "braveli-workspace-state") { window.__writes.count += 1; window.__writes.ms += performance.now() - started; }
    };
  });
  const started = Date.now();
  await page.keyboard.type("a".repeat(200), { delay: 15 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => ({ longTasks: window.__busy.length, longTaskMs: Math.round(window.__busy.reduce((a, b) => a + b, 0)), workspaceWrites: window.__writes.count, workspaceWriteMs: Math.round(window.__writes.ms) }));
  console.log("200 keystrokes", JSON.stringify(result), `${Date.now() - started}ms`);
} finally {
  await app.close();
}
