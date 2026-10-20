const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const { removeWorktreeIfSafe, shareDependencies } = require("../electron/lib/worktreeCleanup.cjs");
const { managedWorktreePath } = require("../electron/lib/worktrees.cjs");

// Real repositories in a temp directory, isolated from the machine's git config.
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-worktree-cleanup-")));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Pitwall Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Pitwall Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
const runGit = (args, cwd) => new Promise((resolve) => {
  execFile("git", args, { cwd, env }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
});

const remote = path.join(tempRoot, "remote.git");
const primary = path.join(tempRoot, "primary");
const userData = path.join(tempRoot, "user-data");

function addWorktree(branch) {
  const target = managedWorktreePath(userData, primary, branch);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  git(primary, "worktree", "add", "-b", branch, target, "main");
  return target;
}

function commit(cwd, file, content) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", file);
}

const remove = (worktreePath, live = false) =>
  removeWorktreeIfSafe({ runGit, projectRoot: primary, worktreePath, isLive: () => live });

before(() => {
  git(tempRoot, "init", "-q", "--bare", "-b", "main", remote);
  git(tempRoot, "init", "-q", "-b", "main", primary);
  commit(primary, ".gitignore", "node_modules/\n");
  commit(primary, "README.md", "hello\n");
  git(primary, "remote", "add", "origin", remote);
  git(primary, "push", "-q", "origin", "main");
});

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe("removing a finished worktree", () => {
  it("removes one that is clean and pushed, and keeps its branch", async () => {
    const worktree = addWorktree("pushed");
    commit(worktree, "a.txt", "a\n");
    git(worktree, "push", "-q", "origin", "pushed");
    // Ignored dependencies are not unfinished work.
    fs.mkdirSync(path.join(worktree, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "node_modules/x/index.js"), "");

    const result = await remove(worktree);
    assert.equal(result.removed, true, JSON.stringify(result));
    assert.equal(result.branch, "pushed");
    assert.equal(fs.existsSync(worktree), false);
    assert.match(git(primary, "branch", "--list", "pushed"), /pushed/);
  });

  it("keeps one with uncommitted changes", async () => {
    const worktree = addWorktree("dirty");
    fs.writeFileSync(path.join(worktree, "untracked.txt"), "work\n");
    const result = await remove(worktree);
    assert.equal(result.removed, false);
    assert.deepEqual(result.blockers, ["dirty"]);
    assert.equal(result.dirty, 1);
    assert.equal(fs.existsSync(path.join(worktree, "untracked.txt")), true);
  });

  it("keeps one with commits no remote has", async () => {
    const worktree = addWorktree("unpushed");
    commit(worktree, "b.txt", "b\n");
    const result = await remove(worktree);
    assert.equal(result.removed, false);
    assert.deepEqual(result.blockers, ["unpushed"]);
    assert.equal(result.unpushed, 1);
    assert.equal(fs.existsSync(worktree), true);
  });

  it("keeps one a terminal is running in", async () => {
    const worktree = addWorktree("live");
    const result = await remove(worktree, true);
    assert.equal(result.removed, false);
    assert.deepEqual(result.blockers, ["live"]);
    assert.equal(fs.existsSync(worktree), true);
  });

  it("recreates a removed worktree from its branch, with the work on it", async () => {
    const worktree = addWorktree("again");
    commit(worktree, "c.txt", "c\n");
    git(worktree, "push", "-q", "origin", "again");
    assert.equal((await remove(worktree)).removed, true);
    git(primary, "worktree", "add", worktree, "again");
    assert.equal(fs.readFileSync(path.join(worktree, "c.txt"), "utf8"), "c\n");
  });
});

describe("sharing dependencies with a new worktree", { skip: process.platform === "win32" }, () => {
  before(() => {
    fs.writeFileSync(path.join(primary, "package-lock.json"), "{\"lockfileVersion\":3}\n");
    fs.mkdirSync(path.join(primary, "apps/web"), { recursive: true });
    fs.writeFileSync(path.join(primary, "apps/web/package.json"), "{}\n");
    git(primary, "add", "package-lock.json", "apps/web/package.json");
    git(primary, "commit", "-q", "-m", "lockfile");
    // A pnpm-shaped tree: packages live in .pnpm and are reached by relative symlinks.
    const store = path.join(primary, "node_modules/.pnpm/left-pad@1.0.0/node_modules/left-pad");
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, "index.js"), "module.exports = 'padded';\n");
    fs.symlinkSync(".pnpm/left-pad@1.0.0/node_modules/left-pad", path.join(primary, "node_modules/left-pad"));
    fs.mkdirSync(path.join(primary, "apps/web/node_modules"), { recursive: true });
    fs.symlinkSync("../../../node_modules/left-pad", path.join(primary, "apps/web/node_modules/left-pad"));
  });

  it("clones node_modules, workspace ones too, with relative symlinks that still resolve", async () => {
    const worktree = addWorktree("shared");
    const result = await shareDependencies({ primaryRoot: primary, worktreePath: worktree });
    assert.deepEqual(result.cloned, ["node_modules", path.join("apps", "web", "node_modules")]);
    assert.equal(fs.readlinkSync(path.join(worktree, "node_modules/left-pad")), ".pnpm/left-pad@1.0.0/node_modules/left-pad");
    const resolved = fs.realpathSync(path.join(worktree, "apps/web/node_modules/left-pad/index.js"));
    assert.ok(resolved.startsWith(worktree), resolved);
    assert.equal(require(resolved), "padded");
    assert.equal(git(worktree, "status", "--porcelain"), "");
    assert.deepEqual(fs.readdirSync(path.dirname(worktree)).filter((name) => name.startsWith(".clone-")), []);
  });

  it("leaves dependencies to the agent when the lockfile differs", async () => {
    const worktree = addWorktree("drifted");
    fs.writeFileSync(path.join(worktree, "package-lock.json"), "{\"lockfileVersion\":3,\"x\":1}\n");
    const result = await shareDependencies({ primaryRoot: primary, worktreePath: worktree });
    assert.deepEqual(result.cloned, []);
    assert.match(result.skipped, /lockfile/);
    assert.equal(fs.existsSync(path.join(worktree, "node_modules")), false);
  });

  it("leaves a node_modules the worktree already has alone", async () => {
    const worktree = addWorktree("installed");
    fs.mkdirSync(path.join(worktree, "node_modules"));
    fs.writeFileSync(path.join(worktree, "node_modules/mine.js"), "");
    const result = await shareDependencies({ primaryRoot: primary, worktreePath: worktree });
    assert.deepEqual(result.cloned, [path.join("apps", "web", "node_modules")]);
    assert.deepEqual(fs.readdirSync(path.join(worktree, "node_modules")), ["mine.js"]);
  });

  it("gives up without leaving anything behind when out of time", async () => {
    const worktree = addWorktree("hurried");
    const result = await shareDependencies({ primaryRoot: primary, worktreePath: worktree, timeoutMs: 0 });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.join(worktree, "node_modules")), false);
  });
});
