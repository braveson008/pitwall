// The Zed shell: title bar, status bar, palette keyboard flow, and every shortcut the
// interface advertises actually doing what its tooltip says.
//   npm run build && node tests/zed-shell-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-zed-shell-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
for (const cli of ["claude", "codex", "hermes"]) {
  await writeFile(path.join(fakeBin, cli), `#!/bin/bash\ncase "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) exit 0 ;; esac\necho "stub ready"\nexec cat >/dev/null\n`);
  await chmod(path.join(fakeBin, cli), 0o755);
}
const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
const now = new Date().toISOString();
const session = (id, name) => ({ id, name, agent: "Claude", status: "running", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir });
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 3, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session("a", "First session"), session("b", "Second session"), session("c", "Third session")], queue: [], timeline: [] };
const task = (id, identifier, title, status) => ({ id, projectId: "p", identifier, title, description: "", status, priority: "medium", providerId: "claude", createdAt: now, updatedAt: now });
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [task("t1", "R-1", "Ship the thing", "review")], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const errors = [];
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => { errors.push(String(error)); console.log("PAGEERROR", error.stack || String(error)); });
  page.on("console", (message) => { if (message.type() === "error") console.log("CONSOLE", message.text().slice(0, 600)); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([project]));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  const header = page.locator(".dk-header-titles");
  const statusbar = page.locator(".dk-statusbar");

  // Title bar is one line; the status bar spans the window and leads with the agents.
  assert.equal(Math.round((await page.locator(".dk-header-bar").boundingBox()).height), 34, "the title bar is Zed's 34px");
  const bar = await statusbar.boundingBox();
  assert.ok(bar && bar.width >= 1430 && bar.y + bar.height >= 895, "the status bar runs along the foot of the window");
  await statusbar.getByRole("button", { name: "1 to review" }).click();
  // It used to blank the window: a task with no relatedFiles crashed the review page.
  await page.locator(".dk-review-head", { hasText: "Ship the thing" }).waitFor({ timeout: 10000 });
  assert.doesNotMatch(await page.locator(".dk-review-notice").innerText(), /\.\./, "one full stop, not two");
  console.log("PASS status bar: review count opens the finished work");

  // Fonts: Zed's faces by default.
  const fonts = await page.evaluate(() => ({ ui: getComputedStyle(document.body).fontFamily, mono: getComputedStyle(document.documentElement).getPropertyValue("--font-mono") }));
  assert.match(fonts.ui, /IBM Plex Sans/);
  assert.match(fonts.mono, /Lilex/);
  console.log("PASS fonts: IBM Plex Sans and Lilex");

  // Palette: arrows move one selection, Enter runs the selected command.
  await page.keyboard.press("Meta+k");
  await page.locator(".dk-palette").waitFor();
  await page.keyboard.type("new");
  const rows = page.locator(".dk-palette-row");
  assert.ok((await rows.count()) >= 1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.locator('.dk-palette-row[aria-selected="true"]').count(), 1, "exactly one row is selected");
  await page.keyboard.press("Escape");
  await page.locator(".dk-palette").waitFor({ state: "detached" });
  console.log("PASS palette: one keyboard selection");

  // A ticket key in the palette opens that task.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("R-1");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Ship the thing" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Close task detail" }).click();
  console.log("PASS palette: a ticket key opens the task");

  // Every shortcut the interface advertises does what its tooltip says.
  await page.keyboard.press("Meta+n");
  await page.getByRole("dialog", { name: "New work" }).waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "New work" }).waitFor({ state: "detached" });
  console.log("PASS ⌘N opens New work");

  // Selecting text in a field and letting go over the backdrop keeps the dialog.
  await page.keyboard.press("Meta+n");
  const dialog = page.getByRole("dialog", { name: "New work" });
  await dialog.waitFor();
  const field = await page.getByRole("textbox", { name: "Instruction" }).boundingBox();
  await page.mouse.move(field.x + 20, field.y + 10);
  await page.mouse.down();
  await page.mouse.move(20, 880, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(await dialog.count(), 1, "a drag out of the dialog does not close it");
  await page.mouse.click(20, 880);
  await dialog.waitFor({ state: "detached", timeout: 5000 });
  console.log("PASS dialogs survive a drag onto the backdrop, and close on a real click there");
  await page.keyboard.press("Meta+b");
  await page.locator(".dk-tsb").getByRole("tab", { name: "Board", selected: true }).waitFor({ timeout: 5000 });
  console.log("PASS ⌘B shows the board");
  await page.keyboard.press("Meta+,");
  await statusbar.getByRole("button", { name: "Settings" }).and(page.locator(".is-current")).waitFor({ timeout: 5000 });
  console.log("PASS ⌘, opens Settings");

  // ⌘1…⌘9 open the sidebar's rows in order; ⌥⌘↓/↑ step through them.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+2");
  await header.getByText("Second session").waitFor({ timeout: 10000 });
  await page.keyboard.press("Meta+Alt+ArrowDown");
  await header.getByText("Third session").waitFor({ timeout: 10000 });
  await page.keyboard.press("Meta+Alt+ArrowUp");
  await header.getByText("Second session").waitFor({ timeout: 10000 });
  console.log("PASS ⌘1–9 and ⌥⌘↑/↓ move between sessions");

  assert.deepEqual(errors, [], "no page errors");
  console.log("Pitwall Zed shell smoke test passed.");
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
