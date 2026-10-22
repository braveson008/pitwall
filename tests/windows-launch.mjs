// Real Windows: what cmd.exe, git.exe, npm-style .cmd shims and ConPTY actually
// do with the command lines Pitwall builds. Skipped elsewhere.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  console.log("  SKIP  windows-launch runs on Windows only");
  process.exit(0);
}

const require = createRequire(import.meta.url);
require("../electron/lib/windowsBootstrap.cjs");
const platform = require("../electron/lib/platform.cjs");
const { runShellCommand } = require("../electron/lib/shellCommand.cjs");
const pty = require("node-pty");

const hostile = [
  "plain",
  "two words",
  'say "hi"',
  "a & b | c > d < e ^ f",
  "100% %PATH% !USERNAME!",
  "C:\\dir with space\\",
  "{\"hooks\":{\"Stop\":[{\"command\":\"x\"}]}}",
  "mcp_servers.x.url=\"https://h/p?a=1&b=2\"",
  "",
];
const root = mkdtempSync(path.join(os.tmpdir(), "pitwall launch "));
const ok = (name) => console.log(`  OK  ${name}`);

try {
  // 1. A commit message through the shell runner (the macOS path for mutating
  //    git, still used for other commands on Windows) arrives intact.
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  execFileSync("git", ["-C", repo, "add", "a.txt"]);
  const message = 'fix: "quoted" & piped | 100% %PATH% !x! ^caret';
  const committed = await runShellCommand(`git commit -q -m ${platform.shellEscape(message)}`, { cwd: repo, env: process.env, timeoutMs: 30_000 });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  const stored = execFileSync("git", ["-C", repo, "log", "-1", "--format=%B"], { encoding: "utf8" }).trim();
  assert.equal(stored, message);
  ok("commit message with quotes, &, |, %VAR%, !x! and ^ survives cmd");

  // 2. An npm-style .cmd shim receives every argument as given.
  const bin = path.join(root, "bin dir");
  mkdirSync(bin);
  const printer = path.join(root, "print-args.cjs");
  writeFileSync(printer, "process.stdout.write('<<' + JSON.stringify(process.argv.slice(2)) + '>>')");
  // The same shape npm writes for a global package.
  writeFileSync(path.join(bin, "argsdemo.cmd"), `@ECHO off\r\n"${process.execPath}" "${printer}" %*\r\n`);
  const pathValue = `${bin};${process.env.PATH}`;
  assert.equal(platform.resolveExecutable("argsdemo", pathValue).toLowerCase(), path.join(bin, "argsdemo.cmd").toLowerCase());
  const shim = platform.commandInvocation("argsdemo", hostile, { pathValue });
  assert.equal(shim.viaCmd, true);
  const printed = execFileSync(shim.file, shim.args, { ...shim.spawnOptions, encoding: "utf8" });
  assert.deepEqual(JSON.parse(/<<(.*)>>/s.exec(printed)[1]), hostile);
  ok("child_process through a .cmd shim keeps every hostile argument");

  // 3. The same through node-pty (ConPTY), the way agent CLIs start.
  const start = platform.agentInvocation("argsdemo", hostile, { pathValue });
  const fromPty = await new Promise((resolve, reject) => {
    let out = "";
    const term = pty.spawn(start.file, start.args, { cols: 400, rows: 30, cwd: root, env: { ...process.env, PATH: pathValue } });
    const timer = setTimeout(() => { term.kill(); reject(new Error(`timeout: ${out}`)); }, 30_000);
    term.onData((data) => { out += data; });
    term.onExit(() => { clearTimeout(timer); resolve(out); });
  });
  const flat = fromPty.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r?\n/g, "");
  assert.deepEqual(JSON.parse(/<<(.*)>>/s.exec(flat)[1]), hostile);
  ok("node-pty through a .cmd shim keeps every hostile argument");

  // 4. A real program on PATH is started directly, without cmd.
  const direct = platform.commandInvocation("git", ["--version"], { pathValue: process.env.PATH });
  assert.equal(direct.viaCmd, false, JSON.stringify(direct));
  assert.match(execFileSync(direct.file, direct.args, { encoding: "utf8" }), /git version/);
  ok(`git resolves to ${direct.file} and starts directly`);

  // 5. A child sees the PATH it was given, not the inherited Path.
  const seen = execFileSync("cmd.exe", ["/d", "/c", "echo %PATH%"], {
    env: { ...process.env, PATH: `C:\\pitwall-marker;${process.env.PATH}` }, encoding: "utf8",
  });
  assert.match(seen, /pitwall-marker/);
  ok("a child process reads the PATH Pitwall set");

  // 6. Crash cleanup: an orphan in the worktrees is ended, a process whose
  //    parent is alive (a live session's) is not.
  const { terminateOrphanedProcesses } = require("../electron/lib/sessionProcesses.cjs");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(path.join(worktrees, "p", "s1"), { recursive: true });
  const server = path.join(worktrees, "p", "s1", "server.js");
  writeFileSync(server, "setTimeout(() => {}, 120000);");
  const launcher = path.join(root, "launcher.cjs");
  writeFileSync(launcher, `const c = require("child_process").spawn(process.execPath, [${JSON.stringify(server)}], { detached: true, stdio: "ignore" }); c.unref(); console.log(c.pid);`);
  const orphanPid = Number(execFileSync(process.execPath, [launcher], { encoding: "utf8" }).trim());
  const { spawn } = await import("node:child_process");
  const kept = spawn(process.execPath, [server], { stdio: "ignore" });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(alive(orphanPid) && alive(kept.pid));
  const ended = await terminateOrphanedProcesses({ root: worktrees }, { platform: "win32" });
  await new Promise((r) => setTimeout(r, 1000));
  assert.deepEqual(ended.pids, [orphanPid]);
  assert.equal(alive(orphanPid), false);
  assert.equal(alive(kept.pid), true);
  kept.kill();
  ok("crash cleanup ends an orphaned worktree server and spares one with a live parent");

  // 7. Codex's completion notice: the configured command, with the event JSON
  //    appended the way Codex appends it, reaches Pitwall's endpoint intact.
  const { codexCompletionArgs } = require("../electron/lib/agentNotifications.cjs");
  const http = await import("node:http");
  const received = await new Promise((resolve, reject) => {
    const serverHttp = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => { response.end("ok"); serverHttp.close(); resolve(body); });
    });
    serverHttp.listen(0, "127.0.0.1", () => {
      const endpoint = `http://127.0.0.1:${serverHttp.address().port}/agent-complete?token=a&b=1`;
      const notify = JSON.parse(codexCompletionArgs(endpoint)[1].slice("notify=".length));
      const event = JSON.stringify({ type: "agent-turn-complete", "last-assistant-message": 'Done: "quotes" & 100% %PATH% !x!' });
      // Asynchronously: a synchronous call would block this server from answering.
      execFile(notify[0], [...notify.slice(1), event], { timeout: 10_000 }, (error) => { if (error) reject(error); });
    });
    setTimeout(() => reject(new Error("no notice arrived")), 15_000);
  });
  assert.equal(JSON.parse(received)["last-assistant-message"], 'Done: "quotes" & 100% %PATH% !x!');
  ok("Codex completion notice reaches the endpoint with its JSON intact");

  // What a program under ConPTY receives when a multi-line prompt is typed in, with and without bracketed paste.
  for (const paste of [false, true]) {
    const reader = path.join(root, `reader-${paste}.js`);
    writeFileSync(reader, `process.stdin.setRawMode(true); ${paste ? 'process.stdout.write("\\x1b[?2004h");' : ""} let got = ""; process.stdin.on("data", (d) => { got += d.toString("latin1"); }); setTimeout(() => { process.stdout.write("GOT:" + JSON.stringify(got) + ":END"); process.exit(0); }, 3000); process.stdout.write("READY");`);
    const received = await new Promise((resolve) => {
      const term = pty.spawn(process.execPath, [reader], { cols: 200, rows: 10, cwd: root, env: process.env });
      let out = "";
      let typed = false;
      term.onData((data) => {
        out += data;
        if (!typed && out.includes("READY")) {
          typed = true;
          term.write(paste ? "\x1b[200~one\ntwo\x1b[201~" : "one\ntwo");
          setTimeout(() => term.write("\r"), 300);
        }
        const match = /GOT:(".*?"):END/s.exec(out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
        if (match) resolve(match[1]);
      });
      setTimeout(() => resolve("(nothing)"), 8000);
    });
    console.log(`  INFO  typed ${paste ? "with" : "without"} bracketed paste, the program read ${received}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
  // A child left running by a failed step must not keep the job open.
  process.exit();
}
