import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braveli-project-flow-"));
const userDataPath = path.join(tempRoot, "user-data");
const parentPath = path.join(tempRoot, "workspace");
await mkdir(userDataPath, { recursive: true });
await mkdir(parentPath, { recursive: true });

const log = (step) => process.stdout.write(`  OK  ${step}\n`);

const app = await electron.launch({
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

try {
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("braveli-onboarded", "yes");
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  log("app launched with a clean profile");

  // ---- 1. The new IPC handler, end to end against the real filesystem ----
  const created = await page.evaluate(
    ({ parent }) =>
      window.braveli.createProjectDirectory({
        parentPath: parent,
        folderName: "my-todo-app",
        brief: "# My Todo App\n\n## Brief\n\nTrack tasks offline.\n",
      }),
    { parent: parentPath },
  );
  assert.equal(created.ok, true, `create failed: ${created.error}`);
  const projectDir = path.join(parentPath, "my-todo-app");
  assert.equal(created.path, projectDir);
  assert.ok(existsSync(path.join(projectDir, "BRIEF.md")), "BRIEF.md was not written");
  assert.match(readFileSync(path.join(projectDir, "BRIEF.md"), "utf8"), /Track tasks offline\./);
  assert.equal(created.repository, true, `git repo not initialised: ${created.warning}`);
  log("project:create-directory creates the folder, brief, and git repo");

  const head = execFileSync("git", ["log", "--oneline"], { cwd: projectDir, encoding: "utf8" });
  assert.match(head, /Initial commit: project brief/);
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir, encoding: "utf8" });
  assert.equal(branch.trim(), "main");
  log("initial commit exists on main (worktrees will work)");

  // ---- 2. Rejections: traversal, collisions, bad names ----
  const traversal = await page.evaluate(
    ({ parent }) =>
      window.braveli.createProjectDirectory({ parentPath: parent, folderName: "../escaped", brief: "" }),
    { parent: parentPath },
  );
  assert.equal(traversal.ok, false);
  assert.ok(!existsSync(path.join(tempRoot, "escaped")), "traversal escaped the parent directory");
  log("path traversal is rejected and nothing is written outside the parent");

  const collision = await page.evaluate(
    ({ parent }) =>
      window.braveli.createProjectDirectory({ parentPath: parent, folderName: "my-todo-app", brief: "x" }),
    { parent: parentPath },
  );
  assert.equal(collision.ok, false);
  assert.match(collision.error, /not empty/);
  assert.match(readFileSync(path.join(projectDir, "BRIEF.md"), "utf8"), /Track tasks offline\./);
  log("a non-empty existing folder is refused without clobbering it");

  // ---- 3. The wizard UI ----
  await openProject(page, "Describe a new project…");
  await page.waitForSelector('[aria-label="Describe a new project"]');
  log("sidebar entry opens the wizard");

  const wizard = page.getByRole("dialog", { name: "Describe a new project" });
  const continueButton = wizard.getByRole("button", { name: "Continue" });
  await continueButton.click();
  assert.ok(
    await wizard.locator(".dk-error").first().isVisible(),
    "empty draft should be blocked with a visible error",
  );
  assert.equal(await wizard.getByText("Step 1 of 2").count(), 1, "should still be on step 1");
  log("empty draft is blocked on step 1");

  await page.fill('input[placeholder="Todo App"]', "My Todo App");
  assert.match(await wizard.getByText(/^Folder:/).textContent(), /my-todo-app/);
  await wizard.getByLabel("Description").fill("Track tasks offline with a local database.");
  await continueButton.click();
  await wizard.getByText("Step 2 of 2").waitFor();
  log("folder name previews live, and step 2 shows the scope -> implement pipeline");

  const stages = wizard.getByRole("region");
  assert.equal(await stages.count(), 2, "expected a scoping stage and an implementer stage");
  assert.match(await stages.nth(0).textContent(), /Scope & brainstorm/);
  assert.match(await stages.nth(1).textContent(), /Implement/);
  const selected = await stages.getByRole("button", { pressed: true }).count();
  assert.equal(selected, 2, "both stages should have a pre-selected agent");
  log("both pipeline stages render with a pre-selected agent");

  await wizard.getByRole("button", { name: "Back" }).click();
  assert.equal(await wizard.getByText("Step 1 of 2").count(), 1);
  assert.equal(await page.inputValue('input[placeholder="Todo App"]'), "My Todo App", "draft lost on Back");
  log("Back preserves the draft");

  const screenshotPath = path.join(tempRoot, "project-flow.png");
  await page.screenshot({ path: screenshotPath });
  process.stdout.write(`  Screenshot: ${screenshotPath}\n`);
  process.stdout.write("\nBraveli project flow smoke test passed.\n");
} finally {
  await app.close();
  if (process.env.BRAVELI_KEEP_SMOKE_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
