"use strict";

/**
 * The files of a session's worktree, for the Files panel.
 *
 * Everything here takes a path relative to the worktree and refuses one that
 * would leave it — by `..`, by being absolute, or by a symlink inside the
 * repository that points outside it. The real path is what is checked, so a
 * link to ~/.ssh is as far away as ~/.ssh.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");

const MAX_FILES = 50_000;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo", ".cache", "coverage", ".venv", "__pycache__"]);

function hashOf(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** The real path of `relative` inside `root`, or null when it is not inside. */
async function resolveInside(root, relative) {
  const rel = String(relative || "");
  if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return null;
  let realRoot;
  try {
    realRoot = await fs.promises.realpath(root);
  } catch {
    return null;
  }
  const target = path.resolve(realRoot, rel);
  if (!isInside(realRoot, target)) return null;
  let realTarget;
  try {
    realTarget = await fs.promises.realpath(target);
  } catch {
    return null;
  }
  return isInside(realRoot, realTarget) ? realTarget : null;
}

/**
 * Every file in the worktree, as git sees it: tracked and untracked, without
 * what .gitignore excludes. A folder that is not a repository is walked
 * instead, skipping the directories nobody means to browse.
 */
async function listWorktreeFiles(root, runGit) {
  const listed = await runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root, { timeoutMs: 20000 });
  if (listed.ok) {
    const files = Array.from(new Set(listed.stdout.split("\0").filter(Boolean)));
    files.sort();
    return { ok: true, files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
  }

  const files = [];
  const walk = async (dir, prefix) => {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  };
  await walk(root, "");
  files.sort();
  return { ok: true, files, truncated: files.length >= MAX_FILES };
}

/** A file's text, with what it takes to notice that it changed since. */
async function readWorktreeFile(root, relative) {
  const target = await resolveInside(root, relative);
  if (!target) return { ok: false, error: "That file is not in this worktree" };
  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    return { ok: false, error: "The file is gone — it may have been deleted" };
  }
  if (!stat.isFile()) return { ok: false, error: "That is not a file" };
  if (stat.size > MAX_READ_BYTES) return { ok: false, tooLarge: true, size: stat.size, error: "The file is too large to open here" };
  const buffer = await fs.promises.readFile(target);
  if (buffer.subarray(0, 8000).includes(0)) return { ok: false, binary: true, size: stat.size, error: "A binary file" };
  return { ok: true, content: buffer.toString("utf8"), hash: hashOf(buffer), size: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * Saves the file, unless it changed since it was read. An agent writing the
 * same file in the meantime wins: the save is refused and says so, rather
 * than either side's work being silently thrown away.
 */
async function writeWorktreeFile(root, relative, content, expectedHash) {
  const target = await resolveInside(root, relative);
  if (!target) return { ok: false, error: "That file is not in this worktree" };
  let current;
  let mode;
  try {
    current = await fs.promises.readFile(target);
    mode = (await fs.promises.stat(target)).mode;
  } catch {
    return { ok: false, error: "The file is gone — it may have been deleted" };
  }
  if (expectedHash && hashOf(current) !== expectedHash) {
    return { ok: false, conflict: true, error: "The file changed on disk since you opened it" };
  }
  const next = Buffer.from(String(content), "utf8");
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.braveli-${process.pid}-${Date.now()}`);
  try {
    await fs.promises.writeFile(temp, next, { mode });
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    return { ok: false, error: error.message || "The file could not be saved" };
  }
  const stat = await fs.promises.stat(target);
  return { ok: true, hash: hashOf(next), size: stat.size, mtimeMs: stat.mtimeMs };
}

/**
 * What changed in the worktree, from one `git status` run directly rather
 * than through a shell: the panel asks every few seconds while it is open.
 */
function worktreeChanges(root, env) {
  return new Promise((resolve) => {
    execFile("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, env, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, changes: [] });
        return;
      }
      resolve({ ok: true, changes: parseStatusZ(stdout) });
    });
  });
}

function parseStatusZ(stdout) {
  const parts = String(stdout || "").split("\0");
  const changes = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    // A rename names its old path in the next field.
    if (code.includes("R") || code.includes("C")) index += 1;
    if (/^\.braveli(?:\/|$)/.test(filePath)) continue;
    const kind = code === "??" ? "untracked" : code.includes("D") ? "deleted" : code.includes("R") ? "renamed" : code.includes("A") ? "added" : "modified";
    changes.push({ path: filePath, kind });
  }
  return changes;
}

module.exports = { listWorktreeFiles, parseStatusZ, readWorktreeFile, resolveInside, worktreeChanges, writeWorktreeFile };
