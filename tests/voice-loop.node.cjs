const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createVoiceOrchestrator,
  classifyConfirmation,
  isInterruption,
  STATES,
} = require("../electron/lib/voiceOrchestrator.cjs");
const { createCapabilityRegistry, RISK } = require("../electron/lib/capabilityRegistry.cjs");
const { createScreenContext, extractErrorLines } = require("../electron/lib/screenContext.cjs");

// ------------------------------------------------- confirmation vocabulary

test("recognises the ways people say yes and no", () => {
  for (const yes of ["yes", "Yeah", "yep", "sure", "do it", "go ahead", "okay", "confirm"]) {
    assert.equal(classifyConfirmation(yes), "yes", `${yes} should be yes`);
  }
  for (const no of ["no", "nope", "cancel", "never mind", "don't", "abort", "forget it"]) {
    assert.equal(classifyConfirmation(no), "no", `${no} should be no`);
  }
});

test("a sentence is a new request, not an answer", () => {
  assert.equal(classifyConfirmation("no, open the other file instead please"), null);
  assert.equal(classifyConfirmation("yes and then also run the tests for me"), null);
  assert.equal(classifyConfirmation("what am I looking at"), null);
  assert.equal(classifyConfirmation(""), null);
  assert.equal(classifyConfirmation("   "), null);
});

test("a contradictory answer is read as refusal", () => {
  // "no, go ahead" is genuinely ambiguous; refusing loses nothing but a retry.
  assert.equal(classifyConfirmation("no go ahead"), "no");
});

test("affirmative fragments inside another instruction never approve destruction", async () => {
  for (const words of ["not yet okay", "yes but wait", "I never said yes", "maybe yes", "yes only if safe"]) {
    assert.notEqual(classifyConfirmation(words), "yes", words);
    const { orchestrator, ran } = harness({ routeTo: [
      { capabilityId: "git.discard_changes", params: {} },
      { capabilityId: "git.diff", params: {} },
    ] });
    await orchestrator.submitText("discard my changes");
    await orchestrator.submitText(words);
    assert.equal(ran.includes("git.discard_changes"), false, words);
  }
});

test("recognises being told to stop", () => {
  assert.equal(isInterruption("stop"), true);
  assert.equal(isInterruption("never mind"), true);
  assert.equal(isInterruption("stop the tests"), false, "that is a request, not an interruption");
});

// -------------------------------------------------------------- orchestrator

function harness({ routeTo = { capabilityId: "tests.run", params: {} }, capabilities, routeDelayMs = 0 } = {}) {
  const spoken = [];
  const emitted = [];
  const ran = [];
  /** What the router was actually handed, which is not always what was said. */
  const routed = [];

  // Each turn may route somewhere different, which is the realistic case and
  // the only way to exercise "the user changed their mind mid-confirmation".
  // A single intent repeats for every turn.
  const queue = Array.isArray(routeTo) ? [...routeTo] : null;
  const nextIntent = () => (queue ? queue.shift() ?? routeTo[routeTo.length - 1] : routeTo);

  const registry = createCapabilityRegistry({ newId: () => "confirm-1" });
  registry.defineAll(
    capabilities || [
      {
        id: "tests.run",
        title: "Run tests",
        description: "Run the tests",
        risk: RISK.GUARDED,
        handler: () => {
          ran.push("tests.run");
          return { ok: true, speak: "All 31 tests passed." };
        },
      },
      {
        id: "git.discard_changes",
        title: "Discard changes",
        description: "Discard uncommitted work",
        risk: RISK.DESTRUCTIVE,
        handler: () => {
          ran.push("git.discard_changes");
          return { ok: true, speak: "Working tree reset." };
        },
        confirm: () => "This permanently discards your changes. Say yes to confirm.",
      },
      {
        id: "git.diff",
        title: "Show the diff",
        description: "Show what changed",
        risk: RISK.SAFE,
        handler: () => {
          ran.push("git.diff");
          return { ok: true, speak: "Three files changed." };
        },
      },
    ],
  );

  const sidecar = {
    start: () => ({ ok: true }),
    configure: () => ({ ok: true }),
    startListening: () => ({ ok: true }),
    stopListening: () => ({ ok: true }),
    listenOnce: () => ({ ok: true }),
    speak: (text) => spoken.push(text),
    stopSpeaking: () => spoken.push("[stopped]"),
    getState: () => ({ running: true }),
  };

  const orchestrator = createVoiceOrchestrator({
    sidecar,
    registry,
    router: {
      route: async ({ transcript }) => {
        // Locally-routed turns return immediately; a turn that needs the model
        // takes seconds, which is the difference the acknowledgement exists for.
        if (routeDelayMs) await new Promise((resolve) => setTimeout(resolve, routeDelayMs));
        routed.push(transcript);
        return { ok: true, intent: nextIntent(), transcript };
      },
    },
    memory: { recordSnapshot: () => {} },
    getContext: async () => ({ projectName: "pitwall" }),
    emit: (event) => emitted.push(event),
  });

  return { orchestrator, registry, spoken, emitted, ran, routed };
}

test("a routine request runs and is spoken back", async () => {
  const { orchestrator, spoken, ran } = harness();
  await orchestrator.submitText("run the tests");
  assert.deepEqual(ran, ["tests.run"]);
  assert.ok(spoken.includes("All 31 tests passed."));
  assert.equal(orchestrator.getStatus().state, STATES.LISTENING);
});

test("a destructive request waits, then runs on yes", async () => {
  const { orchestrator, spoken, ran } = harness({
    routeTo: { capabilityId: "git.discard_changes", params: {} },
  });

  await orchestrator.submitText("discard my changes");
  assert.deepEqual(ran, [], "nothing may run before confirmation");
  assert.ok(spoken.some((line) => /permanently discards/.test(line)));
  assert.equal(orchestrator.getStatus().state, STATES.AWAITING_CONFIRMATION);
  assert.ok(orchestrator.getStatus().pendingConfirmation);

  await orchestrator.submitText("yes");
  assert.deepEqual(ran, ["git.discard_changes"]);
  assert.equal(orchestrator.getStatus().pendingConfirmation, null);
});

test("a destructive request is dropped on no", async () => {
  const { orchestrator, spoken, ran } = harness({
    routeTo: { capabilityId: "git.discard_changes", params: {} },
  });
  await orchestrator.submitText("discard my changes");
  await orchestrator.submitText("no");
  assert.deepEqual(ran, []);
  assert.ok(spoken.includes("Okay, I won't."));
  assert.equal(orchestrator.getStatus().pendingConfirmation, null);
});

test("an unrelated utterance disarms the pending destructive action", async () => {
  // The dangerous case: Pitwall asks "should I discard?", the user says
  // something else entirely, and a later "yes" must not reach back and
  // approve the discard.
  const { orchestrator, registry, ran } = harness({
    routeTo: [
      { capabilityId: "git.discard_changes", params: {} },
      { capabilityId: "git.diff", params: {} },
    ],
  });
  await orchestrator.submitText("discard my changes");
  assert.ok(orchestrator.getStatus().pendingConfirmation);

  await orchestrator.submitText("actually show me what changed in the parser first");
  assert.deepEqual(ran, ["git.diff"], "the new request should run instead");
  assert.equal(orchestrator.getStatus().pendingConfirmation, null, "the pending action must be disarmed");
  assert.equal(registry.getPendingConfirmation(), null, "and cleared in the registry too");

  await orchestrator.submitText("yes");
  assert.ok(!ran.includes("git.discard_changes"), "a later yes must not resurrect the discard");
});

test("stopping talking does not run anything", async () => {
  const { orchestrator, spoken, ran } = harness();
  await orchestrator.submitText("stop");
  assert.deepEqual(ran, []);
  assert.ok(spoken.includes("[stopped]"));
});

test("a router failure is spoken rather than swallowed", async () => {
  const { registry } = harness();
  const spoken = [];
  const orchestrator = createVoiceOrchestrator({
    sidecar: {
      start: () => ({ ok: true }),
      speak: (text) => spoken.push(text),
      stopSpeaking: () => {},
      getState: () => ({ running: true }),
      stopListening: () => {},
      startListening: () => {},
      configure: () => {},
      listenOnce: () => {},
    },
    registry,
    router: { route: async () => ({ ok: false, error: "I don't have a way to do that." }) },
    memory: { recordSnapshot: () => {} },
    getContext: async () => ({}),
    emit: () => {},
  });
  await orchestrator.submitText("make me a sandwich");
  assert.ok(spoken.includes("I don't have a way to do that."));
});

test("a silent success still says something", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "quiet.thing", params: {} },
    capabilities: [
      { id: "quiet.thing", title: "Quiet", description: "d", risk: RISK.SAFE, handler: () => ({ ok: true }) },
    ],
  });
  await orchestrator.submitText("do the quiet thing");
  assert.ok(spoken.length > 0, "a turn that says nothing is indistinguishable from a crash");
});

test("long results are trimmed before they are spoken", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "wordy.thing", params: {} },
    capabilities: [
      {
        id: "wordy.thing",
        title: "Wordy",
        description: "d",
        risk: RISK.SAFE,
        handler: () => ({ ok: true, speak: `${"This is a sentence. ".repeat(200)}` }),
      },
    ],
  });
  await orchestrator.submitText("tell me everything");
  const utterance = spoken.at(-1);
  assert.ok(utterance.length < 800, `expected a trimmed utterance, got ${utterance.length} characters`);
});

test("markdown never reaches the synthesiser", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "fmt.thing", params: {} },
    capabilities: [
      {
        id: "fmt.thing",
        title: "Formatted",
        description: "d",
        risk: RISK.SAFE,
        handler: () => ({ ok: true, speak: "**Bold** and `code` and\n```js\nconst x = 1;\n```\ndone" }),
      },
    ],
  });
  await orchestrator.submitText("show me");
  const utterance = spoken.at(-1);
  assert.doesNotMatch(utterance, /[*`]/);
  assert.doesNotMatch(utterance, /const x/);
});

// ------------------------------------------------------------ screen context

test("finds the failure in a wall of terminal output", () => {
  const output = [
    "$ npm test",
    "> vitest run",
    "✓ src/lib/format.test.ts (4)",
    "✓ src/lib/agentGate.test.ts (7)",
    "✕ src/lib/councilRelay.test.ts > relays the stage prompt",
    "TypeError: Cannot read properties of undefined (reading 'stage')",
    "    at relayPrompt (src/lib/councilRelay.ts:212:18)",
    "Tests  1 failed | 11 passed",
  ].join("\n");

  const lines = extractErrorLines(output);
  assert.ok(lines.some((line) => /TypeError/.test(line)));
  assert.ok(lines.some((line) => /councilRelay.ts:212/.test(line)));
});

test("clean output yields no error", () => {
  assert.deepEqual(extractErrorLines("✓ everything passed\nTests 31 passed"), []);
  assert.deepEqual(extractErrorLines(""), []);
  assert.deepEqual(extractErrorLines(null), []);
});

test("prefers Pitwall's own state when Pitwall is frontmost", async () => {
  let prompt = "";
  const screen = createScreenContext({
    observerPath: "/fake",
    observe: async () => ({ ok: true, trusted: true, app: "Pitwall", window: "Pitwall", text: "" }),
    capture: async () => {
      throw new Error("a screenshot must not be taken when Pitwall's own state is available");
    },
    runConductor: async (text) => {
      prompt = text;
      return { ok: true, raw: "You're looking at the terminal pane in Pitwall." };
    },
  });

  const result = await screen.describe({}, { projectName: "pitwall", branch: "voice", terminalTail: "npm test" });
  assert.equal(result.ok, true);
  assert.equal(result.tier, "pitwall-state");
  assert.match(prompt, /Project: pitwall/);
});

test("falls back to a screenshot only when nothing structured is readable", async () => {
  let captured = false;
  const screen = createScreenContext({
    observerPath: "/fake",
    observe: async () => ({ ok: true, trusted: false, app: "Figma", window: "Untitled", text: "" }),
    capture: async () => {
      captured = true;
      return { ok: true, path: "/tmp/shot.png", size: 1000 };
    },
    runConductor: async () => ({ ok: true, raw: "A Figma canvas with a login screen." }),
  });

  const result = await screen.describe({}, {});
  assert.equal(captured, true);
  assert.equal(result.tier, "screenshot");
});

test("the accessibility tree beats a screenshot", async () => {
  const screen = createScreenContext({
    observerPath: "/fake",
    observe: async () => ({
      ok: true,
      trusted: true,
      app: "Google Chrome",
      window: "PR #42 · pitwall",
      text: "Checks have failed. 1 failing check: build (macos-latest). Merge blocked.",
    }),
    capture: async () => {
      throw new Error("a screenshot must not be taken when the window text is readable");
    },
    runConductor: async () => ({ ok: true, raw: "A GitHub pull request with a failing build check." }),
  });
  const result = await screen.describe({}, {});
  assert.equal(result.tier, "accessibility");
});

test("says so plainly when there is no error to explain", async () => {
  const screen = createScreenContext({
    observerPath: "/fake",
    observe: async () => ({ ok: true, trusted: true, app: "Pitwall", window: "Pitwall", text: "" }),
    capture: async () => ({ ok: false }),
    runConductor: async () => ({ ok: true, raw: "should not be reached" }),
  });
  const result = await screen.explainError({}, { terminalTail: "✓ all good\n31 passed" });
  assert.equal(result.ok, true);
  assert.match(result.speak, /can't see an error/i);
});

// ------------------------------------------------- routing latency

// Routing locally costs microseconds; routing through the model costs about
// five seconds. Silence during that gap is indistinguishable from not having
// been heard — which is exactly how the "it isn't answering" report started.

test("an instantly-routed turn says nothing before doing the work", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "tests.run", params: {}, say: "Running the tests." },
  });

  await orchestrator.submitText("run the tests");
  assert.ok(
    !spoken.some((line) => /one moment/i.test(line)),
    "a fast turn must not stall the user with an acknowledgement",
  );
  assert.deepEqual(spoken, ["Running the tests.", "All 31 tests passed."]);
});

test("a slow turn acknowledges rather than leaving dead air", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "tests.run", params: {}, say: "Running the tests." },
    routeDelayMs: 900,
  });

  await orchestrator.submitText("run whatever tests cover the parser");
  assert.ok(spoken.some((line) => /one moment/i.test(line)), "the user must hear something");
  assert.ok(
    !spoken.includes("Running the tests."),
    "the router's preamble is redundant once we have already acknowledged",
  );
  assert.ok(spoken.includes("All 31 tests passed."));
});

// ------------------------------------------------- corrections and undo

test("a correction re-routes the corrected words, not the complaint", async () => {
  const { orchestrator, routed } = harness({ routeTo: { capabilityId: "git.diff", params: {} } });
  await orchestrator.submitText("no, I meant show me the diff");
  assert.deepEqual(routed, ["show me the diff"]);
});

test("an ordinary request reaches the router untouched", async () => {
  const { orchestrator, routed } = harness({ routeTo: { capabilityId: "git.diff", params: {} } });
  await orchestrator.submitText("show me the diff");
  assert.deepEqual(routed, ["show me the diff"]);
});

test("correcting a pending destructive action disarms it and honours the new request", async () => {
  // "No, I meant show me the diff" is too long to be a yes/no answer, so it is
  // a new request — and the armed destructive action must be dropped before it
  // runs, not left waiting for a later stray "yes".
  const { orchestrator, ran, routed } = harness({
    routeTo: [
      { capabilityId: "git.discard_changes", params: {} },
      { capabilityId: "git.diff", params: {} },
    ],
  });
  await orchestrator.submitText("discard my changes");
  await orchestrator.submitText("no, I meant show me the diff");

  assert.ok(!ran.includes("git.discard_changes"), "the destructive action must never have run");
  assert.deepEqual(ran, ["git.diff"], "the corrected request is what should run");
  assert.equal(routed.at(-1), "show me the diff");
  assert.equal(orchestrator.getStatus().pendingConfirmation, null);
});

test("a bare no still answers the question on the table", async () => {
  const { orchestrator, ran, spoken } = harness({ routeTo: { capabilityId: "git.discard_changes", params: {} } });
  await orchestrator.submitText("discard my changes");
  await orchestrator.submitText("no");
  assert.deepEqual(ran, []);
  assert.ok(spoken.includes("Okay, I won't."));
});

test("undo reaches the registry instead of the router", async () => {
  let undone = 0;
  const { orchestrator, registry, routed } = harness();
  registry.undoLast = async () => {
    undone += 1;
    return { ok: true, speak: "Undid the commit." };
  };
  await orchestrator.submitText("undo that");
  assert.equal(undone, 1);
  assert.deepEqual(routed, [], "an undo is not a request to interpret");
});

test("a request that merely mentions undo is still routed", async () => {
  let undone = 0;
  const { orchestrator, registry, routed } = harness({ routeTo: { capabilityId: "git.diff", params: {} } });
  registry.undoLast = async () => {
    undone += 1;
    return { ok: true };
  };
  await orchestrator.submitText("undo the changes in App.tsx");
  assert.equal(undone, 0);
  assert.deepEqual(routed, ["undo the changes in App.tsx"]);
});

test("a refused undo is spoken with its reason", async () => {
  // The reason is the difference between an assistant being careful and one
  // that looks broken.
  const { orchestrator, registry, spoken } = harness();
  registry.undoLast = async () => ({
    ok: false,
    speak: "That commit has already been pushed. Undoing it would need a force push, so I've left it alone.",
  });
  await orchestrator.submitText("undo that");
  assert.ok(spoken.some((line) => /already been pushed/.test(line)), spoken.join(" | "));
});

test("a slow capability reassures the user instead of going silent", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "slow.thing", params: {} },
    capabilities: [
      {
        id: "slow.thing",
        title: "Take a while",
        description: "Takes a while on purpose.",
        risk: RISK.SAFE,
        progress: { afterMs: 20, say: "Still running the tests." },
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { ok: true, speak: "All 31 tests passed." };
        },
      },
    ],
  });

  await orchestrator.submitText("run the tests");
  assert.deepEqual(spoken, ["Still running the tests.", "All 31 tests passed."]);
});

test("a fast capability never reassures, because chatter is what gets it turned off", async () => {
  const { orchestrator, spoken } = harness({
    routeTo: { capabilityId: "slow.thing", params: {} },
    capabilities: [
      {
        id: "slow.thing",
        title: "Finish quickly",
        description: "Finishes before the reassurance is due.",
        risk: RISK.SAFE,
        progress: { afterMs: 200, say: "Still running the tests." },
        handler: async () => ({ ok: true, speak: "All 31 tests passed." }),
      },
    ],
  });

  await orchestrator.submitText("run the tests");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(spoken, ["All 31 tests passed."]);
});

test("a capability that declares progress without a line is rejected", () => {
  const registry = createCapabilityRegistry();
  assert.throws(
    () =>
      registry.define({
        id: "slow.thing",
        title: "Slow",
        description: "Declares progress badly.",
        risk: RISK.SAFE,
        handler: () => ({ ok: true }),
        progress: { afterMs: 1000 },
      }),
    /progress must be an object with a non-empty say/,
  );
});
