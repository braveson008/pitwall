import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electron } from "./electronLaunch.mjs";
import { expandPromptPointers } from "./fixtures/councilPrompts.mjs";
import { goTo } from "./helpers/goTo.mjs";

/**
 * The council argues out its approach before it writes any code.
 *
 * Kept separate from council-relay-smoke.mjs because the two scenarios need
 * opposite things: that one proves the *conductor* routes each handoff, and
 * while a debate is open the conductor does not route at all. Running both in
 * one file would mean every turn number in the routing scenario shifted by the
 * length of a debate.
 *
 * What this proves, which no unit test can: the opening brief actually reaches
 * the first member's PTY, the second turn goes to the second member rather than
 * wherever the conductor asked, and a settled debate hands the agreed approach
 * to the turn that finally does the work.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-debate-"));
const projectPath = path.join(tempRoot, "debate-project");
const userDataPath = path.join(tempRoot, "user-data");
const fakeBin = path.join(tempRoot, "bin");
const fakeHome = path.join(tempRoot, "home");

for (const dir of [projectPath, userDataPath, fakeBin, fakeHome]) {
  await mkdir(dir, { recursive: true });
}

// The stub CLI represents an initialized provider; trust uses the real writer.
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });

// Every turn the *conductor* would route goes here. The debate must ignore it
// entirely — that is what makes "turn 2 went to the second member" meaningful
// rather than a coincidence of rotation.
const CONDUCTOR_PICKS = "architect-claude";
// The conductor routes by handle; the bar names members by their role, because
// that is the fact a reader is after. The handle is Pitwall's own plumbing.
const LABEL = { "architect-claude": "Architect", "implementer-codex": "Implementer", "qa-claude": "Reviewer / QA" };
const conductorEnvelope = JSON.stringify({
  type: "result",
  is_error: false,
  result: JSON.stringify({
    next: CONDUCTOR_PICKS,
    directive: "Conductor directive.",
    reason: "stub conductor",
    done: false,
  }),
});

/** Every prompt an agent was handed, so the test can read what was asked. */
const promptLog = path.join(tempRoot, "agent-prompts.txt");

for (const name of ["claude", "codex"]) {
  const file = path.join(fakeBin, name);
  const printMode = [
    'for arg in "$@"; do',
    '  if [ "$arg" = "-p" ]; then',
    `    printf '%s' '${conductorEnvelope}'`,
    "    exit 0",
    "  fi",
    "done",
  ].join("\n");
  // Provider TUIs read raw input. Canonical shell input can drop a complete
  // long context packet before tee receives it, which does not model the CLI.
  await writeFile(
    file,
    `#!/bin/sh\n${name === "claude" ? `${printMode}\n` : ""}stty raw -echo 2>/dev/null || true\necho "${name} stub ready"\nexec tee -a '${promptLog}' >/dev/null\n`,
  );
  await chmod(file, 0o755);
}

const injectedPrompts = async () => expandPromptPointers(await readFile(promptLog, "utf8").catch(() => ""), tempRoot);

await writeFile(path.join(projectPath, "README.md"), "# Debate project\n");
await writeFile(
  path.join(projectPath, "package.json"),
  `${JSON.stringify({ name: "debate-project", version: "1.0.0", scripts: { test: "node -e \"process.exit(0)\"" } }, null, 2)}\n`,
);
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
execFileSync("git", ["config", "user.email", "debate@example.invalid"], { cwd: projectPath });
execFileSync("git", ["config", "user.name", "Debate Test"], { cwd: projectPath });
execFileSync("git", ["add", "."], { cwd: projectPath });
execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: projectPath });

const log = (step) => process.stdout.write(`  OK  ${step}\n`);

async function waitFor(predicate, timeoutMs = 30_000, intervalMs = 150) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms (last value: ${JSON.stringify(last)})`);
}

const project = {
  id: "debate-project",
  name: "Debate project",
  path: projectPath,
  branch: "main",
  status: "watching",
  accent: "#9db7ff",
  health: 0,
  openSessions: 0,
  queuedTasks: 0,
  lastCommit: "just added",
  ci: "pending",
  queue: [],
  timeline: [],
  sessions: [],
};

const workspace = {
  version: 1,
  projects: [
    {
      id: project.id,
      name: project.name,
      path: projectPath,
      defaultBranch: "main",
      providerIds: ["claude", "codex"],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ],
  tasks: [
    {
      id: "debate-task",
      identifier: "debate-1",
      projectId: project.id,
      title: "Add a health endpoint",
      description: "It should return 200 and the build SHA.",
      status: "ready",
      priority: "high",
      assignedAgent: "council",
      relatedFiles: [],
      worktree: "debate-1",
      source: { kind: "local" },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  ],
  contextEntries: [],
  contextSnapshots: [],
  sessions: [],
  activity: [],
  councilRuns: [],
  compareRuns: [],
};

// The machine's PATH without folders that hold other agent CLIs: the council
// is made of the stubs, and an installed Gemini or Kimi would join it.
const OTHER_AGENTS = ["gemini", "grok", "kimi", "qwen", "opencode", "aider", "goose", "crush", "droid", "amp", "auggie"];
const hostPath = (process.env.PATH || "")
  .split(path.delimiter)
  .filter((entry) => entry && !OTHER_AGENTS.some((name) => existsSync(path.join(entry, name))))
  .join(path.delimiter);

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}${path.delimiter}${hostPath}`,
    PITWALL_E2E: "1",
    PITWALL_USER_DATA_DIR: userDataPath,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  timeout: 30_000,
});

try {
  const page = await app.firstWindow({ timeout: 20_000 });
  page.on("pageerror", (error) => process.stdout.write(`  RENDERER ERROR  ${error.message}\n`));
  await page.waitForURL(/index\.html$/);
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(
    ({ projectValue, workspaceValue }) => {
      localStorage.clear();
      localStorage.setItem("agent-studio-projects", JSON.stringify([projectValue]));
      localStorage.setItem("agent-studio-active-project", projectValue.id);
      localStorage.setItem("pitwall-workspace-state", JSON.stringify(workspaceValue));
      localStorage.setItem("pitwall-onboarded", "yes");
    },
    { projectValue: project, workspaceValue: workspace },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  log("app launched with stub agent CLIs on PATH");

  await goTo(page, "Work");
  await page.locator(".dk-workbench-bar").getByRole("button", { name: /council/i }).click();
  const setup = page.getByRole("dialog", { name: "Set up Council" });
  const rows = setup.locator(".dk-council-member");
  await waitFor(async () => {
    await page.getByRole("button", { name: /start council/i }).click();
    await page.waitForSelector('[aria-label="Set up Council"]');
    if ((await rows.count()) === 3) return true;
    await setup.getByRole("button", { name: "Close", exact: true }).click();
    return null;
  });

  const debateToggle = page
    .locator(".dk-council-option-label", { hasText: /agree the approach first/i })
    .locator("input");
  assert.equal(await debateToggle.isChecked(), true, "the opening debate should be on by default");

  await setup.getByRole("button", { name: /^Start council/ }).click();
  await waitFor(async () => page.evaluate(() => Boolean(JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}").councilRuns?.[0])));
  log("council started with the opening debate on");

  // The relay runs inside the task's worktree; ask the app where that is.
  const relayPath = await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
      const run = state.councilRuns?.[0];
      if (!run) return null;
      const session = state.sessions?.find((item) => item.id === run.responses?.[0]?.sessionId);
      return session ? { runId: run.id, path: session.worktreePath || null } : null;
    }),
  );
  const stageDir = relayPath.path || projectPath;

  /** A member finishing its turn: the stage file is what the relay watches. */
  const writeStage = (turn, body) =>
    page.evaluate(
      ({ dir, file, content }) => window.pitwall.writeProjectFile({ projectPath: dir, filePath: file, content }),
      { dir: stageDir, file: `.pitwall/council/${relayPath.runId}/stage-${turn}.md`, content: body },
    );

  /** Who the route bar says the turn went to, and why. */
  // The route bar sits beside the terminals: the council opens on the thread,
  // where every hop is already in place with its reason, so the strip above it
  // would only repeat the latest one. Routing is asserted against the bar, so
  // the test has to be where the bar is.
  const agentsView = page.getByRole("group", { name: "View", exact: true }).getByRole("button", { name: "Terminals", exact: true });
  await agentsView.waitFor();
  await agentsView.click();

  const currentTurn = async () => {
    const text = await page.locator(".dk-council-turn").first().textContent();
    return Number((/turn (\d+)/i.exec(text || "") || [])[1]);
  };

  const routeFor = async () => {
    const bar = page.locator(".dk-council-route");
    if ((await bar.count()) === 0) return null;
    return {
      to: (await bar.locator(".dk-council-route-hop strong").first().textContent())?.trim(),
      reason: (await bar.locator(".dk-council-route-reason").first().textContent())?.trim(),
    };
  };

  // --- Turn 1: the opening brief, not the task ---------------------------
  const firstPrompt = await waitFor(async () => {
    const text = await injectedPrompts();
    return /deciding how to approach this work/i.test(text) ? text : null;
  });
  assert.match(
    firstPrompt,
    /do not defer to the others and do not edit any files this turn/i,
    "the opening brief must forbid editing, or the first member builds while the rest are still deciding",
  );
  assert.match(firstPrompt, /Name the risk you think the others are most likely to miss/i);
  // The relay always delivers the task as a pointer to task.md rather than
  // inline, so the brief carries the pointer and the file carries the task.
  assert.match(firstPrompt, /task\.md/, "the brief must point at the task brief");
  assert.match(
    firstPrompt,
    /debating with Implementer \(Codex\), addressed as implementer-codex/i,
    "each member must be told who else is on the council and how to address them",
  );
  log("turn 1 asked the first member for its approach, not for the work");

  // --- Turn 2: the next member, not the conductor's pick -----------------
  await writeStage(1, "I'd add the route to the existing server module and keep it dependency-free.");

  const second = await waitFor(async () => {
    const route = await routeFor();
    return route?.reason && /opening debate/i.test(route.reason) ? route : null;
  }, 45_000);
  assert.equal(
    second.to,
    LABEL["implementer-codex"],
    "turn 2 belongs to the next member in the debate, not to whoever the conductor named",
  );
  assert.notEqual(second.to, LABEL[CONDUCTOR_PICKS], "the conductor must not route while the council is still deciding");
  assert.match(second.reason, /Opening debate, round 1/i);
  log(`turn 2 went to ${second.to} — the conductor asked for ${CONDUCTOR_PICKS}`);

  // --- Round 1 completes, and only then does the argument begin ----------
  // Sequenced on the route bar rather than on the prompt log: only the boot
  // turn is injected at session creation, so later turns do not echo through
  // the stub's stdin. The bar is the app's own account of where each turn went,
  // which is the thing under test anyway.
  const routeAt = async (predicate) =>
    waitFor(async () => {
      const route = await routeFor();
      return route && predicate(route) ? route : null;
    }, 45_000);

  await writeStage(2, "I'd write the test first; the route is trivial either way.");
  const third = await routeAt((route) => route.to === LABEL["qa-claude"] && /round 1/i.test(route.reason));
  assert.match(third.reason, /Opening debate, round 1/i);
  log("round 1 asked all three members for a position before anyone answered");

  await writeStage(3, "I'd put it behind the existing health package so it stays isolated.");
  const roundTwo = await routeAt((route) => /Opening debate, round 2/i.test(route.reason));
  assert.match(
    roundTwo.reason,
    /Opening debate, round 2/i,
    "with every position stated, the council argues them rather than declaring consensus nobody reached",
  );
  log(`round 1 closed with three positions and round 2 opened on ${roundTwo.to}`);

  // --- A settled debate stops and shows its plan --------------------------
  // Two members concede, so the debate closes on the architect's position.
  await writeStage(4, "AGREE: architect-claude\nThe package boundary is the right call.");
  await writeStage(5, "AGREE: architect-claude\nFine by me, as long as it is covered.");
  await writeStage(6, "HOLD: it is still the cleanest boundary.");

  // An agreed approach is not permission to build it. The council used to fall
  // straight through into the first working turn, so it went off and
  // implemented a plan the person who convened it had not read yet.
  const agreed = await waitFor(async () => {
    const text = await page.locator(".dk-council-status").first().textContent().catch(() => null);
    return text && /agreed an approach/i.test(text) ? text : null;
  }, 45_000);
  assert.match(agreed, /has not started building it/i);
  // Read once rather than waited on: the claim is that nothing was routed, and
  // waiting for something not to happen only proves the timeout works.
  const parked = await routeFor();
  assert.match(
    parked?.reason ?? "",
    /Opening debate/i,
    "nothing should have been routed to work while the plan waits to be read",
  );
  log("the settled debate stopped and offered its plan rather than building it");

  // And the one press that turns the plan into work carries it unchanged.
  // Followed on the turn rather than the route bar: starting the work by hand
  // hands the baton on without asking the conductor, so there is no new routing
  // decision to record — which is the point of pressing the button yourself.
  const debateTurn = await currentTurn();
  await page.locator(".dk-council-status .dk-council-handoff").click();
  await waitFor(async () => ((await currentTurn()) > debateTurn ? true : null), 45_000);
  const resumedNote = (await page.locator(".dk-council-status").allTextContents()).join(" ");
  assert.doesNotMatch(resumedNote, /agreed an approach|start the work/i, "the council is running again, so it should not still be showing why it stopped");
  log(`plan accepted and the council moved on to turn ${await currentTurn()}`);

  const thread = await readFile(
    path.join(stageDir, ".pitwall", "council", relayPath.runId, "thread.md"),
    "utf8",
  ).catch(() => "");
  assert.match(thread, /architect-claude/, "the thread should record the debate");
  log("the debate was written into the thread every member reads");

  process.stdout.write("\nPitwall council opening debate smoke test passed.\n");
} finally {
  await app.close();
  if (process.env.PITWALL_KEEP_SMOKE_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
  }
}
