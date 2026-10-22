const { spawn } = require("node:child_process");
const os = require("node:os");
const { terminateProcessTree } = require("./processTree.cjs");
const { commandInvocation, isWindows, shellEscape, shellInvocation } = require("./platform.cjs");

/** Shell jobs own their process group, including npm's test-runner children. */
function runShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    const { file, args, spawnOptions } = options.invocation || shellInvocation(command, options);
    const child = spawn(file, args, {
      ...spawnOptions,
      cwd: options.cwd,
      env: options.env,
      // Its own process group on a Mac, so a timeout can stop the whole job.
      // On Windows a detached child gets a console window of its own; the
      // tree is stopped with taskkill /T instead.
      detached: !isWindows,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    // Below the app and the agents, so a test suite cannot make either stutter.
    if (options.lowPriority && child.pid) {
      try { os.setPriority(child.pid, 10); } catch { /* best effort */ }
    }
    const limit = options.maxOutputBytes ?? 4 * 1024 * 1024;
    const out = boundedTail(limit);
    const err = boundedTail(limit);
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (fields) => {
      if (settled) return;
      const result = { stdout: out.text(), stderr: err.text(), ...fields };
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => finish({ ok: false, code: -1, stderr: error.message }));
    child.on("close", (code) => {
      if (!timedOut) finish({ ok: code === 0, code });
    });
    if (child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input ?? "");
    }
    if (options.timeoutMs) {
      timer = setTimeout(async () => {
        timedOut = true;
        const stopped = await terminateProcessTree(child, { signal: "SIGKILL" });
        finish({
          ok: false,
          code: -1,
          stderr: [err.text(), `Command timed out after ${options.timeoutMs}ms`, stopped.ok ? "" : stopped.error].filter(Boolean).join("\n"),
          timedOut: true,
          ...(stopped.ok ? {} : { terminationFailed: true }),
        });
      }, options.timeoutMs);
    }
  });
}

/**
 * One program and its arguments. On Windows it is started without cmd when it is a real program, because cmd ends
 * a command at the first line break and a review body or reply has many. A Mac keeps the login shell for its PATH.
 */
function runProgramCommand(program, args = [], options = {}) {
  if (!isWindows) return runShellCommand([program, ...args].map(shellEscape).join(" "), options);
  return runShellCommand(null, { ...options, invocation: commandInvocation(program, args, { pathValue: options.env?.PATH }) });
}

/**
 * The last `limit` characters of a stream. Appending to one string and slicing
 * copied up to the whole limit on every chunk, which for a chatty test suite
 * held the main process for seconds; chunks are kept and joined once.
 */
function boundedTail(limit) {
  const parts = [];
  let size = 0;
  return {
    push(chunk) {
      parts.push(chunk);
      size += chunk.length;
      while (parts.length > 1 && size - parts[0].length >= limit) size -= parts.shift().length;
    },
    text() {
      const joined = parts.join("");
      return joined.length > limit ? joined.slice(-limit) : joined;
    },
  };
}

module.exports = { runShellCommand, runProgramCommand, boundedTail };
