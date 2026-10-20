"use strict";
/**
 * Unfinished work moving between computers.
 *
 * A snapshot is a commit made from a private index: everything in the
 * worktree, tracked or not (ignored files excepted), on top of HEAD. The
 * person's own index and branch are never touched. It travels as a git
 * bundle, encrypted like every other synced thing, and never through the
 * project's remote, where anyone with access to the repository could list it.
 * The bundle leaves out what the remote already has, and includes commits the
 * branch hasn't pushed. On the other computer it is applied as uncommitted
 * changes, after fast-forwarding the branch to where the work was.
 */
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
const AUTHOR = { GIT_AUTHOR_NAME: "Pitwall", GIT_AUTHOR_EMAIL: "wip@pitwall.local", GIT_COMMITTER_NAME: "Pitwall", GIT_COMMITTER_EMAIL: "wip@pitwall.local" };

function git(worktree, args, { env = {}, timeout = 120_000 } = {}) {
  return new Promise((resolve) => {
    execFile("git", ["-C", worktree, ...args], {
      timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || "").trim(), stderr: String(stderr || error?.message || "").trim() }));
  });
}

const tempFile = (suffix) => path.join(os.tmpdir(), `pitwall-${crypto.randomUUID()}${suffix}`);

async function snapshotWip({ worktree }) {
  const head = await git(worktree, ["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, message: head.stderr };
  const index = tempFile(".index");
  try {
    const env = { GIT_INDEX_FILE: index };
    for (const args of [["read-tree", "HEAD"], ["add", "-A"]]) {
      const step = await git(worktree, args, { env });
      if (!step.ok) return { ok: false, message: step.stderr };
    }
    const tree = await git(worktree, ["write-tree"], { env });
    const headTree = await git(worktree, ["rev-parse", "HEAD^{tree}"]);
    if (!tree.ok) return { ok: false, message: tree.stderr };
    if (tree.stdout === headTree.stdout) return { ok: true, dirty: false, parent: head.stdout, tree: tree.stdout };
    const commit = await git(worktree, ["commit-tree", tree.stdout, "-p", head.stdout, "-m", "Pitwall: unfinished work"], { env: AUTHOR });
    if (!commit.ok) return { ok: false, message: commit.stderr };
    return { ok: true, dirty: true, sha: commit.stdout, parent: head.stdout, tree: tree.stdout };
  } finally {
    fs.rmSync(index, { force: true });
  }
}

async function bundleWip({ worktree, sha }) {
  const ref = "refs/pitwall/wip-bundle";
  const file = tempFile(".bundle");
  try {
    await git(worktree, ["update-ref", ref, sha]);
    const remotes = (await git(worktree, ["remote"])).stdout;
    // What the remote already has the other computer fetches from there.
    const made = await git(worktree, ["bundle", "create", "--quiet", file, ref, ...(remotes ? ["--not", "--remotes"] : [])]);
    if (!made.ok) return { ok: false, message: made.stderr };
    const size = fs.statSync(file).size;
    if (size > MAX_BUNDLE_BYTES) return { ok: false, tooLarge: true, size };
    return { ok: true, bytes: fs.readFileSync(file), size };
  } finally {
    await git(worktree, ["update-ref", "-d", ref]);
    fs.rmSync(file, { force: true });
  }
}

async function conflictedFiles(worktree) {
  const listed = await git(worktree, ["diff", "--name-only", "--diff-filter=U"]);
  return listed.stdout ? listed.stdout.split("\n") : [];
}

async function restoreWip({ worktree, bundle }) {
  // The person's own changes come first: nothing is applied over them, and their index is never reset.
  const status = await git(worktree, ["status", "--porcelain"]);
  if (!status.ok) return { applied: false, conflicts: [], message: status.stderr };
  if (status.stdout) return { applied: false, busy: true, conflicts: [] };
  // The bundle builds on what the remote has, so that comes first.
  if ((await git(worktree, ["remote"])).stdout) await git(worktree, ["fetch", "--quiet", "origin"]);
  const file = tempFile(".bundle");
  fs.writeFileSync(file, bundle);
  const fetched = await git(worktree, ["fetch", "--quiet", file, "refs/pitwall/wip-bundle"]);
  fs.rmSync(file, { force: true });
  if (!fetched.ok) return { applied: false, conflicts: [], message: fetched.stderr };
  const sha = (await git(worktree, ["rev-parse", "FETCH_HEAD"])).stdout;
  const parent = (await git(worktree, ["rev-parse", `${sha}^`])).stdout;
  const head = (await git(worktree, ["rev-parse", "HEAD"])).stdout;
  const age = Number((await git(worktree, ["show", "-s", "--format=%ct", sha])).stdout) * 1000;
  // The other computer may have committed without pushing; catch up with it first.
  if (head !== parent && (await git(worktree, ["merge-base", "--is-ancestor", head, parent])).ok) {
    await git(worktree, ["merge", "--ff-only", "--quiet", parent]);
  }
  const picked = await git(worktree, ["cherry-pick", "--no-commit", sha]);
  if (!picked.ok) {
    const conflicts = await conflictedFiles(worktree);
    await git(worktree, ["cherry-pick", "--abort"]);
    await git(worktree, ["reset", "--merge"]);
    return { applied: false, conflicts, ageMs: Date.now() - age, message: conflicts.length ? undefined : picked.stderr };
  }
  // Applied as plain uncommitted changes, the way they were left.
  await git(worktree, ["reset", "--quiet"]);
  return { applied: true, conflicts: [], ageMs: Date.now() - age };
}

module.exports = { MAX_BUNDLE_BYTES, bundleWip, restoreWip, snapshotWip };
