// The board's multi-select does what its buttons say: "Remove 2" removes both
// picked tasks, each after its own confirmation, not just the last one picked.
// A board with no tracker does not promise to re-read one.
// The review queue of a repository with no remote says that plainly, and the
// Activity page shows the project's history rather than its last twelve events.
//   npm run build && node tests/task-board-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-board-"));
const fakeHome = path.join(temp, "home");
await mkdir(fakeHome, { recursive: true });
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "a.txt"), "a\n");
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
const now = new Date().toISOString();
const task = (id, title, status) => ({ id, projectId: "p", identifier: id.toUpperCase(), title, description: "", status, priority: "medium", assignedAgent: "", relatedFiles: [], worktree: id, createdAt: now, updatedAt: now });
// Thirty events over two days: more than the twelve the page used to stop at.
const activity = Array.from({ length: 30 }, (_, index) => ({ id: `a${index}`, projectId: "p", type: "system", message: `Event ${index}`, createdAt: new Date(Date.now() - index * 90 * 60_000).toISOString() }));
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [task("t-1", "First pick", "backlog"), task("t-2", "Second pick", "ready"), task("t-3", "Left alone", "ready")], contextEntries: [], contextSnapshots: [], sessions: [], activity, taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
let passed = false;
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
  await openProject(page, "repo");
  await goTo(page, "Tasks");
  const cards = () => page.locator(".dk-board-card").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")).sort());

  // Nothing here came from a tracker, so checking finds nothing to schedule.
  const sync = page.locator(".dk-board-sync");
  await sync.click();
  await page.waitForTimeout(500);
  assert.equal((await sync.innerText()).trim(), "Check tracker", "no re-read countdown without a tracker");
  console.log("PASS a board with no tracker does not count down to re-reading one");

  await page.getByRole("checkbox", { name: "Select First pick" }).click();
  await page.getByRole("checkbox", { name: "Select Second pick" }).click();
  await page.getByRole("button", { name: "Remove 2", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete task" });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /1 more selected task follows/);
  await dialog.getByRole("button", { name: "Delete task" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".dk-board-card").length === 2);
  assert.doesNotMatch(await dialog.innerText(), /more selected/, "the last confirmation has nothing after it");
  await dialog.getByRole("button", { name: "Delete task" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await cards(), ["Left alone"], "both picked tasks are removed, the other is not");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pitwall-workspace-state")).tasks.map((item) => item.id));
  assert.deepEqual(stored, ["t-3"]);
  console.log("PASS Remove 2 removes both picked tasks");

  await page.getByRole("checkbox", { name: "Select Left alone" }).click();
  await page.getByRole("button", { name: "Remove 1", exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await cards(), ["Left alone"], "cancelling removes nothing");
  console.log("PASS cancelling a removal keeps the task");

  // A repository with no remote says so, in one sentence with one full stop.
  await goTo(page, "Review");
  const notice = page.locator(".dk-review-notice");
  await page.waitForFunction(() => /remote/.test(document.querySelector(".dk-review-notice")?.textContent ?? ""), null, { timeout: 15000 });
  const text = await notice.innerText();
  assert.match(text, /this project has no remote/, text);
  assert.doesNotMatch(text, /\.\./, text);
  console.log("PASS the review queue says a local repository has no remote");

  // The Activity page lists the project's history, not just its last twelve events.
  await goTo(page, "Activity");
  const rows = page.locator(".dk-activity .dk-activity-row");
  await rows.first().waitFor();
  assert.ok(await rows.count() >= 30, "every stored event is listed");
  assert.equal(await rows.filter({ hasText: /^.*Event 29$/ }).count(), 1, "the oldest seeded event is listed");
  assert.equal(await page.locator(".dk-activity").getByRole("heading", { name: "Yesterday" }).count(), 1, "yesterday's events are reachable");
  console.log("PASS the Activity page shows more than the latest twelve events");
  passed = true;
} finally {
  await app.close();
  if (passed) await rm(temp, { recursive: true, force: true });
}
console.log("Pitwall task board smoke test passed.");
