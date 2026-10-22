// Settings and Automations, driven the way a person does: dialogs return to
// where they were opened, Escape closes only the menu it was pressed in, the
// MCP form sends what it shows, and a booking's edit is checked like a new one.
//   npm run build && node tests/settings-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { electron } from "./electronLaunch.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitwall-settings-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
const calls = path.join(temp, "calls.log");
await writeFile(path.join(fakeBin, "claude"), `#!/bin/bash
case "$1" in --version) echo "2.2.0 (Claude Code)"; exit 0 ;; --help) echo "  --settings <file-or-json>"; exit 0 ;; esac
printf '%s\\n' "$*" >> '${calls}'
case "$1 $2" in "mcp add") echo "Added stdio MCP server"; exit 0 ;; "mcp list") echo "No MCP servers configured."; exit 0 ;; "auth status") echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0 ;; esac
case "$1" in mcp|auth|plugin) echo "{}"; exit 0 ;; esac
exec cat
`);
await chmod(path.join(fakeBin, "claude"), 0o755);

const dir = path.join(temp, "alpha");
await mkdir(dir, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.email", "dev@example.com");
git("config", "user.name", "A Developer");
await writeFile(path.join(dir, "a.txt"), "a\n");
git("add", ".");
git("commit", "-q", "-m", "init");

const now = new Date().toISOString();
const projectRecord = { id: "alpha", name: "alpha", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 0, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [], queue: [], timeline: [] };
const workspace = { version: 1, projects: [{ id: "alpha", name: "alpha", path: dir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }], tasks: [], contextEntries: [], contextSnapshots: [], sessions: [], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") },
});
let passed = false;
try {
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ projectRecord, workspace }) => {
    localStorage.clear();
    localStorage.setItem("pitwall-projects", JSON.stringify([projectRecord]));
    localStorage.setItem("pitwall-onboarded", "yes");
    localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace));
  }, { projectRecord, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".dk-statusbar").getByRole("button", { name: /^Automations/ }).waitFor({ timeout: 15000 });

  const sheet = page.locator(".dk-sheet");
  const newWork = page.getByRole("dialog", { name: "New work" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await sheet.getByRole("button", { name: "Add agent" }).waitFor({ timeout: 15000 });

  // ---- Add agent goes back to Settings, not on to a new session ----------------
  const addAgent = page.getByRole("dialog", { name: "Add custom agent" });
  for (const close of ["Cancel", "Escape"]) {
    await sheet.getByRole("button", { name: "Add agent" }).click();
    await addAgent.waitFor();
    if (close === "Escape") await page.keyboard.press("Escape");
    else await addAgent.getByRole("button", { name: close }).click();
    await addAgent.waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    assert.equal(await newWork.count(), 0, `closing Add agent with ${close} from Settings opened New work`);
    assert.equal(await sheet.count(), 1, "Settings is still open behind it");
  }
  console.log("PASS Add agent opened from Settings closes back to Settings");

  // ---- Escape on an open menu closes the menu, not the dialog ------------------
  await sheet.getByRole("button", { name: "Manage" }).first().waitFor({ timeout: 60000 }).catch(async () => { console.log(await sheet.innerText()); });
  await sheet.getByRole("button", { name: "Manage" }).first().click();
  await page.getByRole("button", { name: "Add server" }).click();
  const addMcp = page.getByRole("dialog", { name: /Add an MCP server to Claude/ });
  await addMcp.waitFor();
  await addMcp.getByRole("textbox", { name: "Name" }).fill("files");
  await addMcp.getByRole("button", { name: "Scope" }).click();
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("listbox").waitFor({ state: "detached" });
  await page.waitForTimeout(200);
  assert.equal(await addMcp.count(), 1, "Escape on the Scope menu closed the Add MCP dialog");
  assert.equal(await addMcp.getByRole("textbox", { name: "Name" }).inputValue(), "files", "what was typed is still there");
  console.log("PASS Escape on an open dropdown closes only the dropdown");

  // ---- an OAuth tick left over from HTTP does not follow a local server ---------
  await addMcp.getByRole("group", { name: "Transport" }).getByRole("button", { name: "HTTP" }).click();
  await addMcp.getByRole("checkbox", { name: /OAuth authentication/ }).check();
  await addMcp.getByRole("group", { name: "Transport" }).getByRole("button", { name: "Local (stdio)" }).click();
  await addMcp.getByRole("textbox", { name: "Command" }).fill("npx");
  await addMcp.getByRole("button", { name: "Add server" }).click();
  await addMcp.waitFor({ state: "detached", timeout: 15000 }).catch(async () => {
    const said = await addMcp.locator(".dk-error").innerText().catch(() => "");
    assert.fail(`the local server was added but the dialog stayed open: ${said}`);
  });
  assert.match(await readFile(calls, "utf8"), /^mcp add .*files -- npx/m, "the server was added as a local command");
  console.log("PASS a local MCP server is added without an OAuth attempt");
  const manager = page.getByRole("dialog", { name: "MCP servers" });
  await page.keyboard.press("Escape");
  await manager.waitFor({ state: "detached", timeout: 5000 }).catch(() => assert.fail("Escape did not close the MCP servers dialog"));
  assert.equal(await sheet.count(), 1, "only the MCP servers dialog closed, not Settings under it");
  console.log("PASS Escape closes the MCP servers dialog, and only it");

  // ---- Automations: Escape in a menu leaves the sheet open ----------------------
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  await page.locator(".dk-statusbar").getByRole("button", { name: /^Automations/ }).click();
  const compose = page.locator("form.dk-schedule-compose").first();
  await compose.waitFor();
  await compose.getByRole("button", { name: "How often it repeats" }).click();
  await page.getByRole("listbox", { name: undefined }).getByRole("option", { name: "weekdays" }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await sheet.count(), 1, "Escape on the repeat menu closed Automations");
  console.log("PASS Escape on a menu inside a sheet keeps the sheet");

  // ---- a booking: a bad time is named, and an edit is checked like a new one ----
  await compose.getByRole("textbox", { name: "What should run" }).fill("Nightly tidy");
  await compose.getByRole("textbox", { name: "Time" }).fill("25:00");
  await compose.getByRole("button", { name: "Schedule", exact: true }).click();
  assert.match(await compose.locator(".dk-error").innerText(), /25:00 is not a time/, "a time that was given is not asked for again");
  await compose.getByRole("textbox", { name: "Time" }).fill("10:00");
  await compose.getByRole("button", { name: "Schedule", exact: true }).click();
  const slot = page.locator(".dk-slot", { hasText: "Nightly tidy" });
  await slot.waitFor({ timeout: 10000 });
  await slot.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.locator("form.dk-schedule-compose.is-inline");
  await edit.getByRole("button", { name: "How often it repeats" }).click();
  await page.getByRole("option", { name: "every 2 hours" }).click();
  await edit.getByRole("textbox", { name: "Last hour it repeats" }).fill("8pm");
  await edit.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(500);
  assert.equal(await edit.count(), 1, "an unreadable last hour was saved as all day");
  assert.match(await edit.locator(".dk-error").innerText(), /Write the last hour as 20:00/);
  await edit.getByRole("textbox", { name: "Last hour it repeats" }).fill("09:00");
  await edit.getByRole("button", { name: "Save" }).click();
  assert.match(await edit.locator(".dk-error").innerText(), /stop before it started/);
  await edit.getByRole("textbox", { name: "Last hour it repeats" }).fill("20:00");
  await edit.getByRole("button", { name: "Save" }).click();
  await edit.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForFunction(() => /10:00\s*–\s*20:00/.test(document.querySelector(".dk-schedule-list")?.textContent ?? ""), null, { timeout: 10000 });
  console.log("PASS a booking's edit refuses the times a new booking would");

  assert.deepEqual(pageErrors, [], "no uncaught renderer errors");
  passed = true;
  console.log("Pitwall settings smoke test passed.");
} finally {
  await app.close();
  if (passed) await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
  else console.log(`kept ${temp} for a look`);
}
