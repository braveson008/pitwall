import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";
import { goTo } from "./helpers/goTo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braveli-electron-smoke-"));
const projectPath = path.join(tempRoot, "sample-project");
const userDataPath = path.join(tempRoot, "user-data");
const screenshotPath = path.join(tempRoot, "braveli-smoke.png");
const notificationScreenshotPath = path.join(tempRoot, "braveli-project-notification.png");
const connectionsScreenshotPath = path.join(tempRoot, "braveli-connections-responsive.png");
const overviewScreenshotPath = path.join(tempRoot, "braveli-project-overview.png");
const tasksScreenshotPath = path.join(tempRoot, "braveli-task-board.png");
const taskDetailScreenshotPath = path.join(tempRoot, "braveli-task-detail.png");
const bulkTaskScreenshotPath = path.join(tempRoot, "braveli-bulk-task-start.png");
const longTaskSessionScreenshotPath = path.join(tempRoot, "braveli-long-task-session.png");
const mcpImportScreenshotPath = path.join(tempRoot, "braveli-mcp-task-import.png");
const reviewScreenshotPath = path.join(tempRoot, "braveli-review-gate.png");
const connectionsPageScreenshotPath = path.join(tempRoot, "braveli-connections-page.png");
const temporaryImagePath = path.join(tempRoot, "ephemeral-source", "NSIRD-test", "Dragged screenshot.png");
const smokeAgentPath = path.join(tempRoot, "smoke-agent.zsh");
const completionPreviewUrl = "http://127.0.0.1:8090/smoke-427";

function log(step) {
  process.stdout.write(`  OK  ${step}\n`);
}

/**
 * Open the "define a task" form.
 *
 * Prefer the task-centric project navigation. The overflow menu remains as a
 * compatibility route for older builds, so the helper can exercise both.
 */
async function openProjectTool(page, name) {
  const sectionName = name === "Shared context" || name === "Context" ? "Memory" : name;

  // Agents are not a project's property, so their screen moved out of the
  // project rail and into the app rail above it.
  if (sectionName === "Connections" || sectionName === "Agents") {
    await page.locator(".dk-statusbar").getByRole("button", { name: "Settings", exact: true }).click();
    return;
  }
  // Extensions are app-wide now, beside Settings at the foot of the sidebar.
  if (sectionName === "Extensions") {
    await page.locator(".dk-statusbar").getByRole("button", { name: "Extensions", exact: true }).click();
    return;
  }

  await goTo(page, sectionName);
}

async function openTaskForm(page) {
  await openProjectTool(page, "Tasks");
  await page.getByRole("button", { name: "New task", exact: true }).click();
}

async function waitFor(predicate, timeoutMs = 10_000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

await mkdir(projectPath, { recursive: true });
await mkdir(userDataPath, { recursive: true });
await mkdir(path.dirname(temporaryImagePath), { recursive: true });
await writeFile(temporaryImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
await writeFile(
  smokeAgentPath,
  // One process reads the PTY for the whole session. This used to hand over
  // with `exec /bin/zsh -f`, and an interactive shell brings a terminal
  // handover with it: it takes the foreground process group and discards
  // whatever was typed ahead of its first prompt. Commands the test sent
  // across that window were dropped, so the session never exited and the
  // wait for its completion summary timed out — in about one run in three.
  "#!/bin/zsh\nprint -r -- \"RUNTIME:${BRAVELI_PREVIEW_PORT}:${BRAVELI_MOBILE_DEVICE_NAME}\"\nprint -r -- 'Smoke Shell ready'\nIFS= read -r first_prompt\nprint -r -- \"RECEIVED:${first_prompt}\"\nwhile IFS= read -r line; do\n  eval \"$line\"\ndone\n",
);
await chmod(smokeAgentPath, 0o755);
await writeFile(
  path.join(projectPath, "package.json"),
  `${JSON.stringify({ name: "braveli-smoke-project", version: "1.0.0", private: true }, null, 2)}\n`,
);
await writeFile(path.join(projectPath, "README.md"), "# Smoke project\n");
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
execFileSync("git", ["config", "user.email", "braveli-smoke@example.invalid"], { cwd: projectPath });
execFileSync("git", ["config", "user.name", "Pitwall Smoke Test"], { cwd: projectPath });
execFileSync("git", ["add", "."], { cwd: projectPath });
execFileSync("git", ["commit", "-qm", "Initial smoke project"], { cwd: projectPath });

const now = new Date().toISOString();
const project = {
  id: "smoke-project",
  name: "Pitwall Smoke Project",
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
const backgroundProject = {
  ...project,
  id: "background-project",
  name: "Background Project",
  status: "idle",
  accent: "#2ea96f",
};
const legacyWorkspace = {
  version: 1,
  projects: [project, backgroundProject].map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    defaultBranch: "main",
    providerIds: ["claude", "codex", "gemini", "grok", "kimi"],
    createdAt: now,
    updatedAt: now,
  })),
  tasks: [],
  contextEntries: [],
  contextSnapshots: [],
  sessions: [],
  activity: [],
  councilRuns: [],
  compareRuns: [],
};
const customAgent = {
  id: "smoke-shell",
  name: "Smoke Shell",
  command: smokeAgentPath,
  args: "",
  loginCommand: "",
  models: [],
  createdAt: now,
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
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  log("isolated Electron window launch");
  const rendererErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      rendererErrors.push(message.text());
      process.stderr.write(`  renderer: ${message.text()}\n`);
    }
  });
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  log("production renderer load");

  await page.evaluate(
    ({ projectValue, backgroundProjectValue, workspaceValue, customAgentValue }) => {
      localStorage.clear();
      localStorage.setItem("agent-studio-projects", JSON.stringify([projectValue, backgroundProjectValue]));
      localStorage.setItem("agent-studio-active-project", projectValue.id);
      localStorage.setItem("bravely-workspace-state", JSON.stringify(workspaceValue));
      localStorage.setItem("bravely-custom-agents", JSON.stringify([customAgentValue]));
      localStorage.setItem("bravely-onboarded", "yes");
      localStorage.setItem("braveli-terminal-font-family", '"Intel One Mono", monospace');
      localStorage.setItem("braveli-terminal-webgl", "yes");
      localStorage.setItem("braveli-terminal-unicode11", "yes");
    },
    {
      projectValue: project,
      backgroundProjectValue: backgroundProject,
      workspaceValue: legacyWorkspace,
      customAgentValue: customAgent,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  log("legacy profile fixture reload");
  const rendererState = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 500) }));
  assert.match(rendererState.url, /index\.html/);
  await page.locator(".dk-tsb").waitFor({ timeout: 15_000 });

  const identity = await page.evaluate(() => ({
    title: document.title,
    hasBraveli: Boolean(window.braveli),
    hasLegacyBridge: "agentStudio" in window,
    projectKey: localStorage.getItem("braveli-projects"),
    workspaceKey: localStorage.getItem("braveli-workspace-state"),
    customAgentsKey: localStorage.getItem("braveli-custom-agents"),
    oldProjectKey: localStorage.getItem("agent-studio-projects"),
    oldWorkspaceKey: localStorage.getItem("bravely-workspace-state"),
    terminalFontFamily: localStorage.getItem("braveli-terminal-font-family"),
    terminalWebgl: localStorage.getItem("braveli-terminal-webgl"),
    terminalUnicode11: localStorage.getItem("braveli-terminal-unicode11"),
  }));
  assert.equal(identity.hasBraveli, true);
  assert.equal(identity.hasLegacyBridge, false);
  assert.match(identity.projectKey ?? "", /Pitwall Smoke Project/);
  assert.match(identity.workspaceKey ?? "", /smoke-project/);
  assert.match(identity.customAgentsKey ?? "", /Smoke Shell/);
  assert.equal(identity.oldProjectKey, null);
  assert.equal(identity.oldWorkspaceKey, null);
  // The old default is not a choice: it moves once to Zed's Lilex.
  assert.equal(identity.terminalFontFamily, "Lilex, monospace");
  assert.equal(identity.terminalWebgl, null);
  assert.equal(identity.terminalUnicode11, null);
  log("Pitwall identity, storage, and safe terminal renderer migration");

  const attachment = await page.evaluate(
    (sourcePath) => window.braveli.stageTerminalImages({
      sessionId: "smoke-image-session",
      paths: [sourcePath],
    }),
    temporaryImagePath,
  );
  assert.equal(attachment.ok, true, attachment.error);
  assert.equal(attachment.paths.length, 1);
  await rm(temporaryImagePath, { force: true });
  assert.deepEqual(await readFile(attachment.paths[0]), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const clipboardAttachment = await page.evaluate(() => window.braveli.stageTerminalImageData({
    sessionId: "smoke-image-session",
    images: [{
      name: "clipboard-capture",
      type: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }],
  }));
  assert.equal(clipboardAttachment.ok, true, clipboardAttachment.error);
  assert.match(clipboardAttachment.paths[0], /clipboard-capture\.png$/);
  log("temporary and clipboard images persist in per-session attachment storage");

  const providerStatus = await page.evaluate(async () => {
    const providers = await window.braveli.listProviders({ refresh: false });
    const checks = await Promise.all(["Claude", "Codex", "Gemini", "Grok", "Kimi"].map((name) => window.braveli.checkAgent(name)));
    return { providers, checks };
  });
  assert.equal(providerStatus.providers.ok, true);
  assert.equal(providerStatus.providers.providers.length >= 5, true);
  assert.equal(providerStatus.checks.find((item) => item.agent === "Claude")?.installed, true);
  assert.equal(providerStatus.checks.find((item) => item.agent === "Codex")?.installed, true);
  // Whatever this machine has: the check must agree with the shell, and a
  // CLI someone installed since this test was written is not a regression.
  for (const [agent, command] of [["Gemini", "gemini"], ["Grok", "grok"], ["Kimi", "kimi"]]) {
    let onPath = false;
    try { execFileSync("/bin/zsh", ["-lc", `command -v ${command}`], { stdio: "ignore" }); onPath = true; } catch { onPath = false; }
    assert.equal(providerStatus.checks.find((item) => item.agent === agent)?.installed, onPath, `${agent} installed should match the shell`);
  }
  assert.equal(providerStatus.checks.find((item) => item.agent === "Claude")?.completionMode, "native");
  log("dynamic provider registry and installed/missing CLI paths");

  const nativeClaudeSessionId = "33333333-3333-4333-8333-333333333333";
  const nativeClaudeLaunch = await page.evaluate(async ({ rootPath, nativeSessionId }) => {
    let output = "";
    let finish;
    const completed = new Promise((resolve) => {
      finish = resolve;
    });
    const unsubscribe = window.braveli.onTerminalData(({ sessionId, data }) => {
      if (sessionId !== "native-claude-probe") return;
      output += data;
      if (output.includes(nativeSessionId)) finish();
    });
    const started = await window.braveli.startTerminal({
      projectId: "smoke-project",
      projectPath: rootPath,
      sessionId: "native-claude-probe",
      sessionName: "Native Claude probe",
      agent: "Claude",
      model: "auto",
      command: "/bin/echo",
      args: ["native-session-probe"],
      nativeSessionId,
      resumeSession: true,
      cols: 80,
      rows: 24,
    });
    await Promise.race([completed, new Promise((resolve) => setTimeout(resolve, 3000))]);
    unsubscribe();
    return { started, output };
  }, { rootPath: projectPath, nativeSessionId: nativeClaudeSessionId });
  assert.equal(nativeClaudeLaunch.started.ok, true);
  assert.equal(nativeClaudeLaunch.started.nativeSessionId, nativeClaudeSessionId);
  assert.equal(nativeClaudeLaunch.started.nativeSessionMode, "resume");
  assert.match(nativeClaudeLaunch.output, new RegExp(`--resume\\s+${nativeClaudeSessionId}`));
  log("Claude terminal launch restores the provider-native conversation id");

  // Connections left the title bar for the command palette.
  await page.locator(".dk-tsb-titlebar").getByRole("button", { name: /^Search/ }).click();
  await page.locator(".dk-palette-row", { hasText: /^Connections/ }).click();
  const connectionsDialog = page.getByRole("dialog", { name: /Pitwall Smoke Project/i });
  await connectionsDialog.waitFor({ state: "visible" });
  await connectionsDialog.getByText("Kimi", { exact: true }).waitFor();
  await page.setViewportSize({ width: 900, height: 720 });
  const responsiveMetrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    dialogRight: document.querySelector('[role="dialog"][aria-labelledby="connections-title"]')?.getBoundingClientRect().right ?? 0,
  }));
  assert.ok(responsiveMetrics.bodyWidth <= responsiveMetrics.viewport, "responsive shell must not force horizontal page overflow");
  assert.ok(responsiveMetrics.dialogRight <= responsiveMetrics.viewport, "connections dialog must remain in the viewport");
  await page.waitForTimeout(180);
  await page.screenshot({ path: connectionsScreenshotPath, fullPage: false });
  console.log(`  Connections screenshot: ${connectionsScreenshotPath}`);
  await connectionsDialog.getByRole("button", { name: "Close connections" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  log("connection diagnostics and compact viewport remain usable");

  const backgroundNotification = await page.evaluate(async ({ rootPath }) => {
    window.__braveliToneCount = 0;
    const originalCreateOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) {
      window.__braveliToneCount += 1;
      return originalCreateOscillator.apply(this, args);
    };
    const started = await window.braveli.startTerminal({
      projectId: "background-project",
      projectPath: rootPath,
      sessionId: "background-notification-session",
      sessionName: "Background review",
      agent: "Smoke Shell",
      model: "auto",
      command: "/bin/zsh",
      args: ["-f"],
      cols: 80,
      rows: 24,
    });
    if (started.ok) {
      await window.braveli.writeTerminal({
        sessionId: "background-notification-session",
        data: "exit\r",
      });
    }
    return started;
  }, { rootPath: projectPath });
  assert.equal(backgroundNotification.ok, true, backgroundNotification.error);
  // Finished-in-the-background work is counted beside the project in the Project menu.
  const projectMenu = page.locator(".dk-tsb").getByRole("button", { name: "Project", exact: true });
  const backgroundOption = page.locator(".dk-tsb").getByRole("option", { name: /^Background Project/ });
  await waitFor(async () => {
    await projectMenu.click();
    const text = await backgroundOption.innerText().catch(() => "");
    await page.keyboard.press("Escape");
    return /1 new/.test(text);
  });
  await waitFor(() => page.evaluate(() => window.__braveliToneCount >= 2));
  const persistedNotification = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("braveli-project-notifications") || "{}")["background-project"],
  );
  assert.equal(persistedNotification.sessionName, "Background review");
  assert.equal(persistedNotification.count, 1);
  await page.screenshot({ path: notificationScreenshotPath, fullPage: false });
  console.log(`  Notification screenshot: ${notificationScreenshotPath}`);
  log("background agent completion shows a persisted badge and plays the completion tone");

  await openProject(page, /^Background Project/);
  await projectMenu.click();
  assert.doesNotMatch(await backgroundOption.innerText(), /new/, "opening the project clears its count");
  await page.keyboard.press("Escape");
  await openProject(page, new RegExp(`^${project.name}`));
  log("opening the notified project clears its unread badge");

  const fileResult = await page.evaluate(async (rootPath) => {
    const files = await window.braveli.listProjectFiles(rootPath);
    const read = await window.braveli.readProjectFile({ projectPath: rootPath, filePath: "README.md" });
    const write = await window.braveli.writeProjectFile({
      projectPath: rootPath,
      filePath: "src/smoke.ts",
      content: "export const smoke = true;\n",
    });
    const git = await window.braveli.getGitStatus(rootPath);
    const diff = await window.braveli.getGitDiff({ projectPath: rootPath, filePath: "src/smoke.ts" });
    return { files, read, write, git, diff };
  }, projectPath);
  assert.equal(fileResult.files.ok, true);
  assert.equal(fileResult.files.files.includes("README.md"), true);
  assert.equal(fileResult.read.content, "# Smoke project\n");
  assert.equal(fileResult.write.ok, true);
  assert.equal(fileResult.git.ok, true);
  assert.equal(fileResult.git.changes.some((change) => change.path === "src/smoke.ts"), true);
  assert.match(await readFile(path.join(projectPath, "src/smoke.ts"), "utf8"), /smoke = true/);
  log("project filesystem and live Git status/diff bridge");

  const worktreeResult = await page.evaluate(async (rootPath) => {
    const [alpha, beta] = await Promise.all([
      window.braveli.ensureWorktree({ projectPath: rootPath, branch: "smoke/alpha", baseBranch: "main" }),
      window.braveli.ensureWorktree({ projectPath: rootPath, branch: "smoke/beta", baseBranch: "main" }),
    ]);
    if (!alpha.ok || !beta.ok) return { alpha, beta, listed: null };
    await Promise.all([
      window.braveli.writeProjectFile({ projectPath: alpha.path, filePath: "alpha.txt", content: "alpha\n" }),
      window.braveli.writeProjectFile({ projectPath: beta.path, filePath: "beta.txt", content: "beta\n" }),
    ]);
    const [alphaStatus, betaStatus, listed] = await Promise.all([
      window.braveli.getGitStatus(alpha.path),
      window.braveli.getGitStatus(beta.path),
      window.braveli.listWorktrees(rootPath),
    ]);
    return { alpha, beta, alphaStatus, betaStatus, listed };
  }, projectPath);
  assert.equal(worktreeResult.alpha.ok, true, worktreeResult.alpha.error);
  assert.equal(worktreeResult.beta.ok, true, worktreeResult.beta.error);
  assert.notEqual(worktreeResult.alpha.path, worktreeResult.beta.path);
  assert.equal(worktreeResult.alphaStatus.changes.some((item) => item.path === "alpha.txt"), true);
  assert.equal(worktreeResult.betaStatus.changes.some((item) => item.path === "beta.txt"), true);
  assert.equal(worktreeResult.listed.worktrees.filter((item) => item.branch.startsWith("smoke/")).length, 2);
  log("two isolated Git worktrees created and inspected concurrently");

  const ptyOutputs = await page.evaluate(async ({ alphaPath, betaPath }) => {
    const sessions = [
      { id: "electron-smoke-pty-alpha", path: alphaPath, marker: "BRAVELI_ALPHA_OK", pathMarker: "smoke-alpha" },
      { id: "electron-smoke-pty-beta", path: betaPath, marker: "BRAVELI_BETA_OK", pathMarker: "smoke-beta" },
    ];
    const outputs = Object.fromEntries(sessions.map((session) => [session.id, ""]));
    return await new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Concurrent PTY timeout: ${JSON.stringify(outputs)}`));
      }, 10_000);
      const unsubscribe = window.braveli.onTerminalData((payload) => {
        if (!(payload.sessionId in outputs)) return;
        outputs[payload.sessionId] += payload.data;
        if (!sessions.every((session) =>
          outputs[session.id].includes(session.marker) && outputs[session.id].includes(session.pathMarker))) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(outputs);
      });
      const starts = [];
      for (const session of sessions) {
        starts.push(await window.braveli.startTerminal({
          projectId: "smoke-project",
          projectPath: session.path,
          sessionId: session.id,
          sessionName: session.id,
          agent: "Smoke Shell",
          model: "auto",
          command: "/bin/zsh",
          args: ["-f"],
          cols: 100,
          rows: 30,
        }));
      }
      if (starts.some((result) => !result.ok)) {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error(`PTY failed: ${JSON.stringify(starts)}`));
        return;
      }
      await Promise.all(sessions.map((session) => window.braveli.writeTerminal({
        sessionId: session.id,
        data: `printf '${session.marker}:%s\\n' \"$PWD\"\r`,
      })));
    }).finally(() => Promise.all(sessions.map((session) => window.braveli.runSessionAction({
      projectId: "smoke-project",
      sessionId: session.id,
      action: "stop",
    }))));
  }, { alphaPath: worktreeResult.alpha.path, betaPath: worktreeResult.beta.path });
  assert.match(ptyOutputs["electron-smoke-pty-alpha"], /BRAVELI_ALPHA_OK/);
  assert.match(ptyOutputs["electron-smoke-pty-beta"], /BRAVELI_BETA_OK/);
  assert.match(ptyOutputs["electron-smoke-pty-alpha"], /smoke-alpha/);
  assert.match(ptyOutputs["electron-smoke-pty-beta"], /smoke-beta/);
  log("two real node-pty agent sessions remain isolated under concurrent load");

  // Pitwall no longer ships an editor. What has to work is finding the ones the
  // user already has and handing a project to one — the detection is what the
  // Editor tab is built on, and it is the part that can silently find nothing.
  const editors = await page.evaluate(() => window.braveli.listEditors());
  assert.equal(editors.ok, true);
  assert.ok(Array.isArray(editors.editors), "listEditors must always answer with a list");
  for (const editor of editors.editors) {
    assert.ok(editor.id && editor.name, `editor entry is incomplete: ${JSON.stringify(editor)}`);
  }
  // Opening is only asserted where an editor actually exists: a CI box with none
  // installed should not fail this, and the reveal fallback is still a success.
  const opened = await page.evaluate(
    (rootPath) => window.braveli.openInEditor({ projectPath: rootPath }),
    projectPath,
  );
  assert.equal(opened.ok, true, opened.error);
  assert.equal(
    Boolean(opened.editor) || opened.revealed === true,
    true,
    "opening must either name the editor it used or say it revealed the folder",
  );
  log(`external editor detection (${editors.editors.length} found) and project open`);

  await openTaskForm(page);
  const taskDialog = page.getByRole("dialog", { name: "New task" });
  await taskDialog.getByRole("textbox", { name: /Task ID/ }).fill("smoke-427");
  await taskDialog.getByRole("textbox", { name: "Title" }).fill("Verify Pitwall workflow");
  await taskDialog.locator("textarea").fill("Exercise task, context, snapshot, and session persistence.");
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await page.locator(".dk-page").getByText("Verify Pitwall workflow", { exact: true }).first().waitFor();
  // The task list moved inside the Tasks door, so the identifier is checked
  // where it now renders rather than in the rail it used to sit in.
  await openProjectTool(page, "Tasks");
  await page.locator(".dk-page").getByText(/smoke-427/).first().waitFor();
  const smokeTaskCard = page.locator(".dk-board-card", { hasText: "Verify Pitwall workflow" });
  await smokeTaskCard.click();
  const taskDetailDialog = page.getByRole("dialog", { name: "Verify Pitwall workflow" });
  await taskDetailDialog.getByText("Exercise task, context, snapshot, and session persistence.", { exact: true }).waitFor();
  await page.waitForTimeout(180);
  await page.screenshot({ path: taskDetailScreenshotPath, fullPage: false });
  console.log(`  Task detail screenshot: ${taskDetailScreenshotPath}`);
  await taskDetailDialog.getByRole("button", { name: "Close", exact: true }).click();
  log("task card opens the complete task description");

  // Cmd-click picks a card out — the board has no per-card checkbox now, so
  // this is the path to starting more than one task at once.
  await smokeTaskCard.click({ modifiers: ["Meta"] });
  await page.getByRole("button", { name: "Start 1", exact: true }).click();
  const bulkStartDialog = page.getByRole("dialog", { name: "Start 1 task session" });
  await bulkStartDialog.getByText(/one isolated session and task worktree/i).waitFor();
  await page.waitForTimeout(180);
  await page.screenshot({ path: bulkTaskScreenshotPath, fullPage: false });
  console.log(`  Bulk task screenshot: ${bulkTaskScreenshotPath}`);
  await bulkStartDialog.getByRole("button", { name: "Cancel" }).click();
  log("selected tasks open the one-session-per-task launch flow");

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Import from tracker" });
  await importDialog.waitFor({ state: "visible" });
  await importDialog.getByText(/connected|source/i).first().waitFor();
  const claudeMcp = await page.evaluate(
    ({ projectId, projectPath }) => window.braveli.listMcpServers({ provider: "claude", projectId, projectPath }),
    { projectId: project.id, projectPath: project.path },
  );
  const linearSource = claudeMcp.servers.find((server) => /linear/i.test(server.name));
  if (linearSource) {
    const linearOption = importDialog.locator("select option").filter({ hasText: /linear/i }).first();
    const linearValue = await linearOption.getAttribute("value");
    assert.ok(linearValue, "configured Linear option must have a provider-qualified value");
    await importDialog.locator("select").selectOption(linearValue);
    assert.ok(
      (await importDialog.locator("select option").allTextContents()).some((label) => /linear/i.test(label)),
      "configured Linear must remain visible in the import source list",
    );
    if (linearSource.status !== "connected") {
      assert.equal(await importDialog.getByRole("button", { name: "Find tasks" }).isDisabled(), true);
      await importDialog.getByRole("button", { name: /^(Authenticate|Connect|Open connections)$/ }).waitFor();
    }
  }
  await page.screenshot({ path: mcpImportScreenshotPath, fullPage: false });
  console.log(`  MCP import screenshot: ${mcpImportScreenshotPath}`);
  const importClose = importDialog.getByRole("button", { name: "Close" });
  const importCloseBox = await importClose.boundingBox();
  assert.ok(importCloseBox && importCloseBox.width <= 36 && importCloseBox.height <= 36, "MCP import close button must remain compact");
  await importClose.click();
  log("MCP task import opens a project-scoped preview with a compact close control");
  await goTo(page, "Work");
  log("create project task through the UI");

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const taskStartDialog = page
    .getByRole("heading", { name: "Choose one destination" })
    .locator("..")
    .locator("..")
    .locator("..");
  await taskStartDialog.getByText("Council pipeline", { exact: true }).waitFor();
  await taskStartDialog.getByText("New session", { exact: true }).waitFor();
  await taskStartDialog.getByRole("button", { name: "Close" }).click();
  log("task start requires one explicit destination");

  await openProjectTool(page, "Shared context");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const contextDialog = page.getByRole("dialog", { name: "New note" });
  await contextDialog.locator("input").first().fill("Smoke constraint");
  await contextDialog.locator("textarea").fill("Keep the smoke change local to the temporary project.");
  await contextDialog.getByRole("button", { name: "Add note" }).click();
  // Same as the task list: entries render inside their door, not in the rail.
  await openProjectTool(page, "Shared context");
  await page.getByText("Smoke constraint", { exact: true }).first().waitFor();
  await goTo(page, "Work");
  log("create distinct shared context through the UI");

  await page.evaluate(() => {
    window.__braveliTaskPromptOutput = "";
    window.__braveliTaskPromptUnsubscribe = window.braveli.onTerminalData(({ data }) => {
      window.__braveliTaskPromptOutput += data;
    });
  });
  // New work lives in the sidebar; "Start" is the dialog's confirm.
  await page.locator(".dk-tsb-titlebar").getByRole("button", { name: "New work" }).click();
  await page.getByRole("heading", { name: "New work" }).waitFor();
  // The agent is one of the choices under the prompt now, opened in place.
  await page.getByRole("dialog", { name: "New work" }).getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("option", { name: /Smoke Shell/ }).click();
  await page.getByRole("button", { name: "Start", exact: true }).last().click();
  await page.getByText(/Verify Pitwall workflow · Implementer/).first().waitFor({ timeout: 15_000 });
  // Every part has to be present before this returns: the predicate used to
  // hand back an object literal, which is truthy even when half of it is
  // undefined, so waitFor returned on the first poll and the assertions below
  // raced the persistence effect rather than waiting for it.
  const persisted = await waitFor(async () => {
    const state = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return {
        task: stored.tasks?.find((item) => item.title === "Verify Pitwall workflow"),
        context: stored.contextEntries?.find((item) => item.title === "Smoke constraint"),
        session: stored.sessions?.find((item) => item.provider === "smoke-shell"),
        snapshot: stored.contextSnapshots?.find((item) =>
          item.contextEntries?.some((entry) => entry.title === "Smoke constraint"),
        ),
      };
    });
    return state.task && state.context && state.session && state.snapshot ? state : null;
  }, 15_000);
  assert.ok(persisted.task);
  assert.equal(persisted.task.identifier, "smoke-427");
  assert.equal(persisted.task.worktree, "smoke-427");
  assert.ok(persisted.context);
  assert.ok(persisted.session);
  assert.ok(persisted.session.worktreePath);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: persisted.session.worktreePath, encoding: "utf8" }).trim(), "smoke-427");
  assert.ok(persisted.snapshot);
  const taskPromptOutput = await waitFor(() => page.evaluate(() => {
    const output = window.__braveliTaskPromptOutput;
    return output.includes("Work on task smoke-427.") &&
      output.includes('"title":"Verify Pitwall workflow"') &&
      output.includes('"description":"Exercise task, context, snapshot, and session persistence."') &&
      output.includes("owns local preview port") &&
      /RUNTIME:\d+:Pitwall smoke-427/.test(output)
      ? output
      : null;
  }), 15_000);
  const environmentPort = taskPromptOutput.match(/RUNTIME:(\d+):/)?.[1];
  const instructedPort = taskPromptOutput.match(/owns local preview port (\d+)/)?.[1];
  assert.equal(instructedPort, environmentPort);
  const startedTaskStatus = await waitFor(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
    const status = state.tasks?.find((task) => task.identifier === "smoke-427")?.status;
    return status === "running" ? status : null;
  }));
  assert.equal(startedTaskStatus, "running");
  log("task title and description reach the PTY before Pitwall records the session as started");

  // The smoke agent consumes the task prompt with `read`, prints RECEIVED, and
  // only then execs the interactive shell that runs the command below. Sending
  // it before that handover feeds it to the `read` instead, which swallows it
  // and leaves a session that never exits. RECEIVED is the agent saying the
  // read is done, so it is the signal to wait for.
  await waitFor(() => page.evaluate(() => window.__braveliTaskPromptOutput.includes("RECEIVED:")), 20_000);
  await page.evaluate(() => window.__braveliTaskPromptUnsubscribe?.());

  const exitWrite = await page.evaluate(({ sessionId, previewUrl }) => window.braveli.writeTerminal({
    sessionId,
    data: `print -r -- 'BRAVELI_DEV_PREVIEW ${previewUrl}'; print -r -- 'BRAVELI_TASK_SUMMARY {"what":"Verified the complete task workflow","how":"Exercised the isolated task session and persistence path","components":["src/workflow.ts"]}'; exit\r`,
  }), { sessionId: persisted.session.id, previewUrl: completionPreviewUrl });
  assert.equal(exitWrite.ok, true, "the session's terminal must accept the completion command");
  const capturedSummary = await waitFor(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
    return state.tasks?.find((task) => task.identifier === "smoke-427")?.completionSummary || null;
  }), 15_000);
  assert.equal(capturedSummary.what, "Verified the complete task workflow");
  assert.equal(capturedSummary.how, "Exercised the isolated task session and persistence path");
  assert.ok(capturedSummary.components.includes("src/workflow.ts"));
  log("agent completion stores a structured what/how/components handoff");
  const capturedPreview = await waitFor(() => page.evaluate(({ projectId, taskId }) => {
    const previews = JSON.parse(localStorage.getItem("braveli-preview-urls") || "{}");
    return previews[projectId]?.[taskId]?.url || null;
  }, { projectId: project.id, taskId: persisted.task.id }), 15_000);
  assert.equal(capturedPreview, completionPreviewUrl);
  log("agent completion opens and associates its task development preview");

  // An agent finishing moves the task on by itself now, so there is no
  // "Send to Review" left to press — the task is already there. Asserting the
  // status rather than clicking is the point: the button reappearing would mean
  // the auto-advance had stopped working.
  await waitFor(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
    return state.tasks?.find((task) => task.identifier === "smoke-427")?.status === "review" || null;
  }), 15_000);
  log("an agent finishing moves its task to Review without being asked");
  // The task moves itself; the operator still has to go and look at it.
  await openProjectTool(page, "Review");
  await page.getByRole("heading", { name: "Finished by agents, waiting on you" }).waitFor();
  // Review is a list of rows now, and the evidence lives in a row's detail
  // rather than on every card at once.
  // A row opens its detail beside the list.
  await page.locator(".dk-review-item").filter({ hasText: "Verify Pitwall workflow" }).first().click();
  await page.locator(".dk-review-detail").waitFor();
  await page.locator(".dk-review-summary").getByText(/Verified the complete task workflow/).waitFor();
  await page.getByRole("button", { name: "Task details", exact: true }).click();
  const completionDialog = page.getByRole("dialog", { name: "Verify Pitwall workflow" });
  await completionDialog.getByRole("heading", { name: "Completion summary" }).waitFor();
  await completionDialog.getByText("Exercised the isolated task session and persistence path", { exact: true }).waitFor();
  await completionDialog.getByText("src/workflow.ts", { exact: true }).waitFor();
  await completionDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(260);
  await page.screenshot({ path: reviewScreenshotPath, fullPage: false });
  console.log(`  Review gate screenshot: ${reviewScreenshotPath}`);
  log("task advances into the evidence review gate");

  await goTo(page, "Overview");
  await page.locator(".dk-overview").waitFor();
  await page.waitForTimeout(260);
  await page.screenshot({ path: overviewScreenshotPath, fullPage: false });
  console.log(`  Overview screenshot: ${overviewScreenshotPath}`);
  await goTo(page, "Tasks");
  await page.locator(".dk-board").waitFor();
  await page.waitForTimeout(260);
  await page.screenshot({ path: tasksScreenshotPath, fullPage: false });
  console.log(`  Task board screenshot: ${tasksScreenshotPath}`);
  await openProjectTool(page, "Connections");
  await page.getByRole("region", { name: "Agents and connections" }).waitFor();
  await page.waitForTimeout(260);
  await page.screenshot({ path: connectionsPageScreenshotPath, fullPage: false });
  console.log(`  Connections page screenshot: ${connectionsPageScreenshotPath}`);
  await openProjectTool(page, "Work");

  await page.getByRole("button", { name: /^terminal$/i }).click();
  // The pane no longer carries a title of its own: the run header above says
  // what this is, and the agent is named on its facts line.
  await page.locator(".dk-terminal.is-active").waitFor();
  await page.getByRole("button", { name: "Terminal typography settings" }).click();
  await page.getByRole("slider", { name: "Terminal font size" }).fill("10");
  await page.getByRole("button", { name: "Terminal font family" }).click();
  await page.getByRole("option", { name: "JetBrains Mono" }).click();
  const terminalTypography = await page.evaluate(() => ({
    size: localStorage.getItem("braveli-terminal-font-size"),
    family: localStorage.getItem("braveli-terminal-font-family"),
  }));
  assert.equal(terminalTypography.size, "10");
  assert.equal(terminalTypography.family, '"JetBrains Mono", monospace');
  const terminalRendering = await page.locator(".dk-xterm").evaluate(async (host) => {
    await document.fonts.ready;
    const screen = host.querySelector(".xterm-screen");
    return {
      fontReady: document.fonts.check('400 10px "JetBrains Mono"'),
      inlineWidth: Number.parseFloat(screen?.style.width || "0"),
      renderedWidth: screen?.getBoundingClientRect().width || 0,
      unsafeRendererControls: Array.from(document.querySelectorAll('[role="dialog"][aria-label="Terminal typography"] label'))
        .some((label) => /GPU rendering|Unicode 11 widths/.test(label.textContent || "")),
    };
  });
  assert.equal(terminalRendering.fontReady, true, "the bundled terminal font must be loaded");
  assert.ok(terminalRendering.inlineWidth > 0, "xterm must own an explicit measured screen width");
  assert.ok(
    Math.abs(terminalRendering.inlineWidth - terminalRendering.renderedWidth) < 1,
    "application CSS must not stretch xterm away from its measured cell grid",
  );
  assert.equal(terminalRendering.unsafeRendererControls, false);
  log("terminal typography uses the bundled font and preserves xterm's measured cell grid");
  await page.locator(".dk-xterm").evaluate((terminal) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "pasted-terminal-capture.png",
      { type: "image/png" },
    ));
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    terminal.dispatchEvent(paste);
  });
  await page.getByRole("status").filter({ hasText: "1 image ready" }).waitFor();
  await page.evaluate(
    ({ sessionId }) => window.braveli.writeTerminal({ sessionId, data: "\u0015" }),
    { sessionId: persisted.session.id },
  );
  log("pasting an image into the xterm surface stages it for the active session");
  await page.getByRole("button", { name: /^editor$/i }).click();
  await page.getByRole("button", { name: /^terminal$/i }).click();
  // The pane no longer carries a title of its own: the run header above says
  // what this is, and the agent is named on its facts line.
  await page.locator(".dk-terminal.is-active").waitFor();
  log("terminal/editor navigation preserves the mounted session surface");

  // There is no preview pane any more: URLs are clickable in the terminal that
  // printed them, and the project's known server is one chip in the session
  // header. What still belongs to Pitwall is the boundary that decides what may
  // be handed to the OS, so that is what is asserted here.
  const refused = await page.evaluate(() => window.braveli.openExternalUrl("file:///etc/passwd"));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /HTTP, HTTPS, and Expo/);
  const blank = await page.evaluate(() => window.braveli.openExternalUrl("   "));
  assert.equal(blank.ok, false);
  assert.equal(await page.getByRole("button", { name: /^preview$/i }).count(), 0, "the preview tab is gone");
  log("external-open bridge refuses unsupported URL schemes, and the preview tab is gone");

  // The renderer is the whole app now that no editor is embedded in it, so any
  // console error here is Pitwall's own. This replaces a check for one specific
  // code-server extension failure, which can no longer happen and had quietly
  // become an assertion that always held.
  assert.deepEqual(rendererErrors, [], `renderer logged errors: ${rendererErrors.join(" | ")}`);
  log("renderer runs clean, with no console errors");

  const deleteControl = page.getByRole("button", { name: "Delete session" }).first();
  await deleteControl.waitFor({ state: "visible" });
  const deleteControlBox = await deleteControl.boundingBox();
  const sessionChipBox = await deleteControl.locator("..").locator("..").boundingBox();
  assert.ok(deleteControlBox && sessionChipBox, "session delete control must be rendered");
  assert.ok(
    deleteControlBox.x + deleteControlBox.width <= sessionChipBox.x + sessionChipBox.width,
    "session delete control must not be clipped by the compact chip",
  );
  log("compact session chip keeps its delete control visible");
  await deleteControl.click();
  const deleteDialog = page
    .getByRole("heading", { name: "Remove this session from Pitwall?" })
    .locator("..")
    .locator("..")
    .locator("..");
  await deleteDialog.getByText(/branch, worktree, and files remain on disk/i).waitFor();
  await deleteDialog.getByRole("button", { name: "Delete session" }).click();
  await waitFor(async () =>
    page.evaluate((deletedSessionId) => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return state.sessions?.every((session) => session.provider !== "smoke-shell") &&
        state.contextSnapshots?.every((snapshot) => snapshot.sessionId !== deletedSessionId);
    }, persisted.session.id),
  );
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: persisted.session.worktreePath, encoding: "utf8" }).trim(),
    "smoke-427",
  );
  log("session deletion removes Pitwall state while preserving the task branch and files");

  await page.evaluate(
    ({ rootPath, taskId, timestamp }) => {
      const projectState = JSON.parse(localStorage.getItem("braveli-projects") || "[]");
      const workspaceState = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      const agentSessions = ["architect", "implementer"].map((role, index) => ({
        id: `smoke-council-${role}`,
        name: `Smoke Council · ${role === "architect" ? "Architect" : "Implementer"}`,
        agent: "Smoke Shell",
        status: index === 0 ? "running" : "idle",
        model: "auto",
        branch: "smoke-427",
        worktreePath: rootPath,
        task: "Verify Pitwall workflow",
        progress: 0,
        tokens: "0",
        approvals: 0,
        risk: "low",
        files: 0,
        started: "now",
        logs: [],
      }));
      projectState[0] = { ...projectState[0], sessions: agentSessions, openSessions: agentSessions.length };
      workspaceState.sessions = agentSessions.map((session, index) => ({
        id: session.id,
        projectId: "smoke-project",
        provider: "smoke-shell",
        taskId,
        type: index === 0 ? "architecture" : "implementation",
        status: index === 0 ? "running" : "idle",
        model: "auto",
        worktreePath: rootPath,
        messages: [],
        contextSnapshotId: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      workspaceState.councilRuns = [{
        id: "smoke-council-run",
        name: "Smoke Council",
        projectId: "smoke-project",
        taskId,
        prompt: "Smoke Council prompt",
        providerIds: ["smoke-shell"],
        synthesizer: "smoke-shell",
        status: "running",
        responses: agentSessions.map((session, index) => ({
          provider: "smoke-shell",
          sessionId: session.id,
          status: index === 0 ? "running" : "idle",
        })),
        createdAt: timestamp,
      }];
      localStorage.setItem("braveli-projects", JSON.stringify(projectState));
      localStorage.setItem("braveli-workspace-state", JSON.stringify(workspaceState));
    },
    { rootPath: projectPath, taskId: persisted.task.id, timestamp: new Date().toISOString() },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".dk-workbench-bar").getByRole("button", { name: /council/i }).click();
  // The composer was unified into one field with a choice of who hears it, so
  // the field is named for whoever is currently addressed.
  await page.locator(".dk-council-composer").getByRole("button", { name: "Everyone" }).click();
  await page.getByRole("textbox", { name: "Message to every member" }).fill("printf 'COUNCIL_BROADCAST_OK\\n'");
  await page.locator(".dk-council-composer").getByRole("button", { name: "Send", exact: true }).click();
  await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return state.sessions
        ?.filter((session) => session.id.startsWith("smoke-council-"))
        .every((session) => session.messages?.some((message) => message.content.includes("COUNCIL_BROADCAST_OK")));
    }),
  );
  log("Council shared message broadcasts to every member");

  // A pane's swap, stop and delete appear when its header is pointed at.
  await page.locator(".dk-council-pane-head", { has: page.getByRole("button", { name: "Delete Council session Smoke Council · Architect", includeHidden: true }) }).hover();
  await page.getByRole("button", { name: "Delete Council session Smoke Council · Architect" }).click();
  const deleteCouncilMemberDialog = page
    .getByRole("heading", { name: "Remove this session from Pitwall?" })
    .locator("..")
    .locator("..")
    .locator("..");
  await deleteCouncilMemberDialog.getByRole("button", { name: "Delete session" }).click();
  await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return state.councilRuns?.[0]?.responses?.length === 1 &&
        state.sessions?.every((session) => session.id !== "smoke-council-architect");
    }),
  );
  log("individual Council member session can be deleted");

  // The council tab hides the session rail so the thread and its panes have
  // the whole floor; the rail — and the grouped Council control on it — is on
  // the terminal tab.
  await page.getByRole("button", { name: /^terminal$/i }).click();
  const deleteCouncilControl = page.getByRole("button", { name: "Delete Council Smoke Council" });
  await deleteCouncilControl.waitFor({ state: "visible" });
  await deleteCouncilControl.click();
  const deleteCouncilDialog = page
    .getByRole("heading", { name: "Remove this Council from Pitwall?" })
    .locator("..")
    .locator("..")
    .locator("..");
  await deleteCouncilDialog.getByText("1 agent session", { exact: true }).waitFor();
  await deleteCouncilDialog.getByRole("button", { name: "Delete Council" }).click();
  await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return state.councilRuns?.length === 0 && state.sessions?.every((session) => !session.id.startsWith("smoke-council-"));
    }),
  );
  log("grouped Council control deletes the full run while preserving project files");

  await openTaskForm(page);
  const keepTaskDialog = page.getByRole("dialog", { name: "New task" });
  await keepTaskDialog.getByRole("textbox", { name: /Task ID/ }).fill("keep-428");
  await keepTaskDialog.getByRole("textbox", { name: "Title" }).fill("Keep this task");
  await keepTaskDialog.locator("textarea").fill("This task must survive deletion of the other task.");
  await keepTaskDialog.getByRole("button", { name: "Create task" }).click();

  await page.evaluate(
    ({ taskId, worktreePath, timestamp }) => {
      const projectState = JSON.parse(localStorage.getItem("braveli-projects") || "[]");
      const workspaceState = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      const session = {
        id: "smoke-task-dependent-session",
        name: "Verify Pitwall workflow · Architect",
        agent: "Smoke Shell",
        status: "running",
        model: "auto",
        branch: "smoke-427",
        worktreePath,
        task: "Verify Pitwall workflow",
        progress: 0,
        tokens: "0",
        approvals: 0,
        risk: "low",
        files: 0,
        started: "now",
        logs: [],
      };
      projectState[0] = { ...projectState[0], sessions: [session], openSessions: 1 };
      workspaceState.sessions = [{
        id: session.id,
        projectId: "smoke-project",
        provider: "smoke-shell",
        taskId,
        type: "architecture",
        status: "running",
        model: "auto",
        worktreePath,
        messages: [],
        contextSnapshotId: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }];
      workspaceState.councilRuns = [{
        id: "smoke-task-dependent-council",
        name: "Dependent Council",
        projectId: "smoke-project",
        taskId,
        prompt: "Dependent Council prompt",
        providerIds: ["smoke-shell"],
        synthesizer: "smoke-shell",
        status: "running",
        responses: [{ provider: "smoke-shell", sessionId: session.id, status: "running" }],
        createdAt: timestamp,
      }];
      localStorage.setItem("braveli-projects", JSON.stringify(projectState));
      localStorage.setItem("braveli-workspace-state", JSON.stringify(workspaceState));
    },
    { taskId: persisted.task.id, worktreePath: persisted.session.worktreePath, timestamp: new Date().toISOString() },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProjectTool(page, "Tasks");
  // Deleting is a word on the cards you picked, not a glyph on every card.
  // The reload restores a selected task, which reopens its detail over the
  // board; close it before reaching for a card underneath.
  const openDetail = page.locator(".dk-task-sheet");
  if (await openDetail.count()) {
    await openDetail.getByRole("button", { name: "Close task detail" }).click();
    await openDetail.waitFor({ state: "detached" });
  }
  await page.locator(".dk-board-card").filter({ hasText: "Verify Pitwall workflow" }).first().click({ modifiers: ["Meta"] });
  await page.getByRole("button", { name: "Remove 1", exact: true }).click();
  const deleteTaskDialog = page
    .getByRole("heading", { name: "Remove this task from Pitwall?" })
    .locator("..")
    .locator("..")
    .locator("..");
  await deleteTaskDialog.getByText(/1 related session, and 1 Council run will be removed/i).waitFor();
  await deleteTaskDialog.getByRole("button", { name: "Delete task" }).click();
  await waitFor(async () =>
    page.evaluate((deletedTaskId) => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      return state.tasks?.some((task) => task.identifier === "keep-428") &&
        state.tasks?.every((task) => task.id !== deletedTaskId) &&
        state.sessions?.every((session) => session.taskId !== deletedTaskId) &&
        state.councilRuns?.every((run) => run.taskId !== deletedTaskId);
    }, persisted.task.id),
  );
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: persisted.session.worktreePath, encoding: "utf8" }).trim(),
    "smoke-427",
  );
  log("task deletion cascades through dependent Pitwall state and preserves unrelated tasks and Git work");

  for (const task of [
    { id: "parallel-429", title: "Parallel task two" },
    { id: "parallel-430", title: "Parallel task three" },
  ]) {
    await openTaskForm(page);
    const parallelTaskDialog = page.getByRole("dialog", { name: "New task" });
    await parallelTaskDialog.getByRole("textbox", { name: /Task ID/ }).fill(task.id);
    await parallelTaskDialog.getByRole("textbox", { name: "Title" }).fill(task.title);
    await parallelTaskDialog.locator("textarea").fill(`Independent work for ${task.id}.`);
    await parallelTaskDialog.getByRole("button", { name: "Create task" }).click();
  }
  await openProjectTool(page, "Tasks");
  for (const title of ["Keep this task", "Parallel task two", "Parallel task three"]) {
    await page.locator(".dk-board-card").filter({ hasText: title }).first().click({ modifiers: ["Meta"] });
  }
  await page.evaluate(() => {
    window.__braveliBulkPromptOutput = {};
    window.__braveliBulkPromptUnsubscribe = window.braveli.onTerminalData(({ sessionId, data }) => {
      window.__braveliBulkPromptOutput[sessionId] = (window.__braveliBulkPromptOutput[sessionId] || "") + data;
    });
  });
  await page.getByRole("button", { name: "Start 3", exact: true }).click();
  const parallelStartDialog = page.getByRole("dialog", { name: "Start 3 task sessions" });
  await parallelStartDialog.getByRole("button", { name: "Agent for selected tasks" }).click();
  await page.getByRole("option", { name: "Smoke Shell" }).click();
  await parallelStartDialog.getByRole("button", { name: "Start 3 sessions" }).click();
  const parallelSessions = await waitFor(async () => {
    const records = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}");
      const parallelTaskIds = new Set(
        state.tasks
          ?.filter((task) => ["keep-428", "parallel-429", "parallel-430"].includes(task.identifier))
          .map((task) => task.id),
      );
      const identifiers = Object.fromEntries(
        state.tasks?.map((task) => [task.id, task.identifier]) ?? [],
      );
      const sessions = state.sessions?.filter((session) => parallelTaskIds.has(session.taskId)) ?? [];
      return sessions.length === 3 && sessions.every((session) =>
        window.__braveliBulkPromptOutput[session.id]?.includes(`Work on task ${identifiers[session.taskId]}.`),
      ) ? sessions : [];
    });
    return records.length === 3 && records.every((session) => session.worktreePath) ? records : null;
  }, 30_000);
  assert.equal(new Set(parallelSessions.map((session) => session.taskId)).size, 3);
  assert.equal(new Set(parallelSessions.map((session) => session.worktreePath)).size, 3);
  await page.evaluate(() => window.__braveliBulkPromptUnsubscribe?.());
  log("three selected tasks launch as three distinct sessions, worktrees, and PTY prompts");

  const longTaskTitle = "A very long imported task title that must stay inside the task selector without covering the role field";
  await openTaskForm(page);
  const longTaskDialog = page.getByRole("dialog", { name: "New task" });
  await longTaskDialog.getByRole("textbox", { name: /Task ID/ }).fill("long-task-431");
  await longTaskDialog.getByRole("textbox", { name: "Title" }).fill(longTaskTitle);
  await longTaskDialog.locator("textarea").fill("This description verifies that long task content cannot widen the session form.");
  await longTaskDialog.getByRole("button", { name: "Create task" }).click();
  await goTo(page, "Work");
  await page.locator(".dk-tsb-titlebar").getByRole("button", { name: "New work" }).click();
  const longTaskSessionDialog = page.getByRole("dialog", { name: "New work" });
  const taskTrigger = longTaskSessionDialog.getByRole("button", { name: "Task" });
  const roleTrigger = longTaskSessionDialog.getByRole("button", { name: "Role" });
  const [taskBox, roleBox, truncation] = await Promise.all([
    taskTrigger.boundingBox(),
    roleTrigger.boundingBox(),
    taskTrigger.locator(".dk-new-session-value").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflow: getComputedStyle(element).overflow,
      textOverflow: getComputedStyle(element).textOverflow,
    })),
  ]);
  // The settings are one line of choices under the prompt, so task sits beside
  // role rather than below it. The thing worth checking is unchanged: a long
  // title must stay inside its own choice and truncate, not run into the next.
  const overlaps = (a, b) =>
    a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  assert.ok(taskBox && roleBox && !overlaps(taskBox, roleBox), "long task selector must not spill into the role choice");
  assert.ok(truncation.scrollWidth > truncation.clientWidth, "long task title must exercise truncation");
  assert.equal(truncation.overflow, "hidden");
  assert.equal(truncation.textOverflow, "ellipsis");
  await page.waitForTimeout(180);
  await page.screenshot({ path: longTaskSessionScreenshotPath, fullPage: false });
  console.log(`  Long task session screenshot: ${longTaskSessionScreenshotPath}`);
  await longTaskSessionDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  log("long task titles stay truncated inside the session task column");

  // Menus in this app have twice been drawn on top of themselves; jsdom has no
  // layout, so only a real window can see it.
  // The font picker left the title bar for the command palette, so what is
  // checked now is that every face is reachable there and each row is drawn
  // on its own line.
  await page.locator(".dk-tsb-titlebar").getByRole("button", { name: /^Search/ }).click();
  await page.locator(".dk-palette-input input").fill("font");
  const fontRows = page.locator(".dk-palette-row", { hasText: /^Font: / });
  await fontRows.first().waitFor();
  const menuHealth = await page.locator(".dk-palette").evaluate((menu) => {
    const options = [...menu.querySelectorAll(".dk-palette-row")].filter((row) => row.textContent.startsWith("Font: "));
    const boxes = options.map((option) => option.getBoundingClientRect());
    let overlapping = 0;
    for (let index = 1; index < boxes.length; index += 1) {
      if (boxes[index].top < boxes[index - 1].bottom - 0.5) overlapping += 1;
    }
    const box = menu.getBoundingClientRect();
    return { count: options.length, overlapping, right: box.right };
  });
  assert.equal(menuHealth.count, 4, "the palette should offer every interface font");
  assert.equal(menuHealth.overlapping, 0, "no font row may be drawn over the row below it");
  assert.ok(
    menuHealth.right <= (await page.evaluate(() => window.innerWidth)) + 0.5,
    "the palette must stay inside the window",
  );
  await page.keyboard.press("Escape");
  log("the palette lists every interface font without drawing rows on top of each other");

  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Screenshot: ${screenshotPath}`);
  console.log("\nBraveli Electron smoke test passed.");
} finally {
  if (app) {
    const processRef = app.process();
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (!processRef.killed) processRef.kill("SIGKILL");
  }
  if (process.env.BRAVELI_KEEP_SMOKE_ARTIFACTS !== "1") await rm(tempRoot, { recursive: true, force: true });
}
