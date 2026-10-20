const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Project checks, a few at a time.
 *
 * Every finished turn that changed files runs the project's checks, and they
 * all used to start at once: six sessions finishing together meant six type
 * checks, test suites and builds racing for the same cores for eight minutes,
 * with the app and every agent starved behind them. Runs now wait their turn,
 * and a request for a checkout that already has one waiting joins it — the
 * waiting run has not started yet, so it will see the newer files anyway. One
 * checkout is never checked twice at the same time: the two runs would share
 * its build output.
 */
function createValidationQueue({ concurrency = 2 } = {}) {
  const waiting = [];
  const queuedByKey = new Map();
  const runningKeys = new Set();

  function next() {
    for (let index = 0; index < waiting.length && runningKeys.size < concurrency;) {
      const job = waiting[index];
      if (runningKeys.has(job.key)) { index += 1; continue; }
      waiting.splice(index, 1);
      if (queuedByKey.get(job.key) === job) queuedByKey.delete(job.key);
      runningKeys.add(job.key);
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => { runningKeys.delete(job.key); next(); });
    }
  }

  function run(key, task) {
    const queued = queuedByKey.get(key);
    if (queued) return queued.promise;
    const job = { key, run: task };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    queuedByKey.set(key, job);
    waiting.push(job);
    next();
    return job.promise;
  }

  return { run, stats: () => ({ active: runningKeys.size, waiting: waiting.length }) };
}

/**
 * What a checkout holds, to the byte: its commit, its staged and unstaged
 * changes, and its untracked files' names, sizes and timestamps. Null when it
 * cannot be told, which callers never treat as unchanged.
 */
async function worktreeFingerprint(cwd, runGit) {
  const [head, diff, untracked] = await Promise.all([
    runGit(["rev-parse", "HEAD"], cwd),
    runGit(["diff", "HEAD", "--binary"], cwd),
    runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd),
  ]);
  if (!head.ok || !diff.ok || !untracked.ok) return null;
  const digest = createHash("sha256").update(head.stdout).update("\0").update(diff.stdout).update("\0");
  for (const file of untracked.stdout.split("\0").filter(Boolean).sort()) {
    const stat = await fs.stat(path.join(cwd, file)).catch(() => null);
    digest.update(`${file}:${stat?.size ?? -1}:${stat?.mtimeMs ?? -1}\0`);
  }
  return digest.digest("hex");
}

module.exports = { createValidationQueue, worktreeFingerprint };
