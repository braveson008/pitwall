// The Changes tab, in the real app: an edit made in the session's worktree
// appears within a moment, in the tab and the sidebar; one hunk is reverted,
// a new file kept, and the rest reverted all at once.
//   npm run build && node tests/live-changes-smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { electron } from "./electronLaunch.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-live-"));
const shots = path.join(temp, "shots");
await mkdir(shots, { recursive: true });
const home = path.join(temp, "home");
await mkdir(home, { recursive: true });
await writeFile(path.join(home, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });

const repo = path.join(temp, "shop");
await mkdir(repo, { recursive: true });
const git = (...args) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" });
const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
git("init", "-q", "-b", "main");
await writeFile(path.join(repo, "cart.ts"), lines);
await writeFile(path.join(repo, "README.md"), "# shop\n");
git("add", "-A");
git("commit", "-qm", "base");

const until = async (what, check, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const now = new Date().toISOString();
const session = { id: "sess-live", name: "New session · Claude", agent: "Claude", status: "running", model: "", branch: "main", worktreePath: repo };
const project = { id: "shop", name: "shop", path: repo, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "shop", name: "shop", path: repo, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: home, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-theme", "dark");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });

  const tab = page.locator(".dk-workbench-bar button", { hasText: "Changes" });
  await tab.waitFor({ timeout: 20000 });
  await tab.click();
  const pane = page.locator(".dk-pane--changes");
  await until("the empty state", async () => /No changes since/.test(await pane.innerText()));
  await page.screenshot({ path: path.join(shots, "1-empty.png") });
  console.log("PASS the tab opens on a quiet worktree and says nothing has changed");

  // The agent edits two places in one file and adds another.
  await writeFile(path.join(repo, "cart.ts"), lines.replace("line 2\n", "line 2 CHANGED\n").replace("line 28\n", "line 28 CHANGED\n"));
  await writeFile(path.join(repo, "discount.ts"), "export const discount = 0.1;\n");
  await until("both files listed", async () => (await pane.locator(".dk-branchdiff-file").count()) === 2);
  assert.match(await tab.innerText(), /2/);
  const sidebar = page.locator('[aria-label="Changes so far"]');
  await sidebar.waitFor();
  assert.match(await sidebar.innerText(), /cart\.ts/);
  console.log("PASS edits appear live, with a count on the tab and the files in the sidebar");

  await pane.locator(".dk-branchdiff-file", { hasText: "cart.ts" }).click();
  await until("the cart diff", async () => (await pane.locator(".dk-livechanges-hunk").count()) === 2);
  assert.match(await pane.locator(".dk-diff").innerText(), /line 2 CHANGED/);
  await page.screenshot({ path: path.join(shots, "2-diff.png") });

  const firstHunk = pane.locator(".dk-livechanges-hunk").first();
  await firstHunk.hover();
  await firstHunk.getByRole("button", { name: "Revert this change" }).click();
  await until("the first hunk reverted on disk", async () => {
    const text = await readFile(path.join(repo, "cart.ts"), "utf8");
    return text.includes("line 2\n") && text.includes("line 28 CHANGED");
  });
  await until("one hunk left", async () => (await pane.locator(".dk-livechanges-hunk").count()) === 1);
  console.log("PASS reverting one hunk undoes only that hunk, on disk and in the diff");

  const discountRow = pane.locator(".dk-livechanges-row", { hasText: "discount.ts" });
  await discountRow.hover();
  await discountRow.getByRole("button", { name: "Keep discount.ts" }).click();
  await until("discount.ts kept", async () => (await pane.locator(".dk-branchdiff-file").count()) === 1);
  assert.ok(existsSync(path.join(repo, "discount.ts")));
  console.log("PASS keeping a file takes it off the list and leaves it on disk");

  await writeFile(path.join(repo, "README.md"), "# shop\n\nrewritten\n");
  await until("README listed", async () => (await pane.locator(".dk-branchdiff-file").count()) === 2);
  const revertAll = pane.getByRole("button", { name: "Revert all" });
  await revertAll.click();
  await pane.getByRole("button", { name: /Revert 2 files\?/ }).click();
  await until("everything reverted", async () => /No changes since/.test(await pane.innerText()));
  assert.equal(await readFile(path.join(repo, "cart.ts"), "utf8"), lines);
  assert.equal(await readFile(path.join(repo, "README.md"), "utf8"), "# shop\n");
  assert.ok(existsSync(path.join(repo, "discount.ts")), "a kept file is not reverted");
  assert.equal(await sidebar.count(), 0);
  await page.screenshot({ path: path.join(shots, "3-reverted.png") });
  console.log("PASS revert all asks once more, then restores every file that was not kept");

  // Moving around the app and resizing must not lose the live link.
  await page.locator(".dk-workbench-bar button", { hasText: "Terminal" }).click();
  await page.setViewportSize({ width: 900, height: 700 }).catch(() => undefined);
  await writeFile(path.join(repo, "README.md"), "# shop!\n");
  await until("the count while on another tab", async () => /1/.test(await tab.innerText()));
  await tab.click();
  await until("README back in the list", async () => (await pane.locator(".dk-branchdiff-file").count()) === 1);
  await page.screenshot({ path: path.join(shots, "4-narrow.png") });
  console.log("PASS it stays live while another tab is open and after a resize");

  const status = git("status", "--porcelain");
  assert.match(status, /\?\? discount\.ts/);
  assert.doesNotMatch(status, /^A /m, "the agent's index was never touched");
  assert.deepEqual(errors.filter((message) => !/Autofill|DevTools|net::ERR/.test(message)), []);
  console.log(`PASS no renderer errors; screenshots in ${shots}`);
} finally {
  await app.close();
}
