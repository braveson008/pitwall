// The agent already opened the pull request, on a branch it named itself:
// Create PR finds that one and leaves the worktree alone — nothing committed,
// nothing pushed, no second request. The case from ACME-2687.
//   npm run build && node tests/existing-request-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "braveli-existing-request-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
for (const dir of [fakeHome, fakeBin]) await mkdir(dir, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
const calls = path.join(temp, "gh-calls.txt");
await writeFile(path.join(fakeBin, "gh"), `#!/bin/bash
echo "$*" >> "${calls}"
case "$1 $2" in
  "pr list") echo '[{"number":394,"url":"https://github.com/o/r/pull/394","title":"feat: show VIP tag (ACME-2687)","headRefName":"feature/ACME-2687-customer-vip-tag","state":"OPEN"},{"number":12,"url":"https://github.com/o/r/pull/12","title":"old","headRefName":"fix/ACME-268-old","state":"OPEN"}]' ;;
  "pr create") echo "https://github.com/o/r/pull/999" ;;
  *) echo "gh version 2.80.0" ;;
esac
`);
await chmod(path.join(fakeBin, "gh"), 0o755);

const git = (args, cwd) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
const repo = path.join(temp, "repo");
await mkdir(repo, { recursive: true });
git(["init", "-q", "-b", "main"], repo);
await writeFile(path.join(repo, "a.txt"), "a\n");
git(["add", "."], repo);
git(["commit", "-q", "-m", "base"], repo);
git(["remote", "add", "origin", "https://github.com/o/r.git"], repo);
const worktree = path.join(temp, "acme-2687");
git(["worktree", "add", "-q", "-b", "acme-2687", worktree], repo);
await writeFile(path.join(worktree, "vip.txt"), "vip\n");
const headBefore = git(["rev-parse", "HEAD"], worktree).trim();

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const result = await page.evaluate((payload) => window.braveli.openPullRequest(payload), {
    projectPath: repo,
    worktreePath: worktree,
    branch: "acme-2687",
    ticket: "ACME-2687",
    title: "Show VIP tag",
    body: "x",
    commit: { message: "ACME-2687: Show VIP tag", paths: ["vip.txt"] },
  });
  console.log(JSON.stringify(result));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.existed, true);
  assert.equal(result.number, 394);
  assert.equal(result.url, "https://github.com/o/r/pull/394");
  assert.equal(result.branch, "feature/ACME-2687-customer-vip-tag");
  assert.equal(git(["rev-parse", "HEAD"], worktree).trim(), headBefore, "nothing was committed");
  assert.match(git(["status", "--porcelain"], worktree), /vip\.txt/, "the change is still there, uncommitted");
  assert.doesNotMatch(await readFile(calls, "utf8"), /pr create/, "no second request");
  console.log("PASS Create PR finds the agent's request and leaves the worktree alone");

  // Review shows the request the agent opened, and Open goes straight to it.
  const now = new Date().toISOString();
  const project = { id: "p", name: "repo", path: repo, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
  const task = { id: "t", projectId: "p", identifier: "ACME-2687", title: "Show VIP tag", description: "x", status: "review", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "acme-2687", createdAt: now, updatedAt: now };
  const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: repo, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([project]));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  await goTo(page, "Review");
  const open = page.getByRole("button", { name: /^Open pull request$/ });
  await page.getByText("#394").waitFor({ timeout: 20000 });
  await page.getByText("Show VIP tag").first().click();
  await open.waitFor({ timeout: 20000 });
  assert.equal(await page.getByRole("button", { name: /^Create pull request$/ }).count(), 0, "no Create beside a request that exists");
  await page.screenshot({ path: path.join(temp, "review.png") });
  await open.click();
  await page.waitForTimeout(1500);
  assert.equal(await page.getByText(/No pull request for this branch|Could not find the pull request/).count(), 0, "Open found it");
  assert.doesNotMatch(await readFile(calls, "utf8"), /pr view/, "opened from what Review already knew");
  console.log(`PASS Review shows the agent's request and opens it (${path.join(temp, "review.png")})`);
  console.log("existing-request smoke: ok");
} finally {
  await app.close();
}
