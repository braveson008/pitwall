// A pair session: a Claude implementer and a Codex reviewer on one task. The
// reviewer reads the change read-only, sends it back once, then approves, and
// the task reaches Review with the reviewer's verdict on it.
//   npm run build && node tests/pair-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { electron } from "./electronLaunch.mjs";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-pair-"));
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
  curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary '{}' "$URL" >/dev/null 2>&1 || true
}
# The task brief arrives as the launch's own prompt: that is the first turn.
turn "launch"
# One prompt per carriage return, read by node: MSYS's console layer turns a typed CR into LF for its own programs.
'${process.execPath}' -e 'if (process.stdin.isTTY) process.stdin.setRawMode(true); process.stdin.setEncoding("utf8"); let b = ""; process.stdin.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\\r")) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); if (/\\S/.test(l)) process.stdout.write(l + "\\0"); } })' | while IFS= read -r -d '' line; do
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
  body=$(VERDICT="$verdict" '${process.execPath}' -e 'console.log(JSON.stringify({type:"agent-turn-complete","last-assistant-message":process.env.VERDICT}))')
  curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary "$body" "$URL" >/dev/null 2>&1 || true
}
# The first brief is the last argument; on Windows a multi-line brief cannot ride cmd's line, so it is typed in.
last="\${@: -1}"; before="\${@: -2:1}"
if [ "$before" != "-c" ] && [ "\${last#-}" = "$last" ]; then review "$last"; fi
'${process.execPath}' -e 'if (process.stdin.isTTY) process.stdin.setRawMode(true); process.stdin.setEncoding("utf8"); let b = ""; process.stdin.on("data", (d) => { b += d; let i; while ((i = b.indexOf("\\r")) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); if (/\\S/.test(l)) process.stdout.write(l + "\\0"); } })' | while IFS= read -r -d '' line; do
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

const now = new Date().toISOString();
const project = { id: "payments", name: "payments", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const task = { id: "t1", projectId: "payments", identifier: "PAY-7", title: "Add the step helpers", description: "Add step helpers to work.ts.", status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "pay-7", createdAt: now, updatedAt: now };
const workspace = { version: 1, projects: [{ id: "payments", name: "payments", path: dir, defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now }], tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
const stored = () => app.firstWindow().then((page) => page.evaluate(() => JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}").tasks?.find((item) => item.id === "t1")));
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "payments");

  // New session: Claude implements PAY-7, Codex reviews.
  await page.getByRole("button", { name: "New work", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Session options" }) });
  await dialog.waitFor({ timeout: 10000 });
  const pick = async (chip, option) => {
    await dialog.getByRole("button", { name: chip, exact: true }).click();
    await page.getByRole("option", { name: option }).first().click();
  };
  await pick("Agent", /^Claude/);
  await pick("Task", /^Add the step helpers/);
  await pick("Reviewer", /^Codex/);
  assert.match(await dialog.innerText(), /Codex reviews the change read-only/);
  await dialog.getByRole("textbox").first().fill("Add the step helpers.");
  await dialog.getByRole("textbox").first().press("Enter");

  // Round 1: sent back. Round 2: approved, and the task is ready for you.
  const deadline = Date.now() + 120_000;
  let task1 = null;
  while (Date.now() < deadline) {
    task1 = await stored();
    if (task1?.status === "review") break;
    await page.waitForTimeout(1000);
  }
  assert.equal(task1?.status, "review", `the task reached review: ${JSON.stringify(task1?.pair)}`);
  assert.equal(task1.pair.state, "approved");
  assert.equal(task1.pair.outcome, "Codex approved in round 2");
  console.log("PASS the reviewer sent it back once, approved it in round 2, and only then did it reach Review");

  const reviewerArgs = await readFile(path.join(state, "reviewer-args.txt"), "utf8");
  assert.match(reviewerArgs, /--sandbox read-only --ask-for-approval never -c check_for_update_on_startup=false -c mcp_servers=\{\}/, "the reviewer cannot write, reach the network or use MCP servers");
  assert.equal((reviewerArgs.match(/^-c notify=/gm) || []).length, 1, "one reviewer, kept across rounds");
  assert.match(reviewerArgs, /-c notify=/, "the reviewer reports its finished turn");
  const prompts = (await readdir(state)).filter((name) => name.startsWith("reviewer-prompt")).sort();
  assert.equal(prompts.length, 2);
  const firstPrompt = await readFile(path.join(state, prompts[0]), "utf8");
  assert.match(firstPrompt, /Task: PAY-7 Add the step helpers/);
  assert.match(firstPrompt, /round 1 of at most 3/);
  assert.match(firstPrompt, /New file work\.ts:\nexport const step1 = 1;/, "the reviewer read the implementer's uncommitted change");
  const implementer = await readFile(path.join(state, "implementer-prompts.txt"), "utf8");
  assert.match(implementer, /Codex reviewed your change \(round 1 of 3\) and asks for changes before it goes to review:/);
  assert.match(implementer, /- work\.ts:1 — Use step1 or remove it\./);
  assert.equal(task1.changeRequests.filter((request) => request.from === "reviewer").length, 1);
  console.log("PASS the reviewer read the change read-only, and its feedback reached the implementer as a note");

  // The reviewer is beside the implementer, its last verdict and its terminal on screen.
  await goTo(page, "Work");
  // The implementer's terminal first; the reviewer has a tab of its own.
  const tabs = page.getByRole("tablist", { name: "Pair" });
  await tabs.getByRole("tab", { name: "Implementer" }).waitFor({ timeout: 10000 });
  assert.equal(await tabs.getByRole("tab", { name: "Implementer" }).getAttribute("aria-selected"), "true");
  await tabs.getByRole("tab", { name: /^Reviewer/ }).click();
  const pane = page.getByRole("complementary", { name: "Reviewer · Codex" });
  await pane.waitFor({ timeout: 10000 });
  assert.match(await pane.innerText(), /Read-only[\s\S]*Offline/);
  assert.match(await pane.innerText(), /Round 2: approved/);
  await pane.getByRole("button", { name: "Why can't I message the reviewer?" }).click();
  assert.match(await pane.innerText(), /So it takes no messages\. To steer the work, use Review/);
  await tabs.getByRole("tab", { name: "Implementer" }).click();
  await pane.waitFor({ state: "hidden" });
  console.log("PASS the reviewer has its own tab, read-only and offline, and says how to steer it");

  await goTo(page, "Review");
  const row = page.locator(".dk-review-item", { hasText: "Add the step helpers" });
  await row.getByText("Codex approved").waitFor({ timeout: 10000 });
  await row.click();
  await page.locator(".dk-pair-verdict").getByText("Codex approved in round 2").waitFor();
  console.log("PASS Review shows the reviewer's verdict");

  // The session that did the work is a click away, and the decision follows it there.
  await page.locator(".dk-review-detail").getByRole("button", { name: "Open session", exact: true }).click();
  const strip = page.locator(".dk-review-strip");
  await strip.getByText("Ready for your review").waitFor({ timeout: 10000 });
  await page.locator(".dk-terminal.is-active").waitFor();
  assert.match(await strip.innerText(), /Codex approved in round 2/);
  await strip.getByRole("button", { name: "Review changes" }).click();
  await page.locator(".dk-pair-verdict").getByText("Codex approved in round 2").waitFor();
  console.log("PASS a task waiting on review opens its session, and the session leads back to the decision");

  // From the sidebar too: a Review row goes straight to its session.
  const needsRow = page.locator(".dk-tsb-group", { hasText: "Review" }).locator(".dk-tsb-item", { hasText: "Add the step helpers" });
  await needsRow.hover();
  await needsRow.getByRole("button", { name: "Open session for Add the step helpers" }).click();
  await page.locator(".dk-review-strip").getByText("Ready for your review").waitFor({ timeout: 10000 });
  await page.locator(".dk-terminal.is-active").waitFor();
  const current = page.locator(".dk-tsb-group", { hasText: "Working" }).locator('[data-sidebar-row][aria-current="page"]');
  await current.waitFor({ timeout: 5000 });
  assert.equal(await current.count(), 1, "the opened session is highlighted in Working");
  assert.equal(await page.locator('.dk-tsb-group [aria-current="true"]').count(), 0, "and the review row is not");
  console.log("PASS a Review row opens its session in one click, and highlights it");
} finally {
  await app.close();
}
console.log("Pitwall pair smoke test passed.");
