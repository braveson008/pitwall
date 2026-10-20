/**
 * What switching between projects costs while both are working.
 *
 * Pitwall holds every project's sessions in one component, so a switch is a
 * state change in the largest tree in the app — while PTYs in both projects
 * keep streaming. This launches the real thing with several projects, real
 * terminals attached in each, and measures the switch itself: how long the
 * main thread is blocked, how many frames are dropped, and whether anything
 * grows across repetitions.
 *
 *   node tests/perf-project-switch.mjs [projects] [sessionsEach] [switches]
 */
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const PROJECTS = Number(process.argv[2] || 3);
const PER_PROJECT = Number(process.argv[3] || 4);
const SWITCHES = Number(process.argv[4] || 12);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-switch-"));
const userDataPath = path.join(tempRoot, "user-data");
const agentPath = path.join(tempRoot, "noisy-agent.zsh");
await mkdir(userDataPath, { recursive: true });

// The same shape of output a working agent produces: bursts of lines plus a
// status line redrawn in place, which is where the volume actually comes from.
await writeFile(
  agentPath,
  [
    "#!/bin/zsh",
    "print -r -- 'agent ready'",
    "i=0",
    "while true; do",
    "  i=$((i+1))",
    "  for j in $(seq 1 30); do",
    "    printf '\\033[2m  * step %s.%s\\033[0m  read src/entities/store/customers/hooks/useCustomerList.ts\\r\\n' $i $j",
    "  done",
    "  printf '\\033[s\\033[1A\\033[2K  * Working... %sm  |  2.8k tokens\\033[u' $i",
    "  sleep 0.01",
    "done",
  ].join("\n") + "\n",
);
await chmod(agentPath, 0o755);

const now = new Date().toISOString();
const projects = [];
for (let p = 0; p < PROJECTS; p += 1) {
  const projectPath = path.join(tempRoot, `project-${p}`);
  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, "README.md"), `# project ${p}\n`);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "perf@example.invalid"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Perf"], { cwd: projectPath });
  execFileSync("git", ["add", "."], { cwd: projectPath });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: projectPath });

  projects.push({
    id: `proj-${p}`, name: `Project ${p}`, path: projectPath, branch: "main", status: "active",
    accent: "#5368dc", health: 100, openSessions: PER_PROJECT, queuedTasks: 0, lastCommit: "now",
    ci: "pending", queue: [],
    sessions: Array.from({ length: PER_PROJECT }, (_, s) => ({
      id: `p${p}-s${s}`, name: `session ${p}.${s}`, agent: "Noisy", provider: "noisy",
      model: "auto", status: "running", branch: "main", task: "load", progress: 10,
      tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [],
    })),
  });
}

const customAgent = { id: "noisy", name: "Noisy", command: agentPath, args: "", loginCommand: "", models: [], createdAt: now };

const app = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: userDataPath, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 20_000 });
await page.waitForLoadState("domcontentloaded");

await page.evaluate(({ projectValues, agentValue }) => {
  localStorage.clear();
  localStorage.setItem("pitwall-projects", JSON.stringify(projectValues));
  localStorage.setItem("pitwall-active-project", JSON.stringify(projectValues[0].id));
  localStorage.setItem("pitwall-custom-agents", JSON.stringify([agentValue]));
  localStorage.setItem("pitwall-onboarded", "yes");
  localStorage.setItem("pitwall-workspace-section", JSON.stringify("work"));
  localStorage.setItem("pitwall-terminal-webgl", "yes");
}, { projectValues: projects, agentValue: customAgent });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

// Real PTYs in every project, so both sides of a switch are producing output.
let ok = 0;
for (const project of projects) {
  const results = await page.evaluate(async ({ ids, cwd, command, projectId }) => {
    const out = [];
    for (const id of ids) {
      const r = await window.pitwall.startTerminal({
        projectId, sessionId: id, sessionName: id, agent: "Noisy", provider: "noisy",
        model: "auto", projectPath: cwd, command, args: [], cols: 120, rows: 32,
      });
      out.push(r?.ok ? "ok" : (r?.error || "refused"));
    }
    return out;
  }, { ids: project.sessions.map((s) => s.id), cwd: project.path, command: agentPath, projectId: project.id });
  ok += results.filter((r) => r === "ok").length;
}
const total = PROJECTS * PER_PROJECT;
process.stdout.write(`\n${PROJECTS} projects x ${PER_PROJECT} sessions — ${ok}/${total} PTYs attached\n\n`);
await page.waitForTimeout(2500);

const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
const heapStart = await heap();

/**
 * Steady-state cost, with nothing being clicked.
 *
 * The switch measurement below cannot separate "this switch was expensive"
 * from "the app is busy all the time", because the PTYs never stop. This
 * window has no interaction in it at all, so whatever it blocks on is the
 * standing cost of having these sessions open — which is the thing a
 * background project contributes to.
 */
const idle = await page.evaluate(async () => {
  const tasks = [];
  let obs;
  try {
    obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)); });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {}
  const gaps = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const at = performance.now();
      gaps.push(at - last); last = at;
      if (at - started >= 6000) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  obs?.disconnect();
  gaps.sort((a, b) => a - b);
  return {
    blockedMs: tasks.reduce((a, b) => a + b, 0),
    longTasks: tasks.length,
    fps: +(gaps.length / 6).toFixed(1),
    frameP95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
  };
});
process.stdout.write(`idle 6s   blocked ${idle.blockedMs} ms in ${idle.longTasks} long tasks   ${idle.fps} fps   p95 frame ${idle.frameP95} ms\n`);


// Measure the switch itself: click a project, then wait for the main thread to
// go quiet, timing how long that takes and what it blocked on.
const switchTimes = [];
const blocked = [];
const rows = page.locator(".dk-project-line > .dk-row");
const rowCount = await rows.count();

for (let i = 0; i < SWITCHES; i += 1) {
  const target = i % PROJECTS;
  const result = await page.evaluate(async (projectIndex) => {
    const longTasks = [];
    let obs;
    try {
      obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(Math.round(e.duration)); });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {}

    const buttons = [...document.querySelectorAll(".dk-project-line > .dk-row")];
    const button = buttons[projectIndex];
    if (!button) return { error: "no project control found", labels: buttons.length };

    const started = performance.now();
    button.click();
    // Settled = two consecutive frames with no long task and a stable DOM.
    await new Promise((resolve) => {
      let quiet = 0;
      const tick = () => {
        if (performance.now() - started > 4000) return resolve();
        quiet = longTasks.length ? 0 : quiet + 1;
        if (quiet >= 6) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs?.disconnect();
    return {
      ms: +(performance.now() - started).toFixed(1),
      longTasks: longTasks.length,
      blockedMs: longTasks.reduce((a, b) => a + b, 0),
      worstTask: longTasks.length ? Math.max(...longTasks) : 0,
    };
  }, target);

  if (result.error) { process.stdout.write(`  ! ${result.error} (matched ${result.labels})\n`); break; }
  switchTimes.push(result.ms);
  blocked.push(result);
  await page.waitForTimeout(400);
}

if (switchTimes.length) {
  const sorted = [...switchTimes].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const worst = sorted.at(-1);
  const totalBlocked = blocked.reduce((a, b) => a + b.blockedMs, 0);
  const worstTask = Math.max(...blocked.map((b) => b.worstTask));
  process.stdout.write(`switch to settle   median ${med.toFixed(0)} ms   worst ${worst.toFixed(0)} ms\n`);
  process.stdout.write(`main thread blocked  ${(totalBlocked / blocked.length).toFixed(0)} ms per switch, worst single task ${worstTask} ms\n`);
}

const heapEnd = await heap();
process.stdout.write(`js heap  ${(heapStart / 1e6).toFixed(0)} MB -> ${(heapEnd / 1e6).toFixed(0)} MB after ${switchTimes.length} switches\n`);

// Where the time goes, over a few more switches with the profiler running.
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
for (let i = 0; i < Math.min(6, PROJECTS * 2); i += 1) {
  await page.evaluate((projectIndex) => {
    [...document.querySelectorAll(".dk-project-line > .dk-row")][projectIndex]?.click();
  }, i % PROJECTS);
  await page.waitForTimeout(700);
}
const { profile } = await cdp.send("Profiler.stop");

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
// Who called whom: a native frame like setTimeout says nothing on its own, and
// its caller is the code actually worth changing.
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parentOf.set(child, node.id);
const label = (node) => {
  const f = node.callFrame;
  return `${f.functionName || "(anonymous)"} ${f.url ? f.url.split("/").pop() : ""}:${f.lineNumber}`;
};
const callers = new Map();
for (let i = 0; i < (profile.samples || []).length; i += 1) {
  const node = byId.get(profile.samples[i]);
  if (!node) continue;
  const name = label(node);
  self.set(name, (self.get(name) || 0) + 1);
  if (/^(setTimeout|clearTimeout|setInterval) /.test(name)) {
    const parent = byId.get(parentOf.get(node.id));
    const via = parent ? label(parent) : "(root)";
    callers.set(via, (callers.get(via) || 0) + 1);
  }
}
const samples = (profile.samples || []).length || 1;
process.stdout.write("\nwhere the time goes while switching:\n");
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, count]) => {
  process.stdout.write(`  ${String(((count / samples) * 100).toFixed(1)).padStart(5)}%  ${name}\n`);
});


if (callers.size) {
  process.stdout.write("\ntimer churn, by caller:\n");
  [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([name, count]) => {
    process.stdout.write(`  ${String(((count / samples) * 100).toFixed(1)).padStart(5)}%  ${name}\n`);
  });
}

await app.close();
process.stdout.write("\ndone\n");
