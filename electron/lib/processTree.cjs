/**
 * Stopping a PTY means stopping everything behind it.
 *
 * node-pty hands back the shell it started, and `kill()` signals that shell
 * alone. But the shell is only the doorway: the agent CLI it launched, and
 * whatever that launched in turn, are separate processes. Signalling the shell
 * left all of them running — reparented to init, unreachable through Pitwall,
 * and still holding whatever they held. They accumulated across app restarts,
 * so a machine could carry days-old agents from sessions nobody remembered.
 *
 * node-pty puts the shell in its own session, which makes it the leader of its
 * process group, so a negative pid reaches the shell and every descendant at
 * once. That is what Pitwall already does for the non-PTY children it spawns;
 * the PTY paths simply never did it.
 *
 * Windows has none of that. There are no signals, no process groups, and no
 * negative pid; a child outlives its parent by default and there is nothing to
 * inherit a kill. `taskkill /T` is the whole mechanism — it walks the parent
 * chain the OS records and ends the subtree — and `/F` is the only way to end
 * a console program that is not asking to be closed. So the escalation below
 * has no counterpart there: one call either reaches the tree or does not.
 */

const { spawn } = require("node:child_process");

/**
 * `taskkill /pid N /T /F`, resolved when it has finished.
 *
 * Exit code 128 is "there is no such process", which is the outcome asked for,
 * and 1 usually means the same thing arriving as an error string.
 */
function terminateWindowsTree(pid) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.on("close", (code) => {
      if (code === 0 || code === 128) return resolve({ ok: true });
      // Already gone, reported as an error rather than a code.
      if (/not found|no running instance/i.test(stderr)) return resolve({ ok: true });
      resolve({ ok: false, error: stderr.trim() || `taskkill exited ${code}` });
    });
  });
}

/** Wait for the owned process group to disappear, escalating when it ignores HUP. */
async function terminateProcessTree(processRef, options = {}) {
  const pid = Number(processRef?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: "Process id is unavailable" };
  if (process.platform === "win32") return terminateWindowsTree(pid);
  const signal = options.signal || "SIGHUP";
  const graceMs = options.graceMs ?? 750;
  const killGraceMs = options.killGraceMs ?? 3000;
  let target = -pid;
  try {
    process.kill(target, 0);
  } catch (error) {
    if (error.code !== "ESRCH") return { ok: false, error: error.message };
    target = pid;
  }
  const exists = () => {
    try { process.kill(target, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  };
  const send = (value) => {
    try { process.kill(target, value); return null; }
    catch (error) { return error.code === "ESRCH" ? null : error.message; }
  };
  const wait = async (duration) => {
    const deadline = Date.now() + duration;
    while (exists() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return !exists();
  };
  if (!exists()) return { ok: true };
  const error = send(signal);
  if (error) return { ok: false, error };
  if (await wait(signal === "SIGKILL" ? killGraceMs : graceMs)) return { ok: true };
  if (signal !== "SIGKILL") {
    const escalationError = send("SIGKILL");
    if (escalationError) return { ok: false, error: escalationError };
    if (await wait(killGraceMs)) return { ok: true };
  }
  return { ok: false, error: "The process group has not exited" };
}

module.exports = { terminateProcessTree, terminateWindowsTree };
