// The app shell does what it says: the shortcuts its tooltips advertise work,
// Escape closes only the thing on top, and the sidebar's project menu never
// points at a project that is gone.
//   npm run build && node tests/shell-navigation-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-shell-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
for (const name of ["claude", "codex"]) {
  await writeFile(path.join(fakeBin, name), `#!/bin/sh\ncase "$1" in --version) echo "1.0.0"; exit 0 ;; --help) exit 0 ;; esac\nstty raw -echo 2>/dev/null\necho "${name} stub ready"\nexec cat >/dev/null\n`);
  await chmod(path.join(fakeBin, name), 0o755);
}
const repo = async (name) => {
  const dir = path.join(temp, name);
  await mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
};
const dirs = { web: await repo("web"), api: await repo("api") };
// The main process's working directory, a repository of its own: work started
// with no project must not land in whatever repository the app was launched from.
const launchDir = await repo("launched-from");
const now = new Date().toISOString();
const session = (id, name, agent, dir) => ({ id, name, agent, status: "running", model: "Auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [], worktreePath: dir });
const project = (id, sessions) => ({ id, name: id, path: dirs[id], branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: sessions.length, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] });
const projects = [project("web", [session("w1", "Web work", "Claude", dirs.web)]), project("api", [session("a1", "Api work", "Codex", dirs.api), session("a2", "Api spare", "Codex", dirs.api), session("c1", "Pricing · Claude", "Claude", dirs.api), session("c2", "Pricing · Codex", "Codex", dirs.api)])];
const stored = (id) => ({ id, name: id, path: dirs[id], defaultBranch: "main", providerIds: ["claude", "codex"], createdAt: now, updatedAt: now });
const workspace = { version: 1, projects: [stored("web"), stored("api")], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], compareRuns: [],
  councilRuns: [{ id: "cr1", name: "Pricing debate", projectId: "api", taskId: "", prompt: "Raise prices?", providerIds: ["claude", "codex"], synthesizer: "claude", status: "running", responses: [{ provider: "claude", sessionId: "c1", status: "running" }, { provider: "codex", sessionId: "c2", status: "running" }], createdAt: now }] };

const app = await electron.launch({ args: [root], cwd: launchDir, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
let passed = false;
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ projects, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify(projects));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { projects, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  const sidebar = page.locator(".dk-tsb");
  await sidebar.getByRole("button", { name: "New work" }).waitFor();
  const newWork = page.getByRole("dialog", { name: "New work" });
  const sheet = page.locator(".dk-sheet");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  // The shortcuts the sidebar's tooltips and empty state promise.
  await page.locator("[data-sidebar-row]", { hasText: "Web work" }).click();
  await page.keyboard.press(`${modifier}+n`);
  await newWork.waitFor({ timeout: 3000 });
  await page.keyboard.press("Escape");
  await newWork.waitFor({ state: "detached" });
  await page.keyboard.press(`${modifier}+b`);
  await page.locator(".dk-header-titles").getByText("Board", { exact: true }).waitFor({ timeout: 3000 });
  assert.equal(await sidebar.getByRole("tab", { name: "Board" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press(`${modifier}+,`);
  await sheet.getByRole("group", { name: "Appearance" }).waitFor({ timeout: 3000 });
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  console.log("PASS New work, Board and Settings answer to the shortcuts their tooltips name");

  // Escape on a New work choice list closes the list, not the dialog.
  await sidebar.getByRole("button", { name: "New work" }).click();
  await newWork.getByRole("textbox", { name: "Instruction" }).fill("keep this draft");
  await newWork.getByRole("button", { name: "Agent", exact: true }).click();
  await newWork.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  await newWork.getByRole("listbox").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  assert.equal(await newWork.count(), 1, "the dialog stays open");
  assert.equal(await newWork.getByRole("textbox", { name: "Instruction" }).inputValue(), "keep this draft");
  // The palette would open behind the dialog, taking the typing out of sight.
  await page.keyboard.press(`${modifier}+k`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".dk-palette").count(), 0, "no palette hidden behind New work");
  assert.equal(await newWork.getByRole("textbox", { name: "Instruction" }).evaluate((element) => element === document.activeElement || element.closest("[role=dialog]").contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await newWork.waitFor({ state: "detached" });
  console.log("PASS Escape on a New work choice list closes only the list, and Cmd+K waits for the dialog");

  // Escape on a menu inside a sheet closes the menu, not the sheet.
  await page.locator(".dk-statusbar").getByRole("button", { name: /^Automations/ }).click();
  await sheet.locator(".dk-dropdown-trigger").first().click();
  await page.locator(".dk-dropdown-menu").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".dk-dropdown-menu").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  assert.equal(await sheet.count(), 1, "the Automations sheet stays open");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  console.log("PASS Escape on a menu in a sheet closes only the menu");

  // The MCP servers dialog closes on Escape like every other.
  await page.keyboard.press(`${modifier}+k`);
  await page.keyboard.type("Manage MCP servers");
  await page.keyboard.press("Enter");
  const mcp = page.getByRole("dialog", { name: "MCP servers" });
  await mcp.waitFor();
  await page.keyboard.press("Escape");
  await mcp.waitFor({ state: "detached", timeout: 3000 });
  console.log("PASS the MCP servers dialog closes on Escape");

  // Rows from every project carry a delete; it acts on the row's own project.
  const storedSessions = (id) => page.evaluate((id) => JSON.parse(localStorage.getItem("pitwall-projects")).find((item) => item.id === id).sessions.map((item) => item.id), id);
  await page.locator("[data-sidebar-row]", { hasText: "Web work" }).click();
  await page.locator(".dk-header-titles").getByText("Web work").waitFor();
  await page.locator("[data-sidebar-row='session:a2']").hover();
  await page.getByRole("button", { name: "Delete session Api spare" }).click();
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  await page.locator("[data-sidebar-row='session:a2']").waitFor({ state: "detached", timeout: 5000 });
  assert.deepEqual(await storedSessions("api"), ["a1", "c1", "c2"]);
  await page.locator("[data-sidebar-row='council:cr1']").hover();
  await page.getByRole("button", { name: "Delete Council Pricing debate" }).click();
  await page.getByRole("alertdialog", { name: "Delete Council run" }).getByRole("button", { name: "Delete Council", exact: true }).click();
  await page.locator("[data-sidebar-row='council:cr1']").waitFor({ state: "detached", timeout: 5000 });
  assert.deepEqual(await storedSessions("api"), ["a1"]);
  assert.match(await page.locator(".dk-header-titles").innerText(), /Web work/, "the open session is left alone");
  console.log("PASS deleting a session or Council from another project's row removes it");

  // Removing the project the sidebar is filtered to returns it to every project.
  // Switching project from the palette while the sidebar is on another one follows it there.
  const trigger = sidebar.getByRole("button", { name: "Project", exact: true });
  await openProject(page, "web");
  await page.keyboard.press(`${modifier}+k`);
  await page.keyboard.type("api");
  await page.locator(".dk-palette-row", { hasText: /^api/ }).click();
  await page.locator(".dk-header-titles").getByText("Api work").waitFor();
  assert.equal((await trigger.innerText()).trim(), "api");
  assert.equal(await page.locator("[data-sidebar-row='session:a1']").getAttribute("aria-current"), "page");
  console.log("PASS a project opened from the palette is the one the sidebar shows");

  page.on("dialog", (dialog) => void dialog.accept());
  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await sidebar.getByRole("option", { name: /^Remove/ }).click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("pitwall-projects") || "[]").some((item) => item.id === "api"));
  await page.waitForTimeout(500);
  assert.equal((await trigger.innerText()).trim(), "All projects");
  await page.locator("[data-sidebar-row]", { hasText: "Web work" }).waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => localStorage.getItem("pitwall-sidebar-project")), "");
  console.log("PASS removing the filtered project shows every project again");

  // With no project left, New work asks for one instead of starting anywhere.
  await openProject(page, "web");
  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await sidebar.getByRole("option", { name: /^Remove/ }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("pitwall-projects") || "[]").length === 0);
  await sidebar.getByRole("button", { name: "New work" }).click();
  await newWork.getByRole("textbox", { name: "Instruction" }).fill("anything");
  await page.keyboard.press("Enter");
  await page.getByText("Add a project first").waitFor({ timeout: 5000 });
  assert.equal(execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: launchDir, encoding: "utf8" }).trim(), "main");
  assert.equal(execFileSync("git", ["worktree", "list"], { cwd: launchDir, encoding: "utf8" }).trim().split("\n").length, 1);
  console.log("PASS New work with no project asks for one and touches no repository");

  assert.deepEqual(errors, []);
  passed = true;
} finally {
  await app.close();
  if (passed) await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
}
console.log("Pitwall shell navigation smoke test passed.");
