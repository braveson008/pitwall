// A watcher's plan for an assigned ticket, started with the agent you pick,
// and the sidebar showing the session while it is being created.
//   npm run build && node tests/watch-ticket-start-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-ticket-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
const profile = path.join(temp, "profile");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await mkdir(profile, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
for (const [name, version] of [["claude", "2.1.289 (Claude Code)"], ["codex", "codex-cli 0.160.1"]]) {
  await writeFile(path.join(fakeBin, name), `#!/bin/bash
case "$1" in --version) echo "${version}"; exit 0 ;; --help) echo "  --settings <file-or-json>"; exit 0 ;; esac
stty raw -echo 2>/dev/null
echo "${name} stub ready"
exec cat >/dev/null
`);
  await chmod(path.join(fakeBin, name), 0o755);
}

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "a.txt"), "a\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

const nowMs = Date.now();
await writeFile(path.join(profile, "watches.json"), JSON.stringify({
  watches: [{ id: "watch-t", projectId: "p", projectPath: dir, kind: "ticket-assigned", enabled: false, config: {}, createdAt: nowMs, lastCheckedAt: nowMs, lastError: "", seen: null }],
  findings: [{
    id: "finding-t", key: "ticket:WEB-42", watchId: "watch-t", projectId: "p", kind: "ticket-assigned",
    ref: "WEB-42", title: "Prize filter on campaign page", url: "",
    payload: { ticket: { id: "WEB-42", title: "Prize filter on campaign page", description: "Filter prizes.", url: "", status: "To Do" }, source: { name: "linear", provider: "claude", target: "" } },
    proposal: { plan: "1. Add the filter\n2. Test it" },
    state: "ready", review: null, error: "", foundAt: nowMs, updatedAt: nowMs, postedUrl: "", reviewedSha: "",
  }],
}));

const now = new Date().toISOString();
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: profile } });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([project]));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");

  await page.getByRole("button", { name: /^Automations/ }).click();
  await page.getByRole("tab", { name: /^Watches/ }).click();
  const card = page.locator(".dk-watch-card", { hasText: "Prize filter on campaign page" });
  await card.waitFor({ timeout: 10000 });

  await card.getByRole("button", { name: "Agent to work on this ticket" }).click();
  await page.getByRole("option", { name: /^Codex/ }).first().click();
  console.log("PASS the ticket's plan offers a choice of agent");

  // Record every row the sidebar shows, so a brief "starting" row is not missed.
  await page.evaluate(() => {
    window.__seenRows = new Set();
    const note = () => document.querySelectorAll("[data-sidebar-row]").forEach((row) => window.__seenRows.add(`${row.getAttribute("data-sidebar-row")}|${row.textContent}`));
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await card.getByRole("button", { name: /Create and start/ }).click();

  const row = page.locator("[data-sidebar-row^='session:']", { hasText: "Prize filter on campaign page" });
  await row.waitFor({ timeout: 30000 });
  const seen = await page.evaluate(() => [...window.__seenRows]);
  assert.ok(seen.some((entry) => entry.startsWith("starting-") && entry.includes("Prize filter on campaign page") && entry.includes("starting")), `a starting row showed first (${seen.join(", ")})`);
  assert.equal(await page.locator("[data-sidebar-row^='starting-']").count(), 0, "and it is gone once the session is listed");
  console.log("PASS the sidebar shows the session as starting until it exists");

  // Started from the Automations dialog, the session is put on screen and the dialog gets out of the way.
  await page.getByRole("button", { name: /^Codex.*Swap agent/ }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(".dk-watch-card").count(), 0, "the Automations dialog closed");
  assert.equal(await row.getAttribute("aria-current"), "page", "and the new session is the highlighted row");
  console.log("PASS the started session is opened and highlighted");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}"));
  const task = stored.tasks.find((item) => item.title === "Prize filter on campaign page");
  assert.equal(task?.assignedAgent, "codex", "the task is Codex's");
  assert.equal(stored.sessions.find((item) => item.taskId === task.id)?.provider, "codex", "and Codex runs its session");
  console.log("PASS the session runs on the agent picked on the ticket");
} finally {
  await app.close();
}
console.log("Pitwall watch ticket start smoke test passed.");
