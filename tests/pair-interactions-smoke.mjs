// Everything a person does around a paired session, with the mouse: scroll the
// implementer's terminal, flip to the reviewer's tab and back, switch to a
// plain session and back. And a session started with "No task" is given none.
//   npm run build && node tests/pair-interactions-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-pair-ui-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
// An agent with a long answer: three hundred numbered lines, then it waits.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash
case "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) echo "  --settings <file-or-json>"; exit 0 ;; esac
for i in $(seq 1 300); do echo "output line $i"; done
exec cat >/dev/null
`);
await writeFile(path.join(fakeBin, "codex"), `#!/bin/bash\ncase "$1" in --version) echo "codex-cli 0.160.1"; exit 0 ;; esac\nexit 0\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);
await chmod(path.join(fakeBin, "codex"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "a.txt"), "a\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
const now = new Date().toISOString();
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const task = { id: "t1", projectId: "p", identifier: "T-1", title: "Paired task", description: "x", status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "t-1", createdAt: now, updatedAt: now };
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now }], tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  // The real window, at the screen's own density, so terminals draw as they do for a person.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
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

  const startSession = async ({ task, reviewer, instruction }) => {
    await page.getByRole("button", { name: "New work", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Session options" }) });
    await dialog.waitFor({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("option", { name: /^Claude/ }).first().click();
    await dialog.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByRole("option", { name: task }).first().click();
    if (reviewer) {
      await dialog.getByRole("button", { name: "Reviewer", exact: true }).click();
      await page.getByRole("option", { name: reviewer }).first().click();
    }
    await dialog.getByRole("textbox").first().fill(instruction);
    await dialog.getByRole("textbox").first().press("Enter");
    await dialog.waitFor({ state: "detached", timeout: 30000 });
  };
  await startSession({ task: /^Paired task/, reviewer: /^Codex/, instruction: "Paired work" });
  await startSession({ task: /^No task/, instruction: "Plain work" });

  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}"));
  const plainRecord = (await stored()).sessions.find((item) => item.taskId !== "t1");
  assert.ok(plainRecord, "the plain session has a record");
  assert.equal(plainRecord.taskId, "", "a session started with No task is given no task");
  assert.equal((await stored()).tasks.find((item) => item.id === "t1").assignedAgent, "claude", "the paired task is the paired session's");
  console.log("PASS a session started with No task gets no task, and leaves the other task alone");

  await goTo(page, "Work");
  const open = async (name) => {
    await page.locator("[data-sidebar-row]", { hasText: name }).click();
    await page.locator(".dk-header-titles").getByText(name === "Paired work" ? "Paired task" : "Plain work").waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
  };
  // The terminal's own record of which scrollback line is at the top of the view.
  const scrollTop = () => page.locator(".dk-terminal.is-active .dk-xterm").evaluate((element) => Number(element.dataset.viewportLine ?? -1));
  const terminalWidth = () => page.locator(".dk-terminal.is-active").evaluate((element) => element.getBoundingClientRect().width);
  const wheelOverTerminal = async (deltaY, times) => {
    const box = await page.locator(".dk-terminal.is-active .xterm").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let index = 0; index < times; index += 1) {
      await page.mouse.wheel(0, deltaY);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
  };

  // The plain session: full width, no pair tabs.
  await open("Plain work");
  const fullWidth = await terminalWidth();
  assert.equal(await page.getByRole("tablist", { name: "Pair" }).count(), 0, "a plain session has no pair tabs");
  assert.match(await page.locator(".dk-header-titles").innerText(), /No task/);

  // The paired session: same full width, tabs, and its terminal scrolls.
  await open("Paired work");
  assert.equal(Math.round(await terminalWidth()), Math.round(fullWidth), "the implementer keeps the full width");
  const tabs = page.getByRole("tablist", { name: "Pair" });
  await tabs.waitFor();
  await page.waitForFunction(() => Number(document.querySelector(".dk-terminal.is-active .dk-xterm")?.dataset.viewportLine ?? 0) > 0, null, { timeout: 15000 });
  const bottom = await scrollTop();
  assert.ok(bottom > 0, "the terminal has scrollback to scroll");
  await wheelOverTerminal(-60, 20);
  const scrolledUp = await scrollTop();
  assert.ok(scrolledUp < bottom, `wheel up scrolls the implementer (${bottom} → ${scrolledUp})`);
  await wheelOverTerminal(60, 8);
  const scrolledBack = await scrollTop();
  assert.ok(scrolledBack > scrolledUp, `wheel down scrolls back (${scrolledUp} → ${scrolledBack})`);
  console.log("PASS the paired implementer's terminal scrolls both ways at full width");

  // Flip to the reviewer and back: the terminal is where it was, and still scrolls.
  await tabs.getByRole("tab", { name: /^Reviewer/ }).click();
  const reviewer = page.getByRole("complementary", { name: "Reviewer · Codex" });
  await reviewer.waitFor();
  assert.match(await reviewer.innerText(), /When Claude finishes, Codex reads the change here/);
  await tabs.getByRole("tab", { name: "Implementer" }).click();
  await reviewer.waitFor({ state: "hidden" });
  assert.equal(await scrollTop(), scrolledBack, "switching tabs keeps the scroll position");
  await wheelOverTerminal(-60, 5);
  assert.ok(await scrollTop() < scrolledBack, "and the terminal still scrolls after switching tabs");
  console.log("PASS switching between Implementer and Reviewer keeps the terminal and its scroll");

  // Side by side: both at once, each at half the width.
  await tabs.getByRole("tab", { name: "Side by side" }).click();
  await reviewer.waitFor();
  const halfWidth = await terminalWidth();
  assert.ok(Math.abs(halfWidth - fullWidth / 2) < 24, `the implementer takes half the width (${halfWidth} of ${fullWidth})`);
  assert.ok(await page.locator(".dk-terminal.is-active .xterm").isVisible(), "the implementer's terminal stays visible beside the reviewer");
  await tabs.getByRole("tab", { name: "Implementer" }).click();
  await reviewer.waitFor({ state: "hidden" });
  assert.equal(await terminalWidth(), fullWidth, "and returns to the full width");
  console.log("PASS side by side shows the implementer and the reviewer together");

  // Away to the plain session and back: still a paired session on its implementer, still scrolling.
  await open("Plain work");
  assert.equal(await page.getByRole("tablist", { name: "Pair" }).count(), 0);
  await wheelOverTerminal(-60, 5);
  await open("Paired work");
  assert.equal(await tabs.getByRole("tab", { name: "Implementer" }).getAttribute("aria-selected"), "true", "a session opens on its implementer");
  const before = await scrollTop();
  await wheelOverTerminal(-60, 5);
  assert.ok(await scrollTop() < before || before === 0, "the paired terminal scrolls after switching sessions");
  console.log("PASS switching sessions back and forth keeps each one scrolling and the tabs where they belong");
} finally {
  await app.close();
}
console.log("Pitwall pair interactions smoke test passed.");
