// A session started without a task is headed as itself, not with whichever
// ticket was picked last.
//   npm run build && node tests/untasked-session-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-untasked-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
for (const name of ["claude", "codex"]) {
  await writeFile(path.join(fakeBin, name), `#!/bin/sh\nstty raw -echo 2>/dev/null\necho "${name} stub ready"\nexec cat >/dev/null\n`);
  await chmod(path.join(fakeBin, name), 0o755);
}

const dir = path.join(temp, "shop-frontend");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "README.md"), "# shop\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });

const now = new Date().toISOString();
const session = (id, name, status = "completed") => ({ id, name, agent: "Claude", status, model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] });
const project = { id: "shop", name: "shop-frontend", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 2, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session("tasked", "JSON List picker · Implementer"), session("free", "New session · Claude")], queue: [], timeline: [] };
const sessionless = { id: "t2", projectId: "shop", identifier: "shop-564", title: "Handle _object type Object fields", description: "Shipped last week.", status: "completed", priority: "medium", assignedAgent: "claude", relatedFiles: [], worktree: "shop-564", createdAt: now, updatedAt: now };
const orphan = { id: "t3", projectId: "shop", identifier: "shop-2632", title: "Prize filter on campaign page", description: "Marked running in the tracker.", status: "running", priority: "medium", assignedAgent: "claude", relatedFiles: [], worktree: "shop-2632", createdAt: now, updatedAt: now };
const task = { id: "t1", projectId: "shop", identifier: "shop-1967", title: "JSON List picker saves wrong value when display and value fields differ", description: "Fix it.", status: "running", priority: "medium", assignedAgent: "claude", relatedFiles: [], worktree: "shop-1967", createdAt: now, updatedAt: now };
const workspace = {
  version: 1,
  projects: [{ id: "shop", name: "shop-frontend", path: dir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }],
  tasks: [task, sessionless, orphan],
  contextEntries: [],
  contextSnapshots: [],
  // Only the first session belongs to the task.
  sessions: [{ id: "tasked", projectId: "shop", taskId: "t1", type: "implementation", provider: "claude", status: "completed", createdAt: now, updatedAt: now }],
  activity: [],
  taskRuns: [],
  councilRuns: [],
  compareRuns: [],
};

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
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
  await openProject(page, "shop-frontend");

  const header = page.locator(".dk-header-titles");
  // The task's own session first, which makes the task the one picked last.
  await page.locator("[data-sidebar-row]", { hasText: "JSON List picker" }).click();
  await header.getByText("JSON List picker saves wrong value", { exact: false }).waitFor({ timeout: 10000 });
  assert.match(await header.innerText(), /shop-1967/i);

  // The CLI is told the pane's real height, not the shorter one it starts at.
  await page.locator(".dk-terminal.is-active .xterm-rows").waitFor();
  const heights = await (async () => {
    for (let i = 0; i < 20; i += 1) {
      const now = await page.evaluate(async () => ({
        shown: document.querySelectorAll(".dk-terminal.is-active .xterm-rows > div").length,
        pty: (await window.braveli.getTerminalSize("tasked"))?.rows,
      }));
      if (now.shown && now.shown === now.pty) return now;
      await page.waitForTimeout(250);
    }
    return page.evaluate(async () => ({
      shown: document.querySelectorAll(".dk-terminal.is-active .xterm-rows > div").length,
      pty: (await window.braveli.getTerminalSize("tasked"))?.rows,
    }));
  })();
  assert.equal(heights.pty, heights.shown, `the agent draws in every row the pane shows (${JSON.stringify(heights)})`);
  console.log("PASS the agent's terminal is as tall as the pane");

  await page.locator("[data-sidebar-row]", { hasText: "New session · Claude" }).click();
  await header.getByText("New session · Claude").waitFor({ timeout: 10000 });
  const text = await header.innerText();
  assert.match(text, /No task/);
  assert.doesNotMatch(text, /JSON List picker|shop-1967/i, "an untasked session does not borrow the last task");
  console.log("PASS an untasked session is headed as itself, with no task");
  assert.equal(await page.getByRole("button", { name: "Files", exact: true }).count(), 0, "the Files panel stays off until it is finished");
  console.log("PASS the unfinished Files panel is not offered");

  // Two lists, as in Braveli: sessions, and work in review. Tasks no agent is
  // on live on the board, not here.
  const names = await page.locator(".dk-tsb-group .dk-tsb-heading-toggle > span:nth-child(2)").allInnerTexts();
  assert.deepEqual(names, ["Working"]);
  assert.equal(await page.locator("[data-sidebar-row]", { hasText: "Prize filter" }).count(), 0, "a running task with no agent is not a session");
  assert.equal(await page.locator("[data-sidebar-row]", { hasText: "Handle _object type" }).count(), 0, "shipped work is not a session");
  console.log("PASS the sidebar lists sessions, and only sessions, under Working");

  // Groups fold, and stay folded.
  const working = page.locator(".dk-tsb-group", { hasText: "Working" });
  await working.locator(".dk-tsb-heading-toggle").click();
  assert.equal(await working.locator("[data-sidebar-row]").count(), 0, "a folded group hides its rows");
  assert.equal(await working.locator(".dk-tsb-heading-toggle").getAttribute("aria-expanded"), "false");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".dk-tsb-group", { hasText: "Working" }).waitFor();
  assert.equal(await page.locator(".dk-tsb-group", { hasText: "Working" }).locator("[data-sidebar-row]").count(), 0, "and stays folded after a restart");
  await page.locator(".dk-tsb-group", { hasText: "Working" }).locator(".dk-tsb-heading-toggle").click();
  await page.locator("[data-sidebar-row]", { hasText: "New session · Claude" }).waitFor();
  console.log("PASS sidebar groups fold, and remember it");
} finally {
  await app.close();
}
console.log("Pitwall untasked session smoke test passed.");
