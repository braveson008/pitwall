import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { goTo } from "./helpers/goTo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-release-failures-"));
const projectPath = path.join(temp, "project");
await mkdir(projectPath);
const app = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
  timeout: 30_000,
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => console.error("Renderer error:", error.message));
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  // Exercise the actual renderer state transitions without ever running an agent
  // or writing a brief. The failing boundary is an IPC result, as in production.
  await app.evaluate(({ ipcMain }) => {
    global.releaseFailureCalls = [];
    global.releaseFailureMode = "worktree-return";
    const handlers = ["git:worktree-ensure", "task-runtime:allocate", "project:trust", "session:launch", "terminal:start", "project:write-file"];
    for (const name of handlers) ipcMain.removeHandler(name);
    for (const name of handlers) ipcMain.handle(name, (_event, payload) => {
      global.releaseFailureCalls.push({ name, payload });
      if (name === "git:worktree-ensure") {
        if (global.releaseFailureMode === "worktree-reject") throw new Error("Fixture Git failure");
        if (global.releaseFailureMode === "worktree-return") return { ok: false, error: "Fixture Git failure" };
        return { ok: true, path: payload.projectPath, branch: payload.branch };
      }
      if (name === "task-runtime:allocate") {
        if (global.releaseFailureMode === "runtime-reject") throw new Error("Fixture ports exhausted");
        if (global.releaseFailureMode === "runtime-return") return { ok: false, error: "Fixture ports exhausted" };
        return { ok: true, previewPort: 8199, mobileRuntimeId: "fixture", mobileDeviceName: "Fixture" };
      }
      if (name === "project:trust") return { ok: true, trusted: true };
      return { ok: true, command: "inert fixture", cwd: payload.projectPath };
    });
  });

  async function seed(sessions = []) {
    const now = new Date().toISOString();
    await page.evaluate(({ projectPath, now, sessions }) => {
      const project = { id: "fixture", name: "Fixture", path: projectPath, branch: "main", status: "active",
        accent: "#5368dc", health: 100, openSessions: sessions.length, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] };
      localStorage.clear();
      localStorage.setItem("pitwall-projects", JSON.stringify([project]));
      localStorage.setItem("pitwall-active-project", JSON.stringify(project.id));
      localStorage.setItem("pitwall-selected-session", sessions[0]?.id ?? "");
      localStorage.setItem("pitwall-onboarded", "yes");
      localStorage.setItem("pitwall-workspace-section", JSON.stringify("work"));
      localStorage.setItem("pitwall-workspace-state", JSON.stringify({ version: 1, projects: [project],
        tasks: [{ id: "task-one", projectId: "fixture", identifier: "audit-1", title: "Fixture task", description: "Fixture only",
          status: "ready", priority: "low", relatedFiles: [], worktree: "audit-1", createdAt: now, updatedAt: now }],
        contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] }));
    }, { projectPath, now, sessions });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await goTo(page, "Work");
  }

  async function openSessionDialog() {
    await page.locator(".dk-tsb-titlebar").getByRole("button", { name: "New work" }).click();
    return page.getByRole("dialog", { name: "New work" });
  }

  async function assertNoStartedWork() {
    const calls = await app.evaluate(() => global.releaseFailureCalls);
    assert.equal(calls.filter(({ name }) => ["session:launch", "terminal:start", "project:write-file"].includes(name)).length, 0, JSON.stringify(calls));
    const counts = await page.evaluate(() => ({
      sessions: JSON.parse(localStorage.getItem("pitwall-projects"))[0].sessions.length,
      runs: JSON.parse(localStorage.getItem("pitwall-workspace-state")).sessions.length,
    }));
    assert.deepEqual(counts, { sessions: 0, runs: 0 });
  }

  for (const mode of ["worktree-return", "worktree-reject", "runtime-return", "runtime-reject"]) {
    await app.evaluate((_electron, mode) => { global.releaseFailureMode = mode; global.releaseFailureCalls = []; }, mode);
    await seed();
    const dialog = await openSessionDialog();
    await dialog.getByRole("button", { name: "Task", exact: true }).click();
    await page.getByRole("option", { name: "Fixture task", exact: true }).click();
    await dialog.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByText(mode.startsWith("runtime") ? "Task runtime isolation unavailable" : "Could not create an isolated checkout", { exact: true }).waitFor();
    await assertNoStartedWork();
    console.log(`PASS ${mode}: no launch, terminal, brief write, or successful session state`);
  }

  await app.evaluate(() => { global.releaseFailureMode = "worktree-return"; global.releaseFailureCalls = []; });
  await seed();
  await page.locator(".dk-workbench-bar").getByRole("button", { name: /council/i }).click();
  await page.getByRole("button", { name: /start council/i }).click();
  const council = page.getByRole("dialog", { name: "Set up Council" });
  await council.getByRole("button", { name: /^Start council/ }).click();
  await page.getByText("Could not create an isolated checkout", { exact: true }).waitFor();
  await assertNoStartedWork();
  console.log("PASS council worktree failure: no brief, agents, or successful session state");

  await app.evaluate(() => { global.releaseFailureMode = "success"; global.releaseFailureCalls = []; });
  await seed([{ id: "missing-agent", name: "Retry fixture", agent: "Missing Fixture", model: "auto", status: "disconnected",
    branch: "main", task: "Fixture", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: new Date().toISOString(), logs: [] }]);
  await page.locator("[data-sidebar-row]", { hasText: "Retry fixture" }).first().click();
  await page.getByText("Missing Fixture is not available", { exact: true }).waitFor();
  const sessionDialog = await openSessionDialog();
  await sessionDialog.getByRole("button", { name: "Agent", exact: true }).click();
  await sessionDialog.getByRole("button", { name: "Add agent", exact: true }).click();
  const addAgent = page.getByRole("dialog", { name: "Add custom agent" });
  await addAgent.getByPlaceholder("e.g. Aider").fill("Missing Fixture");
  await addAgent.getByPlaceholder("aider", { exact: true }).fill("/bin/sh");
  await addAgent.getByRole("button", { name: "Add agent", exact: true }).click();
  await page.getByRole("dialog", { name: "New work" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Attach CLI", exact: true }).click();
  await page.getByRole("button", { name: "Attached", exact: true }).waitFor({ timeout: 5000 });
  const calls = await app.evaluate(() => global.releaseFailureCalls);
  assert.equal(calls.filter(({ name }) => name === "terminal:start").length, 1);
  console.log("PASS unavailable-agent retry: configuring the agent allows attach without reload");

  await app.evaluate(({ BrowserWindow }) => {
    global.releaseOutputCount = 0;
    global.releaseOutputTimer = setInterval(() => {
      BrowserWindow.getAllWindows()[0].webContents.send("terminal:data", {
        sessionId: "missing-agent", data: `checkpoint-live-${++global.releaseOutputCount}\r\n`,
      });
    }, 100);
  });
  // Output must stay continuous for longer than the checkpoint period. A
  // debounce only saves once this producer goes quiet, which this test forbids.
  await page.waitForTimeout(4500);
  const checkpoint = await page.evaluate(() => localStorage.getItem("pitwall-terminal-history"));
  assert.match(checkpoint, /checkpoint-live-/);
  assert.ok(await app.evaluate(() => global.releaseOutputCount > 0 && Boolean(global.releaseOutputTimer)));
  console.log("PASS continuous terminal output checkpoints before the producer stops");
  await app.evaluate(({ BrowserWindow }) => {
    clearInterval(global.releaseOutputTimer);
    global.releaseOutputTimer = null;
    BrowserWindow.getAllWindows()[0].webContents.send("terminal:closed", { sessionId: "missing-agent" });
  });
  await page.getByRole("button", { name: "Attach CLI", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Attached", exact: true }).count(), 0);
  console.log("PASS terminal:closed crosses the preload bridge and clears attached state");
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
