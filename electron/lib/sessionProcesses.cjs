/**
 * What a session left running after its terminal was gone.
 *
 * Agent CLIs run tool commands in a session of their own (setsid), so a dev
 * server an agent starts has no controlling terminal and a process group the
 * PTY's never reaches. Once the shell that started it exits it is reparented
 * to launchd and outlives the stop, the quit and every restart: 35 vite, expo
 * and esbuild processes were found this way, some ten days old, all `ppid` 1,
 * no tty, group leader gone.
 *
 * Their ancestry is lost but their environment is not: each still carried the
 * BRAVELI_SESSION_ID its PTY was given. That marker selects a session's
 * processes, and only together with a working directory inside the session's
 * workspace — a Claude daemon started from a session carries the marker too,
 * is shared, and runs from the home directory.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SESSION_MARKER = /(?:^|\s)BRAVELI_SESSION_ID=(\S+)/;

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      // lsof exits 1 when some of the pids it was asked about have gone.
      resolve(error && !stdout ? "" : String(stdout || ""));
    });
  });
}

/** `ps -E` appends each process's environment to its command line. */
function parseProcessList(output) {
  const processes = [];
  for (const line of String(output || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const marker = match[2].match(SESSION_MARKER);
    if (marker) processes.push({ pid: Number(match[1]), sessionId: marker[1] });
  }
  return processes;
}

/** `lsof -Fpn` for the cwd descriptor: a `p` line, then its `n` path. */
function parseWorkingDirectories(output) {
  const directories = new Map();
  let pid = 0;
  for (const line of String(output || "").split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) directories.set(pid, line.slice(1));
  }
  return directories;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The pids that belong to this session and ran inside its workspace.
 *
 * A root that is the filesystem or the home directory contains everything, so
 * it is not evidence of anything and selects nothing.
 */
function selectSessionProcesses(processes, { sessionId, root, exclude = [], homeDir = os.homedir() }) {
  if (!sessionId || !root || !path.isAbsolute(root)) return [];
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot === path.parse(resolvedRoot).root || resolvedRoot === path.resolve(homeDir)) return [];
  const excluded = new Set(exclude);
  return processes
    .filter((item) => item.sessionId === sessionId && !excluded.has(item.pid))
    .filter((item) => item.cwd && isInside(resolvedRoot, item.cwd))
    .map((item) => item.pid);
}

/**
 * Every marked process inside the app's own worktrees whose session has no
 * terminal. At launch that is everything a crash or force-quit left behind,
 * since the stop path that would have ended it never ran.
 */
function selectOrphanedProcesses(processes, { root, isLive = () => false, exclude = [] }) {
  if (!root || !path.isAbsolute(root)) return [];
  const resolvedRoot = path.resolve(root);
  const excluded = new Set(exclude);
  return processes
    .filter((item) => !excluded.has(item.pid) && !isLive(item.sessionId))
    .filter((item) => item.cwd && isInside(resolvedRoot, item.cwd) && path.resolve(item.cwd) !== resolvedRoot)
    .map((item) => item.pid);
}

async function listMarkedProcessesDarwin() {
  const marked = parseProcessList(await run("/bin/ps", ["-axww", "-E", "-o", "pid=,command="]));
  if (!marked.length) return [];
  const directories = parseWorkingDirectories(
    await run("/usr/sbin/lsof", ["-a", "-d", "cwd", "-p", marked.map((item) => item.pid).join(","), "-Fpn"]),
  );
  return marked.map((item) => ({ ...item, cwd: directories.get(item.pid) || "" }));
}

async function listMarkedProcessesLinux() {
  const processes = [];
  for (const entry of await fs.promises.readdir("/proc").catch(() => [])) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const environment = (await fs.promises.readFile(`/proc/${entry}/environ`, "utf8")).split("\0");
      const marker = environment.find((item) => item.startsWith("BRAVELI_SESSION_ID="));
      if (!marker) continue;
      const cwd = await fs.promises.readlink(`/proc/${entry}/cwd`);
      processes.push({ pid: Number(entry), sessionId: marker.slice("BRAVELI_SESSION_ID=".length), cwd });
    } catch {
      // Gone, or not ours to read.
    }
  }
  return processes;
}

function listMarkedProcesses() {
  if (process.platform === "darwin") return listMarkedProcessesDarwin();
  if (process.platform === "linux") return listMarkedProcessesLinux();
  // Windows exposes no other process's environment or working directory; a
  // session's own tree is ended through taskkill /T, and what a crash left
  // behind is found differently (listWindowsProcesses, selectWindowsOrphans).
  return Promise.resolve([]);
}

/**
 * Every process with what Windows does expose about it: its command line,
 * executable, parent and start time. One PowerShell call; slow (about a
 * second), so it runs once, at launch.
 */
async function listWindowsProcesses() {
  const query = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine,ExecutablePath | ConvertTo-Json -Compress";
  return parseWindowsProcesses(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query]));
}

/** ConvertTo-Json of Win32_Process rows; one row comes back as an object, not a list. */
function parseWindowsProcesses(output) {
  let rows;
  try { rows = JSON.parse(String(output || "").trim() || "[]"); } catch { return []; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  const startedAt = (value) => {
    // Windows PowerShell writes "/Date(1760245000000)/"; PowerShell 7 an ISO string.
    const legacy = /Date\((\d+)/.exec(String(value || ""));
    if (legacy) return Number(legacy[1]);
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return rows
    .filter((row) => row && Number.isInteger(row.ProcessId))
    .map((row) => ({
      pid: row.ProcessId,
      ppid: Number(row.ParentProcessId) || 0,
      startedAt: startedAt(row.CreationDate),
      commandLine: String(row.CommandLine || ""),
      executable: String(row.ExecutablePath || ""),
    }));
}

/**
 * What a crash left running in the app's worktrees, on Windows.
 *
 * A dev server an agent started names a file inside its worktree on its
 * command line (node_modules\\.bin\\vite, a script, an executable there).
 * Windows does not reparent an orphan, so the tell is a parent that is gone:
 * no process with that id, or one started after the child (the id was reused).
 * A live session's processes always have a living parent, so a session
 * restored while this ran is never touched.
 */
function selectWindowsOrphans(processes, { root, exclude = [] }) {
  if (!root) return [];
  const needle = String(root).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase() + "\\";
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const excluded = new Set(exclude);
  return processes
    .filter((item) => !excluded.has(item.pid))
    .filter((item) => `${item.commandLine} ${item.executable}`.replace(/\//g, "\\").toLowerCase().includes(needle))
    .filter((item) => {
      const parent = byPid.get(item.ppid);
      return !parent || (parent.startedAt && item.startedAt && parent.startedAt > item.startedAt);
    })
    .map((item) => item.pid);
}

/**
 * TERM, then KILL whatever is still there once the grace period is over.
 *
 * `ended` is asked again after the (slow) listing: a session restarted in the
 * meantime has a new terminal whose children carry the same marker.
 */
async function terminateSessionProcesses({ sessionId, root }, options = {}) {
  const list = options.listProcesses || listMarkedProcesses;
  const ended = options.ended || (() => true);
  const pids = selectSessionProcesses(await list(), {
    sessionId,
    root,
    exclude: [process.pid, process.ppid],
  });
  if (!pids.length || !ended()) return { ok: true, pids: [] };
  return endProcesses(pids, options.graceMs ?? 2000);
}

async function terminateOrphanedProcesses({ root, isLive }, options = {}) {
  if ((options.platform || process.platform) === "win32") {
    const list = options.listWindowsProcesses || listWindowsProcesses;
    const pids = selectWindowsOrphans(await list(), { root, exclude: [process.pid, process.ppid] });
    if (!pids.length) return { ok: true, pids: [] };
    return endProcessesWindows(pids, options.taskkill);
  }
  const list = options.listProcesses || listMarkedProcesses;
  const marked = await list();
  const pids = selectOrphanedProcesses(marked, { root, isLive, exclude: [process.pid, process.ppid] });
  // A session restored while the listing ran owns its processes again.
  const bySession = new Map(marked.map((item) => [item.pid, item.sessionId]));
  const still = pids.filter((pid) => !isLive?.(bySession.get(pid)));
  if (!still.length) return { ok: true, pids: [] };
  return endProcesses(still, options.graceMs ?? 2000);
}

/** taskkill /T /F: the process and anything it started, which on Windows is not a group. */
async function endProcessesWindows(pids, taskkill = (pid) => run("taskkill", ["/pid", String(pid), "/T", "/F"])) {
  for (const pid of pids) await taskkill(pid);
  return { ok: true, pids };
}

async function endProcesses(pids, graceMs) {
  const alive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  };
  const send = (pid, signal) => {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  };
  for (const pid of pids) send(pid, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  const survivors = pids.filter(alive);
  for (const pid of survivors) send(pid, "SIGKILL");
  return { ok: true, pids };
}

module.exports = {
  listMarkedProcesses,
  listWindowsProcesses,
  parseWindowsProcesses,
  selectWindowsOrphans,
  parseProcessList,
  parseWorkingDirectories,
  selectOrphanedProcesses,
  selectSessionProcesses,
  terminateOrphanedProcesses,
  terminateSessionProcesses,
};
