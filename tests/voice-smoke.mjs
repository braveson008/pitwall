import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

/**
 * Proves the voice stack works inside the real app, not just in unit tests.
 *
 * `electron/*.cjs` is not covered by `tsc`, so a typo in the IPC wiring builds
 * cleanly and fails only at runtime. This drives the actual IPC surface through
 * the preload bridge — the same path the renderer uses — and asserts the
 * properties that matter:
 *
 *   - the capability registry is populated and reachable
 *   - a safe capability runs
 *   - a destructive capability does NOT run without confirmation
 *   - a renderer-surface capability round-trips to React and back
 *
 * The conductor is stubbed, so nothing here spends a token or needs a network.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-voice-"));
const userDataPath = path.join(tempRoot, "user-data");
const fakeBin = path.join(tempRoot, "bin");
const fakeHome = path.join(tempRoot, "home");

await mkdir(userDataPath, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await mkdir(fakeHome, { recursive: true });

// The router asks `claude -p --output-format json` for a decision. This stub
// always routes to a read-only capability, so the assertion that a *destructive*
// capability needs confirmation cannot be satisfied by accident.
const routerDecision = JSON.stringify({ capabilityId: "git.status", params: {}, say: "Checking." });
await writeFile(
  path.join(fakeBin, "claude"),
  `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${JSON.stringify({
    type: "result",
    is_error: false,
    result: routerDecision,
  }).replace(/'/g, "'\\''")}'\n`,
  "utf8",
);
await chmod(path.join(fakeBin, "claude"), 0o755);

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    PITWALL_E2E: "1",
    PITWALL_USER_DATA_DIR: userDataPath,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  timeout: 30_000,
});

let failures = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    process.stdout.write(`  OK  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
};

try {
  const page = await app.firstWindow({ timeout: 20_000 });
  page.on("pageerror", (error) => process.stdout.write(`  RENDERER ERROR  ${error.message}\n`));
  await page.waitForFunction(() => Boolean(window.pitwall?.getVoiceStatus), null, { timeout: 20_000 });

  // --- the registry is real and reachable over IPC ------------------------
  const capabilities = await page.evaluate(() => window.pitwall.listCapabilities());
  check("capability registry is exposed", capabilities.ok && capabilities.capabilities.length >= 20,
    `got ${capabilities.capabilities?.length}`);

  const ids = capabilities.capabilities.map((capability) => capability.id);
  check("no shell escape hatch is registered", !ids.some((id) => /run_shell|exec|eval/.test(id)), ids.join(","));
  check("every capability declares a risk tier",
    capabilities.capabilities.every((capability) => ["safe", "guarded", "destructive"].includes(capability.risk)));

  // --- voice status reports honestly --------------------------------------
  const status = await page.evaluate(() => window.pitwall.getVoiceStatus());
  check("voice reports its state without the engine running", status.ok && status.state === "off");
  check("voice knows whether the engine binary was built", typeof status.engineBuilt === "boolean");

  // --- a destructive capability refuses to run unconfirmed ----------------
  const discard = await page.evaluate(() =>
    window.pitwall.runCapability({ capabilityId: "git.discard_changes", params: {} }),
  );
  check("destructive capability demands confirmation",
    discard.ok === false && discard.code === "confirmation_required",
    JSON.stringify(discard));
  check("the confirmation is phrased for speech",
    typeof discard.confirmation?.question === "string" && /yes/i.test(discard.confirmation.question),
    discard.confirmation?.question);

  // A wrong confirmation id must not approve it.
  const forged = await page.evaluate(() =>
    window.pitwall.runCapability({
      capabilityId: "git.discard_changes",
      params: {},
      confirmationId: "not-the-real-id",
    }),
  );
  check("a forged confirmation id is rejected", forged.ok === false, JSON.stringify(forged));

  // --- invalid arguments are refused before any handler runs --------------
  const badArgs = await page.evaluate(() =>
    window.pitwall.runCapability({ capabilityId: "git.commit", params: {} }),
  );
  check("missing required arguments are refused", badArgs.ok === false && badArgs.code === "invalid_params",
    JSON.stringify(badArgs));

  const unknown = await page.evaluate(() =>
    window.pitwall.runCapability({ capabilityId: "os.run_shell", params: { command: "echo pwned" } }),
  );
  check("an unregistered capability cannot be invoked", unknown.ok === false && unknown.code === "unknown_capability");

  // --- a renderer-surface capability round-trips --------------------------
  const projectList = await page.evaluate(() => window.pitwall.runCapability({ capabilityId: "project.list" }));
  check("renderer-surface capability round-trips through React",
    projectList.ok === true && Array.isArray(projectList.projects),
    JSON.stringify(projectList).slice(0, 200));

  // --- memory persists ----------------------------------------------------
  await page.evaluate(() => window.pitwall.rememberNote({ note: "The ledger uses Postgres", kind: "decision" }));
  const recalled = await page.evaluate(() =>
    window.pitwall.runCapability({ capabilityId: "memory.recall", params: { query: "postgres" } }),
  );
  check("a remembered note can be recalled", recalled.ok === true && /Postgres/.test(recalled.speak || ""),
    JSON.stringify(recalled).slice(0, 200));

  // --- the HUD obeys the flag that hides it -------------------------------
  // Voice ships in the build and out of the interface: it owns a microphone, a
  // permission prompt and a daemon that can die for reasons the app cannot
  // control, which is a whole class of first-run failure in front of people
  // meeting the product for the first time. The capability layer above is what
  // has to work; the panel is behind `VOICE_ENABLED`, and asserting it renders
  // asserted the opposite of what this build is meant to do.
  //
  // Read from the source so this stays true whichever way the flag is set — and
  // so flipping it on without meaning to fails here.
  const featuresSource = await readFile(path.join(root, "src", "lib", "features.ts"), "utf8");
  const voiceEnabled = /export const VOICE_ENABLED = true/.test(featuresSource);
  const hudVisible = await page.evaluate(() => Boolean(document.querySelector('aside[aria-label="Voice assistant"]')));
  check(
    voiceEnabled ? "the voice HUD renders" : "the voice HUD stays hidden while the flag is off",
    hudVisible === voiceEnabled,
    `VOICE_ENABLED=${voiceEnabled}, hud present=${hudVisible}`,
  );

  process.stdout.write(`\nVoice smoke test ${failures ? "FAILED" : "passed"}.\n`);
} finally {
  await app.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

assert.equal(failures, 0, `${failures} voice smoke check(s) failed`);
