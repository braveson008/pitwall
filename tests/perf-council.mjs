/**
 * What a running council costs, measured while it runs.
 *
 * Sessions and councils are different loads. A council mounts every member's
 * terminal at once rather than one at a time, keeps a thread that grows with
 * every turn, and recomputes a per-member summary that reads each member's
 * screen. This starts a real council with agents that produce real output and
 * measures the main thread while it is going.
 *
 *   node tests/perf-council.mjs [members] [seconds]
 */
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { goTo } from "./helpers/goTo.mjs";

const MEMBERS = Number(process.argv[2] || 4);
const SECONDS = Number(process.argv[3] || 10);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braveli-council-perf-"));
const projectPath = path.join(tempRoot, "project");
const userDataPath = path.join(tempRoot, "user-data");
const fakeHome = path.join(tempRoot, "home");
const fakeBin = path.join(tempRoot, "bin");
await mkdir(projectPath, { recursive: true });
await mkdir(userDataPath, { recursive: true });
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });

// Stand-ins for the CLIs a council would drive, producing the shape of output
// a working agent produces. They never finish a turn: the point is to measure
// the app while several members are busy, not to complete a run.
for (const name of ["claude", "codex", "gemini", "qwen"]) {
  const file = path.join(fakeBin, name);
  await writeFile(file, [
    "#!/bin/zsh",
    `print -r -- '${name} ready'`,
    "i=0",
    "while true; do",
    "  i=$((i+1))",
    "  for j in $(seq 1 25); do",
    "    printf '\\033[2m  * %s.%s\\033[0m  reading src/entities/store/customers/useCustomerList.ts\\r\\n' $i $j",
    "  done",
    "  printf '\\033[s\\033[1A\\033[2K  * Working... %sm  |  3.1k tokens\\033[u' $i",
    "  sleep 0.01",
    "done",
  ].join("\n") + "\n");
  await chmod(file, 0o755);
}

await writeFile(path.join(projectPath, "README.md"), "# council perf\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
execFileSync("git", ["config", "user.email", "perf@example.invalid"], { cwd: projectPath });
execFileSync("git", ["config", "user.name", "Perf"], { cwd: projectPath });
execFileSync("git", ["add", "."], { cwd: projectPath });
execFileSync("git", ["commit", "-qm", "init"], { cwd: projectPath });

const iso = new Date(0).toISOString();
const project = {
  id: "council-perf", name: "Council perf", path: projectPath, branch: "main", status: "active",
  accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now",
  ci: "pending", queue: [], timeline: [], sessions: [],
};
const workspace = {
  version: 1,
  projects: [{ id: project.id, name: project.name, path: projectPath, defaultBranch: "main",
    providerIds: ["claude", "codex"], createdAt: iso, updatedAt: iso }],
  tasks: [{ id: "perf-task", identifier: "perf-1", projectId: project.id, title: "Council load",
    description: "Members work continuously.", status: "ready", priority: "high",
    assignedAgent: "council", relatedFiles: [], worktree: "perf-1", source: { kind: "local" },
    createdAt: iso, updatedAt: iso }],
  contextEntries: [], contextSnapshots: [], sessions: [], activity: [], councilRuns: [], compareRuns: [],
};

const app = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
         BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: userDataPath, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 20_000 });
await page.waitForLoadState("domcontentloaded");
await page.evaluate(({ projectValue, workspaceValue }) => {
  localStorage.clear();
  localStorage.setItem("braveli-projects", JSON.stringify([projectValue]));
  localStorage.setItem("braveli-active-project", JSON.stringify(projectValue.id));
  localStorage.setItem("braveli-workspace-state", JSON.stringify(workspaceValue));
  localStorage.setItem("braveli-onboarded", "yes");
  localStorage.setItem("braveli-workspace-section", JSON.stringify("work"));
  localStorage.setItem("braveli-terminal-webgl", "yes");
}, { projectValue: project, workspaceValue: workspace });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

const measure = async (label, seconds) => {
  const out = await page.evaluate(async (secs) => {
    const tasks = [];
    let obs;
    try {
      obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)); });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {}
    const gaps = []; let last = performance.now();
    await new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const at = performance.now(); gaps.push(at - last); last = at;
        if (at - started >= secs * 1000) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs?.disconnect();
    gaps.sort((a, b) => a - b);
    return {
      fps: +(gaps.length / secs).toFixed(1),
      p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
      worst: +gaps.at(-1).toFixed(1),
      blocked: tasks.reduce((a, b) => a + b, 0),
      longTasks: tasks.length,
      heapMb: +((performance.memory?.usedJSHeapSize ?? 0) / 1e6).toFixed(0),
    };
  }, seconds);
  process.stdout.write(
    `${label.padEnd(26)} ${String(out.fps).padStart(6)} fps   p95 ${String(out.p95).padStart(5)} ms   ` +
    `worst ${String(out.worst).padStart(6)} ms   blocked ${String(out.blocked).padStart(5)} ms / ${out.longTasks}   heap ${out.heapMb} MB\n`,
  );
  return out;
};

process.stdout.write(`\n${MEMBERS}-member council, ${SECONDS}s windows\n\n`);
const before = await measure("idle, no council", SECONDS);

// Start a council through the interface, exactly as a person does.
await goTo(page, "Work");
await page.locator(".dk-workbench-bar").getByRole("button", { name: /council/i }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /start council/i }).first().click();
await page.waitForSelector('[aria-label="Set up Council"]', { timeout: 15_000 });

const addAgent = page.getByRole("button", { name: /add agent/i });
while ((await page.locator(".dk-council-member").count()) < MEMBERS) await addAgent.click();
// Straight to work: the opening debate is a different measurement.
const debate = page.locator(".dk-council-option-label", { hasText: /agree the approach first/i }).locator("input");
if (await debate.count()) await debate.uncheck();
await page.getByRole("dialog", { name: "Set up Council" }).getByRole("button", { name: /^Start council/ }).click();

// Wait until members are actually producing output.
await page.waitForTimeout(9000);
const panes = await page.evaluate(() => document.querySelectorAll(".dk-council-pane").length);
process.stdout.write(`council started with ${panes} panes\n`);

// The thread must not have the grid showing through underneath it.
const overlap = await page.evaluate(() => {
  const toggle = [...document.querySelectorAll(".dk-council-view-toggle button")]
    .find((b) => /thread/i.test(b.textContent || ""));
  toggle?.click();
  return new Promise((r) => setTimeout(() => {
    // The thread lies over the panes so switching never refits a terminal; it
    // has to cover them completely, probed at the grid's own centre.
    const gridEl = document.querySelector(".dk-council-grid");
    const box = gridEl?.getBoundingClientRect();
    const onTop = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
    r({ covered: !gridEl || !gridEl.contains(onTop), onTop: onTop?.className || onTop?.tagName || "" });
  }, 600));
});
// A regression guard, not a note: the grid once beat the rule that hid it, so
// the members showed through underneath the thread.
if (!overlap.covered) {
  console.error(`FAIL the agents grid is visible through the thread (on top: ${overlap.onTop})`);
  process.exitCode = 1;
} else {
  console.log("  OK  the thread view covers the terminal grid");
}
await page.evaluate(() => {
  [...document.querySelectorAll(".dk-council-view-toggle button")]
    .find((b) => /agents/i.test(b.textContent || ""))?.click();
});
await page.waitForTimeout(800);
// Flicker is a terminal being reset or resized when nothing changed. Count
// both over a quiet window, with no interaction at all.
const churn = await page.evaluate(async () => {
  const counts = { resize: 0, reset: 0 };
  const realResize = window.braveli.resizeTerminal;
  window.braveli.resizeTerminal = (payload) => { counts.resize += 1; return realResize(payload); };
  await new Promise((r) => setTimeout(r, 5000));
  window.braveli.resizeTerminal = realResize;
  return counts;
});
console.log(`  resize calls in 5 idle seconds: ${churn.resize}`);

const grid = await measure("council running (grid)", SECONDS);

// The thread is the other surface a council is watched from.
const toggle = page.locator(".dk-council-view-toggle").getByRole("button", { name: /thread/i });
if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(1200); }
const thread = await measure("council running (thread)", SECONDS);

process.stdout.write(
  `\nrunning a council costs ${(before.fps - grid.fps).toFixed(0)} fps ` +
  `(${before.fps} -> ${grid.fps}) and ${grid.blocked - before.blocked} ms of blocking\n`,
);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
await page.waitForTimeout(6000);
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parentOf.set(child, node.id);
const label = (node) => {
  const f = node.callFrame;
  return `${f.functionName || "(anonymous)"} ${f.url ? f.url.split("/").pop() : ""}:${f.lineNumber}`;
};
const measureCallers = new Map();
const self = new Map();
for (const id of profile.samples || []) {
  const node = byId.get(id); if (!node) continue;
  const f = node.callFrame;
  const name = `${f.functionName || "(anonymous)"} ${f.url ? f.url.split("/").pop() : ""}:${f.lineNumber}`;
  self.set(name, (self.get(name) || 0) + 1);
  if (name.startsWith("_measure ")) {
    // Two levels up: the immediate caller is usually a thin wrapper.
    const chain = [];
    let cursor = node.id;
    for (let depth = 0; depth < 4; depth += 1) {
      cursor = parentOf.get(cursor);
      const parent = byId.get(cursor);
      if (!parent) break;
      chain.push(label(parent));
    }
    const key = chain.join("  <-  ") || "(root)";
    measureCallers.set(key, (measureCallers.get(key) || 0) + 1);
  }
}
const samples = (profile.samples || []).length || 1;
process.stdout.write("\nwhere the time goes with a council running:\n");
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([name, count]) => {
  process.stdout.write(`  ${String(((count / samples) * 100).toFixed(1)).padStart(5)}%  ${name}\n`);
});

if (measureCallers.size) {
  process.stdout.write("\nwho calls _measure:\n");
  [...measureCallers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([chain, count]) => {
    process.stdout.write(`  ${((count / samples) * 100).toFixed(1)}%  ${chain}\n`);
  });
}

const renderer = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  return { webgl: Boolean(gl), stored: localStorage.getItem("braveli-terminal-webgl") };
});
const canvases = await page.evaluate(() =>
  [...document.querySelectorAll(".xterm")].map((el) => el.querySelectorAll("canvas").length));
process.stdout.write(
  `\nWebGL available: ${renderer.webgl} — terminals with a GPU canvas: ` +
  `${canvases.filter((n) => n > 0).length}/${canvases.length}\n`,
);

await app.close();
process.stdout.write("\ndone\n");
