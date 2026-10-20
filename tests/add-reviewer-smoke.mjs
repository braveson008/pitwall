// A reviewer added to a session already running, not chosen when it started.
//   npm run build && node tests/add-reviewer-smoke.mjs
// A pair session: a Claude implementer and a Codex reviewer on one task. The
// reviewer reads the change read-only, sends it back once, then approves, and
// the task reaches Review with the reviewer's verdict on it.
//   npm run build && node tests/pair-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-add-reviewer-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
const state = path.join(temp, "state");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await mkdir(state, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
// Claude's own settings file, which project trust is recorded in.
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });

// The implementer: each prompt it is given is one turn. It changes a file in
// its checkout, then tells Pitwall the turn is over the way the real hook does.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash
case "$1" in
  --version) echo "2.1.289 (Claude Code)"; exit 0 ;;
  --help) echo "  --settings <file-or-json>  Load settings, including hooks"; exit 0 ;;
esac
URL=$(printf '%s' "$*" | grep -o "http://127\\.0\\.0\\.1:[0-9]*/agent-complete?[^'\\" ]*" | head -1)
if [ -z "$URL" ]; then exit 0; fi
stty raw -echo 2>/dev/null
echo "claude stub ready"
n=0
turn() {
  n=$((n+1))
  printf '%s\\n----\\n' "$1" >> '${state}/implementer-prompts.txt'
  echo "export const step$n = $n;" >> work.ts
  sleep 2
  /usr/bin/curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary '{}' "$URL" >/dev/null 2>&1 || true
}
# The task brief arrives as the launch's own prompt: that is the first turn.
turn "launch"
# One prompt per carriage return; the system bash's read -d cannot split on a raw tty.
/usr/bin/perl -ne 'BEGIN { $/ = "\\r"; $| = 1 } chomp; print "$_\\0" if /\\S/' | while IFS= read -r -d '' line; do
  turn "$line"
done
`);
// The reviewer: interactive Codex in its read-only sandbox, as Pitwall starts
// it in the pane beside the implementer. Each round's brief arrives first as
// the launch's own prompt, then typed into its terminal; each verdict goes back
// through Codex's own turn-complete notification.
await writeFile(path.join(fakeBin, "codex"), `#!/bin/bash
case "$1" in
  --version) echo "codex-cli 0.160.1"; exit 0 ;;
  --help) echo "  -c, --config <key=value>  Override a configuration value"; exit 0 ;;
  login|mcp) exit 0 ;;
esac
printf '%s\\n' "$*" >> '${state}/reviewer-args.txt'
URL=$(printf '%s' "$*" | grep -o "http://127\\.0\\.0\\.1:[0-9]*/agent-complete?[^'\\" ]*" | head -1)
stty raw -echo 2>/dev/null
echo "codex reviewer ready"
review() {
  rounds=$(( $(ls '${state}' | grep -c reviewer-prompt) + 1 ))
  printf '%s' "$1" > "${state}/reviewer-prompt-$rounds.txt"
  if [ "$rounds" -le 1 ]; then
    verdict='{"verdict":"request_changes","summary":"step1 is never used.","comments":[{"path":"work.ts","line":1,"body":"Use step1 or remove it."}]}'
  else
    verdict='{"verdict":"approve","summary":"The change does what the task asks.","comments":[]}'
  fi
  sleep 2
  body=$(VERDICT="$verdict" /usr/bin/python3 -c 'import json,os; print(json.dumps({"type":"agent-turn-complete","last-assistant-message":os.environ["VERDICT"]}))')
  /usr/bin/curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary "$body" "$URL" >/dev/null 2>&1 || true
}
# The first brief is the last argument.
review "\${@: -1}"
/usr/bin/perl -ne 'BEGIN { $/ = "\\r"; $| = 1 } chomp; print "$_\\0" if /\\S/' | while IFS= read -r -d '' line; do
  review "$line"
done
`);
await chmod(path.join(fakeBin, "claude"), 0o755);
await chmod(path.join(fakeBin, "codex"), 0o755);

const dir = path.join(temp, "payments");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# payments\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

await mkdir(path.join(fakeHome, ".codex"), { recursive: true });
await writeFile(path.join(fakeHome, ".codex", "models_cache.json"), JSON.stringify({ models: [{ slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list" }] }));

const now = new Date().toISOString();
const project = { id: "payments", name: "payments", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "payments", name: "payments", path: dir, defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
const workspaceState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}"));
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([project]));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "payments");

  // A session started with no reviewer and no task.
  await page.getByRole("button", { name: "New work", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Session options" }) });
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("option", { name: /^Claude/ }).first().click();
  await dialog.getByRole("textbox").first().fill("Add the step helpers.");
  await dialog.getByRole("textbox").first().press("Enter");
  await dialog.waitFor({ state: "detached", timeout: 30000 });
  await page.locator("[data-sidebar-row]", { hasText: "Add the step helpers." }).first().click();
  await page.getByRole("button", { name: "Add reviewer" }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);

  // A reviewer joins the running session.
  // The agent list is re-read, as opening Connections does, so Codex's models are in it.
  await page.evaluate(() => window.braveli.listProviders({ refresh: true }));
  await page.getByRole("button", { name: "Add reviewer" }).click();
  // Codex's models are read from its cache a moment after launch.
  for (let i = 0; i < 30; i += 1) {
    await page.getByRole("button", { name: "Reviewer agent and model" }).click();
    if (await page.getByRole("option", { name: "Codex · GPT-6-Astra", exact: true }).count()) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }
  await page.getByRole("option", { name: "Codex · GPT-6-Astra", exact: true }).click();
  await page.getByRole("button", { name: "Review now" }).click();

  const deadline = Date.now() + 120_000;
  let task = null;
  while (Date.now() < deadline) {
    task = (await workspaceState(page)).tasks?.find((item) => item.pair);
    if (task?.status === "review") break;
    await page.waitForTimeout(1000);
  }
  assert.ok(task, "the session got a task to carry the review");
  assert.equal(task.title, "Add the step helpers.", "named after the session");
  assert.equal(task.status, "review", `the work reached review: ${JSON.stringify(task.pair)}`);
  assert.equal(task.pair.outcome, "Codex approved in round 2");
  console.log("PASS a reviewer added to a running session reviews now, sends it back once, and approves in round 2");

  const reviewerArgs = await readFile(path.join(state, "reviewer-args.txt"), "utf8");
  assert.match(reviewerArgs, /--sandbox read-only --ask-for-approval never/, "read-only, as any reviewer");
  assert.match(reviewerArgs, /-m gpt-6-astra/, "on the model picked");
  const implementer = await readFile(path.join(state, "implementer-prompts.txt"), "utf8");
  assert.match(implementer, /Codex reviewed your change \(round 1 of 3\)/);
  assert.match(implementer, /Use step1 or remove it\./);
  console.log("PASS it runs read-only on the model picked, and its notes reached the agent");

  await page.locator("[data-sidebar-row]", { hasText: "Add the step helpers." }).first().waitFor();
  await page.getByRole("button", { name: "Reviewer · Codex" }).waitFor({ timeout: 10000 });
  console.log("PASS the header shows the session's reviewer");
} finally {
  await app.close();
}
console.log("Pitwall add reviewer smoke test passed.");
