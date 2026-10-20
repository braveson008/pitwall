// A notification leads to what it is about: the project, the session, the
// review, the Watches card — from the window's message and from the bell.
//   npm run build && node tests/notification-jump-smoke.mjs
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright";
import { openProject } from "./helpers/openProject.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-notify-"));
const fakeHome = path.join(temp, "home");
const fakeBin = path.join(temp, "bin");
await mkdir(fakeHome, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await writeFile(path.join(fakeHome, ".zprofile"), `export PATH="${fakeBin}:$PATH"\n`);
for (const name of ["claude", "codex"]) {
  await writeFile(path.join(fakeBin, name), `#!/bin/sh\ncase "$1" in --version) echo "1.0.0"; exit 0 ;; esac\nstty raw -echo 2>/dev/null\necho "${name} stub ready"\nexec cat >/dev/null\n`);
  await chmod(path.join(fakeBin, name), 0o755);
}
const repo = async (name) => {
  const dir = path.join(temp, name);
  await mkdir(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "x\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
};
const [webDir, apiDir] = [await repo("web"), await repo("api")];
const now = new Date().toISOString();
const session = (id, name, agent) => ({ id, name, agent, status: "completed", model: "Auto", branch: "main", task: "", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] });
const project = (id, name, dir, sessions) => ({ id, name, path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: sessions.length, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions, queue: [], timeline: [] });
const projects = [project("web", "web", webDir, [session("w1", "Web work", "Claude")]), project("api", "api", apiDir, [session("a1", "Api work", "Codex"), session("a2", "Rate limits · Implementer", "Codex")])];
const task = { id: "t1", projectId: "api", identifier: "api-7", title: "Rate limits", description: "x", status: "running", priority: "medium", assignedAgent: "codex", relatedFiles: [], worktree: "api-7", createdAt: now, updatedAt: now };
const workspace = { version: 1, projects: [{ id: "web", name: "web", path: webDir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }, { id: "api", name: "api", path: apiDir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }], tasks: [task], contextEntries: [], contextSnapshots: [], sessions: [{ id: "a2", projectId: "api", taskId: "t1", type: "implementation", provider: "codex", status: "running", createdAt: now, updatedAt: now }], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, HOME: fakeHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") } });
const send = (channel, payload) => app.evaluate(({ BrowserWindow }, [channel, payload]) => BrowserWindow.getAllWindows()[0].webContents.send(channel, payload), [channel, payload]);
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  await page.evaluate(({ projects, workspace }) => {
    localStorage.clear();
    localStorage.setItem("braveli-projects", JSON.stringify(projects));
    localStorage.setItem("braveli-onboarded", "yes");
    localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
    localStorage.setItem("braveli-sidebar-project", "");
  }, { projects, workspace });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, "web");
  await page.locator("[data-sidebar-row]", { hasText: "Web work" }).click();
  await page.locator(".dk-header-titles").getByText("Web work").waitFor();

  // An agent in another project finishes.
  await send("agent:completed", { projectId: "api", sessionId: "a1", sessionName: "Api work", agent: "Codex", status: "completed", at: new Date().toISOString() });
  const toast = page.locator(".dk-toast", { hasText: "Api work finished" });
  await toast.waitFor({ timeout: 10000 });
  await toast.getByRole("button", { name: "Open session" }).click();
  await page.locator(".dk-header-titles").getByText("Api work").waitFor({ timeout: 10000 });
  assert.equal(await page.locator("[data-sidebar-row='session:a1']").getAttribute("aria-current"), "page", "its row is highlighted");
  console.log("PASS a finished agent in another project: Open session goes to that project and session");

  // Nothing about the session already on screen.
  await page.locator(".dk-toast").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const focused = await page.evaluate(() => document.hasFocus());
  if (focused) {
    await send("agent:completed", { projectId: "api", sessionId: "a1", sessionName: "Api work", agent: "Codex", status: "completed", at: new Date().toISOString() });
    await page.waitForTimeout(800);
    assert.equal(await page.locator(".dk-toast", { hasText: "Api work finished" }).count(), 0, "no news about what you are looking at");
    console.log("PASS no notification about the session on screen");
  }

  // A watch finding, from the main process, leads to its card.
  await send("automation:notice", { title: "New ticket: API-9", body: "Webhook retries", target: { section: "watch", projectId: "web", findingId: "f1" } });
  await page.locator(".dk-toast", { hasText: "New ticket: API-9" }).getByRole("button", { name: "Open in Watches" }).waitFor({ timeout: 10000 });
  console.log("PASS a watch finding offers Open in Watches");

  // The bell keeps them, each with its way back.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await panel.getByText("Api work finished").waitFor();
  await panel.getByText("New ticket: API-9").waitFor();
  await panel.locator(".dk-notes-item", { hasText: "Api work finished" }).getByRole("button", { name: "Open session" }).click();
  await page.locator(".dk-header-titles").getByText("Api work").waitFor({ timeout: 10000 });
  console.log("PASS the bell lists recent notifications, each with Open");

  // Work reaching Review says so, and opens on its review.
  await page.keyboard.press("Escape");
  await openProject(page, "web");
  await send("agent:completed", { projectId: "api", sessionId: "a2", sessionName: "Rate limits · Implementer", agent: "Codex", status: "completed", at: new Date().toISOString() });
  const reviewToast = page.locator(".dk-toast", { hasText: "Ready for review: Rate limits" });
  await reviewToast.waitFor({ timeout: 10000 });
  assert.equal(await page.locator(".dk-toast", { hasText: "Rate limits · Implementer finished" }).count(), 0, "not also 'finished'");
  await reviewToast.getByRole("button", { name: "Open review" }).click();
  await page.locator(".dk-header-titles").getByText(/Review/).waitFor({ timeout: 10000 });
  console.log("PASS work that reaches Review is announced once, and Open review opens it");

  // The macOS banner's click lands in the same place.
  await openProject(page, "web");
  await send("app:navigate", { section: "work", target: { section: "work", projectId: "api", sessionId: "a1" } });
  await page.locator(".dk-header-titles").getByText("Api work").waitFor({ timeout: 10000 });
  console.log("PASS clicking the macOS notification opens the session");

  // A watch in another project: the notice names it, and every way in lands on its card.
  const t = Date.now();
  const watchState = {
    watches: [{ id: "w-api", projectId: "api", projectPath: apiDir, kind: "review-requested", enabled: true, createdAt: t, lastCheckedAt: t, lastError: "" }],
    findings: [{ id: "f-api", key: "api#12", watchId: "w-api", projectId: "api", kind: "review-requested", number: 12, title: "Retry webhooks", url: "", author: "sam", headRef: "retry", baseRef: "main", headSha: "abc", draft: false, description: "", state: "ready", review: { verdict: "comment", summary: "Looks fine", comments: [] }, error: "", foundAt: t, updatedAt: t, postedUrl: "", reviewedSha: "abc" }],
  };
  const card = page.locator(".dk-watch-card[aria-labelledby='watch-f-api']");
  await openProject(page, "web");
  await send("watch:changed", watchState);
  await send("automation:notice", { title: "Review ready: #12", body: "Retry webhooks", target: { section: "watch", projectId: "api", findingId: "f-api" } });
  const watchToast = page.locator(".dk-toast", { hasText: "Review ready: #12" });
  await watchToast.getByText("api · Retry webhooks").waitFor({ timeout: 10000 });
  console.log("PASS a watch notice names the project it happened in");

  await send("app:navigate", { section: "watch", target: { section: "watch", projectId: "api", findingId: "f-api" } });
  await card.waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("tab", { name: /Watches/ }).getAttribute("aria-selected"), "true", "Watches is the open tab");
  console.log("PASS clicking a watch banner from another project opens that project's Watches on the card");

  await page.keyboard.press("Escape");
  await openProject(page, "web");
  await card.waitFor({ state: "detached", timeout: 10000 });
  // Again: the main process broadcasts its own (empty) watch state now and then.
  await send("watch:changed", watchState);
  const automations = page.locator(".dk-status-item", { hasText: "Automations" });
  await automations.getByLabel("1 waiting").waitFor({ timeout: 10000 });
  await automations.click();
  await card.waitFor({ timeout: 10000 });
  console.log("PASS the status bar's Automations opens the project where a finding waits");
} finally {
  await app.close();
}
console.log("Pitwall notification jump smoke test passed.");
