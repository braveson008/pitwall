// A repository whose rules refuse Pitwall's branch name: the push is retried
// under the convention the repository's own branches follow, never under the
// prefix it just refused, and the result says what it was renamed from.
//   npm run build && node tests/branch-rule-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { electron } from "./electronLaunch.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-branch-rule-"));
const git = (args, cwd) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });

const origin = path.join(temp, "origin.git");
const repo = path.join(temp, "repo");
await mkdir(repo, { recursive: true });
git(["init", "-q", "--bare", "-b", "main", origin], temp);
git(["init", "-q", "-b", "main"], repo);
await writeFile(path.join(repo, "a.txt"), "a\n");
git(["add", "."], repo);
git(["commit", "-q", "-m", "base"], repo);
git(["remote", "add", "origin", origin], repo);
// Branches from before the rule, unprefixed ones outnumbering the convention.
for (const name of ["main", "acme-5", "acme-6", "acme-7", "feature/ACME-1-x", "feature/ACME-2-y"]) git(["push", "-q", "origin", `main:refs/heads/${name}`], repo);
const hook = path.join(origin, "hooks", "pre-receive");
await writeFile(hook, `#!/bin/bash
while read old new ref; do
  case "$ref" in
    refs/heads/main|refs/heads/feature/*|refs/heads/fix/*) ;;
    *) echo "error: GH013: Repository rule violations found for $ref." >&2; exit 1 ;;
  esac
done
`);
await chmod(hook, 0o755);

const worktree = path.join(temp, "wt");
git(["worktree", "add", "-q", "-b", "acme-2687", worktree], repo);
await writeFile(path.join(worktree, "b.txt"), "b\n");
git(["add", "."], worktree);
git(["commit", "-q", "-m", "vip tag"], worktree);

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const result = await page.evaluate((payload) => window.pitwall.openPullRequest(payload), {
    projectPath: repo,
    worktreePath: worktree,
    branch: "acme-2687",
    ticket: "ACME-2687",
    title: "Customer VIP tag",
  });
  console.log(JSON.stringify(result));
  assert.equal(result.pushed, true, result.error);
  assert.equal(result.renamedFrom, "acme-2687");
  assert.equal(result.branch, "feature/ACME-2687-customer-vip-tag");
  assert.match(git(["ls-remote", "--heads", "origin"], repo), /refs\/heads\/feature\/ACME-2687-customer-vip-tag/);
  assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], worktree).trim(), "feature/ACME-2687-customer-vip-tag");
  console.log("branch-rule smoke: ok");
} finally {
  await app.close();
}
