// Coming back to a project comes back to the session that was open there.
//   npm run build && node tests/session-memory-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { electron } from "./electronLaunch.mjs";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-memory-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeBin, "claude"), `#!/bin/sh\ncase "$1" in --version) echo "1.0.0"; exit 0 ;; esac\nstty raw -echo 2>/dev/null\necho "claude stub ready"\nexec cat >/dev/null\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);
const repo = async (name) => {
  const dir = path.join(temp, name);
  await mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
};
const now = new Date().toISOString();
const session = (id, name) => ({ id, name, agent: "Claude", status: "completed", model: "Auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] });
const project = (id, dir, sessions) => ({ id, name: id, path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: sessions.length, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] });
const projects = [project("web", await repo("web"), [session("w1", "Web first"), session("w2", "Web second")]), project("api", await repo("api"), [session("a1", "Api first"), session("a2", "Api second")])];
const workspace = { version: 1, projects: projects.map((item) => ({ id: item.id, name: item.name, path: item.path, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now })), tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ projects, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify(projects));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { projects, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  const header = page.locator(".dk-header-titles");

  await openProject(page, "web");
  await page.locator("[data-sidebar-row]", { hasText: "Web second" }).click();
  await header.getByText("Web second").waitFor();
  await openProject(page, "api");
  await page.locator("[data-sidebar-row]", { hasText: "Api second" }).click();
  await header.getByText("Api second").waitFor();

  await openProject(page, "web");
  await header.getByText("Web second").waitFor({ timeout: 10000 });
  assert.equal(await page.locator("[data-sidebar-row='session:w2']").getAttribute("aria-current"), "page");
  console.log("PASS back in a project from the menu, the session that was open there is open again");

  // Another way across: a notification for the other project.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("app:navigate", { target: { section: "review", projectId: "api" } }));
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: "Now" }).click();
  await header.getByText("Api second").waitFor({ timeout: 10000 });
  console.log("PASS and after arriving some other way too");

  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "web");
  await header.getByText("Web second").waitFor({ timeout: 10000 });
  console.log("PASS and after a restart");
} finally {
  await app.close();
}
console.log("Pitwall session memory smoke test passed.");
