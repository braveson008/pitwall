import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electron } from "./electronLaunch.mjs";

// A managed worktree through the real main process: created with its
// dependencies cloned, kept while a terminal runs in it or while it holds
// work, removed once finished, and recreated when its session resumes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = realpathSync(await mkdtemp(path.join(os.tmpdir(), "pitwall-worktree-lifecycle-")));
const remote = path.join(tempRoot, "remote.git");
const project = path.join(tempRoot, "project");
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

git(tempRoot, "init", "-q", "--bare", "-b", "main", remote);
git(tempRoot, "init", "-q", "-b", "main", project);
writeFileSync(path.join(project, ".gitignore"), "node_modules/\n");
writeFileSync(path.join(project, "package-lock.json"), "{\"lockfileVersion\":3}\n");
git(project, "add", ".");
git(project, "commit", "-q", "-m", "init");
git(project, "remote", "add", "origin", remote);
git(project, "push", "-q", "origin", "main");
mkdirSync(path.join(project, "node_modules/dep"), { recursive: true });
writeFileSync(path.join(project, "node_modules/dep/index.js"), "module.exports = 1;\n");

const waitFor = async (check, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
};

let app;
try {
  app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(tempRoot, "user-data"), ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  const call = (method, payload) => page.evaluate(([name, value]) => window.pitwall[name](value), [method, payload]);

  const created = await call("ensureWorktree", { projectPath: project, branch: "feature/done", baseBranch: "main" });
  assert.equal(created.ok, true, created.error);
  assert.ok(created.path.startsWith(path.join(tempRoot, "user-data", "worktrees")), created.path);
  // Windows has no copy-on-write clone, so there a worktree's agent installs instead.
  if (process.platform !== "win32") {
    await waitFor(() => existsSync(path.join(created.path, "node_modules/dep/index.js")), "cloned node_modules");
    console.log("  OK  a new worktree gets the project's node_modules cloned when the lockfile matches");
  }

  const started = await call("startTerminal", {
    projectId: "p", projectPath: created.path, sessionId: "wt-session", sessionName: "wt",
    agent: "Worktree Shell", model: "auto", ...(process.platform === "win32" ? { command: "cmd.exe", args: [] } : { command: "/bin/zsh", args: ["-f"] }), cols: 80, rows: 24,
  });
  assert.equal(started.ok, true, started.error);
  const whileLive = await call("removeWorktree", { projectPath: project, worktreePath: created.path, onlyIfSafe: true });
  assert.equal(whileLive.removed, false);
  assert.deepEqual(whileLive.blockers, ["live"]);
  const manualWhileLive = await call("removeWorktree", { projectPath: project, worktreePath: created.path });
  assert.equal(manualWhileLive.ok, false);
  assert.equal(existsSync(created.path), true);
  console.log("  OK  a worktree a terminal runs in is kept, even when removed by hand");

  await call("runSessionAction", { projectId: "p", sessionId: "wt-session", action: "stop" });
  const removed = await call("removeWorktree", { projectPath: project, worktreePath: created.path, onlyIfSafe: true });
  assert.equal(removed.removed, true, JSON.stringify(removed));
  assert.equal(existsSync(created.path), false);
  assert.match(git(project, "branch", "--list", "feature/done"), /feature\/done/);
  console.log("  OK  a finished, clean, pushed worktree is removed and its branch kept");

  const restored = await call("ensureWorktree", {
    projectPath: project, branch: "feature/done", baseBranch: "main", worktreePath: created.path,
  });
  assert.equal(restored.ok, true, restored.error);
  assert.equal(restored.path, created.path);
  assert.equal(existsSync(path.join(created.path, "package-lock.json")), true);
  console.log("  OK  resuming a session whose worktree was removed recreates it from its branch");

  const dirty = await call("ensureWorktree", { projectPath: project, branch: "feature/dirty", baseBranch: "main" });
  writeFileSync(path.join(dirty.path, "notes.txt"), "unfinished\n");
  const unpushed = await call("ensureWorktree", { projectPath: project, branch: "feature/unpushed", baseBranch: "main" });
  writeFileSync(path.join(unpushed.path, "a.txt"), "a\n");
  git(unpushed.path, "add", "a.txt");
  git(unpushed.path, "commit", "-q", "-m", "a");
  for (const kept of [dirty, unpushed]) {
    const result = await call("removeWorktree", { projectPath: project, worktreePath: kept.path, onlyIfSafe: true });
    assert.equal(result.removed, false);
    assert.equal(existsSync(kept.path), true);
  }
  const audit = await call("auditWorktrees", { projectPath: project });
  assert.equal(audit.ok, true, audit.error);
  const byBranch = Object.fromEntries(audit.worktrees.map((item) => [item.branch, item]));
  assert.equal(byBranch["feature/dirty"].dirty, 1);
  assert.equal(byBranch["feature/unpushed"].unpushed, 1);
  assert.equal(byBranch["feature/done"].dirty + byBranch["feature/done"].unpushed, 0);
  console.log("  OK  dirty and unpushed worktrees are kept and listed with their counts");

  await page.evaluate((projectPath) => {
    localStorage.clear();
    localStorage.setItem("agent-studio-projects", JSON.stringify([{
      id: "wt-project", name: "Worktree Project", path: projectPath, branch: "main", status: "active",
      accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending",
      sessions: [], queue: [], timeline: [],
    }]));
    localStorage.setItem("agent-studio-active-project", "wt-project");
    localStorage.setItem("bravely-onboarded", "yes");
  }, project);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".dk-tsb-titlebar").getByRole("button", { name: /^Search/ }).click();
  await page.locator(".dk-palette-row", { hasText: /^Unfinished worktrees/ }).click();
  const dialog = page.getByRole("dialog", { name: "Unfinished worktrees" });
  const dirtyRow = dialog.getByRole("listitem").filter({ hasText: "feature/dirty" });
  const unpushedRow = dialog.getByRole("listitem").filter({ hasText: "feature/unpushed" });
  await dirtyRow.getByText("1 uncommitted file").waitFor({ timeout: 10_000 });
  await unpushedRow.getByText("1 unpushed commit").waitFor();
  assert.equal(await dirtyRow.getByRole("button", { name: "Remove" }).count(), 0);
  await page.screenshot({ path: path.join(os.tmpdir(), "pitwall-unfinished-worktrees.png") });
  await unpushedRow.getByRole("button", { name: "Remove", exact: true }).click();
  await unpushedRow.getByText("1 commit stay on feature/unpushed, and on no remote").waitFor();
  await unpushedRow.getByRole("button", { name: "Remove anyway", exact: true }).click();
  await waitFor(() => !existsSync(unpushed.path), "the confirmed removal");
  await unpushedRow.waitFor({ state: "detached" });
  assert.equal(git(project, "log", "-1", "--format=%s", "feature/unpushed").trim(), "a");
  console.log("  OK  the unfinished list offers no removal for dirty work and asks before removing unpushed work");

  // A task branch starts from the trunk without tracking it, and a worktree
  // tidied away comes back on the branch the agent moved its work to.
  const agentRun = await call("ensureWorktree", { projectPath: project, branch: "acme-9", baseBranch: "main" });
  assert.equal(agentRun.ok, true, agentRun.error);
  assert.throws(() => git(agentRun.path, "rev-parse", "--abbrev-ref", "acme-9@{upstream}"), undefined, "no upstream on a new task branch");
  git(agentRun.path, "checkout", "-q", "-b", "feature/ACME-9-vip-tag");
  writeFileSync(path.join(agentRun.path, "vip.txt"), "vip\n");
  git(agentRun.path, "add", ".");
  git(agentRun.path, "commit", "-q", "-m", "vip");
  git(project, "worktree", "remove", agentRun.path);
  const back = await call("ensureWorktree", { projectPath: project, branch: "acme-9", baseBranch: "main", worktreePath: agentRun.path, ticket: "ACME-9" });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.path, agentRun.path);
  assert.equal(back.branch, "feature/ACME-9-vip-tag");
  assert.equal(git(back.path, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feature/ACME-9-vip-tag");
  assert.equal(existsSync(path.join(back.path, "vip.txt")), true, "the agent's work is there");
  console.log("  OK  a removed worktree comes back on the agent's own branch, and new branches track nothing");

  // Pitwall's branch with work of its own is never swapped for another.
  git(project, "worktree", "remove", back.path);
  const scratch = path.join(tempRoot, "scratch");
  git(project, "worktree", "add", "-q", scratch, "acme-9");
  writeFileSync(path.join(scratch, "own.txt"), "own\n");
  git(scratch, "add", ".");
  git(scratch, "commit", "-q", "-m", "own");
  git(project, "worktree", "remove", scratch);
  const kept = await call("ensureWorktree", { projectPath: project, branch: "acme-9", baseBranch: "main", worktreePath: back.path, ticket: "ACME-9" });
  assert.equal(kept.branch, "acme-9");
  assert.equal(existsSync(path.join(kept.path, "own.txt")), true);
  console.log("  OK  a branch holding work the agent's lacks is restored as itself");

  console.log("\nPitwall worktree lifecycle smoke test passed.");
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
}
