// Windows packaged smoke test: install the NSIS installer silently, launch the
// installed app with a clean profile, and prove the parts that only fail on a
// real Windows machine: the window, the bridge, ConPTY and argument quoting.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

if (process.platform !== "win32") {
  console.log("  SKIP  packaged-smoke-win runs on Windows only");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const installer = path.join(root, "release", `Pitwall-${packageJson.version}-x64-setup.exe`);
const installDir = path.join(process.env.LOCALAPPDATA, "Programs", "Pitwall");
const executablePath = path.join(installDir, "Pitwall.exe");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-win-smoke-"));
const projectPath = path.join(tempRoot, "clean project");
const userDataPath = path.join(tempRoot, "clean-profile");
let app;

const step = (name) => console.log(`  OK  ${name}`);

try {
  assert.ok(existsSync(installer), `installer missing: ${installer}`);
  execFileSync(installer, ["/S"], { stdio: "inherit", timeout: 180_000 });
  assert.ok(existsSync(executablePath), `installed app missing: ${executablePath}`);
  step("NSIS installer installs silently per user");
  const updaterConfig = await readFile(path.join(installDir, "resources", "app-update.yml"), "utf8");
  assert.match(updaterConfig, /provider: generic/);
  step(`installed app can update itself (${/url: (\S+)/.exec(updaterConfig)?.[1]})`);

  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, "README.md"), "# Windows package test\n");
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      PITWALL_E2E: "1",
      PITWALL_USER_DATA_DIR: userDataPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 45_000 });
  await page.waitForLoadState("domcontentloaded");
  const identity = await page.evaluate(() => ({
    title: document.title,
    bridge: Boolean(window.pitwall),
    platform: document.documentElement.dataset.platform ?? null,
  }));
  assert.equal(identity.title, "Pitwall");
  assert.equal(identity.bridge, true);
  step(`installed app launches (renderer platform flag: ${identity.platform})`);

  const chrome = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { closable: win.isClosable(), minimizable: win.isMinimizable(), maximizable: win.isMaximizable() };
  });
  assert.deepEqual(chrome, { closable: true, minimizable: true, maximizable: true });
  step("window can be closed, minimised and maximised");

  // What the window looks like on Windows: caption buttons, header, fonts.
  const shots = path.join(root, "release", "smoke");
  await mkdir(shots, { recursive: true });
  await page.waitForTimeout(2_000);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      void window.pitwall.setWindowChrome?.({ dark: theme === "dark" });
    }, theme);
    await page.waitForTimeout(500);
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const shot = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
      return shot.toPNG().toString("base64");
    });
    await writeFile(path.join(shots, `window-${theme}.png`), Buffer.from(image, "base64"));
  }
  const overlay = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".dk-header-bar") ?? document.body);
    return { platform: document.documentElement.dataset.platform, headerPaddingRight: style.paddingRight };
  });
  step(`screenshots saved; header padding-right ${overlay.headerPaddingRight} (platform ${overlay.platform})`);

  const editors = await page.evaluate(() => window.pitwall.listEditors());
  assert.equal(editors.ok, true);
  step(`editor detection answers (${editors.editors.length} found)`);

  await page.evaluate(() => {
    window.winOut = "";
    window.winClosed = false;
    window.pitwall.onTerminalData(({ sessionId, data }) => {
      if (sessionId === "win-terminal") window.winOut += data;
    });
    window.pitwall.onTerminalClosed(({ sessionId }) => {
      if (sessionId === "win-terminal") window.winClosed = true;
    });
  });
  const started = await page.evaluate((projectPath) => window.pitwall.startTerminal({
    projectId: "win-project", projectPath, sessionId: "win-terminal",
    sessionName: "Windows fixture", agent: "Package Shell", command: "cmd.exe", args: ["/d", "/q"],
  }), projectPath);
  assert.equal(started.ok, true, JSON.stringify(started));
  await page.evaluate(() => window.pitwall.writeTerminal({
    sessionId: "win-terminal", data: "echo PITWALL_%COMPUTERNAME%_OK\r",
  }));
  await page.waitForFunction(() => /PITWALL_\S+_OK/.test(window.winOut), null, { timeout: 30_000 });
  const stopped = await page.evaluate(() => window.pitwall.runSessionAction({ sessionId: "win-terminal", action: "stop" }));
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await page.waitForFunction(() => window.winClosed, null, { timeout: 30_000 });
  step("ConPTY terminal starts in a path with a space, runs a command, stops");

  const missing = await page.evaluate(() => window.pitwall.startTerminal({
    projectId: "win-project", projectPath: "C:\\nowhere\\pitwall-missing", sessionId: "win-missing",
    sessionName: "Missing folder", agent: "Package Shell", command: "cmd.exe", args: ["/d", "/q"],
  }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /doesn't exist on this computer/);
  step("a session whose folder is missing says so instead of failing with error 267");

  const updates = await page.evaluate(() => window.pitwall.getUpdateState());
  step(`update state: ${updates.status}`);
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
    if (child.exitCode === null) {
      try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    }
  }
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
