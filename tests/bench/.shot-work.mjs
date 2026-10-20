import { _electron as electron } from "playwright";
import os from "node:os"; import path from "node:path"; import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises"; import { execFileSync } from "node:child_process";
const out = process.argv[2]; const theme = process.argv[3] || "light";
const temp = await mkdtemp(path.join(os.tmpdir(), "pitwall-shot-"));
const bin = path.join(temp, "bin"); await mkdir(bin);
await writeFile(path.join(bin, "claude"), `#!/bin/bash
case "$1" in --version) echo "2.2.0 (Claude Code)"; exit 0;; --help) echo "  --settings <file-or-json>"; exit 0;; esac
printf '\\n⏺ Reading src/webhooks/retry.ts\\n\\n⏺ The retry loop gives up after one attempt because maxAttempts is read\\n  before the config loads. I will move the read into the handler.\\n\\n⏺ Update(src/webhooks/retry.ts)\\n  ⎿  Updated with 4 additions and 2 removals\\n\\n⏺ Bash(npm test -- retry)\\n  ⎿  PASS  src/webhooks/retry.test.ts (6 tests)\\n\\n❯ \\n'
exec sleep 600
`); await chmod(path.join(bin, "claude"), 0o755);
const dir = path.join(temp, "payments"); await mkdir(dir); execFileSync("git", ["init","-q","-b","main"], { cwd: dir }); await writeFile(path.join(dir,"a.md"),"x"); execFileSync("git",["add","."],{cwd:dir}); execFileSync("git",["-c","user.email=a@b","-c","user.name=t","commit","-qm","i"],{cwd:dir});
const now = new Date().toISOString();
const session = { id: "s9", name: "Retry failed webhooks", agent: "Claude", model: "auto", status: "running", branch: "pay-9", worktreePath: dir, task: "Retry failed webhooks", progress: 0, tokens: "0", approvals: 0, risk: "low", files: 0, started: now, logs: [] };
const project = { id: "payments", name: "payments", path: dir, branch: "main", status: "active", accent: "#5368dc", health: 100, openSessions: 1, queuedTasks: 0, lastCommit: "now", ci: "pending", sessions: [session], queue: [], timeline: [] };
const tasks = [["t1","PAY-7","Add the step helpers","review"],["t3","PAY-14","Export refunds as CSV","ready"],["t5","PAY-9","Retry failed webhooks","running"]].map(([id,identifier,title,status]) => ({ id, projectId: "payments", identifier, title, description: "Webhooks that fail should be retried with backoff.", status, priority: "medium", assignedAgent: "claude", relatedFiles: [], worktree: identifier === "PAY-9" ? "pay-9" : "", createdAt: now, updatedAt: now }));
const workspace = { version: 1, projects: [{ id: "payments", name: "payments", path: dir, defaultBranch: "main", providerIds: [], createdAt: now, updatedAt: now }], tasks, contextEntries: [], contextSnapshots: [], sessions: [{ id: "s9", projectId: "payments", provider: "claude", taskId: "t5", type: "implementation", status: "running", model: "auto", worktreePath: dir, messages: [], contextSnapshotId: "", createdAt: now, updatedAt: now }], activity: [], taskRuns: [], councilRuns: [], compareRuns: [] };
const app = await electron.launch({ args: [process.cwd()], cwd: process.cwd(), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PITWALL_E2E: "1", PITWALL_USER_DATA_DIR: path.join(temp, "profile") } });
const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1500);
await page.evaluate(({ project, workspace, theme }) => { localStorage.clear(); localStorage.setItem("pitwall-projects", JSON.stringify([project])); localStorage.setItem("pitwall-onboarded", "yes"); localStorage.setItem("pitwall-theme", theme); localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspace)); }, { project, workspace, theme });
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(2500);
await page.locator(".dk-tsb-row", { hasText: "Retry failed webhooks" }).click(); await page.waitForTimeout(4000);
await page.screenshot({ path: out }); await app.close();
