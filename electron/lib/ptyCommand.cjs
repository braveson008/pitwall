const { ptyShellInvocation } = require("./platform.cjs");

function stripTerminalOutput(value) {
  return String(value || "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .trim();
}

function summarizeCommandFailure(result) {
  const clean = stripTerminalOutput(`${result?.stderr || ""}\n${result?.stdout || ""}`);
  if (!clean) return "";
  const lines = clean
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//i.test(line));
  return lines.slice(-3).join(" ").slice(0, 600);
}

function runPtyShell(pty, command, options = {}) {
  return new Promise((resolve) => {
    if (!pty?.spawn) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "Interactive terminal backend unavailable" });
      return;
    }

    let processRef;
    let output = "";
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      const invocation = ptyShellInvocation(command, options);
      processRef = pty.spawn(invocation.file, invocation.args, {
        name: "xterm-256color",
        cols: 120,
        rows: 32,
        cwd: options.cwd,
        env: options.env || process.env,
      });
    } catch (error) {
      finish({ ok: false, code: -1, stdout: output, stderr: error.message });
      return;
    }

    processRef.onData((data) => {
      output += data;
      // What the command prints as it prints it: a sign-in link has to reach
      // the person while the command is still waiting for them to use it.
      try { options.onData?.(data, output); } catch { /* a listener's failure is not the command's */ }
    });
    // A way to stop it, for whoever started it. Stopping settles the result
    // as cancelled rather than leaving the caller waiting out the timeout.
    options.onStart?.({
      cancel() {
        try { processRef.kill(); } catch { /* already gone */ }
        finish({ ok: false, cancelled: true, code: -1, stdout: output, stderr: "Cancelled" });
      },
    });
    processRef.onExit(({ exitCode, signal }) => {
      finish({ ok: exitCode === 0, code: exitCode, signal, stdout: output, stderr: "" });
    });

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        try {
          processRef.kill();
        } catch {
          // The PTY may already have exited.
        }
        finish({ ok: false, code: -1, stdout: output, stderr: "Authentication timed out" });
      }, options.timeoutMs);
    }
  });
}

module.exports = { runPtyShell, stripTerminalOutput, summarizeCommandFailure };
