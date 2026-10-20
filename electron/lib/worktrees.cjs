const crypto = require("node:crypto");
const path = require("node:path");

function parseWorktreeList(output) {
  const records = [];
  let current = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice(9), branch: "", head: "", bare: false, detached: false };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).replace(/^refs\/heads\//, "");
    } else if (current && line === "bare") {
      current.bare = true;
    } else if (current && line === "detached") {
      current.detached = true;
    }
  }
  if (current) records.push(current);
  return records;
}

// Names Windows refuses as a file or folder, with or without an extension.
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/;

function branchSlug(branch) {
  // No leading or trailing dot: Windows drops a trailing one, and a leading
  // one hides the folder from the cleanup that lists managed worktrees.
  const slug = String(branch || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 80)
    .replace(/^[-.]+|[-.]+$/g, "") || "session";
  return RESERVED_NAME.test(slug) ? `${slug}-branch` : slug;
}

/**
 * Runs a git command again when Windows reports a file in use: removing a
 * worktree just after its agent exits, or while an antivirus scan holds a
 * file open, fails for a moment and then succeeds.
 */
async function retryWhileLocked(run, { attempts = 4, delayMs = 500, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let result = await run();
  for (let attempt = 1; attempt < attempts && !result.ok && FILE_IN_USE.test(`${result.stderr || ""}${result.stdout || ""}`); attempt += 1) {
    await wait(delayMs * attempt);
    result = await run();
  }
  return result;
}

const FILE_IN_USE = /permission denied|being used by another process|directory not empty|unable to unlink|failed to delete|resource busy|invalid argument/i;

function managedWorktreeRoot(userDataPath, projectPath) {
  const projectKey = crypto.createHash("sha256").update(path.resolve(projectPath)).digest("hex").slice(0, 16);
  return path.join(userDataPath, "worktrees", projectKey);
}

function managedWorktreePath(userDataPath, projectPath, branch) {
  return path.join(managedWorktreeRoot(userDataPath, projectPath), branchSlug(branch));
}

function isManagedWorktree(userDataPath, projectPath, targetPath) {
  const root = path.resolve(managedWorktreeRoot(userDataPath, projectPath));
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Decides where a session's checkout goes, given what Git already has.
 *
 * The directory is named from a slug of the branch at creation time, but the
 * branch inside it can be renamed or checked out to something else afterwards,
 * and two branch names can slug to the same directory. Looking the worktree up
 * by exact branch then finds nothing while the path is already taken. That used
 * to be a hard error with no way forward: the session could never be created
 * again without deleting the directory by hand.
 *
 * An occupied path that Git knows as a worktree is reused as it is. The branch
 * it actually holds is reported back rather than the one that was asked for, so
 * nothing downstream records a branch the checkout is not on.
 */
function resolveWorktreeTarget({ branch, worktrees, targetPath, targetExists }) {
  const requestedBranch = String(branch || "");
  const records = Array.isArray(worktrees) ? worktrees : [];
  const samePath = (a, b) => path.resolve(String(a || "")) === path.resolve(String(b || ""));

  const byBranch = records.find((item) => item.branch === requestedBranch);
  if (byBranch) {
    return {
      action: "reuse",
      path: byBranch.path,
      branch: byBranch.branch,
      requestedBranch,
      ...(byBranch.detached ? { detached: true } : {}),
    };
  }

  if (!targetExists) return { action: "create", path: targetPath, branch: requestedBranch, requestedBranch };

  const byPath = records.find((item) => samePath(item.path, targetPath));
  if (byPath) {
    return {
      action: "reuse",
      path: byPath.path,
      branch: byPath.branch,
      requestedBranch,
      ...(byPath.detached ? { detached: true } : {}),
    };
  }

  return {
    action: "blocked",
    reason: `${targetPath} already exists and is not a Git worktree. Remove it, or choose another branch.`,
  };
}

/**
 * Which branch a removed worktree comes back on.
 *
 * An agent often moves its work to a branch it names itself
 * (`feature/ACME-2687-…`), while Pitwall remembers its own (`acme-2687`).
 * Restoring Pitwall's name then reopened the session on an empty branch, and
 * the agent did the work again. The agent's branch wins only when it carries
 * the same ticket and already contains everything on Pitwall's, so nothing is
 * left behind either way.
 */
function branchToRestore({ requested, ticket, candidates = [] }) {
  const key = String(ticket || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) return requested;
  const token = new RegExp(`(^|[^A-Za-z0-9])${key}(?!\\d)`, "i");
  const best = candidates
    .filter((item) => item.name !== requested && token.test(item.name) && item.containsRequested && !item.checkedOut)
    .sort((a, b) => b.committedAt - a.committedAt)[0];
  return best ? best.name : requested;
}

module.exports = {
  branchSlug,
  branchToRestore,
  isManagedWorktree,
  managedWorktreePath,
  retryWhileLocked,
  managedWorktreeRoot,
  parseWorktreeList,
  resolveWorktreeTarget,
};
