const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { terminateProcessTree } = require("../electron/lib/processTree.cjs");
const { runShellCommand } = require("../electron/lib/shellCommand.cjs");

test("stopping a process that ignores HUP waits for forced termination", async (t) => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGHUP',()=>{});console.log('ready');setInterval(()=>{},1000)"], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  const exited = once(child, "exit");
  await once(child.stdout, "data");
  const result = await terminateProcessTree(child, { graceMs: 50 });
  assert.equal(result.ok, true, JSON.stringify(result));
  const [, signal] = await exited;
  assert.equal(signal, "SIGKILL");
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});

test("a timed-out shell cannot leave a child writing after its result", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-timeout-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "child.cjs");
  const marker = path.join(dir, "late-write");
  fs.writeFileSync(script, `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),350);`);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const result = await runShellCommand(`${quote(process.execPath)} ${quote(script)} & wait`, { shell: "/bin/sh", cwd: dir, timeoutMs: 75 });
  assert.equal(result.timedOut, true);
  assert.equal(result.terminationFailed, undefined, JSON.stringify(result));
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(fs.existsSync(marker), false);
});

test("shell jobs preserve input and exit status while bounding captured output", async () => {
  const echo = await runShellCommand("cat", { shell: "/bin/sh", input: "a task with 'quotes'\n", timeoutMs: 1000 });
  assert.equal(echo.ok, true);
  assert.equal(echo.stdout, "a task with 'quotes'\n");
  const output = await runShellCommand("printf '%05000d' 0; printf failure >&2; exit 7", { shell: "/bin/sh", maxOutputBytes: 64, timeoutMs: 1000 });
  assert.equal(output.code, 7);
  assert.equal(output.stdout.length, 64);
  assert.equal(output.stderr, "failure");
});
