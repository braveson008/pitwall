import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-crash-recovery-"));
const userDataPath = path.join(tempRoot, "user-data");
const projectPath = path.join(tempRoot, "project");
const screenshotPath = path.join(tempRoot, "pitwall-restored-transcript.png");
const projectActionScreenshotPath = path.join(tempRoot, "pitwall-project-remove.png");
await mkdir(projectPath, { recursive: true });
await writeFile(path.join(projectPath, "README.md"), "# Recovery test\n");

const env = {
  ...process.env,
  PITWALL_E2E: "1",
  PITWALL_USER_DATA_DIR: userDataPath,
  ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
};

let firstApp;
let secondApp;
try {
  firstApp = await electron.launch({ args: [root], cwd: root, env, timeout: 30_000 });
  const firstPage = await firstApp.firstWindow({ timeout: 20_000 });
  await firstPage.waitForURL(/index\.html$/);
  await firstPage.waitForLoadState("domcontentloaded");
  await firstPage.evaluate(({ cwd, timestamp }) => {
    const sessions = ["recovery-a", "recovery-b"].map((id, index) => ({
      id,
      name: index === 0 ? "Restore prior conversation" : "Restore second session",
      agent: "Recovery Shell",
      status: "running",
      model: "auto",
      branch: "main",
      worktreePath: cwd,
      task: "Verify crash recovery",
      progress: 50,
      tokens: "0",
      approvals: 0,
      risk: "low",
      files: 0,
      started: "now",
      logs: [],
    }));
    const project = {
      id: "recovery-project",
      name: "Recovery Project",
      path: cwd,
      branch: "main",
      status: "active",
      accent: "#5368dc",
      health: 100,
      openSessions: sessions.length,
      queuedTasks: 0,
      lastCommit: "now",
      ci: "pending",
      sessions,
      queue: [],
      timeline: [],
    };
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([project]));
    localStorage.setItem("pitwall-active-project", project.id);
    localStorage.setItem("pitwall-selected-session", sessions[0].id);
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-custom-agents", JSON.stringify([{
      id: "recovery-shell",
      name: "Recovery Shell",
      command: "/bin/zsh",
      args: "-f",
      loginCommand: "",
      models: [],
      createdAt: timestamp,
    }]));
    localStorage.setItem("pitwall-workspace-state", JSON.stringify({
      version: 1,
      projects: [{
        id: project.id,
        name: project.name,
        path: cwd,
        defaultBranch: "main",
        providerIds: ["claude", "codex", "gemini", "grok", "kimi"],
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      tasks: [],
      contextEntries: [],
      contextSnapshots: [],
      sessions: sessions.map((session) => ({
        id: session.id,
        projectId: project.id,
        provider: "recovery-shell",
        type: "implementation",
        status: "running",
        model: "auto",
        worktreePath: cwd,
        messages: [],
        contextSnapshotId: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
      activity: [],
      councilRuns: [],
      compareRuns: [],
    }));
    localStorage.setItem("pitwall-terminal-history", JSON.stringify({
      version: 1,
      sessions: {
        "recovery-a": [
          "\u001b[36mUser:\u001b[0m retain this request\r\n",
          "Assistant: prior answer\r\n",
        ],
        "recovery-b": ["Second saved transcript\r\n"],
      },
    }));
  }, { cwd: projectPath, timestamp: new Date().toISOString() });
  await firstApp.evaluate(async ({ session }) => {
    await session.defaultSession.flushStorageData();
  });
  const started = await firstPage.evaluate(async (cwd) => {
    const terminals = await Promise.all(["recovery-a", "recovery-b"].map((sessionId) => window.pitwall.startTerminal({
      projectId: "recovery-project",
      projectPath: cwd,
      sessionId,
      sessionName: sessionId,
      agent: "Recovery Shell",
      model: "auto",
      command: "/bin/zsh",
      args: ["-f"],
      cols: 80,
      rows: 24,
    })));
    return { terminals };
  }, projectPath);
  assert.equal(started.terminals.every((item) => item.ok), true);

  const crashedProcess = firstApp.process();
  crashedProcess.kill("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  firstApp = null;

  secondApp = await electron.launch({ args: [root], cwd: root, env, timeout: 30_000 });
  const secondPage = await secondApp.firstWindow({ timeout: 20_000 });
  await secondPage.waitForURL(/index\.html$/);
  await secondPage.waitForLoadState("domcontentloaded");
  const recovery = await secondPage.evaluate(() => window.pitwall.getRuntimeRecovery());
  assert.equal(recovery.recovered, true);
  assert.deepEqual(recovery.terminals.map((item) => item.sessionId).sort(), ["recovery-a", "recovery-b"]);
  await secondPage.getByText("Saved sessions recovered", { exact: true }).waitFor({ timeout: 15_000 });
  const exploreButton = secondPage.getByRole("button", { name: "close", exact: true });
  if (await exploreButton.isVisible().catch(() => false)) await exploreButton.click();
  await secondPage.getByRole("button", { name: "Terminal", exact: true }).click();
  const activeTerminal = secondPage.locator(".dk-terminal.is-active");
  await activeTerminal.getByRole("button", { name: "Transcript", exact: true }).click();
  // The dialog is labelled by the session it belongs to now — "Saved
  // conversation · <session name>" — rather than by what it was once called, so
  // it is located by what it is rather than by a title that has since changed.
  const transcriptDialog = secondPage.getByRole("dialog").filter({ hasText: "Read-only" });
  await transcriptDialog.getByText("User: retain this request", { exact: false }).waitFor();
  await transcriptDialog.getByText("Assistant: prior answer", { exact: false }).waitFor();
  await secondPage.setViewportSize({ width: 900, height: 720 });
  const transcriptBounds = await transcriptDialog.boundingBox();
  assert.ok(transcriptBounds && transcriptBounds.x >= 0 && transcriptBounds.width <= 900);
  await secondPage.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Transcript screenshot: ${screenshotPath}`);
  await transcriptDialog.getByRole("button", { name: "Close transcript" }).click();

  // Removing a project lives in the sidebar's Project menu, offered for the project shown.
  const sidebar = secondPage.locator(".dk-tsb");
  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await sidebar.getByRole("option", { name: "Recovery Project", exact: true }).click();
  await sidebar.getByRole("button", { name: "Project", exact: true }).click();
  await sidebar.getByRole("option", { name: "Remove “Recovery Project” from Pitwall…" }).waitFor({ state: "visible" });
  await secondPage.screenshot({ path: projectActionScreenshotPath, fullPage: false });
  console.log(`  Project action screenshot: ${projectActionScreenshotPath}`);
  await secondPage.evaluate(() => window.pitwall.acknowledgeRuntimeRecovery({ sessionIds: ["recovery-a", "recovery-b"] }));
  console.log("  OK  hard-crash recovery relaunches CLIs and exposes the saved transcript");
} finally {
  if (firstApp) await firstApp.close().catch(() => undefined);
  if (secondApp) await secondApp.close().catch(() => undefined);
  if (process.env.PITWALL_KEEP_SMOKE_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
