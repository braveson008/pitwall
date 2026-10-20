// An MCP sign-in that waits on the browser: its link reaches the window as
// soon as the CLI prints it, and cancelling stops the CLI at once rather than
// after the five-minute timeout.
//   npm run build && node tests/mcp-auth-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-mcp-auth-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);

const project = path.join(temp, "admin");
await mkdir(project, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: project });

const pidFile = path.join(temp, "login.pid");
const link = "https://auth.atlassian.com/authorize?response_type=code&client_id=abc&code_challenge=xyz&redirect_uri=http%3A%2F%2Flocalhost%3A53142%2Fcallback";
// The login prints its link the way the real CLI does — coloured, after the
// server's own address — and then waits for a browser that never answers.
await writeFile(path.join(fakeBin, "claude"), `#!/bin/sh
case "$1 $2" in
  "mcp remove"|"mcp add") exit 0 ;;
  "mcp login")
    echo $$ > '${pidFile}'
    printf 'Authenticating with atlassian at https://mcp.atlassian.com/v2/mcp\\r\\n'
    printf 'If your browser does not open, visit:\\r\\n\\033[36m%s\\033[39m\\r\\n' '${link}'
    exec sleep 600 ;;
  *) echo "unexpected claude call: $*" >&2; exit 2 ;;
esac
`);
await chmod(path.join(fakeBin, "claude"), 0o755);

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  const payload = { projectId: "admin", projectPath: project, provider: "claude", name: "atlassian", target: "https://mcp.atlassian.com/v2/mcp", transport: "http" };
  await page.evaluate((payload) => {
    window.__signIn = { url: "", result: null };
    window.pitwall.onMcpAuthUrl((event) => { if (event.name === payload.name) window.__signIn.url = event.url; });
    void window.pitwall.connectMcpAuth(payload).then((result) => { window.__signIn.result = result; });
  }, payload);

  await page.waitForFunction(() => window.__signIn.url, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__signIn.url), link, "the sign-in link, not the server's own address");
  console.log("PASS the sign-in link reaches the window while the CLI waits");

  const pid = Number((await readFile(pidFile, "utf8")).trim());
  const started = Date.now();
  await page.evaluate((payload) => window.pitwall.cancelMcpAuth({ projectPath: payload.projectPath, provider: payload.provider, name: payload.name }), payload);
  await page.waitForFunction(() => window.__signIn.result, null, { timeout: 10000 });
  const result = await page.evaluate(() => window.__signIn.result);
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.ok(Date.now() - started < 5000, "cancelling does not wait out the timeout");
  await new Promise((resolve) => setTimeout(resolve, 500));
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  assert.equal(alive, false, "the CLI waiting on the browser is stopped");
  console.log("PASS cancelling stops the sign-in at once and says it was cancelled");

  // Nothing running: cancelling is harmless.
  const idle = await page.evaluate((payload) => window.pitwall.cancelMcpAuth({ projectPath: payload.projectPath, provider: payload.provider, name: payload.name }), payload);
  assert.deepEqual(idle, { ok: true, running: false });
  console.log("PASS cancelling with nothing running does nothing");
} finally {
  await app.close();
}
console.log("Pitwall MCP sign-in smoke test passed.");
