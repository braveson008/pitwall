// A project on GitLab, driven through a stubbed `glab`, and one on a host
// Pitwall has no CLI for. Checks the main-process answers and the words on
// screen: nothing about GitHub where the code is not on GitHub.
//   npm run build && node tests/code-host-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { electron } from "./electronLaunch.mjs";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-code-host-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
// Pitwall runs commands through a login shell, and macOS's profile puts the
// system paths (Homebrew's among them) in front of the inherited PATH. The
// stand-ins go back in front here, or an installed glab or gh would answer.
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);

const mergeRequest = {
  iid: 42,
  title: "Retry failed webhooks",
  state: "opened",
  source_branch: "pay-214",
  target_branch: "main",
  web_url: "https://gitlab.com/acme/platform/payments/-/merge_requests/42",
};
const mergeRequests = [mergeRequest, { ...mergeRequest, iid: 7, state: "merged", source_branch: "pay-209", web_url: "https://gitlab.com/acme/platform/payments/-/merge_requests/7" }];
const calls = path.join(temp, "glab-calls.log");
// What `glab mr list` answers; rewritten mid-test when a request "merges".
const listReply = path.join(temp, "mr-list.json");
const sentDescription = path.join(temp, "mr-description.md");
const sentArgs = path.join(temp, "mr-args.txt");
// The description writer is a headless `claude -p`; this one answers with a
// fixed description and keeps the prompt it was given.
const writerPrompt = path.join(temp, "writer-prompt.txt");
const writerReply = path.join(temp, "writer-reply.json");
await writeFile(writerReply, JSON.stringify({
  type: "result",
  is_error: false,
  result: JSON.stringify({
    summary: "Shows each file's folder path under its name in the dataset view.",
    changes: ["Add a path line under the file name", "Generated with Claude Code"],
    testing: ["Open a dataset with nested folders and check each path"],
    commitSubject: "Show the folder path under file names",
    commitBody: "Files with the same name could not be told apart.\nCo-Authored-By: Claude <noreply@anthropic.com>",
  }),
}));
// Only a call that brings a prompt is the writer: Pitwall also runs \`claude\`
// in the background (version and sign-in checks), with nothing on stdin.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/sh\ninput=$(cat)\n[ -n "$input" ] && printf '%s' "$input" > '${writerPrompt}'\nsleep 2\ncat '${writerReply}'\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);
// Answers exactly the invocations Pitwall is documented to make, and fails
// loudly on anything else, so a changed flag shows up here.
await writeFile(path.join(fakeBin, "glab"), `#!/bin/sh
echo "$*" >> '${calls}'
case "$*" in
  "mr create "*) cat > '${sentDescription}'; echo "$*" > '${sentArgs}'; echo "https://gitlab.com/acme/platform/payments/-/merge_requests/43" ;;
  "config get token --host gitlab.com") echo "glpat-stub" ;;
  "mr view -F json") printf '%s' '${JSON.stringify(mergeRequest)}' ;;
  "mr list -A -F json -P 100") cat '${listReply}' ;;
  *) echo "unexpected glab call: $*" >&2; exit 2 ;;
esac
`);
await chmod(path.join(fakeBin, "glab"), 0o755);
await writeFile(listReply, JSON.stringify(mergeRequests));
// No gh at all: a GitLab project must not need it.
await writeFile(path.join(fakeBin, "gh"), "#!/bin/sh\necho 'gh must not be called for GitLab' >&2\nexit 3\n");
await chmod(path.join(fakeBin, "gh"), 0o755);

const now = new Date().toISOString();
async function repo(name, remote) {
  const dir = path.join(temp, name);
  await mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), `# ${name}\n`);
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
  execFileSync("git", ["checkout", "-q", "-b", "pay-214"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  // Pushes land in a local bare repository; the remote still reads as the host.
  const bare = path.join(temp, `${name}-remote.git`);
  execFileSync("git", ["init", "-q", "--bare", bare]);
  execFileSync("git", ["config", `url.${bare}.pushInsteadOf`, remote], { cwd: dir });
  execFileSync("git", ["push", "-q", bare, "main"], { cwd: dir });
  // The branch a new request is created for, with the trailer an agent leaves.
  execFileSync("git", ["checkout", "-q", "-b", "pay-300", "main"], { cwd: dir });
  await writeFile(path.join(dir, "path.txt"), "full path\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "Show the full path under each file name", "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], { cwd: dir });
  // What an agent leaves behind: real work not committed, and Pitwall's own
  // notes beside it that must stay out of the commit.
  await writeFile(path.join(dir, "folderPath.ts"), "export const folderPath = (p: string) => p.split('/').slice(0, -1).join('/');\n");
  await mkdir(path.join(dir, ".pitwall", "council"), { recursive: true });
  await writeFile(path.join(dir, ".pitwall", "council", "stage-1.md"), "notes\n");
  execFileSync("git", ["config", "user.email", "dev@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "A Developer"], { cwd: dir });
  return dir;
}
const gitlabDir = await repo("payments", "git@gitlab.com:acme/platform/payments.git");
const otherDir = await repo("legacy", "https://git.example.invalid/team/legacy.git");

const project = (id, dir) => ({ id, name: id, path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] });
const projects = [project("payments", gitlabDir), project("legacy", otherDir)];
const tasks = [
  { id: "t1", projectId: "payments", identifier: "PAY-214", title: "Retry failed webhooks", description: "Retry.", status: "review", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "pay-214", createdAt: now, updatedAt: now },
  { id: "t2", projectId: "payments", identifier: "PAY-300", title: "Show the full path of a file", description: "<p>Users cannot tell which folder a file is in.</p>", status: "review", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "pay-300", createdAt: now, updatedAt: now, source: { kind: "mcp", name: "atlassian", url: "https://acme.atlassian.net/browse/PAY-300" } },
];
const workspace = { version: 1, projects: [], tasks, contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");

  // ---- main process ---------------------------------------------------------
  const host = await page.evaluate((projectPath) => window.pitwall.getCodeHost({ projectPath }), gitlabDir);
  assert.equal(host.kind, "gitlab");
  assert.equal(host.repository, "acme/platform/payments", "the nested group path is kept");
  assert.equal(host.requestNoun, "merge request");
  assert.equal(host.cliInstalled, true);
  assert.equal("embeddedToken" in host, false, "no credential crosses into the page");
  console.log("PASS GitLab remote is identified, nested path kept");

  const found = await page.evaluate((projectPath) => window.pitwall.getPullRequest({ projectPath }), gitlabDir);
  assert.equal(found.ok, true, found.error);
  assert.equal(found.found, true);
  assert.equal(found.number, 42);
  assert.equal(found.state, "open");
  assert.equal(found.url, mergeRequest.web_url);
  console.log("PASS the branch's merge request is found through glab");

  const review = await page.evaluate((projectPath) => window.pitwall.reviewState({ projectPath, projectId: "payments", baseBranch: "main", branches: ["pay-214", "pay-209"] }), gitlabDir);
  assert.equal(review.ok, true, review.error);
  assert.equal(review.pullRequestsAvailable, true, review.pullRequestError);
  assert.equal(review.requestNoun, "merge request");
  console.log("PASS Review reads merge requests through glab");

  const activation = await page.evaluate((projectPath) => window.pitwall.activateGitHubAccount({ projectId: "payments", projectPath }), gitlabDir);
  assert.equal(activation.action, "none", "glab is signed in, so there is nothing to ask for");
  console.log("PASS a signed-in GitLab project is not asked for an account");

  const other = await page.evaluate((projectPath) => window.pitwall.getPullRequest({ projectPath }), otherDir);
  assert.equal(other.ok, true);
  assert.equal(other.unsupported, true);
  const otherActivation = await page.evaluate((projectPath) => window.pitwall.activateGitHubAccount({ projectId: "legacy", projectPath }), otherDir);
  assert.equal(otherActivation.action, "none");
  console.log("PASS an unknown host is answered honestly, with no account prompt");

  // ---- on screen ------------------------------------------------------------
  await page.evaluate(({ projects, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify(projects));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify({ ...workspace, projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path, defaultBranch: "main", providerIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) }));
  }, { projects, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "payments");
  await goTo(page, "Review");
  const row = page.locator(".dk-review-item", { hasText: "Retry failed webhooks" });
  await row.getByText("MR open").waitFor({ timeout: 15000 });
  assert.match(await row.innerText(), /!42/, "GitLab numbers its merge requests with !");
  await row.click();
  await page.getByRole("button", { name: "Open merge request" }).first().waitFor({ timeout: 10000 });
  assert.equal(await page.getByText(/Add GitHub account/).count(), 0);
  assert.equal(await page.getByText(/pull request/i).count(), 0, "no GitHub word on a GitLab project's Review");
  console.log("PASS Review says merge request, and nothing asks for GitHub");

  // ---- create one -------------------------------------------------------------
  await page.keyboard.press("Escape");
  const fresh = page.locator(".dk-review-item", { hasText: "Show the full path of a file" });
  await fresh.click();
  await page.getByRole("button", { name: "Create merge request" }).click();
  const dialog = page.getByRole("dialog", { name: "Create merge request" });
  await dialog.waitFor({ timeout: 15000 });
  assert.equal(await dialog.getByLabel("Title").inputValue(), "PAY-300: Show the full path of a file");
  // While it is written, the draft is visibly waiting rather than looking final.
  await dialog.getByText("Writing the description from the changes…").waitFor({ timeout: 10000 });
  assert.equal(await dialog.getByLabel(/Description/).isDisabled(), true, "the draft cannot be mistaken for the result");
  assert.equal(await dialog.getByRole("button", { name: "Commit and create merge request" }).isDisabled(), true, "the placeholder cannot be sent");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // The written description replaces the factual draft once it arrives.
  // The app tells the person 15–40 seconds; a busy machine can take that long.
  await dialog.getByRole("button", { name: "Write from the changes" }).waitFor({ timeout: 60000 });
  assert.equal(await dialog.getByText("Writing the description from the changes…").count(), 0);
  const drafted = await dialog.getByLabel(/Description/).inputValue();
  assert.match(drafted, /^## Summary\n\nShows each file's folder path under its name in the dataset view\./);
  assert.match(drafted, /- Add a path line under the file name/);
  assert.match(drafted, /`folderPath\.ts`/, "the files about to be committed are listed");
  assert.match(drafted, /- \[ \] Open a dataset with nested folders and check each path/);
  assert.match(drafted, /\[PAY-300\]\(https:\/\/acme\.atlassian\.net\/browse\/PAY-300\)/);
  assert.doesNotMatch(drafted, /claude|co-authored|generated|pitwall|\.pitwall/i);
  const prompt = await (await import("node:fs/promises")).readFile(writerPrompt, "utf8");
  assert.match(prompt, /folderPath/, "the writer read the uncommitted change");
  assert.doesNotMatch(prompt, /stage-1\.md/, "Pitwall's own notes are not part of the change");

  // The uncommitted work is offered for committing, with a conventional message.
  assert.equal(await dialog.getByRole("checkbox", { name: /Commit the 1 uncommitted file first/ }).isChecked(), true);
  assert.equal(await dialog.getByLabel("Commit message").inputValue(), "PAY-300: Show the folder path under file names\n\nFiles with the same name could not be told apart.");
  await dialog.getByRole("button", { name: "Commit and create merge request" }).click();
  await page.getByText("Merge request created").waitFor({ timeout: 20000 });
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(sentDescription, "utf8"), drafted, "the description sent is the one shown");
  const args = await readFile(sentArgs, "utf8");
  assert.match(args, /--title PAY-300: Show the full path of a file --description-file - --yes --source-branch pay-300 --target-branch main/);
  assert.doesNotMatch(args, /--fill/);
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: gitlabDir, encoding: "utf8" }).trim();
  assert.equal(git("log", "-1", "--format=%B"), "PAY-300: Show the folder path under file names\n\nFiles with the same name could not be told apart.");
  assert.equal(git("log", "-1", "--format=%an <%ae>"), "A Developer <dev@example.com>", "committed as the person");
  assert.equal(git("show", "--name-only", "--format=", "HEAD"), "folderPath.ts");
  assert.match(git("status", "--porcelain", "--untracked-files=all"), /\.pitwall\/council\/stage-1\.md/, "Pitwall's notes stay uncommitted");
  console.log("PASS uncommitted work is committed as the person, with no trailer and none of Pitwall's files");

  // ---- merged on the host, noticed without opening Review -------------------
  await goTo(page, "Tasks");
  await writeFile(listReply, JSON.stringify([...mergeRequests, { ...mergeRequest, iid: 43, title: "PAY-300: Show the full path of a file", state: "merged", source_branch: "pay-300", web_url: "https://gitlab.com/acme/platform/payments/-/merge_requests/43" }]));
  await page.evaluate(() => window.dispatchEvent(new Event("pitwall:check-reviews")));
  await page.waitForFunction(() => {
    const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
    return state.tasks?.find((task) => task.id === "t2")?.status === "completed";
  }, null, { timeout: 20000 });
  const settled = await page.evaluate(() => JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}"));
  assert.equal(settled.tasks.find((task) => task.id === "t1").status, "review", "an open request stays in review");
  assert.ok(settled.activity.some((entry) => entry.message === "Done: PAY-300 Show the full path of a file — merge request !43 merged"));
  console.log("PASS a merged merge request settles its task in the background, and Activity says so");
  console.log("PASS a merge request is drafted, edited in place, and created as written, with no AI trailer");

  await goTo(page, "Overview");
  await page.getByText("GitLab account", { exact: true }).waitFor({ timeout: 10000 });
  console.log("PASS Overview names the GitLab account");

  await openProject(page, "legacy");
  await goTo(page, "Overview");
  await page.getByText("Your own Git credentials").waitFor({ timeout: 10000 });
  assert.equal(await page.getByText(/Add (GitHub|GitLab) account/).count(), 0);
  console.log("PASS an unknown host offers no account it could not hold");
} finally {
  await app.close();
}
console.log("Pitwall code host smoke test passed.");
