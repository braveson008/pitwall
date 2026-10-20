// Switching sessions sticks. A pane in the background answers its CLI's
// terminal queries on its own, and that answer used to be taken for you
// clicking into it: the window kept jumping back to that session.
//   npm run build && node tests/session-switch-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-switch-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
// A CLI that keeps asking the terminal about itself, as Codex does.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash\ncase "$1" in --version) echo "2.1.289 (Claude Code)"; exit 0 ;; --help) exit 0 ;; esac\nstty raw -echo 2>/dev/null\necho "stub ready"\nwhile true; do printf '\\033[c\\033]11;?\\007\\033[6n'; sleep 0.3; done &\nexec cat >/dev/null\n`);
await chmod(path.join(fakeBin, "claude"), 0o755);

const dir = path.join(temp, "repo");
await mkdir(dir, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
const now = new Date().toISOString();
const session = (id, name) => ({ id, name, agent: "Claude", status: "running", model: "auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir });
const project = { id: "p", name: "repo", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 2, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session("a", "First session"), session("b", "Second session")], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "p", name: "repo", path: dir, defaultBranch: "main", providerIds: ["claude"], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
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
  const header = page.locator(".dk-header-titles");
  const open = async (name) => {
    await page.locator("[data-sidebar-row]", { hasText: name }).click();
    await header.getByText(name).waitFor({ timeout: 10000 });
  };
  // Both panes mounted and their CLIs running, then the first one chosen.
  await open("Second session");
  await page.waitForTimeout(2000);
  await open("First session");
  await page.waitForTimeout(3000);
  assert.match(await header.innerText(), /First session/, "the background pane's terminal replies did not pull the window back");
  await open("Second session");
  await page.waitForTimeout(3000);
  assert.match(await header.innerText(), /Second session/);
  console.log("PASS switching sessions sticks while background panes answer their CLIs");
} finally {
  await app.close();
}
console.log("Pitwall session switch smoke test passed.");
