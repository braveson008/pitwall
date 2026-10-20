import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const dmgPath = path.join(root, "release", `Pitwall-${packageJson.version}-arm64.dmg`);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-packaged-smoke-"));
const projectPath = path.join(tempRoot, "clean-project");
const userDataPath = path.join(tempRoot, "clean-profile");
let mountDevice = "";
let mountPoint = "";
let app;

try {
  const attached = execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", dmgPath], { encoding: "utf8" });
  const mountedLine = attached.split(/\r?\n/).find((line) => line.includes("/Volumes/"));
  if (!mountedLine) throw new Error(`DMG did not mount: ${attached}`);
  mountPoint = mountedLine.slice(mountedLine.indexOf("/Volumes/")).trim();
  mountDevice = mountedLine.trim().split(/\s+/)[0].replace(/s\d+$/, "");

  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, "README.md"), "# Clean profile package test\n");
  const executablePath = path.join(mountPoint, "Pitwall.app", "Contents", "MacOS", "Pitwall");
  app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      PITWALL_E2E: "1",
      PITWALL_USER_DATA_DIR: userDataPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  const identity = await page.evaluate(() => ({ title: document.title, bridge: Boolean(window.pitwall) }));
  assert.equal(identity.title, "Pitwall");
  assert.equal(identity.bridge, true);
  // The packaged app has no editor of its own; what must survive packaging is
  // its ability to find the user's. Detection reads the real filesystem, so a
  // path that only resolves in dev would show up here as an empty list.
  const editors = await page.evaluate(() => window.pitwall.listEditors());
  assert.equal(editors.ok, true);
  assert.ok(Array.isArray(editors.editors), "listEditors must always answer with a list");
  // The packaged app opens the project's server in the user's browser, which a
  // test must not launch. The refusal path is the part that still belongs to
  // Pitwall, and it exercises the same bridge.
  const refused = await page.evaluate(() => window.pitwall.openExternalUrl("file:///etc/passwd"));
  assert.equal(refused.ok, false);
  // A dev-only native-addon load cannot prove the terminal survived packaging.
  await page.evaluate(() => {
    window.packageTerminalOutput = "";
    window.packageTerminalClosed = false;
    window.pitwall.onTerminalData(({ sessionId, data }) => {
      if (sessionId === "package-terminal") window.packageTerminalOutput += data;
    });
    window.pitwall.onTerminalClosed(({ sessionId }) => {
      if (sessionId === "package-terminal") window.packageTerminalClosed = true;
    });
  });
  const terminal = await page.evaluate((projectPath) => window.pitwall.startTerminal({
    projectId: "package-project", projectPath, sessionId: "package-terminal",
    sessionName: "Package fixture", agent: "Package Shell", command: "/bin/cat", args: [],
  }), projectPath);
  assert.equal(terminal.ok, true, JSON.stringify(terminal));
  assert.equal((await page.evaluate(() => window.pitwall.writeTerminal({
    sessionId: "package-terminal", data: "PITWALL_PACKAGE_TERMINAL_OK\n",
  }))).ok, true);
  await page.waitForFunction(() => window.packageTerminalOutput.includes("PITWALL_PACKAGE_TERMINAL_OK"));
  const stopped = await page.evaluate(() => window.pitwall.runSessionAction({ sessionId: "package-terminal", action: "stop" }));
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  await page.waitForFunction(() => window.packageTerminalClosed);
  console.log("  OK  mounted DMG native PTY starts, receives input, stops, and emits its closed event");
  const updates = await page.evaluate(() => window.pitwall.getUpdateState());
  assert.equal(updates.status, "disabled");
  console.log("  OK  DMG app launches with a clean profile, editor detection, and a guarded external-open bridge");
} finally {
  if (app) {
    const appProcess = app.process();
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (appProcess.exitCode === null) {
      appProcess.kill("SIGKILL");
    }
  }
  if (mountDevice) {
    try {
      execFileSync("hdiutil", ["detach", mountDevice], { stdio: "ignore" });
    } catch {
      // A failed launch should not hide its original error behind detach cleanup.
    }
  }
  await rm(tempRoot, { recursive: true, force: true });
}
