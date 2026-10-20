// Diagnostic, Windows only: the released installer, real agent CLIs, sessions
// started the way the window starts them. Records everything; asserts nothing.
//   node tests/windows-agents-diagnose.mjs <installer.exe>
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const installer = process.argv[2];
const log = (...parts) => console.log(...parts);
execFileSync(installer, ["/S"], { stdio: "inherit", timeout: 180_000 });
const exe = path.join(process.env.LOCALAPPDATA, "Programs", "Pitwall", "Pitwall.exe");
log("installed:", existsSync(exe));

const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall diag "));
const project = path.join(temp, "shop project");
await mkdir(project, { recursive: true });
execFileSync("git", ["init", "-q", project]);
await writeFile(path.join(project, "README.md"), "# shop\n");
execFileSync("git", ["-C", project, "add", "."]);
execFileSync("git", ["-C", project, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init"]);

const app = await electron.launch({ executablePath: exe, env: { ...process.env, PITWALL_USER_DATA_DIR: path.join(temp, "profile") }, timeout: 90_000 });
const proc = app.process();
proc.stdout.on("data", (chunk) => process.stdout.write(`[main] ${chunk}`));
proc.stderr.on("data", (chunk) => process.stdout.write(`[main:err] ${chunk}`));
proc.on("exit", (code, signal) => log(`!!! APP EXITED code=${code} signal=${signal}`));
const page = await app.firstWindow({ timeout: 60_000 });
page.on("crash", () => log("!!! RENDERER CRASHED"));
page.on("pageerror", (error) => log("[renderer error]", error.message));
page.on("console", (message) => { if (["error", "warning"].includes(message.type())) log(`[renderer ${message.type()}]`, message.text().slice(0, 400)); });
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(3000);

await page.evaluate(() => {
  window.diag = {};
  window.pitwall.onTerminalData(({ sessionId, data }) => { (window.diag[sessionId] ||= { out: "", closed: null }).out += data; });
  window.pitwall.onTerminalClosed((event) => { (window.diag[event.sessionId] ||= { out: "", closed: null }).closed = event; });
});

for (const agent of ["Claude", "Codex"]) {
  const sessionId = `diag-${agent.toLowerCase()}`;
  const started = await page.evaluate((payload) => window.pitwall.startTerminal(payload), {
    projectId: "shop", projectPath: project, sessionId, sessionName: `Diag ${agent}`, agent, model: "",
    nativeSessionId: agent === "Claude" ? randomUUID() : undefined, resumeSession: false, cols: 120, rows: 40,
  }).catch((error) => ({ thrown: error.message }));
  log(`=== ${agent} start:`, JSON.stringify(started));
  await page.waitForTimeout(25_000);
  const seen = await page.evaluate((id) => window.diag[id] || null, sessionId).catch((error) => ({ error: error.message }));
  const text = String(seen?.out || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  log(`=== ${agent} closed:`, JSON.stringify(seen?.closed));
  log(`=== ${agent} output (last 3000 chars):\n${text.slice(-3000)}\n=== end ${agent}`);
  await page.evaluate((id) => window.pitwall.runSessionAction({ sessionId: id, action: "stop" }), sessionId).catch(() => {});
}

const profile = path.join(temp, "profile");
for (const folder of ["Crashpad", "logs"]) {
  const dir = path.join(profile, folder);
  if (existsSync(dir)) log(`=== ${folder}:`, JSON.stringify(readdirSync(dir, { recursive: true })));
}
await app.close().catch(() => {});
