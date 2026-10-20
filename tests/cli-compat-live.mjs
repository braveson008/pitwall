// Today's Claude Code and Codex, started the way Pitwall starts them. Fails
// only if a CLI refuses Pitwall's flags or exits — a sign-in screen is fine,
// and expected where nobody is signed in (CI).
//   npm run build && node tests/cli-compat-live.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const profile = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-cli-compat-"));
// Pretend Pitwall last saw old versions, so both are checked now.
await writeFile(path.join(profile, "cli-versions.json"), JSON.stringify({ claude: "0.0.1", codex: "0.0.1" }));
const app = await electron.launch({
  args: [process.cwd()],
  cwd: process.cwd(),
  env: { ...process.env, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: profile, PITWALL_CLI_CHECK_DELAY_MS: "1500" },
});
try {
  await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const send = win.webContents.send.bind(win.webContents);
    globalThis.__checked = [];
    win.webContents.send = (channel, payload) => {
      if (channel === "cli:checked") globalThis.__checked.push(payload);
      return send(channel, payload);
    };
  });
  const deadline = Date.now() + 120_000;
  let checked = [];
  while (Date.now() < deadline && checked.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    checked = await app.evaluate(() => globalThis.__checked);
  }
  assert.equal(checked.length, 2, `both CLIs were checked (got ${checked.map((item) => item.agent).join(", ") || "none"})`);
  for (const item of checked) {
    console.log(`${item.agent} ${item.to}: ${item.result.status}${item.result.kind ? ` (${item.result.kind})` : ""}${item.result.detail ? ` — ${item.result.detail}` : ""}`);
    assert.notEqual(item.result.status, "broken", `${item.agent} ${item.to} refused how Pitwall starts it: ${item.result.detail}`);
    if (item.result.status === "blocked") assert.equal(item.result.kind, "signin", `${item.agent} ${item.to} opens on an unexpected screen: ${item.result.detail}`);
  }
} finally {
  await app.close();
}
console.log("Pitwall CLI compatibility check passed.");
