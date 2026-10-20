// Hermes as the project's reviewer: with it switched on for a project, a task
// Claude finishes goes to Hermes before it reaches Review — nobody picked a
// reviewer — and Hermes learns from it in the background, filing what it
// learned as project knowledge in its own name. When the lead sends the work
// back, Hermes learns from that too. Hermes is a stub that speaks Hermes's
// protocol: a banner with its session id, OSC 9 at the end of a turn, its
// session store through `sessions export`, and a one-shot learning job.
//   npm run build && node tests/hermes-overseer-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const { hermesProfileName } = createRequire(import.meta.url)("../electron/lib/hermesProfiles.cjs");
const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-overseer-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
const state = path.join(temp, "state");
await mkdir(path.join(fakeHome, ".hermes"), { recursive: true });
await mkdir(fakeBin, { recursive: true });
await mkdir(state, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
await writeFile(path.join(fakeHome, ".hermes", "config.yaml"), "model:\n  default: auto\n  provider: nous\ndisplay:\n  bell_on_complete: true\n");

// The implementer, as in the pair smoke test: each turn adds a line to work.ts.
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
  body='{"last_assistant_message":"Added step helper '$n'."}'
  /usr/bin/curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary "$body" "$URL" >/dev/null 2>&1 || true
}
turn "launch"
/usr/bin/perl -ne 'BEGIN { $/ = "\\r"; $| = 1 } chomp; print "$_\\0" if /\\S/' | while IFS= read -r -d '' line; do
  turn "$line"
done
`);

// Hermes. Interactive chat is the reviewer; --oneshot is the learning job.
await writeFile(path.join(fakeBin, "hermes"), `#!/bin/bash
PROFILE=""
if [ "$1" = "-p" ]; then PROFILE="$2"; shift 2; fi
HH="$HOME/.hermes"
case "$1" in
  --version) echo "Hermes Agent v0.21.5 (2026.9.24)"; exit 0 ;;
  --help) echo "usage: hermes"; exit 0 ;;
  tools) exit 0 ;;
  plugins) exit 0 ;;
  profile)
    if [ "$2" = "create" ]; then
      mkdir -p "$HH/profiles/$3/memories"
      cp "$HH/config.yaml" "$HH/profiles/$3/config.yaml"
      echo "learned elsewhere" > "$HH/profiles/$3/memories/MEMORY.md"
      echo "$3" >> '${state}/profiles-created.txt'
    fi
    exit 0 ;;
  config)
    if [ "$2" = "get" ]; then
      case "$3" in
        plugins.enabled) echo '["pitwall-reviewer"]' ;;
        plugins.disabled) echo '[]' ;;
        mcp_servers) echo '{}' ;;
        model) printf 'default: auto\\nprovider: nous\\n' ;;
      esac
    fi
    exit 0 ;;
  sessions)
    # sessions export --format jsonl --session-id ID -
    /usr/bin/python3 -c 'import json,sys; print(json.dumps({"id": sys.argv[1], "messages": [{"role": "user", "content": "review"}, {"role": "assistant", "content": open(sys.argv[2]).read()}]}))' "$6" '${state}/verdict.json'
    exit 0 ;;
  chat) ;;
  *) exit 0 ;;
esac
if printf '%s\\n' "$@" | grep -qx -- "--oneshot"; then
  n=$(( $(ls '${state}' | grep -c '^learn-.*[.]txt$') + 1 ))
  cat > "${state}/learn-$n.txt"
  printf 'profile=%s reviewer=%s args=%s\\n' "$PROFILE" "$PITWALL_HERMES_REVIEWER" "$*" > "${state}/learn-$n.meta"
  echo 'PITWALL_MEMORY {"title":"Step helpers","content":"work.ts holds the numbered step helpers.","kind":"area","sourcePaths":["work.ts"]}'
  echo
  echo "session_id: 20261007_020202_bbbbbb"
  exit 0
fi
printf 'profile=%s reviewer=%s args=%s\\n' "$PROFILE" "$PITWALL_HERMES_REVIEWER" "$*" >> '${state}/reviewer-args.txt'
stty raw -echo 2>/dev/null
echo "Session: 20261007_010101_abcdef"
echo "Welcome to Hermes Agent! Type your message or /help for commands."
review() {
  rounds=$(( $(ls '${state}' | grep -c reviewer-prompt) + 1 ))
  printf '%s' "$1" > "${state}/reviewer-prompt-$rounds.txt"
  if [ "$rounds" -le 1 ]; then
    printf '%s' '{"verdict":"request_changes","summary":"step1 is never used.","comments":[{"path":"work.ts","line":1,"body":"Use step1 or remove it."}]}' > '${state}/verdict.json'
  else
    printf '%s' '{"verdict":"approve","summary":"The change does what the task asks.","comments":[]}' > '${state}/verdict.json'
  fi
  sleep 2
  printf '\\033]9;Hermes: turn complete\\007'
}
prompt=""
while [ $# -gt 0 ]; do if [ "$1" = "-q" ]; then prompt="$2"; fi; shift; done
review "$prompt"
/usr/bin/perl -ne 'BEGIN { $/ = "\\r"; $| = 1 } chomp; print "$_\\0" if /\\S/' | while IFS= read -r -d '' line; do
  review "$line"
done
`);
await chmod(path.join(fakeBin, "claude"), 0o755);
await chmod(path.join(fakeBin, "hermes"), 0o755);

const dir = path.join(temp, "payments");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# payments\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

const now = new Date().toISOString();
const model = "poolside/laguna-s-2.1:free";
const project = { id: "payments", name: "payments", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const task = { id: "t1", projectId: "payments", identifier: "PAY-7", title: "Add the step helpers", description: "Add step helpers to work.ts.", status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "pay-7", createdAt: now, updatedAt: now };
const workspace = {
  version: 1,
  projects: [{ id: "payments", name: "payments", path: dir, defaultBranch: "main", providerIds: ["claude", "hermes"], overseer: { enabled: true, model, rounds: 3 }, createdAt: now, updatedAt: now }],
  tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [],
};

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, HERMES_HOME: path.join(fakeHome, ".hermes"), PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
const workspaceState = () => app.firstWindow().then((page) => page.evaluate(() => JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}")));
const until = async (what, check, ms = 120_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const profile = hermesProfileName("payments");
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

  // Claude on PAY-7, and no reviewer chosen: the project's setting supplies one.
  await page.getByRole("button", { name: "New work", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Session options" }) });
  await dialog.waitFor({ timeout: 10000 });
  const pick = async (chip, option) => {
    await dialog.getByRole("button", { name: chip, exact: true }).click();
    await page.getByRole("option", { name: option }).first().click();
  };
  await dialog.getByRole("button", { name: "Agent", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: /^Hermes/ }).count(), 0, "Hermes is not offered as an implementer");
  await page.getByRole("option", { name: /^Claude/ }).first().click();
  await pick("Task", /^Add the step helpers/);
  await dialog.getByRole("textbox").first().fill("Add the step helpers.");
  await dialog.getByRole("textbox").first().press("Enter");
  console.log("PASS Hermes is not offered to implement; Claude starts the task with no reviewer picked");

  const reviewed = await until("the task to reach Review", async () => {
    const found = (await workspaceState()).tasks?.find((item) => item.id === "t1");
    return found?.status === "review" ? found : null;
  });
  assert.equal(reviewed.pair.reviewer, "hermes", "Hermes reviewed it because the project says so");
  assert.equal(reviewed.pair.state, "approved");
  assert.equal(reviewed.pair.outcome, "Hermes approved in round 2");
  const implementer = await readFile(path.join(state, "implementer-prompts.txt"), "utf8");
  assert.match(implementer, /Hermes reviewed your change \(round 1 of 3\) and asks for changes before it goes to review:/);
  console.log("PASS the finished task went to Hermes, was sent back once, and reached Review approved in round 2");

  const reviewerArgs = await readFile(path.join(state, "reviewer-args.txt"), "utf8");
  assert.match(reviewerArgs, new RegExp(`^profile=${profile} reviewer=1 args=chat --cli -t file,todo,clarify,memory,skills -m ${model.replace(/[.]/g, "\\.")}`, "m"));
  assert.equal((reviewerArgs.match(/^profile=/gm) || []).length, 1, "one reviewer across rounds");
  console.log("PASS Hermes reviewed in the project's own profile, read-only, on the project's model");

  const learned = await until("Hermes to learn from the finished task", async () => (await readdir(state)).includes("learn-1.txt"));
  assert.ok(learned);
  const brief = await readFile(path.join(state, "learn-1.txt"), "utf8");
  assert.match(brief, /Claude finished PAY-7 Add the step helpers\./);
  assert.match(brief, /Your review of it: approve — The change does what the task asks\./);
  assert.match(brief, /<<<DIFF[\s\S]*export const step1 = 1;/);
  const meta = await readFile(path.join(state, "learn-1.meta"), "utf8");
  assert.match(meta, new RegExp(`^profile=${profile} reviewer=1 args=chat -Q --oneshot -t file,todo,clarify,memory,skills --source tool --query-file -`));
  console.log("PASS Hermes learned from the finished task in the background, guarded and in the project's profile");

  const fact = await until("Hermes's fact in project knowledge", async () => {
    const knowledge = await page.evaluate((projectPath) => window.pitwall.inspectProjectKnowledge({ projectPath }), dir);
    return knowledge.records?.find((record) => record.title === "Step helpers");
  });
  assert.equal(fact.author, "hermes");
  assert.equal(fact.status, "tentative", "kept for the person to confirm");
  const activity = (await workspaceState()).activity ?? [];
  assert.ok(activity.some((entry) => entry.message === "Hermes learned 1 fact from PAY-7"));
  console.log("PASS what Hermes learned is in project knowledge, credited to Hermes, tentative until you confirm it");

  // Hermes says what it is doing, and its panel shows what it has done.
  const hermesLine = page.locator(".dk-tsb-hermes");
  await until("Hermes to settle", async () => /Hermes · ready/.test(await hermesLine.innerText()));
  await hermesLine.click();
  const panel = page.getByRole("dialog", { name: "Hermes" });
  await panel.getByText("Add the step helpers").waitFor({ timeout: 10000 });
  assert.match(await panel.innerText(), /PAY-7 · Hermes approved in round 2/);
  assert.match(await panel.innerText(), /Learned 1 fact from PAY-7/);
  await panel.getByRole("button", { name: "Close" }).click();
  console.log("PASS Hermes's status is on the sidebar, and its panel lists its reviews and what it learned");

  const created = (await readFile(path.join(state, "profiles-created.txt"), "utf8")).trim().split("\n");
  assert.deepEqual(created, [profile], "one profile for the project");
  await assert.rejects(readFile(path.join(fakeHome, ".hermes", "profiles", profile, "memories", "MEMORY.md"), "utf8"), "what Hermes learned elsewhere was left behind");
  console.log("PASS the project has its own Hermes profile, started without memory from elsewhere");

  // The lead sends it back: the strongest signal, and Hermes learns from it.
  await goTo(page, "Review");
  await page.locator(".dk-review-item", { hasText: "Add the step helpers" }).click();
  await page.getByRole("button", { name: /^Send back (another note|with a note)/ }).first().click();
  await page.getByRole("textbox", { name: "Note for the agent" }).fill("Steps must start at zero in this codebase.");
  await page.getByRole("button", { name: "Send back" }).click();
  await until("Hermes to learn from the lead's decision", async () => (await readdir(state)).includes("learn-2.txt"), 60_000);
  const decision = await readFile(path.join(state, "learn-2.txt"), "utf8");
  assert.match(decision, /The lead has reviewed PAY-7 Add the step helpers and sent it back for changes\./);
  assert.match(decision, /<<<LEAD\nSteps must start at zero in this codebase\.\nLEAD>>>/);
  console.log("PASS when the lead sends work back, Hermes learns from their words, quoted as data");

  // Its track record counts that: it approved, the lead sent it back — a miss, on its model.
  await page.locator(".dk-tsb-hermes").click();
  const record = page.getByRole("dialog", { name: "Hermes" }).locator(".dk-hermes-record");
  await record.locator(".dk-hermes-figures").waitFor({ timeout: 10000 });
  const figures = await record.locator(".dk-hermes-figures").innerText();
  assert.match(figures, /Agreed with you\s*0%/);
  assert.match(figures, /Missed\s*1/);
  assert.match(figures, /Caught before you\s*1/, "round 1 went back to the agent");
  assert.match(await record.innerText(), new RegExp(`${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} agreed with you 0 of 1 times \\(0%\\) · missed 1`));
  console.log("PASS Hermes's track record counts the miss, the catch, and the model that reviewed");
} finally {
  await app.close();
}
console.log("Pitwall Hermes overseer smoke test passed.");
