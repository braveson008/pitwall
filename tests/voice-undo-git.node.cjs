/**
 * The git undo handlers, against real repositories.
 *
 * These are the only tests in the suite that shell out to git, and they earn it:
 * every one of the refusals here is a case where `git reset` or `git branch -d`
 * would destroy work instead of reversing a mistake, and a refusal that has
 * never actually run is a comment rather than a safeguard.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const { createGitCapabilities } = require("../electron/lib/voiceRuntime.cjs");

/** The same shape `main.cjs` injects: argv in, {ok, stdout, stderr} out. */
const runGit = (args, cwd) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: stdout || "", stderr: stderr || "" }),
    );
  });

const git = createGitCapabilities({
  runGit,
  runConductor: async () => ({ ok: false }),
  osControl: {},
  projectPathFrom: (context) => context?.projectPath || null,
});

let repoCount = 0;

async function makeRepo({ empty = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pitwall-undo-${repoCount++}-`));
  await runGit(["init", "--initial-branch=main"], dir);
  await runGit(["config", "user.email", "test@example.com"], dir);
  await runGit(["config", "user.name", "Test"], dir);
  await runGit(["config", "commit.gpgsign", "false"], dir);
  if (!empty) {
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    await runGit(["add", "."], dir);
    await runGit(["commit", "-m", "base"], dir);
  }
  return { dir, context: { projectPath: dir } };
}

const write = (dir, name, body) => fs.writeFileSync(path.join(dir, name), body);
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// ------------------------------------------------------------ undoing a commit

test("undoing a commit restores the working tree exactly as it was", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));

  write(dir, "base.txt", "changed\n");
  const commit = await git.commit({ message: "Change the base", all: true }, context);
  assert.equal(commit.ok, true);
  assert.ok(commit.sha, "the commit must record its sha or it cannot be undone safely");

  const undone = await git.undoCommit({ result: commit }, context);
  assert.equal(undone.ok, true, undone.speak);

  // The commit is gone...
  const log = await runGit(["log", "--oneline"], dir);
  assert.doesNotMatch(log.stdout, /Change the base/);
  // ...and the work is not: --soft leaves it staged, which is where it was.
  const staged = await runGit(["diff", "--cached", "--name-only"], dir);
  assert.match(staged.stdout, /base\.txt/);
  assert.equal(fs.readFileSync(path.join(dir, "base.txt"), "utf8"), "changed\n");
});

test("refuses when something has been committed since", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));

  write(dir, "base.txt", "one\n");
  const first = await git.commit({ message: "First", all: true }, context);
  write(dir, "base.txt", "two\n");
  await git.commit({ message: "Second", all: true }, context);

  const undone = await git.undoCommit({ result: first }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /committed since/i);
  // The later commit is untouched — that is the whole point of refusing.
  const log = await runGit(["log", "--oneline"], dir);
  assert.match(log.stdout, /Second/);
  assert.match(log.stdout, /First/);
});

test("refuses when the commit has already been pushed", async (t) => {
  const { dir, context } = await makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-undo-remote-"));
  t.after(() => {
    cleanup(dir);
    cleanup(remote);
  });

  await runGit(["init", "--bare"], remote);
  await runGit(["remote", "add", "origin", remote], dir);

  write(dir, "base.txt", "published\n");
  const commit = await git.commit({ message: "Published work", all: true }, context);
  await runGit(["push", "--set-upstream", "origin", "main"], dir);

  const undone = await git.undoCommit({ result: commit }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /pushed/i);
  assert.match(undone.speak, /force push/i, "the user should be told why, not just refused");

  // History is intact locally, so the remote and local still agree.
  const head = await runGit(["rev-parse", "HEAD"], dir);
  assert.equal(head.stdout.trim(), commit.sha);
});

test("refuses to delete the repository's first commit", async (t) => {
  const { dir, context } = await makeRepo({ empty: true });
  t.after(() => cleanup(dir));

  write(dir, "first.txt", "hello\n");
  await runGit(["add", "."], dir);
  const commit = await git.commit({ message: "The very first commit", all: true }, context);
  assert.equal(commit.ok, true);

  const undone = await git.undoCommit({ result: commit }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /first commit/i);
  const log = await runGit(["log", "--oneline"], dir);
  assert.match(log.stdout, /The very first commit/);
});

test("refuses when it has no record of which commit ran", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));
  const undone = await git.undoCommit({ result: {} }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /don't have a record/i);
});

// ------------------------------------------------------------ undoing a branch

test("undoing a new branch deletes it and returns to the previous one", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));

  const created = await git.createBranch({ name: "login fix" }, context);
  assert.equal(created.ok, true);
  assert.equal(created.branch, "login-fix", "spoken prose is slugified");
  assert.equal(created.previousBranch, "main");

  const undone = await git.undoCreateBranch({ result: created }, context);
  assert.equal(undone.ok, true, undone.speak);

  const current = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  assert.equal(current.stdout.trim(), "main");
  const branches = await runGit(["branch", "--list"], dir);
  assert.doesNotMatch(branches.stdout, /login-fix/);
});

test("refuses once there is work on the branch", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));

  const created = await git.createBranch({ name: "feature" }, context);
  write(dir, "base.txt", "work happened here\n");
  await git.commit({ message: "Real work", all: true }, context);

  const undone = await git.undoCreateBranch({ result: created }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /commits on it now/i);

  // Still on the branch, and the commit survives.
  const current = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  assert.equal(current.stdout.trim(), "feature");
  const log = await runGit(["log", "--oneline"], dir);
  assert.match(log.stdout, /Real work/);
});

test("refuses once the user has moved to another branch", async (t) => {
  const { dir, context } = await makeRepo();
  t.after(() => cleanup(dir));

  const created = await git.createBranch({ name: "feature" }, context);
  await runGit(["checkout", "main"], dir);

  const undone = await git.undoCreateBranch({ result: created }, context);
  assert.equal(undone.ok, false);
  assert.match(undone.speak, /not on feature any more/i);
  const branches = await runGit(["branch", "--list"], dir);
  assert.match(branches.stdout, /feature/);
});
