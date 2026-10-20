
/**
 * Profiles the renderer while several agents stream output at once.
 *
 * Written because six hypotheses about Pitwall's lag were measured and found
 * innocent. This launches the real app, attaches real PTYs running an agent that
 * produces output continuously, and asks V8 where the time actually goes.
 *
 *   node tests/perf-parallel-sessions.mjs [sessionCount] [seconds]
 */
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const SESSIONS = Number(process.argv[2] || 6);
const SECONDS = Number(process.argv[3] || 12);
const BURST = Number(process.argv[4] || 40);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braveli-perf-"));
const projectPath = path.join(tempRoot, "project");
const userDataPath = path.join(tempRoot, "user-data");
const agentPath = path.join(tempRoot, "noisy-agent.zsh");

await mkdir(projectPath, { recursive: true });
await mkdir(userDataPath, { recursive: true });

// An agent that behaves like a working CLI: continuous output with escape codes
// and cursor movement, at a rate a real agent produces while thinking.
await writeFile(
  agentPath,
  [
    "#!/bin/zsh",
    "print -r -- 'Noisy agent ready'",
    "i=0",
    "burst=${BRAVELI_PERF_BURST:-40}",
    "while true; do",
    "  i=$((i+1))",
    "  for j in $(seq 1 $burst); do",
    "    printf '\\033[2m  * step %s.%s\\033[0m  read src/entities/store/customers/hooks/useCustomerList.ts and printed a diff line\\r\\n' $i $j",
    "  done",
    "  # a status line being redrawn in place, which is what a working agent does",
    "  printf '\\033[s\\033[1A\\033[2K  * Germinating... %sm %ss  |  2.8k tokens\\033[u' $i $j",
    "  sleep 0.01",
    "done",
  ].join("\n") + "\n",
);
await chmod(agentPath, 0o755);

await writeFile(path.join(projectPath, "README.md"), "# perf\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
execFileSync("git", ["config", "user.email", "perf@example.invalid"], { cwd: projectPath });
execFileSync("git", ["config", "user.name", "Perf"], { cwd: projectPath });
execFileSync("git", ["add", "."], { cwd: projectPath });
execFileSync("git", ["commit", "-qm", "init"], { cwd: projectPath });

const now = new Date().toISOString();
const sessions = Array.from({ length: SESSIONS }, (_, index) => ({
  id: `perf-${index}`,
  name: `perf session ${index}`,
  agent: "Noisy",
  provider: "noisy",
  model: "auto",
  status: "running",
  branch: "main",
  task: "load",
  progress: 10,
  tokens: "0",
  approvals: 0,
  risk: "low",
  files: 0,
  started: now,
  logs: [],
}));

const project = {
  id: "perf-project", name: "Perf", path: projectPath, branch: "main", status: "active",
  accent: "#5368dc", health: 100, openSessions: SESSIONS, queuedTasks: 0, lastCommit: "now",
  ci: "pending", sessions, queue: [],
};
const customAgent = {
  id: "noisy", name: "Noisy", command: agentPath, args: "", loginCommand: "",
  models: [], createdAt: now,
};

const app = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: userDataPath,
         BRAVELI_PERF_BURST: String(BURST), ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 20_000 });
await page.waitForLoadState("domcontentloaded");
// The first load can still navigate once; seeding before it settles loses the page.
await page.waitForTimeout(1000);

await page.evaluate(({ projectValue, agentValue }) => {
  localStorage.clear();
  localStorage.setItem("braveli-projects", JSON.stringify([projectValue]));
  localStorage.setItem("braveli-active-project", JSON.stringify(projectValue.id));
  localStorage.setItem("braveli-custom-agents", JSON.stringify([agentValue]));
  localStorage.setItem("braveli-onboarded", "yes");
  localStorage.setItem("braveli-workspace-section", JSON.stringify("work"));
  localStorage.setItem("braveli-terminal-webgl", "yes");
}, { projectValue: project, agentValue: customAgent });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// Attach a real PTY per session, exactly as Pitwall does when work starts.
const attached = await page.evaluate(async ({ ids, cwd, command }) => {
  const results = [];
  for (const id of ids) {
    const r = await window.braveli.startTerminal({
      projectId: "perf-project", sessionId: id, sessionName: id,
      agent: "Noisy", provider: "noisy", model: "auto", projectPath: cwd,
      command, args: [], cols: 120, rows: 32,
    });
    results.push(r?.ok ? "ok" : (r?.error || "refused"));
  }
  return results;
}, { ids: sessions.map((s) => s.id), cwd: projectPath, command: agentPath });
process.stdout.write(`attached PTYs: ${attached.filter((r) => r === "ok").length}/${SESSIONS}` +
  (attached.some((r) => r !== "ok") ? ` (${[...new Set(attached.filter((r) => r !== "ok"))].join("; ")})` : "") + "\n");

// Visit several sessions so their panes are mounted, as they are in real use.
await page.waitForTimeout(1200);
const rows = page.locator("[data-sidebar-row]");
const visits = Math.min(await rows.count(), 5);
for (let index = 0; index < visits; index += 1) {
  await rows.nth(index).click();
  await page.waitForTimeout(350);
}
const mounted = await page.evaluate(() => document.querySelectorAll(".dk-terminal").length);
process.stdout.write(`mounted panes: ${mounted}\n`);

// Let output flow, then profile.
await page.waitForTimeout(2000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");

const frames = await page.evaluate(async (seconds) => {
  const gaps = [];
  let last = performance.now();
  const longTasks = [];
  try {
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(Math.round(e.duration)); });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {}
  await new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const at = performance.now();
      gaps.push(at - last);
      last = at;
      if (at - started >= seconds * 1000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  gaps.sort((a, b) => a - b);
  return {
    frames: gaps.length,
    fps: +(gaps.length / seconds).toFixed(1),
    frameGapMedian: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
    frameGapP95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
    frameGapWorst: +gaps.at(-1).toFixed(1),
    longTasks: longTasks.length,
    longTaskWorst: longTasks.length ? Math.max(...longTasks) : 0,
  };
}, SECONDS);

const { profile } = await cdp.send("Profiler.stop");

// Aggregate self time per function.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = (profile.timeDeltas || []).reduce((a, b) => a + Math.max(0, b), 0);
for (let i = 0; i < (profile.samples || []).length; i += 1) {
  const node = byId.get(profile.samples[i]);
  if (!node) continue;
  const delta = Math.max(0, (profile.timeDeltas || [])[i] || 0);
  const cf = node.callFrame;
  const where = `${cf.functionName || "(anonymous)"}  ${(cf.url || "").split("/").pop()}:${cf.lineNumber + 1}`;
  self.set(where, (self.get(where) || 0) + delta);
}
const ranked = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);

process.stdout.write(`\n=== ${SESSIONS} agents streaming for ${SECONDS}s ===\n`);
process.stdout.write(JSON.stringify(frames, null, 2) + "\n");
process.stdout.write(`\n=== where the renderer's CPU went (self time of ${(total / 1000).toFixed(0)}ms sampled) ===\n`);
for (const [where, micros] of ranked) {
  const ms = micros / 1000;
  process.stdout.write(`  ${(ms / (total / 1000) * 100).toFixed(1).padStart(5)}%  ${ms.toFixed(0).padStart(6)}ms  ${where}\n`);
}

await app.close();
process.exit(0);
