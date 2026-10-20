"use strict";
/**
 * Getting a synced project's code onto this computer. A checkout of the same
 * repository already here is used as it is; otherwise the repository is
 * cloned into the projects folder. The clone is partial (`--filter=blob:none`):
 * full history, file contents fetched as they are needed, so a large
 * repository is usable in seconds.
 */
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { normaliseRemote } = require("./pathMap.cjs");

function git(args, { cwd, timeout = 10 * 60_000, env = {} } = {}) {
  return new Promise((resolve) => {
    // Never a sign-in window popping up from behind Pitwall: a clone that needs one fails and says so.
    execFile("git", args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...env } }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || "").trim(), stderr: String(stderr || error?.message || "").trim() });
    });
  });
}

/** A remote URL fit to sync: credentials removed, and nothing that only means something on this computer. */
function safeRemoteUrl(url) {
  const raw = String(url || "").trim();
  if (!raw || path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }
  return raw;
}

const comparableRemote = (url) => normaliseRemote(url) ?? String(url || "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");

async function remoteOf(directory) {
  if (!fs.existsSync(path.join(directory, ".git"))) return "";
  const result = await git(["-C", directory, "remote", "get-url", "origin"], { timeout: 10_000 });
  return result.ok ? result.stdout : "";
}

function folderName(project) {
  const fromRemote = comparableRemote(project.remoteUrl).split(/[\\/]/).pop();
  const name = fromRemote || String(project.name || "project");
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "project";
}

// Where people keep code, besides the projects folder.
const USUAL_PLACES = ["", "code", "Code", "dev", "Dev", "src", "repos", "git", "workspace", "Developer", "Projects", "projects", "Documents", "Documents/GitHub", "Desktop", "source/repos"];

/** Folders worth looking in for an existing checkout: the projects folder, the usual places, and wherever this computer keeps other projects. */
function candidateFolders(projectsRoot, knownPaths, home) {
  const usual = home ? USUAL_PLACES.map((place) => path.join(home, ...place.split("/").filter(Boolean))) : [];
  const parents = new Set([projectsRoot, ...knownPaths.map((known) => path.dirname(known)), ...usual]);
  const folders = [];
  for (const parent of parents) {
    let entries = [];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) folders.push(path.join(parent, entry.name));
      if (folders.length >= 600) return folders;
    }
  }
  return folders;
}

async function planCheckout(project, { projectsRoot, knownPaths = [], home = require("node:os").homedir() }) {
  if (!project.remoteUrl) return { action: "needs-remote" };
  const wanted = comparableRemote(project.remoteUrl);
  for (const folder of candidateFolders(projectsRoot, knownPaths, home)) {
    const remote = await remoteOf(folder);
    if (remote && comparableRemote(remote) === wanted) return { action: "adopt", path: folder };
  }
  const base = folderName(project);
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = path.join(projectsRoot, attempt === 1 ? base : `${base}-${attempt}`);
    if (!fs.existsSync(candidate)) return { action: "clone", path: candidate };
  }
  return { action: "clone", path: path.join(projectsRoot, `${base}-${Date.now()}`) };
}

function describeFailure(stderr) {
  if (/not found|does not exist|does not appear to be a git repository|no such file/i.test(stderr)) {
    return { code: "not-found", message: "Pitwall couldn't find this repository. It may have moved, or your account here can't see it." };
  }
  if (/authentication|permission denied|could not read username|403|401|access denied/i.test(stderr)) {
    return { code: "auth", message: "This computer isn't signed in to the repository's host. Sign in to GitHub in Settings, then try again." };
  }
  return { code: "network", message: "The repository couldn't be downloaded. Check the connection and try again." };
}

async function checkoutProject(project, options) {
  const plan = await planCheckout(project, options);
  if (plan.action === "needs-remote") return { ok: false, code: "no-remote", message: "This project has no remote to clone from. Push it to GitHub on the other computer, or copy it here." };
  if (plan.action === "adopt") return { ok: true, action: "adopt", path: plan.path };
  fs.mkdirSync(path.dirname(plan.path), { recursive: true });
  const cloned = await git(["clone", "--filter=blob:none", "--quiet", project.remoteUrl, plan.path], { env: options.env });
  if (!cloned.ok) {
    fs.rmSync(plan.path, { recursive: true, force: true });
    return { ok: false, ...describeFailure(cloned.stderr) };
  }
  return { ok: true, action: "clone", path: plan.path };
}

module.exports = { checkoutProject, comparableRemote, planCheckout, remoteOf, safeRemoteUrl };
