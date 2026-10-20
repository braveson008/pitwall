// A session handed from Codex to Claude mid-session: same row, same worktree,
// a handoff file git never sees, and Claude told to read it.
//   npm run build && node tests/session-swap-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-swap-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
const claudeInput = path.join(temp, "claude-input.txt");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash
case "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) echo "  --settings <file-or-json>"; exit 0 ;; esac
stty raw -echo 2>/dev/null
echo "claude stub ready"
exec cat >> "${claudeInput}"
`);
await writeFile(path.join(fakeBin, "codex"), `#!/bin/bash
case "$1" in --version) echo "codex-cli 0.160.1"; exit 0 ;; esac
stty raw -echo 2>/dev/null
echo "codex stub ready"
exec cat >/dev/null
`);
await chmod(path.join(fakeBin, "claude"), 0o755);
await chmod(path.join(fakeBin, "codex"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "picker.ts"), "export const a = 1;\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
await writeFile(path.join(dir, "picker.ts"), "export const a = 2;\n");

const now = new Date().toISOString();
const session = { id: "solo", name: "New session · Codex", agent: "Codex", status: "completed", model: "Auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] };
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session], queue: [], timeline: [] };
const workspace = {
  version: 1,
  projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now }],
  tasks: [],
  contextEntries: [],
  contextSnapshots: [],
  sessions: [{ id: "solo", projectId: "p", taskId: "", type: "implementation", provider: "codex", status: "completed", createdAt: now, updatedAt: now }],
  activity: [], taskRuns: [], councilRuns: [], compareRuns: [],
};

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");

  await page.locator("[data-sidebar-row]", { hasText: "New session · Codex" }).click();
  await page.locator(".dk-terminal.is-active").getByText("codex stub ready").waitFor({ timeout: 15000 });

  await page.getByRole("button", { name: /Codex.*Swap agent/ }).click();
  await page.getByRole("button", { name: "Agent to hand the session to" }).click();
  await page.getByRole("option", { name: /^Claude/ }).first().click();
  await page.getByRole("group", { name: "Swap agent" }).getByRole("button", { name: /^(Swap|Interrupt and swap)$/ }).click();

  await page.locator("[data-sidebar-row]", { hasText: "New session · Claude" }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator("[data-sidebar-row]").count(), 1, "the same session, not a second one");
  console.log("PASS the session row stays put and now says Claude");

  const handoff = await readFile(path.join(dir, ".pitwall", "handoff-1.md"), "utf8");
  assert.match(handoff, /# Handoff from Codex to Claude/);
  assert.match(handoff, /picker\.ts/);
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  assert.doesNotMatch(status, /\.pitwall/, "git never sees the handoff");
  console.log("PASS the handoff names both agents and the uncommitted change, and git ignores it");

  let typed = "";
  for (let i = 0; i < 60 && !typed.includes(".pitwall/handoff-1.md"); i += 1) {
    await page.waitForTimeout(500);
    typed = await readFile(claudeInput, "utf8").catch(() => "");
  }
  assert.match(typed, /taking over this session from Codex.*\.pitwall\/handoff-1\.md/s);
  console.log("PASS Claude is told to read the handoff");

  await page.locator(".dk-terminal.is-active").getByText("Handed from Codex to Claude").waitFor({ timeout: 10000 });
  console.log("PASS the terminal marks where Codex ended and Claude began");
  await page.locator(".dk-workspace").screenshot({ path: path.join(temp, "swap.png") });
  console.log(`shot ${path.join(temp, "swap.png")}`);
  await page.getByRole("button", { name: /Claude.*Swap agent/ }).waitFor();
  console.log("PASS the header shows Claude driving");
} finally {
  await app.close();
}
console.log("Pitwall session swap smoke test passed.");
