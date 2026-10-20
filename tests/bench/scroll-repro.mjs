// Real Claude in a paired and an unpaired session: does wheel scrolling work?
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const root = process.cwd();
const shots = process.env.SHOTS;
import { realpathSync } from "node:fs";
import { openProject } from "./helpers/openProject.mjs";
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-scroll-"));
const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
await writeFile(path.join(dir, "a.txt"), "a\n");
execFileSync("git", ["add", "."], { cwd: dir });
execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
const now = new Date().toISOString();
const session = (id, name) => ({ id, name, agent: "Claude", status: "completed", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir });
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 2, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const task = { id: "t1", projectId: "p", identifier: "T-1", title: "Paired task", description: "x", status: "ready", priority: "medium", assignedAgent: "", relatedFiles: [], worktree: "t-1", createdAt: now, updatedAt: now };
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
const page = await app.firstWindow();
try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.evaluate(({ project, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { project, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "repo");
  const PROMPT = "Print the numbers 1 to 150, one per line, as plain text. Use no tools and say nothing else.";
  for (const label of ["paired", "plain"]) {
    await page.getByRole("button", { name: /^New session/ }).first().click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("group", { name: "Session options" }) });
    await dialog.waitFor({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("option", { name: /^Claude/ }).first().click();
    if (label === "paired") {
      await dialog.getByRole("button", { name: "Task", exact: true }).click();
      await page.getByRole("option", { name: /^Paired task/ }).first().click();
      await dialog.getByRole("button", { name: "Reviewer", exact: true }).click();
      await page.getByRole("option", { name: /^Claude · up to 3 rounds/ }).first().click();
    } else {
      await dialog.getByRole("button", { name: "Task", exact: true }).click();
      await page.getByRole("option", { name: /^No task/ }).first().click();
    }
    console.log(label, "dialog says:", (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 300));
    await dialog.getByRole("textbox").first().fill(PROMPT);
    await dialog.getByRole("textbox").first().press("Enter");
    await page.waitForTimeout(40000);
    await page.locator(".dk-session-item .dk-session", { hasText: "Print the numbers" }).nth(label === "paired" ? 0 : 1).click();
    await page.waitForTimeout(4000);
    const term = page.locator(".dk-terminal.is-active .xterm");
    await page.screenshot({ path: `${shots}/${label}-1-bottom.png` });
    const box = await term.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // A trackpad flick: many small wheel events.
    for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, -30); await page.waitForTimeout(16); }
    await page.waitForTimeout(800);
    await term.screenshot({ path: `${shots}/${label}-2-scrolled-up.png` });
    for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, 30); await page.waitForTimeout(16); }
    await page.waitForTimeout(800);
    await term.screenshot({ path: `${shots}/${label}-3-scrolled-down.png` });
    console.log(label, "done");
  }
} finally {
  await app.close();
}
