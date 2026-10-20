import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { goTo } from "./helpers/goTo.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = server.resolvedUrls.local[0];
let browser;
const log = (message) => console.log(`  OK  ${message}`);
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  const html = await server.transformIndexHtml("/__review", '<html><body><button id="trigger">Open guide</button><div id="root"></div><script type="module" src="/tests/fixtures/workspace-review.tsx"></script></body></html>');
  await page.route("**/__review", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(new URL("/__review", origin).href);
  await page.waitForFunction(() => Boolean(window.reviewTest));

  await page.evaluate(() => {
    window.diffCalls = [];
    window.pitwall = {
      branchChanges: async ({ branch }) => ({ ok: true, base: `base-${branch}`, files: [{ path: "shared.ts", status: "modified", additions: 1, deletions: 1 }] }),
      branchFileDiff: async ({ branch }) => {
        window.diffCalls.push(branch);
        if (branch === "slow") return new Promise((resolve) => { window.releaseSlow = () => resolve({ ok: true, diff: "@@ -1 +1 @@\n-old\n+STALE" }); });
        return { ok: true, diff: `@@ -1 +1 @@\n-old\n+${branch}-CONTENT` };
      },
    };
    window.reviewTest.render("BranchChanges", { projectPath: "/tmp/test", branch: "a", trunk: "main" });
  });
  await page.getByText("a-CONTENT", { exact: true }).waitFor();
  for (const branch of ["b", "a"]) {
    await page.evaluate((branch) => window.reviewTest.render("BranchChanges", { projectPath: "/tmp/test", branch, trunk: "main" }), branch);
    await page.getByText(`${branch}-CONTENT`, { exact: true }).waitFor();
  }
  assert.deepEqual(await page.evaluate(() => window.diffCalls), ["a", "b", "a"]);
  await page.evaluate(() => window.reviewTest.render("BranchChanges", { projectPath: "/tmp/test", branch: "slow", trunk: "main" }));
  await page.waitForFunction(() => Boolean(window.releaseSlow));
  await page.evaluate(() => window.reviewTest.render("BranchChanges", { projectPath: "/tmp/test", branch: "fast", trunk: "main" }));
  await page.getByText("fast-CONTENT", { exact: true }).waitFor();
  await page.evaluate(() => window.releaseSlow());
  await page.waitForTimeout(50);
  assert.equal(await page.getByText("STALE", { exact: true }).count(), 0);
  log("branch changes isolate same-file caches and ignore late responses");

  await page.evaluate(() => {
    window.changesetCalls = 0;
    window.patchCalls = 0;
    window.pitwall.getTaskChangeset = async () => {
      if (++window.changesetCalls === 1) throw new Error("Temporary Git failure");
      return { ok: true, base: "base", files: [{ path: "file.ts", status: "modified", additions: 1, deletions: 1 }], additions: 1, deletions: 1 };
    };
    window.pitwall.getTaskFileDiff = async () => ++window.patchCalls === 1
      ? { ok: false, error: "Temporary patch failure" }
      : { ok: true, diff: `@@ -1 +1 @@\n-old\n+VERSION-${window.patchCalls}` };
    window.reviewTest.render("TaskChangeset", { projectPath: "/tmp/test", branch: "a", baseBranch: "main" });
  });
  await page.getByRole("button", { name: "Changed files", exact: true }).click();
  await page.getByText("Temporary Git failure", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry changes" }).click();
  await page.locator(".dk-changeset-file-open").click();
  await page.getByRole("button", { name: "Retry patch" }).click();
  await page.getByText("VERSION", { exact: true }).waitFor();
  assert.match(await page.locator(".dk-changeset-patch").innerText(), /VERSION-2/);
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await page.locator(".dk-changeset-file-open").click();
  await page.waitForFunction(() => document.querySelector(".dk-changeset-patch")?.textContent.includes("VERSION-3"));
  log("changesets recover from rejected requests, retry patches, and refresh cached content");

  await page.evaluate(() => window.reviewTest.render("ProjectHub", { onSelectSession: (session) => { window.selectedSession = session.id; } }));
  await page.locator(".dk-section").filter({ has: page.getByRole("heading", { name: /Needs you/ }) }).getByRole("button", { name: /Waiting webhook/ }).click();
  assert.equal(await page.evaluate(() => window.selectedSession), "session-b");
  await page.locator(".dk-section").filter({ has: page.getByRole("heading", { name: /Recent sessions/ }) }).getByRole("button", { name: /Failed billing/ }).click();
  assert.equal(await page.evaluate(() => window.selectedSession), "session-a");
  log("overview rows select the clicked failed or recent session");

  // ---- An MCP sign-in waiting on the browser ----------------------------------
  await page.evaluate(() => {
    window.signInCalls = [];
    window.reviewTest.render("McpAuthModal", {
      open: true,
      projectName: "admin",
      providerLabel: "Claude",
      server: { name: "atlassian", target: "https://mcp.atlassian.com/v2/mcp", transport: "http", status: "needs-auth" },
      profile: { name: "atlassian", alias: "pitwall-admin-atlassian", authenticatedAt: "2026-10-05T10:00:00Z" },
      busy: true,
      notice: "",
      noticeTone: "neutral",
      signInUrl: "https://auth.atlassian.com/authorize?response_type=code&client_id=abc",
      onConnect: () => window.signInCalls.push("connect"),
      onCancel: () => window.signInCalls.push("cancel"),
      onOpenUrl: (url) => window.signInCalls.push(`open ${url}`),
      onForget: () => window.signInCalls.push("forget"),
      onClose: () => window.signInCalls.push("close"),
    });
  });
  const signIn = page.getByRole("dialog", { name: "Project MCP authentication" });
  await signIn.waitFor();
  // Every fact is readable, not squeezed to nothing by another component's grid.
  const facts = await signIn.locator(".dk-facts dd").evaluateAll((items) => items.map((item) => ({ text: item.textContent, width: item.getBoundingClientRect().width })));
  assert.deepEqual(facts.map((fact) => fact.text), ["https://mcp.atlassian.com/v2/mcp", "pitwall-admin-atlassian", "Claude secure OAuth store"]);
  assert.ok(facts.every((fact) => fact.width > 80), `facts are wide enough to read: ${JSON.stringify(facts)}`);
  assert.match(await signIn.innerText(), /https:\/\/auth\.atlassian\.com\/authorize/);
  await signIn.getByRole("button", { name: "Open", exact: true }).click();
  await signIn.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
  const closeButton = signIn.getByRole("button", { name: "Cancel sign-in and close" });
  assert.equal(await closeButton.isDisabled(), false, "the window can always be closed");
  await closeButton.click();
  assert.deepEqual(await page.evaluate(() => window.signInCalls), [
    "open https://auth.atlassian.com/authorize?response_type=code&client_id=abc",
    "cancel",
    "cancel",
    "close",
  ]);
  await page.evaluate(() => window.reviewTest.clear());
  console.log("  OK  an MCP sign-in shows its link, and can be cancelled or closed at any time");

  await page.evaluate(() => window.reviewTest.render("ProjectHub", { section: "tasks" }));
  const cards = page.locator(".dk-board-card");
  const waitForOnlyTask = (title) => page.waitForFunction((expectedTitle) => {
    const visibleCards = document.querySelectorAll(".dk-board-card");
    return visibleCards.length === 1 && visibleCards[0].innerText.includes(expectedTitle);
  }, title);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("task-2");
  await waitForOnlyTask("Retry webhook");
  assert.match(await cards.innerText(), /Retry webhook/);
  await page.getByRole("searchbox", { name: "Search tasks" }).fill("");
  // The filters are words now, not selects: the trigger reads as its own
  // current value and the menu is the same Dropdown the rest of the app uses.
  await page.getByRole("button", { name: "Agent" }).click();
  await page.getByRole("option", { name: "claude" }).click();
  await waitForOnlyTask("Fix billing");
  assert.match(await cards.innerText(), /Fix billing/);
  await page.getByRole("button", { name: "Status" }).click();
  await page.getByRole("option", { name: "ready" }).click();
  await page.getByText(/No tasks match/).waitFor();
  await page.getByRole("button", { name: "Clear filters" }).click();
  // [x] in the character grid, in place of the checkbox the board used to
  // carry on every card.
  await page.getByRole("button", { name: "Needs me" }).click();
  await waitForOnlyTask("Retry webhook");
  assert.match(await cards.innerText(), /Retry webhook/);
  log("task search and the word filters narrow the board");

  // The page header was capped and centred while every other block on the
  // page was capped and left-aligned, so the title and its buttons floated in
  // from both edges while the content below hugged the left. Every hub
  // section shares this header, so the check runs across all of them.
  const originalViewport = page.viewportSize();
  for (const width of [1280, 560]) {
  await page.setViewportSize({ width, height: 900 });
  for (const section of ["tasks", "review", "context", "activity"]) {
    await page.evaluate((name) => window.reviewTest.render("ProjectHub", { section: name }), section);
    const header = page.locator(".dk-page > .dk-toolbar").first();
    if (!(await header.count())) continue;
    const bounds = await page.evaluate(() => {
      // The Context section renders inside the knowledge panel rather than the
      // hub, so measure against whatever actually contains the header.
      const head = document.querySelector(".dk-page > .dk-toolbar");
      // The fixture re-renders the section between the count above and this
      // read; a header that is mid-swap is measured on the next pass.
      if (!head?.parentElement) return null;
      const parent = head.parentElement;
      const style = getComputedStyle(parent);
      const inner = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const box = head.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      const offset = box.left - (parentBox.left + parseFloat(style.paddingLeft));
      const heading = head.querySelector("h2");
      const titleOffset = heading ? heading.getBoundingClientRect().left - box.left : 0;
      return { header: box.width, inner, offset, titleOffset };
    });
    if (!bounds) continue;
    assert.ok(
      bounds.header >= bounds.inner - 20,
      `The ${section} header must span the page, not sit in a narrower measure`,
    );
    assert.ok(
      bounds.offset <= 10,
      `The ${section} header at ${width}px must start at the left edge, not be centred in the page`,
    );
    assert.ok(
      bounds.titleOffset <= 10,
      `The ${section} title at ${width}px must stay on the left edge, not centre when the header stacks`,
    );
  }
  }
  await page.setViewportSize(originalViewport);
  // The board is a board: lanes side by side, not a column of full-width
  // sections with a card's title at one edge and its owner a thousand pixels
  // away at the other.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", { section: "tasks" }));
  await page.locator(".dk-board").waitFor();
  assert.equal(await page.locator(".dk-board").evaluate((el) => getComputedStyle(el).display), "grid");
  const lanes = await page.locator(".dk-board-column").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
  assert.equal(new Set(lanes).size, lanes.length, `lanes are stacked, not side by side: ${lanes}`);
  log("the task board lays its lanes side by side");

  // The countdown says when the trackers are re-read, so "is this current?" is
  // a glance rather than a guess.
  // Only for a board that has a tracker to re-read.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", { section: "tasks", trackerSyncMinutes: 12 }));
  await page.getByText("Check tracker", { exact: true }).waitFor();
  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "tasks",
    trackerSyncMinutes: 12,
    tasks: [{ id: "task-j", identifier: "JIRA-1", projectId: "project", title: "From Jira", description: "", status: "ready", priority: "medium", assignedAgent: "", worktree: "", relatedFiles: [], source: { kind: "mcp", name: "Jira", status: "To Do" }, createdAt: "2026-09-06T10:00:00Z", updatedAt: "2026-09-06T10:00:00Z" }],
  }));
  await page.getByText("Jira · Re-reads in 12m", { exact: true }).waitFor();
  log("the board says how long until it re-reads the trackers");

  await page.evaluate(() => window.reviewTest.render("ProjectHub", { section: "tasks" }));
  log("every hub header spans its page and stays left-aligned when it stacks");


  // Starting a batch of sessions used to disable Cancel the moment it began,
  // so a batch started by mistake had to be waited out.
  const renderBulk = (overrides) =>
    page.evaluate((over) => {
      const noop = () => {};
      window.reviewTest.render("BulkTaskStartModal", {
        tasks: [
          { id: "t1", identifier: "acme-2634", title: "Unable to publish a new game", projectId: "p" },
          { id: "t2", identifier: "acme-2632", title: "Prize filter returns every type", projectId: "p" },
        ],
        agentOptions: [{ agent: "Codex" }],
        agent: "Codex",
        models: [{ label: "Auto" }],
        model: "Auto",
        sessionType: "implementation",
        starting: 0,
        running: true,
        cancelling: false,
        onAgentChange: noop,
        onModelChange: noop,
        onRoleChange: noop,
        onStart: noop,
        onClose: () => window.reviewTest.record("stop"),
        ...over,
      });
    }, overrides);

  await renderBulk({});
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  assert.equal(await stop.isEnabled(), true, "Stopping must stay available while sessions are being created");
  await stop.click();
  assert.deepEqual(await page.evaluate(() => window.reviewTest.calls), ["stop"]);

  await renderBulk({ cancelling: true });
  await page.getByText("Stopping — no sessions have been created.", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Stopping…", exact: true }).isDisabled(),
    true,
    "A stop already asked for must not be askable twice",
  );

  // Honest about what already exists: stopping mid-batch does not undo sessions.
  await renderBulk({ starting: 2, cancelling: true });
  await page.getByText("Stopping after the session in flight. 1 already created.", { exact: true }).waitFor();
  log("a batch of sessions can be stopped while it is starting");

  // Opening this dialog once blanked the whole window: a state hook sat below
  // its `if (!open) return null`, so the closed render called fewer hooks than
  // the open one and React tore the tree down. Nothing in the interface said
  // so, and no test mounted it, so it shipped. The transition is the test.
  const renderSession = (open) =>
    page.evaluate((isOpen) => {
      const noop = () => {};
      window.reviewTest.render("CreateSessionModal", {
        open: isOpen,
        agentOptions: [{ agent: "Codex", command: "codex", models: [] }],
        agentChecks: { Codex: { status: "ready", message: "Signed in" } },
        checkingAgents: false,
        draftAgent: "Codex",
        draftModels: [{ label: "Auto", value: "auto" }],
        draftModel: "Auto",
        draftTaskId: "",
        draftInstruction: "",
        draftSessionType: "implementation",
        draftBootCommand: "codex",
        modelSource: "Codex account model cache",
        modelError: "",
        modelsLoading: false,
        createDisabled: false,
        creating: false,
        projectTasks: [],
        contextEntries: [{ id: "c1", title: "Architecture", category: "architecture" }],
        selectedContextIds: ["c1"],
        onSelectAgent: noop, onRemoveCustomAgent: noop, onAddAgent: noop, onTaskChange: noop,
        onInstructionChange: noop, onRoleChange: noop, onModelChange: noop, onRefreshModels: noop,
        onToggleContext: noop, onCreate: noop, onClose: noop,
      });
    }, open);

  const before = errors.length;
  await renderSession(false);
  await renderSession(true);
  await page.getByRole("dialog", { name: "New work" }).waitFor();
  assert.deepEqual(errors.slice(before), [], "Opening the session dialog must not throw");

  // The command line states every setting in the open, as one line of choices
  // under the prompt, rather than hiding them behind "Adjust".
  await page.getByLabel("Instruction", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Adjust", exact: true }).count(), 0);
  assert.deepEqual(errors.slice(before), [], "The dialog's settings must render without throwing");
  // One line, said as one line rather than as the pixel height of one: pinning
  // the number meant a change to the interface's type scale failed here as a
  // wrapped control, which is not what had happened.
  const choiceLines = await page.evaluate(() => {
    const control = document.querySelector('[role="group"][aria-label="Session options"]');
    const line = control.firstElementChild.getBoundingClientRect().height;
    return Math.round(control.getBoundingClientRect().height / line);
  });
  assert.equal(choiceLines, 1, "The whole control is one line");
  // Which notes go with the session opens in place; a chosen one reads as chosen.
  await page.getByRole("button", { name: "Context", exact: true }).click();
  const architecture = page.getByRole("option", { name: /^Architecture/ });
  assert.equal(await architecture.getAttribute("aria-selected"), "true", "A chosen note reads as chosen");
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[aria-label="New work"] input[type="checkbox"]').length),
    0,
    "No checkboxes: the name is the control",
  );
  log("the session dialog opens, and opens its settings, without throwing");

  await page.evaluate(() => window.reviewTest.clear());
  await page.locator("#trigger").focus();
  // The review list derives from git, so these assert the thing a person
  // cannot see by looking: which rows the repository removes on its own.
  // Counted through the DOM rather than innerText, which is layout-dependent
  // here and returns "" for rows that are present and visible — an assertion
  // on it would pass for the wrong reason.
  const renderReview = (facts, pullRequestsAvailable = true) => page.evaluate(
    ([reviewFacts, available]) => window.reviewTest.render("ProjectHub", {
      section: "review", reviewFacts, pullRequestsAvailable: available,
    }),
    [facts, pullRequestsAvailable],
  );
  const liveBranch = { exists: true, merged: false, branchAhead: 2, pullRequest: null };
  const pullRequest = (state) => ({ headRefName: "branch-a", state, url: "", title: "t" });

  await renderReview({ "branch-a": liveBranch });
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 1);
  log("a live branch keeps its review card");

  // A long note sent back stays small, so the changeset above stays readable.
  const longNote = "Why are we checking for non null specifically? ".repeat(40);
  await page.evaluate(([note]) => window.reviewTest.render("ProjectHub", {
    section: "review",
    reviewFacts: { "branch-a": { exists: true, merged: false, branchAhead: 2, pullRequest: null } },
    pullRequestsAvailable: true,
    tasks: [{ id: "task-a", identifier: "TASK-1", projectId: "project", title: "Fix billing totals", description: "Check the total.", status: "review", priority: "high", assignedAgent: "claude", worktree: "branch-a", relatedFiles: [], createdAt: "2026-09-06T10:00:00Z", updatedAt: "2026-09-06T10:00:00Z",
      changeRequests: [
        { id: "r1", body: "An earlier note", createdAt: "2026-10-05T10:00:00Z", deliveredAt: "2026-10-05T10:00:01Z" },
        { id: "r2", body: note, createdAt: "2026-10-05T11:00:00Z", deliveredAt: "2026-10-05T11:00:01Z" },
      ] }],
  }), [longNote]);
  await page.locator(".dk-review-item").first().click();
  const note = page.locator(".dk-request-note");
  await note.first().waitFor();
  assert.equal(await note.count(), 1, "only the latest note shows until asked");
  const closedHeight = await note.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(closedHeight < 50, `a long note is two lines, not ${closedHeight}px`);
  await page.getByRole("button", { name: "Show all" }).click();
  assert.ok(await note.evaluate((element) => element.getBoundingClientRect().height) > closedHeight * 2, "Show all opens it");
  await page.getByRole("button", { name: "1 earlier note" }).click();
  assert.equal(await note.count(), 2);
  log("a long note sent back is two lines until opened, and earlier notes fold away");
  // React batches a clear with the render after it unless the clear lands first;
  // wait for it, or the open review carries over into the next case.
  await page.evaluate(() => window.reviewTest.clear());
  await page.waitForFunction(() => !document.querySelector(".dk-review-item"));

  await renderReview({ "branch-a": { ...liveBranch, pullRequest: pullRequest("merged") } });
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 0);
  log("a merged pull request removes the card without anyone clicking");

  await renderReview({ "branch-a": { ...liveBranch, merged: true } });
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 0);
  log("a branch merged into the trunk removes the card with no gh at all");

  await renderReview({ "branch-a": { ...liveBranch, pullRequest: pullRequest("closed") } });
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 1);
  assert.match(await page.locator(".dk-review-list").textContent(), /Closed/);
  log("a closed pull request stays, flagged rather than dropped");

  // Facts that loaded and simply do not mention this branch: it is gone.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "review", reviewFacts: {}, pullRequestsAvailable: false, reviewError: "Not a git worktree",
  }));
  await page.getByText(/is not a git repository/).waitFor();
  assert.equal(await page.getByText(/No pull request state/).count(), 0);
  log("a folder that is not a repository says so, instead of blaming gh");

  // A branch review asked about and git no longer has is reported as absent.
  await renderReview({ "branch-a": { exists: false, merged: false, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false, dirty: 0, pullRequest: null } }, false);
  await page.getByText(/No pull request state/).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 0);
  log("an unreachable gh says so, and a vanished branch still clears");

  // No answer about a branch is not evidence it is gone: a capped branch list
  // left every task branch past the fortieth unanswered, and they all cleared.
  await renderReview({}, false);
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 1);
  log("a branch with no facts keeps its card");

  // Uncommitted work keeps a card even when git lists the branch as merged.
  await renderReview({ "branch-a": { ...liveBranch, merged: true, branchAhead: 0, hasOwnCommits: false, dirty: 21 } });
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 1);
  log("uncommitted work on a branch git calls merged keeps its card");

  // Not yet asked is not the same as nothing there. Before the first refresh
  // lands every card must stay, or the screen empties itself on every open.
  await renderReview(null);
  await page.waitForFunction(() => document.querySelectorAll(".dk-review-item").length === 1);
  log("cards stay while the first refresh is still in flight");

  await renderReview({ "branch-a": liveBranch });
  await page.locator(".dk-review-item").first().waitFor();
  assert.equal(await page.locator(".dk-review-detail").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Complete task" }).count(), 0);
  log("review is a list of rows, and completing by hand is gone");

  // The row is the button that opens it, beside the list rather than in place
  // the words on the second line are the only things that do anything.
  await page.locator(".dk-review-item").first().click();
  await page.locator(".dk-review-detail").waitFor();
  assert.match(await page.locator(".dk-review-detail").textContent(), /Fix billing totals/);
  log("a row opens into its own detail view");

  const renderSchedule = (scheduleJobs) => page.evaluate(
    (jobs) => window.reviewTest.render("ProjectHub", { section: "schedule", scheduleJobs: jobs }),
    scheduleJobs,
  );
  // Local, not UTC. slotStatus compares local calendar dates, and east of
  // Greenwich the two disagree for part of every day.
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const today = localToday();
  const scheduleJob = (over = {}) => ({
    id: "job-1", hour: 13, minute: 0, prompt: "review yesterday's commits",
    projectId: "project", enabled: true, lastRunDate: "", history: [], ...over,
  });
  const boxes = () => page.locator(".dk-slot-state .dk-dot").evaluateAll((dots) => dots.map((dot) => dot.dataset.box));

  // Every state is a word first and a checkbox in the character grid, so each
  // one reads with the colour taken away. That is the accessibility rule and
  // the reason the box exists at all.
  await renderSchedule([scheduleJob({ hour: 23, minute: 59 })]);
  await page.locator(".dk-slot").first().waitFor();
  assert.deepEqual(await boxes(), ["[ ]"]);
  assert.match(await page.locator(".dk-slot-state").first().textContent(), /^in /);
  log("work still to come is an empty box and a countdown");

  await renderSchedule([scheduleJob({ lastRunDate: today, history: [{ at: `${today}T09:02:00`, outcome: "ok" }] })]);
  await page.waitForFunction(() => document.querySelector(".dk-slot-state")?.textContent.startsWith("ok "));
  assert.equal((await boxes())[0], "[x]");
  log("a finished run is checked off, and says when it finished");

  await renderSchedule([scheduleJob({ history: [{ at: new Date(Date.now() - 12 * 60000).toISOString(), outcome: "running" }] })]);
  await page.waitForFunction(() => document.querySelector(".dk-slot-state")?.textContent.startsWith("running "));
  assert.equal((await boxes())[0], "[>]");
  log("a live run is marked running, with how long it has been going");

  await renderSchedule([scheduleJob({ history: [
    { at: "2026-09-15T07:14:00", outcome: "blocked", reason: "sat on a prompt past the deadline" },
  ] })]);
  await page.waitForFunction(() => document.querySelector(".dk-slot-state")?.textContent.startsWith("blocked"));
  assert.equal((await boxes())[0], "[!]");
  // The reason is said underneath rather than left for somebody to go and find.
  assert.match(await page.locator(".dk-slot-why").first().textContent(), /sat on a prompt/);
  log("a run that wants a person says so, and says why underneath");

  await renderSchedule([scheduleJob({ history: [
    { at: "2026-09-15T06:00:00", outcome: "missed" },
    { at: "2026-09-14T06:00:00", outcome: "missed" },
    { at: "2026-09-13T06:00:00", outcome: "missed" },
    { at: "2026-09-12T06:00:00", outcome: "missed" },
  ] })]);
  await page.waitForFunction(() => document.querySelector(".dk-slot-state")?.textContent.includes("\u00d74"));
  log("repeated misses are counted, not listed four times");

  // now is plain text in the time column between what is done and what is due.
  await renderSchedule([scheduleJob()]);
  await page.locator(".dk-slot-now").waitFor();
  assert.match(await page.locator(".dk-slot-now").textContent(), /Now \d\d:\d\d/);
  log("now sits in the day, in the same column as the times");

  // A booking stays open across re-renders of the same job; open it only if it is shut.
  const openSlot = async () => {
    const row = page.locator(".dk-slot").first();
    if ((await row.getAttribute("aria-selected")) !== "true") await row.click();
  };
  await page.locator(".dk-slot").first().click();
  await page.getByRole("button", { name: "run now" }).waitFor();
  await page.locator(".dk-slot-agent-pick").waitFor();
  log("opening a slot offers its actions, including the agent it runs with");

  // The row closes on click and its own actions live inside it, so the shared
  // dropdown — which cannot stop its own click — used to shut the booking the
  // moment you picked an agent.
  await page.locator(".dk-slot-agent-pick button").first().click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".dk-slot-agent-pick").count(), 1, "picking an agent closed the booking");
  await page.keyboard.press("Escape");
  log("choosing an agent leaves the booking open");

  // A run you unblocked and finished yourself can be settled by hand.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "schedule",
    scheduleJobs: [{
      id: "job-1", hour: 13, minute: 0, prompt: "review yesterday's commits", projectId: "project",
      agent: "Codex", enabled: true, lastRunDate: "",
      history: [{ at: "2026-09-16T11:11:00", outcome: "blocked", reason: "repository rule violations" }],
    }],
    onMarkScheduleRunDone: (job) => { window.settled = job.id; },
  }));
  await openSlot();
  await page.getByRole("button", { name: "mark done" }).click();
  await page.waitForFunction(() => window.settled === "job-1");
  log("a blocked run can be marked done by hand");

  // A \u escape in JSX text is not an escape, it is those six characters.
  await page.getByRole("button", { name: "edit" }).click();
  await page.getByRole("button", { name: "save" }).waitFor();
  await page.locator(".dk-schedule-compose.is-inline").waitFor();
  await page.getByRole("button", { name: "cancel" }).click();
  log("editing a booking opens it in place");

  // Opening a booking shows its run rather than sending you to Work to find it.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "schedule",
    scheduleJobs: [{
      id: "job-1", hour: 13, minute: 0, prompt: "review yesterday's commits", projectId: "project",
      agent: "Codex", enabled: true, lastRunDate: "",
      history: [{ at: "2026-09-15T13:00:00", outcome: "ok", pullRequestUrl: "https://example.com/pr/1" }],
    }],
    renderScheduleRun: (job) => job.history.length ? "1 run" : "no runs",
  }));
  await openSlot();
  await page.waitForFunction(() => document.querySelector(".dk-slot-run")?.textContent.includes("1 run"));
  log("an open booking shows its own run, in place");

  // The row opens on Space and holds the run's live terminal, whose own input
  // takes focus — so a space typed at the agent used to bubble to the row,
  // collapse it, and unmount the terminal mid-run.
  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "schedule",
    scheduleJobs: [{
      id: "job-1", hour: 13, minute: 0, prompt: "review yesterday's commits", projectId: "project",
      agent: "Codex", enabled: true, lastRunDate: "", history: [{ at: "2026-09-15T13:00:00", outcome: "running" }],
    }],
    renderScheduleRun: () => window.React.createElement("textarea", { className: "fake-terminal", defaultValue: "" }),
  }));
  await openSlot();
  await page.locator(".fake-terminal").waitFor();
  await page.locator(".fake-terminal").click();
  await page.keyboard.type("a b c");
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".fake-terminal").count(), 1, "typing a space inside the run closed it");
  assert.equal(await page.locator(".fake-terminal").inputValue(), "a b c");
  log("typing inside an open run does not close it");

  await renderSchedule([]);
  await page.getByText(/Nothing is booked yet/).waitFor();
  // The empty state is where the screen explains itself: the app hides page
  // descriptions globally, so the header sentence never shows.
  assert.match(await page.locator(".dk-empty").textContent(), /runs while you are away/);
  log("an empty day still says what the screen is for");

  await page.evaluate(() => window.reviewTest.render("ProjectHub", {
    section: "schedule", scheduleJobs: [],
    onCreateScheduleJob: async (time, prompt, agent, days, everyHours) => { window.booked = `${time}|${prompt}|${agent}|${days.join("")}|${everyHours}`; return ""; },
  }));
  await page.getByRole("textbox", { name: "Time" }).fill("13:00");
  await page.getByRole("textbox", { name: "What should run" }).fill("review commits");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.waitForFunction(() => window.booked === "13:00|review commits|Codex||0");
  log("booking takes a time, an instruction and the agent it pins");

  // A dropdown rather than a third field: the line stays a line, and every
  // installed agent is visible at once instead of being reached by clicking
  // through the others.
  await page.getByRole("button", { name: "Agent for this booking" }).click();
  const offered = await page.getByRole("option").allTextContents();
  assert.deepEqual(offered.map((o) => o.split("\n")[0]), ["Codex", "Claude"]);
  await page.getByRole("option", { name: "Claude" }).click();
  await page.waitForFunction(() => document.querySelector(".dk-schedule-agent button")?.textContent.includes("Claude"));
  log("the agent is picked from every agent that can actually run");

  // A booking can repeat on chosen days. Words, from a real dropdown: the
  // first attempt was seven one-character toggles, eight pixels wide each.
  const repeat = page.getByRole("button", { name: "How often it repeats" });
  const target = await repeat.boundingBox();
  assert.ok(target.height >= 24, `repeat target too small: ${target.height}px`);
  await repeat.click();
  const repeats = (await page.getByRole("option").allTextContents()).map((o) => o.split("\n")[0]);
  assert.deepEqual(repeats.slice(0, 3), ["every day", "weekdays", "weekends"]);
  await page.getByRole("option", { name: "weekdays" }).click();
  await page.waitForFunction(() => document.querySelector(".dk-schedule-repeat button")?.textContent.includes("weekdays"));
  log("a booking repeats on chosen days, picked from a list");

  // An interval is a repeat too, in the same list: the line stays a line, and
  // the firing rule is the same rule with more than one occurrence a day.
  await repeat.click();
  await page.getByRole("option", { name: "every hour", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".dk-schedule-repeat button")?.textContent.includes("every hour"));
  log("a booking can repeat through the day, not only once");

  // A booking whose agent is gone says so on the row, rather than at the hour
  // it was due to run.
  await renderSchedule([scheduleJob({ agent: "Gemini" })]);
  await page.waitForFunction(() => Boolean(document.querySelector(".dk-slot-agent.is-gone")));
  log("an agent that is no longer installed is flagged on the booking");


  await page.evaluate(() => document.getElementById("trigger")?.focus());

  await page.evaluate(() => window.reviewTest.render("OnboardingModal", { open: true, agents: [], analyticsEnabled: false, onAnalyticsChange: () => {}, onAddProject: () => {}, onClose: () => window.reviewTest.clear() }));
  await page.getByRole("dialog", { name: "Pitwall guide" }).waitFor();
  await page.getByRole("button", { name: "Add your first project" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Add your first project");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement.id === "trigger");
  log("onboarding contains keyboard focus, closes on Escape, and restores its trigger");

  await page.goto(new URL("/?mock", origin).href);
  // The mock opens a populated project, which is past the first run.
  await page.locator(".dk-header").getByRole("button", { name: "More", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Pitwall guide" }).count(), 0);
  await goTo(page, "Review");
  // Review is a list now, and the evidence lives in a row's detail. Completing
  // by hand is no longer offered here at all — git decides that — so the modal
  // is reached from the decision bar's Approve.
  const reviewRows = page.locator(".dk-review-item");
  const rowsBefore = await reviewRows.count();
  await reviewRows.first().click();
  await page.locator(".dk-review-detail").waitFor();
  const completeTask = page.locator(".dk-review-bar").getByRole("button", { name: /^Approve/ });
  await completeTask.click();
  let dialog = page.getByRole("dialog", { name: /Complete/ });
  assert.equal(await dialog.getByRole("button", { name: "Complete with override" }).isDisabled(), true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    window.pitwall.runValidation = async () => ({ ok: true, result: { ok: true, ranAt: "2026-09-06T10:00:00Z", revision: "abc123abc123abc123", checks: [{ name: "tests", command: "npm test", ok: true, skipped: true, output: "", durationMs: 0 }] } });
  });
  await page.getByRole("button", { name: "Run checks", exact: true }).first().click();
  await page.getByText("No checks ran", { exact: true }).waitFor();
  assert.equal(await page.getByText("0/0 checks pass").count(), 0);
  await page.evaluate(() => {
    window.pitwall.runValidation = async () => ({ ok: true, result: { ok: false, ranAt: "2026-09-06T10:01:00Z", revision: "abc123abc123abc123", checks: [{ name: "tests", command: "npm test", ok: false, skipped: false, output: "Expected total: 12; received: 11", durationMs: 10 }] } });
  });
  await page.getByRole("button", { name: "Run checks again" }).first().click();
  await page.getByText("tests failing", { exact: true }).waitFor();
  await completeTask.click();
  dialog = page.getByRole("dialog", { name: /Complete/ });
  await dialog.locator("summary").click();
  await dialog.getByText("Expected total: 12; received: 11", { exact: true }).waitFor();
  await dialog.getByText("abc123abc123", { exact: true }).waitFor();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Complete with override" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((expected) => document.querySelectorAll(".dk-review-item").length === expected, rowsBefore - 1);
  log("completion exposes revision and output, distinguishes skipped checks, and requires an explicit override");

  await page.setViewportSize({ width: 1180, height: 760 });
  // The inspector toggle and the theme live in the command palette now.
  const runPaletteCommand = async (title) => {
    await page.locator(".dk-tsb-titlebar").getByRole("button", { name: /^Search/ }).click();
    await page.locator(".dk-palette-row", { hasText: title }).click();
  };
  // The inspector belongs to Work; Review has its own decision bar.
  await goTo(page, "Work");
  await page.getByRole("complementary", { name: "Task details", includeHidden: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("complementary", { name: "Task details", includeHidden: true }).isVisible(), false);
  await runPaletteCommand("Show task details");
  assert.notEqual(await page.getByRole("complementary", { name: "Task details", includeHidden: true }).evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await runPaletteCommand("Switch to dark");
  assert.notEqual(await page.getByRole("complementary", { name: "Task details", includeHidden: true }).evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  log("minimum-size inspector defaults closed and stays opaque in light and dark themes");
  assert.deepEqual(errors, []);

  console.log("Pitwall workspace review smoke test passed.");

} finally {
  if (browser) await browser.close();
  await server.close();
}
