import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { goTo } from "./helpers/goTo.mjs";
import { readPointedPrompt } from "./fixtures/councilPrompts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braveli-project-memory-"));
const projectPath = path.join(tempRoot, "project");
const userDataPath = path.join(tempRoot, "user-data");
const fakeHome = path.join(tempRoot, "home");
const fakeBin = path.join(tempRoot, "bin");
const promptLog = path.join(tempRoot, "actual-cli-input.jsonl");
const sentinel = "MEMORY_DELIVERY_PUBLIC_7264";
const restricted = "MEMORY_DELIVERY_CLAUDE_ONLY_8492";
const privateValue = "MEMORY_DELIVERY_PRIVATE_5728";
const learned = "MEMORY_REUSABLE_ARCHITECTURE_6351";
const observationTitle = "Observed rounding entry point";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const log = (step) => process.stdout.write(`  OK  ${step}\n`);
async function waitFor(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out: ${label}`);
}

await Promise.all(
  [projectPath, userDataPath, fakeHome, fakeBin].map((directory) => mkdir(directory, { recursive: true })),
);
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });
await writeFile(
  path.join(projectPath, "README.md"),
  `# Memory fixture\n\n${learned}: Invoice rounding belongs in src/totals.ts.\n`,
);
await writeFile(
  path.join(projectPath, "package.json"),
  JSON.stringify({
    name: "memory-fixture",
    private: true,
    scripts: { test: 'node -e "console.log(\"memory fixture tests passed\")"' },
  }),
);
await mkdir(path.join(projectPath, "src"));
await writeFile(
  path.join(projectPath, "src/totals.ts"),
  "export const total = (amount: number) => Math.round(amount * 100) / 100;\n",
);
for (const args of [
  ["init", "-q", "-b", "main"],
  ["config", "user.email", "memory@example.invalid"],
  ["config", "user.name", "Memory Fixture"],
  ["add", "."],
  ["commit", "-qm", "Initial memory fixture"],
])
  execFileSync("git", args, { cwd: projectPath });

// Record the actual agent process's argv and raw PTY input. These are independent
// of Pitwall's saved snapshots and receipts, so omitted delivery cannot pass.
for (const name of ["claude", "codex"]) {
  await writeFile(
    path.join(fakeBin, name),
    `#!${process.execPath}\n` +
      `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) { console.log('${name} 1.0.0'); process.exit(0); }
if (args[0] === 'auth' || args[0] === 'login') { console.log('Logged in'); process.exit(0); }
const emit = (value) => fs.appendFileSync(${JSON.stringify(promptLog)}, JSON.stringify({ provider: '${name}', pid: process.pid, cwd: process.cwd(), ...value }) + '\\n');
if (args.includes('-p')) {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => { emit({ conductor: input }); console.log(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ next: 'implementer-codex', directive: 'Check the reusable invoice knowledge.', reason: 'Memory delivery smoke', done: false }) })); });
} else {
  emit({ args });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => { emit({ data }); if (data.includes('MEMORY_FIXTURE_EXIT')) process.exit(0); });
  process.stdin.resume();
  console.log('${name} stub ready');
  if (args.some((value) => value.includes('Work on task memory-101.'))) console.log('BRAVELI_MEMORY ' + JSON.stringify({ title: ${JSON.stringify(observationTitle)}, content: 'The rounding entry point is src/totals.ts.', kind: 'area', sourcePaths: ['src/totals.ts'] }));
}
`,
  );
  await chmod(path.join(fakeBin, name), 0o755);
}

const at = new Date().toISOString();
const project = {
  id: "memory-project",
  name: "Memory project",
  path: projectPath,
  branch: "main",
  status: "active",
  accent: "#5368dc",
  health: 100,
  openSessions: 0,
  queuedTasks: 0,
  lastCommit: "now",
  ci: "pending",
  sessions: [],
  queue: [],
  timeline: [],
};
const entry = (id, title, content, visibility, providerIds = []) => ({
  id,
  projectId: project.id,
  title,
  content,
  category: "architecture",
  visibility,
  providerIds,
  priority: 80,
  createdAt: at,
  updatedAt: at,
});
const task = (id, title) => ({
  id,
  identifier: id,
  projectId: project.id,
  title,
  description: "Use the invoice architecture and selected constraints.",
  status: "ready",
  priority: "high",
  assignedAgent: "codex",
  relatedFiles: ["src/totals.ts"],
  worktree: id,
  source: { kind: "local" },
  createdAt: at,
  updatedAt: at,
});
const workspace = {
  version: 1,
  projects: [
    {
      id: project.id,
      name: project.name,
      path: projectPath,
      defaultBranch: "main",
      providerIds: ["claude", "codex"],
      createdAt: at,
      updatedAt: at,
    },
  ],
  tasks: [task("memory-101", "Deliver ordinary task context"), task("memory-102", "Check failed launch receipt")],
  contextEntries: [
    entry("public", "Public constraint", sentinel, "all-agents"),
    entry("restricted", "Claude-only constraint", restricted, "selected-agents", ["claude"]),
    entry("private", "Private note", privateValue, "private"),
  ],
  contextSnapshots: [],
  sessions: [],
  activity: [],
  councilRuns: [],
  compareRuns: [],
};
const errors = [];
let app;
let page;

async function capturedPrompts() {
  const content = await readFile(promptLog, "utf8").catch(() => "");
  const chunks = content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const prompts = [];
  const stdin = new Map();
  for (const chunk of chunks) {
    for (const argument of chunk.args ?? [])
      if (argument.includes("REUSABLE PROJECT KNOWLEDGE"))
        prompts.push({ provider: chunk.provider, cwd: chunk.cwd, prompt: argument, mode: "argument" });
    if (chunk.data) {
      const prior = stdin.get(chunk.pid) ?? { provider: chunk.provider, cwd: chunk.cwd, data: "" };
      prior.data += chunk.data;
      stdin.set(chunk.pid, prior);
    }
  }
  for (const stream of stdin.values())
    for (const typed of stream.data.split("\r")) {
      const prompt = (await readPointedPrompt(typed, stream.cwd)) ?? typed;
      if (prompt.includes("REUSABLE PROJECT KNOWLEDGE"))
        prompts.push({ provider: stream.provider, cwd: stream.cwd, prompt: prompt.trim(), mode: "pty" });
    }
  return prompts;
}
const inspect = () =>
  page.evaluate((projectPath) => window.braveli.inspectProjectKnowledge({ projectPath }), projectPath);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("braveli-workspace-state") || "{}"));
async function openSection(name) {
  await goTo(page, name);
}
async function startTask(id, agent = "Codex") {
  await openSection("Tasks");
  // A card opens its task; the task is where a session is started from.
  await page.locator(".dk-board-card", { hasText: id }).click();
  await page.getByRole("button", { name: "Start working", exact: true }).click();
  await page.getByRole("dialog", { name: "Start task" }).getByRole("button", { name: /New session/ }).click();
  const dialog = page.getByRole("dialog", { name: "New work" });
  await dialog.getByRole("button", { name: "Agent", exact: true }).click();
  await dialog.getByRole("option").filter({ hasText: agent }).first().click();
}

async function launchApp() {
  app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      HOME: fakeHome,
      PATH: [fakeBin, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter),
      BRAVELI_E2E: "1",
      BRAVELI_USER_DATA_DIR: userDataPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    timeout: 30_000,
  });
  page = await app.firstWindow({ timeout: 20_000 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL(/index\.html$/);
}

try {
  await launchApp();
  await page.evaluate(
    ({ project, workspace }) => {
      localStorage.clear();
      localStorage.setItem("agent-studio-projects", JSON.stringify([project]));
      localStorage.setItem("agent-studio-active-project", project.id);
      localStorage.setItem("braveli-workspace-state", JSON.stringify(workspace));
      localStorage.setItem("braveli-onboarded", "yes");
    },
    { project, workspace },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const learnedResult = await page.evaluate(
    (projectPath) => window.braveli.learnProjectKnowledge({ projectPath }),
    projectPath,
  );
  assert.equal(learnedResult.ok, true, learnedResult.error);
  assert.ok(
    learnedResult.records.some((record) => record.content.includes(learned)),
    "Learning must retain source-backed architecture",
  );
  log("real Electron IPC learned the temporary repository");
  await openSection("Memory");
  await page.getByRole("button", { name: "Refresh project", exact: true }).waitFor();
  for (const title of ["Public constraint", "Claude-only constraint", "Private note"]) {
    const label = page.locator(".dk-notes label", { hasText: title });
    if (!(await label.locator('input[type="checkbox"]').isChecked())) await label.click();
    await waitFor(() => label.locator('input[type="checkbox"]').isChecked(), `select ${title}`);
  }
  await startTask("memory-101");
  await page.getByRole("button", { name: "Start", exact: true }).last().click();
  const ordinary = await waitFor(
    async () =>
      (await inspect()).receipts.find(
        (receipt) => receipt.taskId === "memory-101" && !receipt.runId && receipt.status === "delivered",
      ),
    "ordinary delivery receipt",
  );
  const actualOrdinary = await waitFor(
    async () => (await capturedPrompts()).find((capture) => hash(capture.prompt) === ordinary.payloadHash),
    "ordinary prompt received by the actual stub process",
  );
  assert.match(actualOrdinary.prompt, new RegExp(sentinel));
  assert.match(actualOrdinary.prompt, new RegExp(learned));
  assert.ok(!actualOrdinary.prompt.includes(restricted), "Codex must not receive Claude-only notes");
  assert.ok(!actualOrdinary.prompt.includes(privateValue), "Private notes must not reach an agent");
  assert.deepEqual(ordinary.manualEntryIds, ["public"]);
  assert.equal(ordinary.approximateChars, actualOrdinary.prompt.length);
  assert.equal(actualOrdinary.mode, "argument");
  assert.equal(path.resolve(actualOrdinary.cwd), path.resolve(ordinary.workspacePath));
  log("ordinary Codex argv contains selected notes and memory; receipt hash matches exact transported prompt");

  // Select the same notes for a council. Each member receives only its own
  // provider-visible context even though the council shares a thread.
  await openSection("Memory");
  for (const title of ["Public constraint", "Claude-only constraint", "Private note"]) {
    const label = page.locator(".dk-notes label", { hasText: title });
    if (!(await label.locator('input[type="checkbox"]').isChecked())) await label.click();
  }
  await openSection("Work");
  await page
    .locator(".dk-workbench-bar")
    .getByRole("button", { name: /council/i })
    .click();
  await waitFor(async () => {
    await page.getByRole("button", { name: /start council/i }).click();
    await page.waitForSelector('[aria-label="Set up Council"]');
    if ((await page.locator(".dk-council-member").count()) === 3) return true;
    await page.getByRole("dialog", { name: "Set up Council" }).getByRole("button", { name: "Close", exact: true }).click();
    return false;
  }, "stub council roster");
  await page
    .locator(".dk-council-option-label", { hasText: /agree the approach first/i })
    .locator("input")
    .uncheck();
  await page
    .locator(".dk-council-option-label", { hasText: /verify with the project's tests/i })
    .locator("input")
    .uncheck();
  await page.getByRole("dialog", { name: "Set up Council" }).getByRole("button", { name: /^Start council/ }).click();
  const first = await waitFor(
    async () =>
      (await inspect()).receipts.find(
        (receipt) => receipt.runId && receipt.provider === "claude" && receipt.status === "delivered",
      ),
    "first council prompt receipt",
  );
  const firstCapture = await waitFor(
    async () => (await capturedPrompts()).find((capture) => hash(capture.prompt) === first.payloadHash),
    "first council prompt at actual CLI",
  );
  assert.match(firstCapture.prompt, new RegExp(learned));
  assert.match(firstCapture.prompt, new RegExp(sentinel));
  assert.match(firstCapture.prompt, new RegExp(restricted));
  assert.ok(!firstCapture.prompt.includes(privateValue));
  assert.deepEqual(first.manualEntryIds.sort(), ["public", "restricted"]);
  const handoff = `TO: implementer-codex\nArchitecture mapped.\n\n## Working set\n- src/totals.ts — Memory smoke rounding boundary.\n\n## Commands\n- npm test\n\n## Accepted decisions\n- Preserve source evidence for future tasks.\n\n## Open questions\n- Confirm rounding for negative values.\n`;
  const write = await page.evaluate(
    ({ projectPath, filePath, content }) => window.braveli.writeProjectFile({ projectPath, filePath, content }),
    { projectPath: first.workspacePath, filePath: `.braveli/council/${first.runId}/stage-1.md`, content: handoff },
  );
  assert.equal(write.ok, true, write.error);
  const later = await waitFor(
    async () =>
      (await inspect()).receipts.find(
        (receipt) => receipt.runId === first.runId && receipt.provider === "codex" && receipt.status === "delivered",
      ),
    "later council prompt receipt",
  );
  const laterCapture = await waitFor(
    async () => (await capturedPrompts()).find((capture) => hash(capture.prompt) === later.payloadHash),
    "later council prompt at actual CLI",
  );
  assert.match(laterCapture.prompt, new RegExp(learned));
  assert.match(laterCapture.prompt, new RegExp(sentinel));
  assert.ok(!laterCapture.prompt.includes(restricted), "Later Codex member must not inherit Claude-only context");
  assert.ok(!laterCapture.prompt.includes(privateValue));
  assert.deepEqual(later.manualEntryIds, ["public"]);
  log(
    `first and later council prompts deliver project memory with provider visibility (${firstCapture.mode}, ${laterCapture.mode})`,
  );

  const exited = await page.evaluate(
    (sessionId) => window.braveli.writeTerminal({ sessionId, data: "MEMORY_FIXTURE_EXIT\r" }),
    ordinary.sessionId,
  );
  assert.equal(exited.ok, true);
  const observed = await waitFor(
    async () => (await inspect()).records.find((record) => record.title === observationTitle),
    "normal agent output captured on completion",
  );
  assert.equal(observed.origin, "agent");
  assert.equal(observed.status, "tentative");
  assert.equal(observed.sources[0].path, "src/totals.ts");
  assert.equal(observed.sources[0].hash, hash(await readFile(path.join(projectPath, "src/totals.ts"))));
  log("ordinary agent completion captures its own source-backed BRAVELI_MEMORY observation as tentative");

  await waitFor(
    async () =>
      (await stored()).councilRuns
        ?.find((run) => run.id === first.runId)
        ?.relay?.workingSet?.files?.some((file) => file.path === "src/totals.ts"),
    "working set persisted before restart",
  );
  await app.close();
  app = undefined;
  await launchApp();
  const restoredKnowledge = await inspect();
  assert.equal(restoredKnowledge.ok, true);
  assert.ok(restoredKnowledge.records.some((record) => record.content.includes(learned)));
  assert.equal(
    restoredKnowledge.records.filter((record) => record.title === observationTitle).length,
    1,
    "Restart must retain one observation without learning it again from old output",
  );
  assert.ok(restoredKnowledge.receipts.some((receipt) => receipt.id === ordinary.id && receipt.status === "delivered"));
  await openSection("Work");
  await page
    .locator(".dk-workbench-bar")
    .getByRole("button", { name: /council/i })
    .click();
  await page.locator(".dk-council-more > summary").click();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await page.getByText("1 file in the working set", { exact: true }).waitFor();
  await page.getByText("Confirm rounding for negative values.", { exact: true }).waitFor();
  log("full Electron restart restores learned project context, delivery receipts and council working set");

  // A executable disappearing after selection is a real spawn failure. The
  // cached provider choice lets the UI attempt it; no real CLI is substituted.
  const missingAgent = path.join(fakeBin, "missing-fixture");
  await writeFile(missingAgent, await readFile(path.join(fakeBin, "codex")));
  await chmod(missingAgent, 0o755);
  await page.evaluate(
    ({ command, at }) =>
      localStorage.setItem(
        "braveli-custom-agents",
        JSON.stringify([
          {
            id: "missing-fixture",
            name: "Missing fixture",
            command,
            args: "",
            loginCommand: "",
            models: [],
            createdAt: at,
          },
        ]),
      ),
    { command: missingAgent, at },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await startTask("memory-102", "Missing fixture");
  await rename(missingAgent, `${missingAgent}-disabled`);
  await page.getByRole("button", { name: "Start", exact: true }).last().click();
  const failed = await waitFor(
    async () =>
      (await inspect()).receipts.find((receipt) => receipt.taskId === "memory-102" && receipt.status === "failed"),
    "failed launch is recorded as failed delivery",
  );
  assert.ok(failed.error);
  assert.ok(!(await capturedPrompts()).some((capture) => hash(capture.prompt) === failed.payloadHash));
  log("failed launch records failed delivery without a matching transported prompt");
  assert.deepEqual(errors, [], "No renderer exceptions");
  await page.screenshot({ path: path.join(tempRoot, "project-memory-final.png") });
  console.log("Pitwall project memory Electron smoke test passed.");
} catch (error) {
  console.error(`Memory smoke artifacts: ${tempRoot}`);
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 6500));
    await page.screenshot({ path: path.join(tempRoot, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await app?.close();
  if (process.env.BRAVELI_KEEP_SMOKE_ARTIFACTS !== "1") await rm(tempRoot, { recursive: true, force: true });
}
