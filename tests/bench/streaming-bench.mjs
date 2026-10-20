// Three sessions printing continuously while the Tasks board is open: how
// smooth is the window? Prints frames per second and main-thread stalls.
//   npm run build && node tests/bench/streaming-bench.mjs
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "../helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-bench-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
// An agent that never stops talking: a line every 10ms, like a busy TUI.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash\ncase "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) exit 0 ;; esac\necho $$ >> '${temp}/started.txt'; i=0; while true; do i=$((i+1)); printf '\\033[2K\\rworking on step %d … esc to interrupt\\n' $i; sleep 0.01; done\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "a.txt"), "a\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

const now = new Date().toISOString();
const sessions = [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Agent ${n}`, agent: "Claude", status: "running", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir }));
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 3, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] };
const tasks = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}`, projectId: "p", identifier: `delta-${i}`, title: `Task number ${i}`, description: "", status: ["ready", "running", "review", "backlog"][i % 4], priority: "medium", assignedAgent: "", relatedFiles: [], worktree: `delta-${i}`, source: { kind: "mcp", name: "atlassian", status: ["To Do", "In progress", "Review", "Backlog"][i % 4] }, createdAt: now, updatedAt: now }));
const activity = Array.from({ length: 3000 }, (_, i) => ({ id: `a${i}`, projectId: "p", type: "system", message: `Activity line ${i} with some words in it`, createdAt: now }));
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks, contextEntries: [], contextSnapshots: [], sessions: [], activity, taskRuns: [], councilRuns: [], compareRuns: [] };

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
  for (const n of [1, 2, 3]) {
    await page.locator(".dk-session-item .dk-session", { hasText: `Agent ${n}` }).click();
    await page.waitForTimeout(1500);
  }
  const measure = async (label) => {
    const result = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      let worst = 0;
      let last = performance.now();
      const longTasks = [];
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(entry.duration); });
      observer.observe({ type: "longtask", buffered: false });
      const started = performance.now();
      const tick = (now) => {
        frames += 1;
        worst = Math.max(worst, now - last);
        last = now;
        if (now - started < 8000) requestAnimationFrame(tick);
        else {
          observer.disconnect();
          resolve({ fps: Math.round(frames / ((now - started) / 1000)), worstFrameMs: Math.round(worst), longTasks: longTasks.length, longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)) });
        }
      };
      requestAnimationFrame(tick);
    }));
    const cpu = await app.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Tab" || metric.type === "Browser")
      .map((metric) => `${metric.type === "Tab" ? "renderer" : "main"} ${Math.round(metric.cpu.percentCPUUsage)}%`).join(", "));
    console.log(label.padEnd(28), JSON.stringify(result), cpu);
  };
  console.log("agents started:", (await import("node:fs")).readFileSync(path.join(temp, "started.txt"), "utf8").trim().split("\n").length);
  await measure("terminal, 3 streaming");
  await goTo(page, "Tasks");
  await page.waitForTimeout(1000);
  await measure("tasks board, 3 streaming");
} finally {
  await app.close();
}
