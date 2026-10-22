// Runs every end-to-end smoke in test:electron on its own, with a time limit, and writes what passed and why the
// others did not. For a platform where some are expected to fail: one run shows all of it, not the first failure.
//   npm run build && node tests/run-smokes.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.resolve(process.argv[2] || "release/smoke-report");
mkdirSync(out, { recursive: true });
const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts["test:electron"]
  .split("&&").map((step) => step.trim()).filter((step) => step.startsWith("node tests/")).map((step) => step.slice(5))
  // PITWALL_SMOKES=tests/a.mjs,tests/b.mjs runs only those, for a quicker loop on one platform.
  .filter((script) => !process.env.PITWALL_SMOKES || process.env.PITWALL_SMOKES.split(",").map((item) => item.trim()).includes(script));
const LIMIT_MS = 4 * 60_000;
// What a platform cannot do at all, and why; reported, never run.
const UNSUPPORTED = {
  win32: {
    "tests/session-process-leak-smoke.mjs": "finds a session's detached leftovers by their working directory, which Windows does not expose",
    // Its Windows ground is tests/windows-launch.mjs and tests/packaged-smoke-win.mjs.
    "tests/electron-smoke.mjs": "the Mac development smoke: it needs real Claude and Codex installed and drives zsh and /bin/echo",
  },
}[process.platform] || {};

function run(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], { cwd: root, env: process.env });
    let log = "";
    child.stdout.on("data", (chunk) => { log += chunk; });
    child.stderr.on("data", (chunk) => { log += chunk; });
    const timer = setTimeout(() => { log += `\n[timed out after ${LIMIT_MS / 1000}s]`; child.kill(); }, LIMIT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      writeFileSync(path.join(out, `${path.basename(script, ".mjs")}.log`), log);
      resolve({ script, ok: code === 0, code, seconds: Math.round((Date.now() - started) / 1000), tail: log.trim().split("\n").slice(-6).join("\n") });
    });
  });
}

const results = [];
for (const script of scripts) {
  if (UNSUPPORTED[script]) {
    results.push({ script, ok: true, skipped: UNSUPPORTED[script] });
    console.log(`SKIP ${script}: ${UNSUPPORTED[script]}`);
    continue;
  }
  const result = await run(script);
  results.push(result);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${script} (${result.seconds}s)`);
  if (!result.ok) console.log(result.tail.replace(/^/gm, "    "));
}
writeFileSync(path.join(out, "summary.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} smokes passed`);
