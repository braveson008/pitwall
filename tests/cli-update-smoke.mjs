// A CLI that updated itself is started once to check it still works, and the
// person is told: ready, or exactly what it refused.
//   npm run build && node tests/cli-update-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { electron } from "./electronLaunch.mjs";

const root = process.cwd();

async function run({ claudeBody, expectTitle, expectText }) {
  const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-cli-update-"));
  const fakeHome = path.join(temp, "home");
  const fakeBin = path.join(temp, "bin");
  const profile = path.join(temp, "profile");
  await mkdir(fakeHome, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
  await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
  await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash
case "$1" in --version) echo "2.2.0 (Claude Code)"; exit 0 ;; --help) echo "  --settings <file-or-json>"; exit 0 ;; esac
echo "$*" >> '${temp}/launched.txt'
${claudeBody}
`);
  await chmod(path.join(fakeBin, "claude"), 0o755);
  // Pitwall last saw an older Claude.
  await writeFile(path.join(profile, "cli-versions.json"), JSON.stringify({ claude: "2.1.289" }));

  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: profile, PITWALL_CLI_CHECK_DELAY_MS: "1500" },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByText(expectTitle, { exact: true }).waitFor({ timeout: 45000 });
    assert.match(await page.locator("body").innerText(), expectText);
    const launched = await readFile(path.join(temp, "launched.txt"), "utf8");
    assert.match(launched, /--settings/, "it was started the way a session is, completion hook included");
    assert.doesNotMatch(launched, /Print|task/i, "with no prompt: nothing was asked of a model");
    const versions = JSON.parse(await readFile(path.join(profile, "cli-versions.json"), "utf8"));
    assert.equal(versions.claude, "2.2.0", "the new version is remembered, so it is checked once");
  } finally {
    await app.close();
  }
}

await run({
  claudeBody: `printf '\\n❯ \\n  ⏵⏵ auto mode on (shift+tab to cycle)\\n'\nexec sleep 60`,
  expectTitle: "Claude updated",
  expectText: /Claude updated from 2\.1\.289 to 2\.2\.0\. Pitwall started it with its usual settings and it is ready to use\./,
});
console.log("PASS an updated CLI that still starts cleanly is reported as ready");

await run({
  claudeBody: `echo "error: unknown option '--settings'" >&2\nexit 1`,
  expectTitle: "Claude may not start",
  expectText: /refused how Pitwall starts it\. It said: “error: unknown option '--settings'”/,
});
console.log("PASS an updated CLI that refuses Pitwall's flags is reported, with what it said");

console.log("Pitwall CLI update smoke test passed.");
