import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
const errors = [];
let browser;
let page;
try {
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__knowledge-ui*", async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: await server.transformIndexHtml(
        "/__knowledge-ui",
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/tests/fixtures/project-knowledge-ui.tsx"></script></body></html>',
      ),
    }),
  );
  await page.goto(`${origin}/__knowledge-ui`);
  await page.getByText("Give the next task a head start").waitFor();
  await page.getByRole("button", { name: "Learn project", exact: true }).click();
  await page.getByText("Build and test commands", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "New context", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Edit Build and test commands", exact: true }).click();
  await page.getByLabel("Knowledge", { exact: true }).fill("My corrected command, preserved during a conflict.");
  const initialInspections = await page.evaluate(() => window.__knowledgeUi.inspected.length);
  await page.evaluate(() => window.__knowledgeUi.refresh());
  await page.waitForFunction((count) => window.__knowledgeUi.inspected.length > count, initialInspections);
  assert.equal(
    await page.getByLabel("Knowledge", { exact: true }).inputValue(),
    "My corrected command, preserved during a conflict.",
    "Refreshing receipts must preserve an unsaved draft",
  );
  await page.evaluate(() => {
    window.__knowledgeUi.conflict = true;
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("This record changed while you were editing. Your draft is preserved.").waitFor();
  assert.equal(
    await page.getByLabel("Knowledge", { exact: true }).inputValue(),
    "My corrected command, preserved during a conflict.",
  );
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Keep draft and use version 2", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Knowledge updated.", { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.__knowledgeUi.updates.map((input) => input.expectedVersion)),
    [1, 2],
  );
  await page.getByRole("button", { name: "Pin Build and test commands", exact: true }).click();
  await page.getByRole("button", { name: "Unpin Build and test commands", exact: true }).waitFor();
  await page.getByRole("button", { name: "Areas", exact: true }).click();
  await page.getByText("Sources changed", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("unmatched query");
  await page.getByText("No matching knowledge", { exact: true }).waitFor();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await page.getByRole("button", { name: "Share with project", exact: true }).click();
  await page.getByText("Knowledge updated.", { exact: true }).waitFor();
  const promotion = await page.evaluate(() => window.__knowledgeUi.updates.at(-1));
  assert.equal(
    promotion.workspacePath,
    "/project/worktree",
    "Project-wide view promotes using the finding's source workspace",
  );
  assert.equal(promotion.taskId, "memory-task");
  assert.equal(await page.getByRole("button", { name: "Share with project", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Context used" }).click();
  assert.equal(await page.getByText("Delivered", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Prepared", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Failed", { exact: true }).count(), 1);
  await page.locator(".dk-receipt summary").first().click();
  await page.locator(".dk-receipt[open]").getByText("exact-payload-hash", { exact: true }).waitFor();
  // The panel replaces `.project-hub` inside `.workspace`, which is a flex
  // column with `overflow: hidden`. Whatever sits in that slot has to be its
  // own scroll container or its content is simply unreachable. A short viewport
  // guarantees the records overflow regardless of how many the fixture holds.
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 1200, height: 240 });
  const scroll = await page.evaluate(() => {
    const panel = document.querySelector(".dk-memory");
    const style = getComputedStyle(panel);
    panel.scrollTop = 200;
    return {
      overflowY: style.overflowY,
      overflows: panel.scrollHeight > panel.clientHeight,
      scrolled: panel.scrollTop,
      fitsParent: panel.clientHeight <= panel.parentElement.clientHeight,
    };
  });
  // Without its own overflow the panel simply grows to content height, so the
  // symptom is that it outgrows the slot — not that it scrolls badly.
  assert.equal(scroll.fitsParent, true, "Knowledge panel must not outgrow the workspace slot");
  assert.notEqual(scroll.overflowY, "visible", "Knowledge panel must be its own scroll container");
  assert.equal(scroll.overflows, true, "A short viewport must make the records overflow");
  assert.ok(scroll.scrolled > 0, "Knowledge panel must scroll its own content");
  await page.setViewportSize({ width: 1200, height: 900 });

  // The platform draws its own rounded well inside a search input, which put a
  // second box around the placeholder inside the field's own border.
  const field = await page.evaluate(() => {
    const input = document.querySelector(".dk-memory-search input");
    const style = getComputedStyle(input);
    return {
      appearance: style.appearance,
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      placeholder: input.placeholder,
    };
  });
  assert.equal(field.appearance, "none", "The search input must not draw the platform's own box");
  assert.equal(field.background, "rgba(0, 0, 0, 0)", "The search input fills nothing; its container is the field");
  assert.equal(field.borderWidth, "0px", "The search input must not draw a second border inside the field");
  assert.equal(field.placeholder, "Search knowledge or source paths", "The field keeps its placeholder");

  await page.screenshot({ path: "/tmp/pitwall-project-knowledge-light.png", fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({ path: "/tmp/pitwall-project-knowledge-dark.png", fullPage: true });
  await page.setViewportSize({ width: 540, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "Knowledge panel must fit a narrow window",
  );
  await page.screenshot({ path: "/tmp/pitwall-project-knowledge-narrow.png", fullPage: true });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Forget Build and test commands", exact: true }).click();
  await page.getByText("Record forgotten. It will no longer be included in new agent context.").waitFor();
  assert.equal(await page.getByText("Build and test commands", { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.__knowledgeUi.learnFailure = true;
  });
  await page.getByRole("button", { name: "Refresh project", exact: true }).click();
  await page.getByText("Fixture learning failed", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__knowledgeUi.inspectFailure = true;
  });
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.getByText("Fixture store unavailable", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.__knowledgeUi.inspectFailure = false;
  });
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${origin}/__knowledge-ui?mode=thread`);
  const log = page.locator(".dk-council-thread-log");
  // The thread shows no per-message turn label wherever it is mounted; the
  // 35th handoff's own text is what says it rendered.
  await page.getByText(/^Turn 35: inspected/).waitFor();
  await log.evaluate((element) => {
    element.scrollTop = 150;
    element.dispatchEvent(new Event("scroll"));
  });
  const before = await log.evaluate((element) => element.scrollTop);
  await page.evaluate(() => window.__knowledgeUi.append());
  await page.getByRole("button", { name: "New activity", exact: true }).waitFor();
  assert.equal(
    await log.evaluate((element) => element.scrollTop),
    before,
    "New handoff must preserve the reader's position",
  );
  await page.getByRole("button", { name: "New activity", exact: true }).click();
  assert.equal(
    await log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 2),
    true,
  );
  await page.evaluate(() => window.__knowledgeUi.append());
  await page.getByText("New handoff 37: the implementation now persists context.", { exact: true }).waitFor();
  assert.equal(
    await log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 2),
    true,
    "Thread follows when the reader is at the bottom",
  );
  assert.equal(await page.evaluate(() => scrollY), 0, "Thread updates must not scroll the page");

  // The create-session command line, driven by the keyboard alone. The payload
  // it hands over is the draft `createAgentSession` reads, so every option the
  // old form could set has to arrive here unchanged.
  await page.goto(`${origin}/__knowledge-ui?mode=create-session`);
  const sessionDialog = page.getByRole("dialog", { name: "New work" });
  await sessionDialog.waitFor();
  const focusedName = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim());
  const key = (name) => page.keyboard.press(name);
  assert.equal(await focusedName(), "Instruction", "Typing starts at the prompt");
  const pick = async (choice, option) => {
    await key("Enter");
    const list = sessionDialog.getByRole("listbox", { name: choice });
    await list.waitFor();
    for (let step = 0; step < 12; step += 1) {
      const current = await page.evaluate(() => document.activeElement?.querySelector(".dk-new-session-label")?.textContent);
      if (current === option) break;
      await key("ArrowDown");
    }
    await key("Enter");
    await list.waitFor({ state: "detached" });
    assert.equal(await focusedName(), choice, `Choosing a ${choice.toLowerCase()} returns to its choice`);
  };
  await key("ArrowDown");
  assert.equal(await focusedName(), "Agent");
  await pick("Agent", "Claude");
  await key("ArrowRight");
  await pick("Model", "Sonnet");
  await key("ArrowRight");
  await pick("Role", "Reviewer / QA");
  await key("ArrowRight");
  await pick("Task", "Fix the review screen");
  await key("ArrowRight");
  await key("Enter");
  await sessionDialog.getByRole("listbox", { name: "Context" }).waitFor();
  await key(" ");
  await key("ArrowDown");
  await key(" ");
  await key("Escape");
  assert.equal(await sessionDialog.count(), 1, "Escape inside a list closes the list, not the dialog");
  assert.equal(await focusedName(), "Context");
  await key("ArrowRight");
  await key("Enter");
  assert.equal(await sessionDialog.getByRole("button", { name: "Access" }).getAttribute("aria-pressed"), "true");
  await sessionDialog.getByText(/^Runs .*--dangerously-skip-permissions/).waitFor();
  await key("ArrowUp");
  assert.equal(await focusedName(), "Instruction");
  await page.keyboard.type("fix login");
  const undersized = await sessionDialog.evaluate((dialog) =>
    [...dialog.querySelectorAll("button, input")]
      .filter((element) => element.getClientRects().length && element.offsetHeight < 24)
      .map((element) => element.textContent),
  );
  assert.deepEqual(undersized, [], "Every control is at least 24px tall");
  const frame = await sessionDialog.evaluate((dialog) => {
    const style = getComputedStyle(dialog);
    const box = dialog.getBoundingClientRect();
    return { shadow: style.boxShadow, spansWindow: box.width >= window.innerWidth - 1 };
  });
  assert.notEqual(frame.shadow, "none", "The dialog floats: dialogs are one of the few things that carry a shadow");
  assert.equal(frame.spansWindow, false, "The dialog is a panel, not a band cutting the page");
  await key("Enter");
  assert.deepEqual(await page.evaluate(() => window.__createSession.created), [
    {
      agent: "Claude",
      model: "Sonnet",
      sessionType: "review",
      taskId: "t1",
      instruction: "fix login",
      autoApprove: true,
      selectedContextIds: ["c2"],
    },
  ]);
  await key("Escape");
  await sessionDialog.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.__createSession.events), ["close"]);

  await page.goto(`${origin}/__knowledge-ui?mode=council`);
  // Thread first: the council opens on its conversation, laid over the panes,
  // which keep their full width underneath so switching never refits them.
  await page.evaluate(() => localStorage.removeItem("pitwall-council-view"));
  await page.reload();
  await page.locator(".dk-council-thread").waitFor();
  const viewToggle = page.getByRole("group", { name: "View", exact: true });
  const threadToggle = viewToggle.getByRole("button", { name: /^Thread/ });
  const agentsToggle = viewToggle.getByRole("button", { name: "Terminals", exact: true });
  const measureFloor = () => page.evaluate(() => ({
    thread: document.querySelectorAll(".dk-council-thread").length,
    view: document.querySelector(".dk-council").getBoundingClientRect().width,
    grid: document.querySelector(".dk-council-grid").getBoundingClientRect().width,
    composer: document.querySelector(".dk-council-composer").getBoundingClientRect().width,
  }));
  assert.equal(await threadToggle.getAttribute("aria-pressed"), "true", "The council opens on its thread");
  assert.equal((await measureFloor()).grid, (await measureFloor()).view, "The panes keep the full width under the thread");
  await agentsToggle.click();
  const floor = await measureFloor();
  assert.equal(floor.thread, 0, "The Agents view hides the thread");
  assert.equal(floor.grid, floor.view, "The panes take the full width while the thread is hidden");
  assert.equal(floor.composer, floor.view, "The composer takes the full width while the thread is hidden");
  assert.equal(await threadToggle.getAttribute("aria-pressed"), "false");
  assert.equal((await threadToggle.textContent()).trim(), "Thread");
  // A handoff that lands while the thread is hidden is counted on the toggle.
  await page.evaluate(() => window.__knowledgeUi.append());
  await viewToggle.getByRole("button", { name: /1 unread/ }).waitFor({ timeout: 2000 }).catch(() => {});
  assert.match((await threadToggle.textContent()).trim(), /^Thread\s*1$/, "An unread handoff shows on the toggle");
  // Terminal type is set from the council's own bar while the panes are shown.
  assert.match(await page.locator(".dk-council-bar").getByRole("button", { name: "Terminal typography settings" }).textContent(), /12px/);
  await page.locator(".dk-council-more > summary").click();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  // Close "more" again: what it holds is only offered while it is open, which
  // is what the Synthesize assertion below is checking.
  await page.evaluate(() => { document.querySelector(".dk-council-more").open = false; });
  await page.getByText("Make Pitwall remember project context", { exact: true }).waitFor();
  await page.getByText("No verification verdict recorded.", { exact: true }).waitFor();
  await page.getByText("Failed", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Synthesize", exact: true }).isVisible(), false);
  // A 4.4em cap with hidden overflow was written as a backstop for the relay
  // note bar, which had once taken a wall of an agent's prose. It was applied to
  // the whole row of chrome, so the conductor lane lost most of its height and
  // its log was cut off with no way to scroll to the rest.
  // Deterministic rather than a toggle: an earlier step may have left "more"
  // open or closed, and clicking it would then do the opposite of what is
  // wanted here.
  // The conductor lives in the council's Options menu.
  await page.locator(".dk-council-more").evaluate((menu) => { menu.open = true; });
  await page.locator(".dk-council-more-menu").getByRole("button", { name: /^Conductor/ }).click();
  const lane = await page.evaluate(() => {
    const el = document.querySelector(".dk-council-conductor");
    const note = document.querySelector(".dk-council-status");
    const box = (n) => (n ? { clipped: n.scrollHeight - n.clientHeight > 1, maxHeight: getComputedStyle(n).maxHeight } : null);
    return { lane: box(el), note: box(note), log: box(document.querySelector(".dk-council-conductor-log")) };
  });
  // A conductor question can take two minutes, and is asked twice when the
  // first answer is unusable. "Thinking…" for four minutes is indistinguishable
  // from a conductor that died.
  await page.getByText("Asking the conductor who takes the turn — up to two minutes.", { exact: true }).waitFor();

  assert.ok(lane.lane, "The conductor lane must render when the Conductor tab is open");
  assert.equal(lane.lane.clipped, false, "The conductor lane must not hide its own content");
  // It may be bounded — it has to be, or it starves the members' panes — but it
  // bounds itself by scrolling its log, not by hiding the end of it.
  assert.notEqual(lane.lane.maxHeight, lane.note.maxHeight, "The conductor lane must not carry the note bar's cap");
  assert.ok(lane.note, "The relay note bar must still render");
  assert.notEqual(lane.note.maxHeight, "none", "The note bar keeps its backstop against a wall of prose");
  // The lane was capped at four lines, which cut its log off. Removing the cap
  // gave it an unbounded fixed height instead, and since the members' panes take
  // what is left, a short window left them a sliver each and their terminals
  // rendered nothing at all. It has to be bounded relative to the window.
  // Leaving the summary (under "more") brings the Agents view back.
  await page.evaluate(() => { document.querySelector(".dk-council-more").open = true; });
  const summaryToggle = page.getByRole("button", { name: "Summary", exact: true });
  if (await summaryToggle.getAttribute("aria-pressed") === "true") await summaryToggle.click();
  await page.evaluate(() => { document.querySelector(".dk-council-more").open = false; });

  // The pane's image button is pinned to the same top-right corner as the gate
  // banner's action and sat on a higher layer, so the one control that clears a
  // gated pane could not be clicked.
  const gateAction = page.locator(".dk-council-gate button", { hasText: "Send task" }).first();
  await gateAction.waitFor();
  const reachable = await page.evaluate(() => {
    const button = document.querySelector(".dk-council-gate button");
    const box = button.getBoundingClientRect();
    const covered = [];
    // Across the button, not just its middle: the image control covered only
    // the right third of it, which a single centre probe walks straight past.
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const onTop = document.elementFromPoint(box.left + box.width * fraction, box.top + box.height / 2);
      if (onTop !== button && !button.contains(onTop)) covered.push(onTop?.className || onTop?.tagName || "?");
    }
    return covered;
  });
  assert.deepEqual(reachable, [], "Send task must be clickable across its whole width");

  // Leaving the summary (under "more") brings the Agents view back.
  await page.evaluate(() => { document.querySelector(".dk-council-more").open = true; });
  const summaryToggleAgain = page.getByRole("button", { name: "Summary", exact: true });
  if (await summaryToggleAgain.getAttribute("aria-pressed") === "true") await summaryToggleAgain.click();
  await page.evaluate(() => { document.querySelector(".dk-council-more").open = false; });
  for (const height of [900, 700, 600]) {
    await page.setViewportSize({ width: 1400, height });
    const room = await page.evaluate(() => {
      const view = document.querySelector(".dk-council");
      const lane = document.querySelector(".dk-council-conductor");
      const grid = document.querySelector(".dk-council-grid");
      return {
        view: view.getBoundingClientRect().height,
        lane: lane.getBoundingClientRect().height,
        grid: grid.getBoundingClientRect().height,
        laneScrolls: lane.scrollHeight - lane.clientHeight > 1,
      };
    });
    // The panes are the point of the view, so they are never the smaller half,
    // and they always keep enough height to render something.
    assert.ok(
      room.grid >= room.lane,
      `At ${height}px the conductor lane took ${Math.round(room.lane)} against ${Math.round(room.grid)} for the members`,
    );
    assert.ok(
      room.grid >= 200,
      `At ${height}px the members' panes were left ${Math.round(room.grid)}, which renders as empty terminals`,
    );
    assert.equal(room.laneScrolls, false, "The lane bounds itself by scrolling its log, not by hiding its own content");
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  // The thread opens from the header, over the panes, and does not take their
  // width. Reading it clears the unread count, and the choice is remembered.
  const gridBefore = await page.evaluate(() => document.querySelector(".dk-council-grid").getBoundingClientRect().width);
  await threadToggle.click();
  await page.locator(".dk-council-thread").first().waitFor();
  assert.equal(await threadToggle.getAttribute("aria-pressed"), "true");
  assert.equal((await threadToggle.textContent()).trim(), "Thread", "Opening the thread marks it read");
  assert.equal(
    await page.evaluate(() => document.querySelector(".dk-council-grid").getBoundingClientRect().width),
    gridBefore,
    "Opening the thread must not narrow the panes",
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("pitwall-council-view")), "thread");
  await page.locator(".dk-council-thread-log").focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".dk-council-thread").count(), 0, "Escape closes the thread");
  assert.equal(await threadToggle.evaluate((element) => element === document.activeElement), true, "Focus returns to the toggle");
  await threadToggle.click();
  await page.locator(".dk-council-thread").first().waitFor();

  // A long URL or file path has nowhere to break, so without a wrapping rule it
  // runs straight out through the side of whatever is holding it.
  await page.setViewportSize({ width: 560, height: 900 });
  const spills = await page.evaluate(() => {
    const selector = ".dk-council-note p, .dk-msg p, .dk-council-notice-text";
    const seen = document.querySelectorAll(selector).length;
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      // Its own scrollWidth does not show this: the element is laid out wider
      // than what holds it, so the spill is only visible against the container.
      const holder = el.closest(".dk-council-conductor-log, .dk-council-thread-log, .dk-msg") || el.parentElement;
      const box = el.getBoundingClientRect();
      const bounds = holder.getBoundingClientRect();
      if (box.right - bounds.right > 1) out.push(`${el.className || el.tagName} spills ${Math.round(box.right - bounds.right)}px`);
    }
    return { seen, out };
  });
  assert.ok(spills.seen > 0, "The check needs some chat text to look at");
  assert.deepEqual(spills.out, [], "Text must wrap inside its container rather than run out through the side");
  await page.setViewportSize({ width: 1200, height: 900 });

  await page.locator(".dk-council-more").evaluate((menu) => { menu.open = true; });
  await page.locator(".dk-council-more-menu").getByRole("button", { name: /^Conductor/ }).click();

  await page.getByLabel("Council options", { exact: true }).click();
  await page.getByRole("button", { name: "Synthesize", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__knowledgeUi.actions), ["synthesize"]);
  await page.getByLabel("Council options", { exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "Stop all", exact: true }).isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Stop all", exact: true }).isVisible(), false);
  assert.equal(
    await page
      .getByLabel("Council options", { exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.screenshot({ path: "/tmp/pitwall-council-summary-light.png", fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({ path: "/tmp/pitwall-council-summary-dark.png", fullPage: true });
  await page.setViewportSize({ width: 700, height: 850 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "Council toolbar and summary must fit a narrow window",
  );
  for (const control of [
    page.getByRole("button", { name: "Pause", exact: true }),
    page.getByLabel("Council options", { exact: true }),
  ]) {
    const box = await control.boundingBox();
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 700 && box.y >= 0 && box.y + box.height < 160,
      "Primary and overflow controls must stay inside the visible toolbar",
    );
  }
  await page.screenshot({ path: "/tmp/pitwall-council-summary-narrow.png", fullPage: true });
  assert.deepEqual(errors, [], "The UI must not raise browser exceptions");
  console.log(
    "Pitwall project knowledge UI smoke test passed (learning, errors, version conflicts, pin, forget, scope promotion, receipts, themes, narrow layout, council summary, keyboard overflow, long-thread scrolling, and keyboard-only session creation).",
  );
} catch (error) {
  if (page) {
    console.error("Browser exceptions:", errors);
    console.error((await page.locator("body").innerText()).slice(0, 6000));
    await page.screenshot({ path: "/tmp/pitwall-knowledge-ui-failure.png", fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
