// The Files panel (behind pitwall-files-panel while it is finished): a session's worktree as a tree, a file opened and saved in
// place, an agent's write taken in or flagged, and a selection handed to the
// agent. Also: a scheduled run's task stays off the task board.
//   npm run build && node tests/files-panel-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-files-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
const typed = path.join(temp, "typed.txt");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
// Whatever reaches the agent's input is kept, so the test can read it.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/sh\ncase "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) exit 0 ;; esac\nstty raw -echo 2>/dev/null\necho "claude stub ready"\nexec cat >> '${typed}'\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);

const dir = path.join(temp, "admin");
await mkdir(path.join(dir, "src", "lib"), { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, ".gitignore"), "dist/\n");
await writeFile(path.join(dir, "src", "app.ts"), "export const one = 1;\nexport const two = 2;\nexport const three = 3;\n");
await writeFile(path.join(dir, "src", "lib", "util.ts"), "export const util = true;\n");
await writeFile(path.join(dir, "README.md"), "# admin\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
// The agent has been at work: one change, one new file, one ignored build.
await writeFile(path.join(dir, "src", "lib", "util.ts"), "export const util = false;\n");
await writeFile(path.join(dir, "src", "new.ts"), "export const fresh = 1;\n");
await mkdir(path.join(dir, "dist"));
await writeFile(path.join(dir, "dist", "bundle.js"), "built");

const now = new Date().toISOString();
const session = { id: "s1", name: "Fix the util", agent: "Claude", status: "running", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir };
const project = { id: "bo", name: "admin", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session], queue: [], timeline: [] };
const task = (id, identifier, extra = {}) => ({ id, projectId: "bo", identifier, title: `${identifier} title`, description: "", status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: identifier, createdAt: now, updatedAt: now, ...extra });
const workspace = {
  version: 1,
  projects: [{ id: "bo", name: "admin", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }],
  tasks: [
    task("t1", "acme-2679", { source: { kind: "mcp", name: "atlassian", status: "To Do" } }),
    // A scheduled run from before runs were marked as such.
    task("t2", "sched-987452-20260929-1200", { source: { kind: "local" }, status: "running" }),
  ],
  contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [],
};

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-files-panel", "on");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "admin");

  // The board is filed work only.
  await goTo(page, "Tasks");
  await page.locator(".dk-workspace").getByText("acme-2679 title").waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".dk-workspace").getByText("sched-987452-20260929-1200 title").count(), 0, "a scheduled run is not on the task board");
  assert.equal(await page.locator(".dk-workspace .dk-board-card").count(), 1, "one filed task on the board");
  console.log("PASS the task board shows tracker work, not scheduled runs");

  await page.locator("[data-sidebar-row]", { hasText: "Fix the util" }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Worktree files" });
  await tree.getByRole("treeitem", { name: /^src/ }).waitFor({ timeout: 10000 });
  const top = await tree.getByRole("treeitem").allInnerTexts();
  assert.deepEqual(top.map((text) => text.trim()), ["src", ".gitignore", "README.md"], "ignored files are left out");
  console.log("PASS the tree lists the worktree without what git ignores");

  await page.getByRole("button", { name: /^Changed/ }).click();
  await tree.getByRole("treeitem", { name: /util\.ts/ }).waitFor();
  const changed = (await tree.getByRole("treeitem").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());
  assert.deepEqual(changed, ["util.ts src/lib M", "new.ts src U"]);
  await page.getByRole("button", { name: "All files", exact: true }).click();
  console.log("PASS Changed lists what the agent touched");

  await tree.getByRole("treeitem", { name: /^src/ }).click();
  await tree.getByRole("treeitem", { name: /app\.ts/ }).click();
  const editor = page.locator(".dk-code-editor .cm-content");
  await editor.getByText("export const two = 2;").waitFor({ timeout: 10000 });
  console.log("PASS a file opens in the panel");

  // Edit and save.
  await page.locator(".cm-line", { hasText: "export const three = 3;" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // saved");
  await page.locator(".dk-files-dirty").waitFor();
  await page.keyboard.press("Meta+s");
  await page.locator(".dk-files-dirty").waitFor({ state: "detached" });
  assert.match(await readFile(path.join(dir, "src", "app.ts"), "utf8"), /export const three = 3; \/\/ saved\n/);
  console.log("PASS ⌘S saves to the worktree");

  // The agent writes the file while it is open and unedited: taken in.
  await writeFile(path.join(dir, "src", "app.ts"), "export const one = 1;\nexport const two = 22;\nexport const three = 3; // saved\n");
  await editor.getByText("export const two = 22;").waitFor({ timeout: 5000 });
  console.log("PASS an agent's write to an unedited file is shown at once");

  // ...and while it has edits: flagged, and a save is refused.
  await page.locator(".cm-line", { hasText: "export const one = 1;" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // mine");
  await writeFile(path.join(dir, "src", "app.ts"), "export const one = 100;\nexport const two = 22;\nexport const three = 3; // saved\n");
  await page.getByText("Changed on disk while you were editing.").waitFor({ timeout: 5000 });
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(300);
  assert.match(await readFile(path.join(dir, "src", "app.ts"), "utf8"), /^export const one = 100;/, "the agent's version is not overwritten");
  await page.getByRole("button", { name: "Reload and drop my edits" }).click();
  await editor.getByText("export const one = 100;").waitFor();
  console.log("PASS edits never silently overwrite an agent's change");

  // Hand a selection to the agent.
  await page.locator(".cm-line", { hasText: "export const one = 100;" }).click();
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Ask agent" }).click();
  await page.waitForTimeout(500);
  assert.match(await readFile(typed, "utf8").catch(() => ""), /src\/app\.ts:1-2 $/, "the reference reaches the agent's input, unsent");
  console.log("PASS Ask agent puts the lines into the session's input");

  // Leaving a file with unsaved edits asks first; saying no keeps them.
  await page.locator(".cm-line", { hasText: "export const two = 22;" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // unsaved");
  await page.locator(".dk-files-dirty").waitFor();
  const asked = [];
  const answer = (accept) => page.once("dialog", (dialog) => { asked.push(dialog.message()); void (accept ? dialog.accept() : dialog.dismiss()); });
  answer(false);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.waitForTimeout(300);
  assert.equal(asked.length, 1, "leaving with edits asks first");
  assert.match(await editor.innerText(), /\/\/ unsaved/, "declining keeps the edits on screen");
  answer(true);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("tree").waitFor();
  assert.equal(asked.length, 2);
  assert.doesNotMatch(await readFile(path.join(dir, "src", "app.ts"), "utf8"), /unsaved/);
  console.log("PASS leaving a file with unsaved edits asks before dropping them");

  // Path escapes are refused at the boundary.
  const escaped = await page.evaluate((root) => window.pitwall.readFile({ root, path: "../home/.zprofile" }), dir);
  assert.equal(escaped.ok, false);
  console.log("PASS a path outside the worktree is refused");
} finally {
  await app.close();
}
console.log("Pitwall files panel smoke test passed.");
