import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { expandPromptPointers } from "./fixtures/councilPrompts.mjs";
import { goTo } from "./helpers/goTo.mjs";

/**
 * Drives the council relay end to end with stub CLIs on PATH, so conductor-led
 * routing is proven against the real app without spawning a real model or
 * spending a token. The stub conductor always names the same member, which is
 * what makes the assertions meaningful: plain rotation would pick someone else
 * every time, so any turn landing where the conductor asked can only have been
 * routed there.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pitwall-relay-"));
const projectPath = path.join(tempRoot, "relay-project");
const userDataPath = path.join(tempRoot, "user-data");
const fakeBin = path.join(tempRoot, "bin");
const fakeHome = path.join(tempRoot, "home");

await mkdir(projectPath, { recursive: true });
await mkdir(userDataPath, { recursive: true });
await mkdir(fakeBin, { recursive: true });
await mkdir(fakeHome, { recursive: true });
// The stub CLI represents an initialized provider; trust still uses the real writer.
await writeFile(path.join(fakeHome, ".claude.json"), JSON.stringify({ projects: {} }), { mode: 0o600 });

// The council always routes to this member, whoever spoke last.
const ROUTED_TO = "qa-claude";
// The conductor routes by handle; the bar names the member by its role, which
// is the fact a reader is after — the handle is Pitwall's own plumbing.
const ROUTED_TO_LABEL = "Reviewer / QA";

// `claude -p` is also how the conductor runs, so the claude stub has to answer
// in two different ways: a routing decision in print mode, and a long-lived
// terminal session otherwise.
const envelope = (decision) => JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(decision) });

const conductorEnvelope = envelope({
  next: ROUTED_TO,
  directive: "Verify the rejoin path.",
  reason: "stub conductor",
  done: false,
});

// Both are advisory roles, so the council is allowed to consult them at once.
// The architect leads so the panel turn is not attributed to the member the stub
// already routes to every time, which would trip the anti-stall guard.
const PANEL = ["architect-claude", ROUTED_TO];
const panelEnvelope = envelope({
  next: PANEL[0],
  panel: PANEL,
  directive: "Both of you review the change independently.",
  reason: "stub conductor panel",
  done: false,
});

// The stub switches to calling a panel once this file exists, which keeps the
// test in control of when parallel routing happens.
const panelFlag = path.join(tempRoot, "panel-mode");

// Deliberately small, so the run reaches its own limit within a few turns
// instead of needing the default 24 to prove the cap is honoured.
const TURN_LIMIT = 4;

// Every routing prompt is kept so the test can assert on what the conductor was
// actually told, rather than only on where the work ended up.
const promptLog = path.join(tempRoot, "conductor-prompts.txt");
const memberPromptLog = path.join(tempRoot, "member-prompts.txt");

// Stub agent CLIs: print a banner so the session "settles", then hold the PTY
// open on stdin so the pane stays alive for the whole relay.
for (const name of ["claude", "codex"]) {
  const file = path.join(fakeBin, name);
  const printMode = [
    'for arg in "$@"; do',
    '  if [ "$arg" = "-p" ]; then',
    `    cat >> '${promptLog}'`,
    `    printf '\\n<<<PROMPT-END>>>\\n' >> '${promptLog}'`,
    `    if [ -f '${panelFlag}' ]; then`,
    `      printf '%s' '${panelEnvelope}'`,
    "    else",
    `      printf '%s' '${conductorEnvelope}'`,
    "    fi",
    "    exit 0",
    "  fi",
    "done",
  ].join("\n");
  await writeFile(
    file,
    `#!/bin/sh\n${name === "claude" ? `${printMode}\n` : ""}stty raw -echo\necho "${name} stub ready"\nexec cat >> '${memberPromptLog}'\n`,
  );
  await chmod(file, 0o755);
}

async function readMemberPrompts() {
  return expandPromptPointers(await readFile(memberPromptLog, "utf8").catch(() => ""), tempRoot);
}

/** The most recent prompt the conductor was given. */
const lastConductorPrompt = async () => {
  const log = await readFile(promptLog, "utf8").catch(() => "");
  const prompts = log.split("<<<PROMPT-END>>>").filter((entry) => entry.trim());
  return prompts.at(-1) || "";
};

await writeFile(path.join(projectPath, "README.md"), "# Relay project\n");
// A project whose tests fail, so the council can be watched noticing that the
// work does not actually work.
await writeFile(
  path.join(projectPath, "package.json"),
  `${JSON.stringify(
    { name: "relay-project", version: "1.0.0", scripts: { test: "node -e \"console.error('deliberately failing council test'); process.exit(1)\"" } },
    null,
    2,
  )}\n`,
);
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectPath });
execFileSync("git", ["config", "user.email", "relay@example.invalid"], { cwd: projectPath });
execFileSync("git", ["config", "user.name", "Relay Test"], { cwd: projectPath });
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
  id: "relay-project",
  name: "Relay project",
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
      id: "relay-task",
      identifier: "relay-loop",
      projectId: project.id,
      title: "Relay loop",
      description: "Pass work back and forth.",
      status: "ready",
      priority: "high",
      assignedAgent: "council",
      relatedFiles: [],
      worktree: "relay-loop",
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

// The machine's PATH without folders that hold other agent CLIs. The council
// is made of the stubs; a Gemini or Kimi someone installed would join it and
// change who the conductor's handles name.
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
    HOME: fakeHome, // keep project:trust away from the real ~/.claude.json
    PATH: `${fakeBin}${path.delimiter}${hostPath}`,
    PITWALL_E2E: "1",
    PITWALL_USER_DATA_DIR: userDataPath,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  timeout: 30_000,
});

try {
  const page = await app.firstWindow({ timeout: 20_000 });
  // A relay that silently stops advancing is the failure mode this test exists
  // to catch, and the cause is almost always an exception in the routing path.
  page.on("pageerror", (error) => process.stdout.write(`  RENDERER ERROR  ${error.message}\n`));
  page.on("console", (message) => {
    if (message.type() === "error") process.stdout.write(`  CONSOLE ERROR  ${message.text()}\n`);
  });
  // The council opens on its thread; routing is asserted against the route bar,
  // which sits beside the terminals, so the test works from the Agents view.
  const agentsView = () => page.getByRole("group", { name: "View", exact: true }).getByRole("button", { name: "Terminals", exact: true });
  const openCouncilWorkbench = async () => {
    await goTo(page, "Work");
    await page.locator(".dk-workbench-bar").getByRole("button", { name: /council/i }).click();
    if (await agentsView().count()) await agentsView().click();
  };
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

  // Start the seeded council: Architect (Claude), Implementer (Codex), QA (Claude).
  await openCouncilWorkbench();
  const setup = page.getByRole("dialog", { name: "Set up Council" });
  const rows = setup.locator(".dk-council-member");
  // The modal seeds its rows from the agent install checks, and it seeds once on
  // open — so a modal opened before those checks land offers a row per *known*
  // agent rather than per installed one. Reopen until the roster settles at the
  // two stubbed CLIs, otherwise the council would boot an agent that is not on
  // PATH and the handles under test would name the wrong member.
  await waitFor(async () => {
    await page.getByRole("button", { name: /start council/i }).click();
    await page.waitForSelector('[aria-label="Set up Council"]');
    if ((await rows.count()) === 3) return true;
    await setup.getByRole("button", { name: "Close", exact: true }).click();
    return null;
  });
  // The conductor, the opening debate and the test-verification pass are all
  // under test, so all three must be on by default. Located by label rather
  // than by position: a positional assertion breaks the moment a toggle is
  // added above it, which says nothing about whether the feature still works.
  for (const label of [/Conductor/, /agree the approach first/i, /verify with the project's tests/i]) {
    const toggle = setup.locator(".dk-council-option-label", { hasText: label }).locator("input");
    assert.equal(await toggle.count(), 1, `one toggle should match ${label}`);
    assert.equal(await toggle.isChecked(), true, `${label} should be on by default`);
  }
  // This scenario is about conductor-led routing, so the opening debate is
  // turned off for it: while a debate is open the conductor does not route at
  // all, and every turn number below would shift. The debate has its own smoke
  // in council-opening-debate-smoke.mjs.
  await setup.locator(".dk-council-option-label", { hasText: /agree the approach first/i }).locator("input").uncheck();

  // The turn limit is chosen here; a low one is set so the cap can be reached
  // and raised without driving 24 turns first.
  const turnDropdown = page.locator('[aria-label="Turn limit"]');
  assert.equal(await turnDropdown.count(), 1, "a turn limit picker should be offered");
  // Every control must sit inside the modal: a dropdown that is width:100% in a
  // flex row silently overflows the dialog and becomes unusable.
  const modalBox = await setup.boundingBox();
  for (const selector of [".dk-council-option-select", ".dk-council-turn-label", '[aria-label="Turn limit"]']) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(
      box && box.x >= modalBox.x - 1 && box.x + box.width <= modalBox.x + modalBox.width + 1,
      `${selector} should stay within the modal (modal ${modalBox.x}..${modalBox.x + modalBox.width}, element ${box?.x}..${box ? box.x + box.width : "?"})`,
    );
  }
  // Fitting inside the modal is not enough: an overreaching control squeezes the
  // copy beside it into a one-word-per-line column that technically still fits.
  for (const selector of [".dk-council-option-label", ".dk-council-turn-label"]) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(
      box && box.width > modalBox.width * 0.5,
      `${selector} should keep at least half the row (got ${box?.width} of ${modalBox.width})`,
    );
  }
  log("council settings rows fit inside the modal");
  await turnDropdown.click();
  await page.locator(".dk-dropdown-menu .dk-dropdown-option", { hasText: "Custom" }).click();
  await setup.locator(".dk-council-turn-custom").fill(String(TURN_LIMIT));
  log(`turn limit set to ${TURN_LIMIT} for this run`);
  await setup.getByRole("button", { name: /^Start council/ }).click();
  log("council started with three members and the conductor on");
  await agentsView().waitFor();
  await agentsView().click();

  // A member on turn wears one of two badges, and which one depends on whether
  // it is the single member the conductor routed to or one of several consulted
  // at once. The solo case says "Speaking" and carries no number, so the turn is
  // read from the bar — which is the one place it is stated outright.
  // The members holding the turn: each pane says its own state, so this is the
  // set of panes that say they are on it.
  const onTurn = () => page.locator(".dk-council-pane").filter({
    has: page.locator(".dk-council-pane-state", { hasText: /speaking|turn \d+/i }),
  });

  const currentTurnNumber = async () => {
    // The header states the turn outright, as "Turn N of M".
    const text = await page.locator(".dk-council-turn").first().textContent();
    return Number((/turn (\d+)/i.exec(text || "") || [])[1]);
  };

  const activeTurn = async () => {
    // Every member has a pane now, and each pane says what its own member is
    // doing — there is no strip above them saying it for all of them at once.
    const speaking = onTurn();
    if ((await speaking.count()) === 0) return null;
    const label = await speaking.first().locator(".dk-council-pane-who strong").first().textContent();
    return { turn: await currentTurnNumber(), agent: (label || "").trim() };
  };

  const first = await waitFor(async () => {
    const state = await activeTurn();
    return state?.turn === 1 ? state : null;
  });
  log(`turn 1 is active on ${first.agent}`);

  // Each CLI must believe it has the width its pane actually has. Spawning at a
  // fixed guess makes the agent wrap for a terminal that does not exist, and the
  // pane shows overlapping mid-word text that nothing reports as an error.
  //
  // The thread lies over the panes rather than replacing them, so every
  // member's pane is laid out from the moment the council opens, and has a
  // width to match straight away.
  await page.locator(".dk-council-grid .dk-council-pane").first().waitFor();
  const ptySizes = await waitFor(async () => {
    const sizes = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
      const ids = (state.councilRuns?.[0]?.responses || []).map((response) => response.sessionId);
      return Promise.all(ids.map((id) => window.pitwall.getTerminalSize(id)));
    });
    return sizes.length && sizes.every((size) => size?.ok && size.cols) ? sizes : null;
  });
  // Three panes side by side are far narrower than the old hardcoded 132.
  for (const size of ptySizes) {
    assert.ok(
      size.cols < 132,
      `a council pane's PTY should match its rendered width, not a fixed guess (got ${size.cols} cols)`,
    );
  }
  log(`every council PTY matches its pane (${ptySizes.map((size) => `${size.cols}x${size.rows}`).join(", ")})`);

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

  // A panel member writes its own suffixed file; a solo turn writes the plain one.
  const writeStage = (turn, body, memberId) =>
    page.evaluate(
      ({ dir, file, content }) => window.pitwall.writeProjectFile({ projectPath: dir, filePath: file, content }),
      {
        dir: stageDir,
        file: `.pitwall/council/${relayPath.runId}/stage-${turn}${memberId ? `-${memberId}` : ""}.md`,
        content: body,
      },
    );

  // Panes are labelled by agent and two members run on Claude, so routing is
  // asserted against the conductor bar, which names the member handle.
  const routeFor = async (turn) => {
    const bar = page.locator(".dk-council-route");
    if ((await bar.count()) === 0) return null;
    const state = await activeTurn();
    if (state?.turn !== turn) return null;
    return {
      to: (await bar.locator(".dk-council-route-hop strong").first().textContent())?.trim(),
      source: (await bar.locator(".dk-council-route-source").first().getAttribute("class")) || "",
      reason: (await bar.locator(".dk-council-route-reason").first().textContent())?.trim(),
    };
  };

  // --- The behaviour under test: the conductor picks who speaks next. ---
  await writeStage(1, "Design done. Someone should build the vault loop.");
  const second = await waitFor(() => routeFor(2));
  assert.equal(second.to, ROUTED_TO_LABEL, "turn 2 should go where the conductor asked, not where rotation would");
  assert.match(second.source, /conductor/, "turn 2 should be attributed to the conductor");
  assert.equal(second.reason, "Verify the rejoin path.", "the conductor's directive should reach the pane");
  log(`conductor routed turn 2 to ${second.to} — rotation would have picked the implementer`);

  // --- The conductor routes on what the repository says, not on the claim. ---
  const firstPrompt = await lastConductorPrompt();
  assert.match(firstPrompt, /## Repository evidence/, "the conductor should be given repository ground truth");
  assert.match(firstPrompt, /ground truth/, "the evidence should be marked as outranking the handoffs");
  // The stub agents write handoffs but no code, and the council's own bookkeeping
  // files must not be mistaken for work.
  assert.match(firstPrompt, /No files changed during this turn\./, "handoff files must not count as work");
  assert.match(firstPrompt, /working tree is clean/, "the council's own artefacts must be excluded from evidence");
  log("conductor was told the repository is untouched despite the handoff claiming progress");

  // Real code landing in the worktree must show up as evidence on the next hop.
  await page.evaluate(
    ({ dir }) =>
      window.pitwall.writeProjectFile({
        projectPath: dir,
        filePath: "src/rejoin.ts",
        content: "export const rejoin = () => true;\n",
      }),
    { dir: stageDir },
  );

  // An instruction typed into the council has to reach the conductor, or it
  // routes against a transcript that never heard it.
  await openCouncilWorkbench();
  const instruction = "Stop gold-plating and ship the minimal fix.";
  // The composer addresses the member on turn by default now, and this is
  // asserting that every member hears it.
  await page.locator(".dk-council-composer").getByRole("button", { name: "Everyone" }).click();
  await page.locator(".dk-council-composer input").fill(instruction);
  await page.locator(".dk-council-composer button[type=submit]").click();
  await waitFor(async () => ((await page.locator(".dk-council-composer input").inputValue()) === "" ? true : null));
  log("instruction broadcast to every member");

  // A member may take a follow-up turn; that is a conversation, not a stall.
  await writeStage(2, "Found a race in the rejoin path. Still checking the retry path.");
  const third = await waitFor(() => routeFor(3));
  assert.equal(third.to, ROUTED_TO_LABEL, "the conductor may keep the work with one member for a follow-up");
  assert.match(third.source, /conductor/, "turn 3 should still be attributed to the conductor");
  log(`turn 3 stayed with ${third.to} on the conductor's instruction`);

  const informedPrompt = await lastConductorPrompt();
  assert.match(informedPrompt, /src\/rejoin\.ts/, "code written to the worktree should appear as evidence");
  assert.ok(
    informedPrompt.includes(instruction),
    "the user's instruction should reach the conductor, not just the terminals",
  );
  assert.match(
    informedPrompt,
    /Instruction from the person running this council/,
    "the user should be attributed as an instruction, not as a council member",
  );
  log("conductor saw the new file on disk and the user's instruction");

  // ...but a member that keeps being handed its own work back is a stalled
  // council, so the baton is forced onward regardless of what the conductor says.
  await writeStage(3, "Still reviewing. I have more to check.");
  const fourth = await waitFor(() => routeFor(4));
  assert.notEqual(fourth.to, ROUTED_TO_LABEL, "a third consecutive turn should be forced away from the same member");
  assert.match(fourth.source, /rotation/, "the anti-stall guard should route by rotation");
  log(`anti-stall guard moved turn 4 off ${ROUTED_TO_LABEL} and on to ${fourth.to}`);

  // --- The run's turn limit stops it, and can be raised in place. ---
  await writeStage(4, "Reviewed. Implementer: fix the two findings.");
  const limitNote = await waitFor(async () => {
    const text = await page.locator(".dk-council-status").first().textContent().catch(() => null);
    return text && /Paused after/.test(text) ? text : null;
  });
  assert.match(
    limitNote,
    new RegExp(`Paused after ${TURN_LIMIT} turns`),
    "the pause should name the limit the user actually chose, not a hardcoded one",
  );
  assert.ok(
    (await page.locator(".dk-council-extend button").count()) >= 1,
    "a council paused at its limit should offer to raise it",
  );
  log(`council paused at its chosen ${TURN_LIMIT}-turn limit`);

  // --- Reconfiguring a council that is already running. ---
  await openCouncilWorkbench();
  await page.locator(".dk-council-more").evaluate((menu) => { menu.open = true; });
  await page.locator(".dk-council-more-menu").getByRole("button", { name: "Council settings" }).click();
  await page.waitForSelector(".dk-council-config");
  const liveTurns = page.locator('.dk-council-config [aria-label="Turn limit"]');
  assert.equal(await liveTurns.count(), 1, "a running council should expose its turn limit");
  assert.equal(
    await page.locator(".dk-council-config input[type=checkbox]").first().isChecked(),
    true,
    "the panel should show the conductor's real current state, not a default",
  );

  // Raising the limit here must resume the hop the old limit blocked, exactly
  // as the +24 button does — this is the same council, mid-conversation.
  await liveTurns.click();
  await page.locator(".dk-dropdown-menu .dk-dropdown-option", { hasText: "36 turns" }).click();
  await waitFor(() => routeFor(5));
  log("turn limit raised from the live settings panel — the council resumed without a restart");

  // Turning the conductor off mid-run must persist to the stored run.
  await page.locator(".dk-council-config input[type=checkbox]").first().uncheck();
  await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
      return state.councilRuns?.[0]?.relay?.conductor?.enabled === false ? true : null;
    }),
  );
  await page.locator(".dk-council-config input[type=checkbox]").first().check();
  await waitFor(async () =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
      return state.councilRuns?.[0]?.relay?.conductor?.enabled === true ? true : null;
    }),
  );
  await page.locator(".dk-council-more").evaluate((menu) => { menu.open = true; });
  await page.locator(".dk-council-more-menu").getByRole("button", { name: "Council settings" }).click();
  log("live config changes persisted to the stored run");

  // --- A panel: two advisory members consulted at once. ---
  await writeFile(panelFlag, "on");
  await writeStage(5, "Please get two opinions on this.");
  await waitFor(async () => ((await onTurn().count()) === 2 ? true : null));
  log("conductor opened a panel — two members active on the same turn");

  // One voice is not the turn: a partial panel must not advance the council.
  await writeStage(6, "Looks fine to me.", PANEL[0]);
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const stillPanel = await activeTurn();
  assert.equal(stillPanel.turn, 6, "a half-answered panel must not advance the council");
  assert.equal(
    await onTurn().count(),
    2,
    "both panel members should still hold the turn until both have answered",
  );
  log("half-answered panel correctly did not advance");

  const savedPanel = await waitFor(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
    return state.councilRuns?.[0]?.relay?.currentPanelMemberIds;
  }));
  assert.deepEqual(savedPanel, PANEL, "the entire panel must survive persistence");
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openCouncilWorkbench();
  // A council running when Pitwall closed picks itself back up on the same turn.
  await waitFor(async () => (await onTurn().count()) === 2 || null);
  assert.equal(await currentTurnNumber(), 6, "restoring the partial panel must preserve its turn");
  log("partial panel restored with both original stage-file owners");

  // Back to solo routing before the panel completes, so the next turn is a
  // single member and the remaining steps stay deterministic.
  await rm(panelFlag, { force: true });
  await writeStage(6, "The retry path still drops reconnects.", PANEL[1]);
  await waitFor(() => routeFor(7));
  const mergedPrompt = await lastConductorPrompt();
  assert.match(mergedPrompt, /Architect \(Claude\)/, "the panel's findings should be attributed per member");
  assert.match(mergedPrompt, /Reviewer \/ QA \(Claude\)/, "both panel voices should reach the conductor");
  assert.match(mergedPrompt, /Looks fine to me\./, "the first panel member's finding should survive the merge");
  assert.match(mergedPrompt, /still drops reconnects/, "the second panel member's finding should survive the merge");
  log("both panel findings merged into one turn and routed on");

  // A change to real code must trigger the project's own test suite, and a
  // failing suite must be stated to the conductor as a blocker.
  await page.evaluate(
    ({ dir }) =>
      window.pitwall.writeProjectFile({
        projectPath: dir,
        filePath: "src/broken.ts",
        content: "export const broken = 1;\n",
      }),
    { dir: stageDir },
  );
  await writeStage(7, "Changed the retry path. Please verify.");
  await waitFor(() => routeFor(8));
  const testedPrompt = await lastConductorPrompt();
  assert.match(testedPrompt, /FAILING TESTS/, "a failing suite should be reported to the conductor");
  assert.match(
    testedPrompt,
    /not finished, whatever the handoff says/,
    "the conductor should be told the work is unfinished regardless of the claim",
  );
  assert.match(testedPrompt, /deliberately failing council test/, "the suite's own output should reach the conductor");
  log("failing project tests were run and reported as a blocker");

  // The bar must report what the council has actually done: a panel puts two
  // members on one turn, so handoffs outnumber turns by now.
  // The run's own numbers live on the facts line under the title now.
  const barText = await page.locator(".dk-council-facts").first().textContent();
  const handoffMatch = /(\d+) handoffs/.exec(barText || "");
  assert.ok(handoffMatch, `the council bar should report handoffs (got "${barText}")`);
  assert.ok(
    Number(handoffMatch[1]) >= 8,
    `handoffs should count every member contribution, including both panel voices (got ${handoffMatch[1]})`,
  );
  // The facts line separates its parts with whitespace rather than middots.
  assert.match(barText, /(just started|\d+m|\d+h)/, "the council bar should report how long it has been running");
  log(`council bar reports ${handoffMatch[1]} handoffs and elapsed time`);

  // --- Completion is checked, not taken on trust. ---
  // A member declaring the work finished is the least independent opinion in
  // the room, so the marker now sends the work to someone else first.
  await writeStage(8, "RELAY-COMPLETE\n\nNothing left to do.");
  const verifying = await waitFor(async () => {
    const state = await activeTurn();
    return state?.turn === 9 ? state : null;
  });
  assert.ok(verifying, "the completion marker should trigger verification rather than stopping the run");
  assert.equal(
    (await onTurn().count()) > 0,
    true,
    "the relay should still be running while the work is verified",
  );
  log("completion marker sent the work to an independent verifier instead of stopping");

  // Restart before the verifier has written its verdict. Hand off must resume
  // that exact verification stage, rather than rotate into an implementation
  // turn whose answer would still be parsed as a verification verdict.
  const pendingVerification = await waitFor(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
    const relay = state.councilRuns?.[0]?.relay;
    const member = relay?.members.find((item) => item.memberId === relay.currentMemberId);
    const session = state.sessions?.find((item) => item.id === member?.sessionId);
    return relay?.turn === 9 && relay.verification?.pending && session?.nativeSessionId
      ? { nativeSessionId: session.nativeSessionId, memberId: member.memberId, sessionId: session.id } : null;
  }));
  const previousMemberOutput = (await readMemberPrompts()).length;
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openCouncilWorkbench();
  // No press needed: the interrupted verification is asked again by itself.
  await waitFor(async () => (await activeTurn())?.turn === 9);
  const resumedVerificationPrompt = await waitFor(async () => {
    const prompt = (await readMemberPrompts()).slice(previousMemberOutput);
    return prompt.includes("NOT-VERIFIED") ? prompt : null;
  });
  assert.match(resumedVerificationPrompt, /stage-9\.md/, "the resumed verifier must write the original pending stage");
  assert.doesNotMatch(resumedVerificationPrompt, /stage-10\.md/, "resuming verification must not advance the turn");
  const resumedVerification = await page.evaluate(({ sessionId }) => {
    const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
    return { relay: state.councilRuns?.[0]?.relay, session: state.sessions?.find((item) => item.id === sessionId) };
  }, pendingVerification);
  assert.equal(resumedVerification.relay.currentMemberId, pendingVerification.memberId);
  assert.equal(resumedVerification.relay.verification.pending, true);
  assert.equal(resumedVerification.relay.verification.attempts, 1, "resuming an interrupted attempt must not spend another verification round");
  assert.notEqual(resumedVerification.session.nativeSessionId, pendingVerification.nativeSessionId, "restored verification must use a fresh conversation");
  log("restart during verification resumed the same stage and verifier with a fresh conversation");

  // A failed verification hands the specific gaps back as the next instruction.
  await writeStage(9, "NOT-VERIFIED\n- the /health endpoint was never added\n");
  const remediation = await waitFor(() => routeFor(10));
  // The bar shows the instruction the council was actually given, which is the
  // verifier's gap turned into work — not a summary of it.
  assert.match(
    remediation.reason,
    /health endpoint was never added/i,
    "a failed verification should hand the specific gap back as the next instruction",
  );
  log("failed verification returned the council to work with the gap as its instruction");

  // Only a pass ends the run.
  await writeStage(10, "RELAY-COMPLETE\n\nAdded the endpoint.");
  await waitFor(async () => {
    const state = await activeTurn();
    return state?.turn === 11 ? state : null;
  });
  await writeStage(11, "VERIFIED\n\nThe endpoint exists and the tests cover it.");
  const note = await waitFor(async () => {
    const text = await page.locator(".dk-council-status").first().textContent().catch(() => null);
    return text && /verified/i.test(text) ? text : null;
  });
  assert.match(note, /Verified against the original task/i);
  await waitFor(async () => (await onTurn().count()) === 0 || null);
  await openCouncilWorkbench();
  // Stopping is not a dead end — the user can still push the loop one more turn.
  assert.equal(
    await page.locator(".dk-council-handoff").count(),
    1,
    "a manual hand-off should remain available after the relay stops",
  );
  log("verified work stopped the relay, manual hand-off still offered");

  await page.locator(".dk-council-handoff").first().click();
  const resumed = await waitFor(async () => {
    const state = await activeTurn();
    return state?.turn === 12 ? state : null;
  });
  assert.ok(resumed.agent, "manual resume should put a member back on the clock");
  log(`manual hand-off resumed the council at turn 12 on ${resumed.agent}`);

  const screenshotPath = path.join(tempRoot, "relay.png");
  await page.screenshot({ path: screenshotPath });
  process.stdout.write(`  Screenshot: ${screenshotPath}\n`);

  // --- The council survives a restart. ---
  // Everything above happened in one window; the point of persisting the relay
  // is that the conversation is still there after the process that held it dies.
  const storedRelay = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("pitwall-workspace-state") || "{}");
    const run = state.councilRuns?.[0];
    return run?.relay ? { turn: run.relay.turn, messages: run.relay.messages?.length, members: run.relay.members?.length } : null;
  });
  assert.ok(storedRelay, "the relay should be persisted with the council run");
  assert.ok(storedRelay.members >= 3, "the roster should survive");
  assert.ok(storedRelay.messages >= 3, "the conversation should survive");
  log(`relay persisted: turn ${storedRelay.turn}, ${storedRelay.messages} messages, ${storedRelay.members} members`);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await openCouncilWorkbench();

  const restoredNote = await waitFor(async () => {
    const text = await page.locator(".dk-council-status").first().textContent().catch(() => null);
    return text && /restored/i.test(text) ? text : null;
  });
  assert.match(restoredNote, /Council restored from turn/, "a restored council should say where it left off");
  assert.ok(
    (await page.locator(".dk-council-handoff").count()) >= 1,
    "a restored council must be resumable by hand — its agents are gone, but its thread is not",
  );
  log("council restored after a restart, with its thread intact and resumable");

  process.stdout.write("\nPitwall council relay smoke test passed.\n");
} finally {
  await app.close();
  if (process.env.PITWALL_KEEP_SMOKE_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
