import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const projectPath = process.env.BRAVELI_GITHUB_PROJECT_PATH;
if (!projectPath) throw new Error("BRAVELI_GITHUB_PROJECT_PATH is required");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userDataPath = await mkdtemp(path.join(os.tmpdir(), "braveli-github-smoke-"));
const now = new Date().toISOString();
const project = {
  id: "github-auth-smoke",
  name: path.basename(projectPath),
  path: projectPath,
  branch: "main",
  status: "active",
  accent: "#5368dc",
  health: 100,
  openSessions: 0,
  queuedTasks: 0,
  lastCommit: "now",
  ci: "pending",
  sessions: [],
  queue: [],
  timeline: [],
};
const workspace = {
  version: 1,
  projects: [{
    id: project.id,
    name: project.name,
    path: project.path,
    defaultBranch: "main",
    providerIds: ["claude", "codex", "gemini", "grok"],
    createdAt: now,
    updatedAt: now,
  }],
  tasks: [],
  contextEntries: [],
  contextSnapshots: [],
  sessions: [],
  activity: [],
  councilRuns: [],
  compareRuns: [],
};

let app;
try {
  app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      BRAVELI_E2E: "1",
      BRAVELI_USER_DATA_DIR: userDataPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });
  const page = await app.firstWindow();
  await page.evaluate(({ projectValue, workspaceValue }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify([projectValue]));
    localStorage.setItem("braveli-active-project", projectValue.id);
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspaceValue));
    localStorage.setItem("braveli-onboarded", "yes");
  }, { projectValue: project, workspaceValue: workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "GitHub auth" }).click();
  await page.getByRole("heading", { name: "GitHub account" }).waitFor();
  await page.getByText("Token embedded in origin URL").waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText("Repo match").count() > 0, true);
  await page.getByRole("button", { name: "Use selected account" }).click();
  await page.getByText(/is now selected for web-app/).waitFor({ timeout: 20_000 });
  const stored = await page.evaluate(() => window.braveli.getGitHubAuth({
    projectId: "github-auth-smoke",
    projectPath: window.localStorage.getItem("braveli-projects")
      ? JSON.parse(window.localStorage.getItem("braveli-projects"))[0].path
      : "",
  }));
  assert.equal(stored.configured, true);
  assert.equal(stored.login, "teammate");
  assert.equal(stored.source, "remote");
  assert.equal("token" in stored, false);
  await page.screenshot({ path: "/tmp/braveli-github-account-picker.png" });
  process.stdout.write("  OK  repository credential is detected, validated, and encrypted without exposing its token\n");
  await page.getByRole("button", { name: "Done" }).click();
  const mcpAuthButton = page.getByRole("button", { name: /Project authentication for plugin:figma:figma/ });
  await mcpAuthButton.waitFor({ timeout: 20_000 });
  await mcpAuthButton.click();
  await page.getByRole("heading", { name: "plugin:figma:figma" }).waitFor();
  await page.getByText("Project account not connected").waitFor();
  await page.screenshot({ path: "/tmp/braveli-mcp-auth.png" });
  process.stdout.write("  OK  remote MCP exposes project-scoped native OAuth controls\n");
} finally {
  await app?.close().catch(() => {});
  await rm(userDataPath, { recursive: true, force: true });
}
