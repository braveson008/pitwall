/**
 * The end of a managed worktree's life, and what its dependencies cost.
 *
 * Every session gets a worktree and nothing ever removed one, and each got a
 * full node_modules installed by its agent: 51 of 61 GB on one machine. Three
 * things here: removing a worktree once its work is finished and safe on a
 * remote, cloning the primary checkout's node_modules into a new one instead
 * of installing again, and dropping node_modules from worktrees nobody has
 * touched in a week.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isManagedWorktree } = require("./worktrees.cjs");

const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function countLines(output) {
  return String(output || "").split(/\r?\n/).filter((line) => line.trim()).length;
}

/** A worktree is in use when any live terminal runs in it or below it. */
function worktreeInUse(worktreePath, livePaths) {
  return (livePaths || []).some((livePath) => livePath && isInside(worktreePath, livePath));
}

/** Everything that keeps a worktree on disk. Empty means it can go. */
function removalBlockers({ live, dirty, unpushed }) {
  const blockers = [];
  if (live) blockers.push("live");
  if (dirty) blockers.push("dirty");
  if (unpushed) blockers.push("unpushed");
  return blockers;
}

/**
 * Uncommitted paths, and commits on HEAD that no remote has.
 *
 * Ignored files are not uncommitted work: `status --porcelain` leaves them out,
 * so node_modules does not hold a worktree back. A repository with no remote
 * reports every commit as unpushed, which keeps its worktrees — there is
 * nowhere the work is safe except here.
 */
async function inspectWorktree(runGit, worktreePath) {
  const [status, unpushed, head] = await Promise.all([
    runGit(["status", "--porcelain"], worktreePath, { timeoutMs: 30000 }),
    runGit(["log", "--format=%H", "HEAD", "--not", "--remotes"], worktreePath, { timeoutMs: 30000 }),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath, { timeoutMs: 10000 }),
  ]);
  if (!status.ok || !unpushed.ok) {
    return { ok: false, error: (status.stderr || unpushed.stderr || "Could not read the worktree").trim() };
  }
  const branch = head.ok ? head.stdout.trim() : "";
  return {
    ok: true,
    dirty: countLines(status.stdout),
    unpushed: countLines(unpushed.stdout),
    branch: branch === "HEAD" ? "" : branch,
  };
}

/**
 * Removes a worktree only when nothing would be lost.
 *
 * Plain `git worktree remove`, never forced: it keeps the branch, and refuses
 * by itself if anything untracked appeared after the check. Liveness is asked
 * again right before removing, since a terminal can start while git runs.
 */
async function removeWorktreeIfSafe({ runGit, projectRoot, worktreePath, isLive }) {
  if (isLive(worktreePath)) return { ok: true, removed: false, blockers: ["live"], dirty: 0, unpushed: 0 };
  const state = await inspectWorktree(runGit, worktreePath);
  if (!state.ok) return { ok: false, removed: false, error: state.error };
  const blockers = removalBlockers({ live: isLive(worktreePath), dirty: state.dirty, unpushed: state.unpushed });
  const facts = { dirty: state.dirty, unpushed: state.unpushed, branch: state.branch };
  if (blockers.length) return { ok: true, removed: false, blockers, ...facts };
  const result = await runGit(["worktree", "remove", worktreePath], projectRoot, { timeoutMs: 120000 });
  if (!result.ok) {
    return { ok: false, removed: false, ...facts, error: (result.stderr || result.stdout || "Unable to remove worktree").trim() };
  }
  return { ok: true, removed: true, blockers: [], ...facts };
}

async function readOptional(filePath) {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Whether two checkouts would install the same dependencies.
 *
 * Every lockfile either side has must exist on both and match byte for byte,
 * and there must be at least one: without a lockfile there is nothing that
 * says the primary's node_modules is what this checkout would get.
 */
async function lockfilesMatch(primaryDir, worktreeDir) {
  let compared = 0;
  for (const name of LOCKFILES) {
    const [primary, worktree] = await Promise.all([
      readOptional(path.join(primaryDir, name)),
      readOptional(path.join(worktreeDir, name)),
    ]);
    if (!primary && !worktree) continue;
    if (!primary || !worktree || !primary.equals(worktree)) return false;
    compared += 1;
  }
  return compared > 0;
}

async function hasLockfile(dir) {
  for (const name of LOCKFILES) {
    if (await readOptional(path.join(dir, name))) return true;
  }
  return false;
}

/**
 * The node_modules directories of a checkout, relative to it.
 *
 * The root one and those of workspace packages (apps/x/node_modules). Never
 * descends into a node_modules, a dot-directory or a symlink, and stops at a
 * depth and a directory count so a huge tree cannot make this slow.
 */
async function findNodeModules(root, { maxDepth = 4, maxDirs = 5000 } = {}) {
  const found = [];
  const queue = [{ rel: "", depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirs) {
    const { rel, depth } = queue.shift();
    visited += 1;
    let entries;
    try {
      entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.name === "node_modules") found.push(child);
      else if (!entry.name.startsWith(".") && depth + 1 < maxDepth) queue.push({ rel: child, depth: depth + 1 });
    }
  }
  return found.sort((left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right));
}

/**
 * How to copy a directory without paying for it again.
 *
 * macOS clones on APFS (clonefile: shared blocks until one side writes), and
 * Linux reflinks where the filesystem can. Both keep symlinks as symlinks, so
 * pnpm's relative links into .pnpm resolve inside the copy. Windows has no
 * equivalent here, so it installs.
 */
function cloneCommand(platform, source, target) {
  if (platform === "darwin") return { file: "cp", args: ["-c", "-R", source, target] };
  if (platform === "linux") return { file: "cp", args: ["--reflink=auto", "-a", source, target] };
  return null;
}

function runFile(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: Math.max(1, timeoutMs), killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      resolve(error ? { ok: false, error: String(stderr || error.message).trim() } : { ok: true });
    });
  });
}

async function exists(targetPath) {
  try {
    await fs.promises.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gives a new worktree the primary checkout's node_modules, cloned.
 *
 * Only when the lockfiles are identical — otherwise the agent installs, as it
 * always did. Each copy is made beside the worktree and moved in whole, so a
 * session never sees half a node_modules, and one the agent already installed
 * is left alone. Bounded in time; any failure leaves the worktree as it was.
 */
async function shareDependencies({ primaryRoot, worktreePath, platform = process.platform, timeoutMs = 120000 }) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  if (!cloneCommand(platform, "", "")) return { ok: true, cloned: [], skipped: "unsupported platform", ms: 0 };
  const candidates = await findNodeModules(primaryRoot);
  if (!candidates.length) return { ok: true, cloned: [], skipped: "no node_modules in the primary checkout", ms: elapsed() };
  if (!(await lockfilesMatch(primaryRoot, worktreePath))) {
    return { ok: true, cloned: [], skipped: "lockfile differs from the primary checkout", ms: elapsed() };
  }

  const staging = await fs.promises.mkdtemp(path.join(path.dirname(worktreePath), ".clone-"));
  const cloned = [];
  const failures = [];
  try {
    for (const [index, relative] of candidates.entries()) {
      const remaining = timeoutMs - elapsed();
      if (remaining <= 0) {
        failures.push(`${relative}: out of time`);
        break;
      }
      const parent = path.dirname(relative);
      const target = path.join(worktreePath, relative);
      if (!(await exists(path.join(worktreePath, parent))) || (await exists(target))) continue;
      if (parent !== "." && (await hasLockfile(path.join(primaryRoot, parent)))
        && !(await lockfilesMatch(path.join(primaryRoot, parent), path.join(worktreePath, parent)))) continue;
      const staged = path.join(staging, String(index));
      const command = cloneCommand(platform, path.join(primaryRoot, relative), staged);
      const result = await runFile(command.file, command.args, remaining);
      if (!result.ok) {
        failures.push(`${relative}: ${result.error}`);
        continue;
      }
      if (await exists(target)) continue;
      try {
        await fs.promises.rename(staged, target);
        cloned.push(relative);
      } catch (error) {
        failures.push(`${relative}: ${error.message}`);
      }
    }
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  return { ok: failures.length === 0, cloned, failures, ms: elapsed() };
}

/**
 * The newest modification time of any file outside node_modules, in ms.
 *
 * Stops at the first file newer than `since`, which is all retention needs to
 * know. A tree too large to finish reads as just modified, so it is kept.
 */
async function newestChange(root, { since = 0, maxEntries = 200000 } = {}) {
  let newest = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return Date.now();
      if (entry.name === "node_modules") continue;
      // The worktree's .git pointer is rewritten by `git worktree repair`; it is not work.
      if (dir === root && entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        const stat = await fs.promises.lstat(full);
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
        if (newest > since && since > 0) return newest;
      } catch {
        // Gone between the listing and the stat.
      }
    }
  }
  return newest;
}

/** The worktrees whose node_modules can go: not live, and untouched for the retention period. */
function selectForRetention(worktrees, { now = Date.now(), maxAgeMs = RETENTION_MS } = {}) {
  return (worktrees || []).filter((worktree) =>
    !worktree.live
    && worktree.nodeModules?.length > 0
    && Number.isFinite(worktree.newestChange)
    && now - worktree.newestChange > maxAgeMs);
}

async function samePath(a, b) {
  const real = (value) => fs.promises.realpath(value).catch(() => path.resolve(value));
  return (await real(a)) === (await real(b));
}

/**
 * The project a managed worktree belongs to, read from its `.git` file.
 *
 * A linked worktree's `.git` names `<primary>/.git/worktrees/<name>`. It is
 * Pitwall's when it sits in userData/worktrees/<key>/<name> and either the key
 * is the hash of that primary's path, or the primary's record points back at
 * this worktree. The second covers a project that moved: its key hashes the
 * old path, and without it the worktrees were disowned and kept forever.
 */
async function managedWorktreeOwner(userDataPath, worktreePath) {
  try {
    const relative = path.relative(path.join(userDataPath, "worktrees"), worktreePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).length !== 2) return "";
    const pointer = await fs.promises.readFile(path.join(worktreePath, ".git"), "utf8");
    const match = pointer.match(/^gitdir:\s*(.+)$/m);
    if (!match) return "";
    const gitDir = path.resolve(worktreePath, match[1].trim());
    if (path.basename(path.dirname(gitDir)) !== "worktrees" || path.basename(path.dirname(path.dirname(gitDir))) !== ".git") return "";
    const primary = path.dirname(path.dirname(path.dirname(gitDir)));
    if (isManagedWorktree(userDataPath, primary, worktreePath)) return primary;
    const back = (await fs.promises.readFile(path.join(gitDir, "gitdir"), "utf8")).trim();
    return (await samePath(path.resolve(gitDir, back), path.join(worktreePath, ".git"))) ? primary : "";
  } catch {
    return "";
  }
}

/** Every worktree under userData/worktrees that is provably Pitwall's, with its project. */
async function listManagedWorktrees(userDataPath) {
  const root = path.join(userDataPath, "worktrees");
  const found = [];
  const projects = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory() || project.name.startsWith(".")) continue;
    const children = await fs.promises.readdir(path.join(root, project.name), { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith(".")) continue;
      const worktreePath = path.join(root, project.name, child.name);
      const primary = await managedWorktreeOwner(userDataPath, worktreePath);
      if (primary) found.push({ path: worktreePath, primary });
    }
  }
  return found;
}

function directorySizeKb(target) {
  return new Promise((resolve) => {
    execFile("du", ["-sk", target], { timeout: 60000 }, (error, stdout) => {
      resolve(error ? 0 : Number.parseInt(String(stdout), 10) || 0);
    });
  });
}

/**
 * Deletes node_modules from managed worktrees that have sat untouched.
 *
 * Never a live session's worktree, never the primary checkout, never anything
 * outside userData/worktrees, and never through a symlink. The worktree itself
 * stays; the next session in it installs or clones again.
 */
async function reclaimIdleDependencies({ userDataPath, isLive, now = Date.now(), maxAgeMs = RETENTION_MS, log = () => {} }) {
  const since = now - maxAgeMs;
  const described = [];
  for (const worktree of await listManagedWorktrees(userDataPath)) {
    const live = isLive(worktree.path);
    const nodeModules = live ? [] : await findNodeModules(worktree.path);
    const changed = nodeModules.length ? await newestChange(worktree.path, { since }) : Number.NaN;
    described.push({ ...worktree, live, nodeModules, newestChange: changed });
  }

  const reclaimed = [];
  for (const worktree of selectForRetention(described, { now, maxAgeMs })) {
    if (isLive(worktree.path) || !(await managedWorktreeOwner(userDataPath, worktree.path))) continue;
    for (const relative of worktree.nodeModules) {
      const target = path.join(worktree.path, relative);
      if (path.basename(target) !== "node_modules" || !isInside(worktree.path, target) || target === worktree.path) continue;
      const stat = await fs.promises.lstat(target).catch(() => null);
      if (!stat?.isDirectory()) continue;
      const kb = await directorySizeKb(target);
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        reclaimed.push({ path: target, kb });
      } catch (error) {
        log(`[worktrees] could not delete ${target}: ${error.message}`);
      }
    }
  }
  const totalKb = reclaimed.reduce((sum, item) => sum + item.kb, 0);
  if (reclaimed.length) {
    log(`[worktrees] reclaimed ${reclaimed.length} idle node_modules, up to ${Math.round(totalKb / 1024)} MB: ${reclaimed.map((item) => item.path).join(", ")}`);
  }
  return { reclaimed, totalKb };
}

function plistWorkspacePath(file) {
  return new Promise((resolve) => {
    execFile("plutil", ["-extract", "WorkspacePath", "raw", "-o", "-", file], { timeout: 10000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout).trim());
    });
  });
}

/**
 * Deletes Xcode build output made for a managed worktree that is gone or idle.
 *
 * Every task builds into its own DerivedData folder (one machine had 36 GB),
 * and Xcode never removes them. Only folders whose recorded workspace is inside
 * userData/worktrees are considered; the person's own projects are untouched.
 */
async function reclaimDerivedData({
  userDataPath,
  derivedDataPath,
  isLive,
  now = Date.now(),
  maxAgeMs = RETENTION_MS,
  readWorkspacePath = plistWorkspacePath,
  log = () => {},
}) {
  const worktreesRoot = path.join(userDataPath, "worktrees");
  const entries = await fs.promises.readdir(derivedDataPath, { withFileTypes: true }).catch(() => []);
  const reclaimed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(derivedDataPath, entry.name);
    const workspace = await readWorkspacePath(path.join(folder, "info.plist"));
    if (!workspace || !isInside(worktreesRoot, workspace) || isLive(workspace)) continue;
    const stat = await fs.promises.stat(folder).catch(() => null);
    const gone = !(await pathExists(workspace));
    if (!gone && (!stat || now - stat.mtimeMs <= maxAgeMs)) continue;
    const kb = await directorySizeKb(folder);
    try {
      await fs.promises.rm(folder, { recursive: true, force: true });
      reclaimed.push({ path: folder, kb });
    } catch (error) {
      log(`[worktrees] could not delete ${folder}: ${error.message}`);
    }
  }
  if (reclaimed.length) {
    const mb = Math.round(reclaimed.reduce((sum, item) => sum + item.kb, 0) / 1024);
    log(`[worktrees] reclaimed ${reclaimed.length} DerivedData folders, up to ${mb} MB`);
  }
  return { reclaimed };
}

async function pathExists(target) {
  return fs.promises.access(target).then(() => true, () => false);
}

/**
 * The periodic pass that keeps managed worktrees from piling up.
 *
 * Retiring a worktree used to hang off the moment a task finished, so anything
 * that missed it (the app was closed, a crash, the project moved) stayed for
 * good. This repairs links after a move, then removes worktrees idle past the
 * retention period that are clean and fully on a remote — lossless, the branch
 * stays and a resumed session recreates it — and drops dependencies and build
 * output from the idle ones it has to keep.
 */
async function maintainWorktrees({
  userDataPath,
  projectPaths = [],
  runGit,
  isLive,
  now = Date.now(),
  maxAgeMs = RETENTION_MS,
  derivedDataPath,
  log = () => {},
}) {
  for (const projectPath of new Set(projectPaths.filter(Boolean))) {
    const root = await runGit(["rev-parse", "--show-toplevel"], projectPath, { timeoutMs: 10000 });
    if (!root.ok) continue;
    await runGit(["worktree", "repair"], root.stdout.trim(), { timeoutMs: 60000 });
    await runGit(["worktree", "prune"], root.stdout.trim(), { timeoutMs: 60000 });
  }

  const removed = [];
  const since = now - maxAgeMs;
  for (const worktree of await listManagedWorktrees(userDataPath)) {
    if (isLive(worktree.path)) continue;
    const changed = await newestChange(worktree.path, { since });
    if (!Number.isFinite(changed) || now - changed <= maxAgeMs) continue;
    const result = await removeWorktreeIfSafe({ runGit, projectRoot: worktree.primary, worktreePath: worktree.path, isLive });
    if (result.removed) removed.push(worktree.path);
  }
  if (removed.length) log(`[worktrees] removed ${removed.length} idle worktrees, clean and on a remote: ${removed.join(", ")}`);

  const dependencies = await reclaimIdleDependencies({ userDataPath, isLive, now, maxAgeMs, log });
  const derivedData = derivedDataPath
    ? await reclaimDerivedData({ userDataPath, derivedDataPath, isLive, now, maxAgeMs, log })
    : { reclaimed: [] };
  return { removed, dependencies, derivedData };
}

module.exports = {
  LOCKFILES,
  RETENTION_MS,
  cloneCommand,
  findNodeModules,
  inspectWorktree,
  listManagedWorktrees,
  lockfilesMatch,
  maintainWorktrees,
  managedWorktreeOwner,
  newestChange,
  reclaimDerivedData,
  reclaimIdleDependencies,
  removalBlockers,
  removeWorktreeIfSafe,
  selectForRetention,
  shareDependencies,
  worktreeInUse,
};
