const assert = require("node:assert/strict");
const test = require("node:test");

const { validateParams, coerceScalar } = require("../electron/lib/capabilitySchema.cjs");
const { createCapabilityRegistry, RISK } = require("../electron/lib/capabilityRegistry.cjs");
const { createCapabilityCatalog } = require("../electron/lib/capabilityCatalog.cjs");
const { parseRouterReply, buildRouterPrompt, normalizeTranscript } = require("../electron/lib/intentRouter.cjs");
const { createMemoryStore } = require("../electron/lib/memoryStore.cjs");
const { matchApplication } = require("../electron/lib/osControl.cjs");

// ---------------------------------------------------------------- schema

test("coerces the sloppy shapes a model actually emits", () => {
  assert.deepEqual(coerceScalar("3", "integer"), { ok: true, value: 3 });
  assert.deepEqual(coerceScalar("yes", "boolean"), { ok: true, value: true });
  assert.equal(coerceScalar("3.5", "integer").ok, false);
  assert.equal(coerceScalar("banana", "number").ok, false);
  assert.equal(coerceScalar({}, "string").ok, false);
});

test("matches enum members case-insensitively but rejects non-members", () => {
  const schema = { type: "object", properties: { mode: { type: "string", enum: ["council", "compare"] } } };
  assert.deepEqual(validateParams(schema, { mode: "Council" }).value, { mode: "council" });
  assert.equal(validateParams(schema, { mode: "senate" }).ok, false);
});

test("drops unknown keys rather than passing them to a handler", () => {
  const schema = { type: "object", properties: { message: { type: "string" } } };
  const result = validateParams(schema, { message: "hi", confirmed: true, __proto__: "x" });
  assert.deepEqual(result.value, { message: "hi" });
  assert.equal(result.value.confirmed, undefined);
});

test("reports every missing required field at once", () => {
  const schema = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] };
  const result = validateParams(schema, {});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
});

test("applies defaults and enforces bounds", () => {
  const schema = {
    type: "object",
    properties: { maxLines: { type: "integer", minimum: 1, maximum: 100, default: 40 } },
  };
  assert.deepEqual(validateParams(schema, {}).value, { maxLines: 40 });
  assert.equal(validateParams(schema, { maxLines: 500 }).ok, false);
});

// -------------------------------------------------------------- registry

function fixtureRegistry(overrides = {}) {
  let clock = 1_000;
  const registry = createCapabilityRegistry({
    now: () => clock,
    newId: () => "confirm-1",
    ...overrides,
  });
  return { registry, advance: (ms) => (clock += ms) };
}

test("rejects capability definitions that would break the router", () => {
  const { registry } = fixtureRegistry();
  assert.throws(() => registry.define({ id: "bad id", title: "x", description: "d", risk: "safe", handler: () => {} }));
  assert.throws(() => registry.define({ id: "a.b", title: "x", risk: "safe", handler: () => {} }), /description/);
  assert.throws(() => registry.define({ id: "a.b", title: "x", description: "d", risk: "nuclear", handler: () => {} }));
  assert.throws(() => registry.define({ id: "a.b", title: "x", description: "d", risk: "safe" }), /handler/);
});

test("refuses duplicate capability ids", () => {
  const { registry } = fixtureRegistry();
  const definition = { id: "a.b", title: "x", description: "d", risk: RISK.SAFE, handler: () => ({ ok: true }) };
  registry.define(definition);
  assert.throws(() => registry.define(definition), /already registered/);
});

test("runs safe and guarded work without asking", async () => {
  const { registry } = fixtureRegistry();
  let ran = 0;
  registry.define({
    id: "tests.run",
    title: "Run tests",
    description: "d",
    risk: RISK.GUARDED,
    handler: () => {
      ran += 1;
      return { ok: true, speak: "All 19 tests passed." };
    },
  });
  const result = await registry.dispatch({ capabilityId: "tests.run" });
  assert.equal(result.ok, true);
  assert.equal(ran, 1);
  assert.equal(result.speak, "All 19 tests passed.");
});

test("destructive work does not run until it is confirmed", async () => {
  const { registry } = fixtureRegistry();
  let ran = 0;
  registry.define({
    id: "git.discard_changes",
    title: "Discard changes",
    description: "d",
    risk: RISK.DESTRUCTIVE,
    handler: () => {
      ran += 1;
      return { ok: true };
    },
    confirm: () => "This discards everything. Say yes to confirm.",
  });

  const first = await registry.dispatch({ capabilityId: "git.discard_changes" });
  assert.equal(first.ok, false);
  assert.equal(first.code, "confirmation_required");
  assert.equal(ran, 0, "the handler must not run before confirmation");
  assert.match(first.speak, /discards everything/);

  const confirmed = await registry.dispatch({
    capabilityId: "git.discard_changes",
    confirmationId: first.confirmation.id,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(ran, 1);
});

test("a confirmation is single-use", async () => {
  const { registry } = fixtureRegistry();
  registry.define({
    id: "git.discard_changes",
    title: "Discard",
    description: "d",
    risk: RISK.DESTRUCTIVE,
    handler: () => ({ ok: true }),
  });
  const pending = await registry.dispatch({ capabilityId: "git.discard_changes" });
  await registry.dispatch({ capabilityId: "git.discard_changes", confirmationId: pending.confirmation.id });
  const replay = await registry.dispatch({
    capabilityId: "git.discard_changes",
    confirmationId: pending.confirmation.id,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, "confirmation_expired");
});

test("a stale confirmation id cannot approve a different action", async () => {
  const { registry } = fixtureRegistry();
  for (const id of ["git.discard_changes", "session.delete"]) {
    registry.define({ id, title: id, description: "d", risk: RISK.DESTRUCTIVE, handler: () => ({ ok: true }) });
  }
  const pending = await registry.dispatch({ capabilityId: "git.discard_changes" });
  // The user then asks for something else destructive; approving the pending
  // discard must not carry over to deleting a session.
  const other = await registry.dispatch({ capabilityId: "session.delete", confirmationId: pending.confirmation.id });
  assert.equal(other.ok, false);
  assert.equal(other.code, "confirmation_mismatch");

  // ...and the original action is still waiting, un-run.
  assert.equal(registry.getPendingConfirmation().capabilityId, "git.discard_changes");
});

test("confirmations expire so an overheard yes cannot land later", async () => {
  const { registry, advance } = fixtureRegistry();
  registry.define({
    id: "git.discard_changes",
    title: "Discard",
    description: "d",
    risk: RISK.DESTRUCTIVE,
    handler: () => ({ ok: true }),
  });
  const pending = await registry.dispatch({ capabilityId: "git.discard_changes" });
  advance(10 * 60 * 1000);
  const late = await registry.dispatch({
    capabilityId: "git.discard_changes",
    confirmationId: pending.confirmation.id,
  });
  assert.equal(late.ok, false);
  assert.equal(late.code, "confirmation_expired");
  assert.equal(registry.getPendingConfirmation(), null);
});

test("confirmation binds arguments and project identity to the proposed action", async () => {
  const registry = createCapabilityRegistry();
  const calls = [];
  registry.define({
    id: "git.discard_changes", title: "Discard", description: "d", risk: RISK.DESTRUCTIVE,
    params: { type: "object", properties: { path: { type: "string" } } },
    handler: (params, context) => { calls.push({ params, context }); return { ok: true }; },
  });
  const request = { capabilityId: "git.discard_changes", params: { path: "one.txt" } };
  const context = { projectId: "one", projectPath: "/tmp/one", branch: "main" };
  const first = await registry.dispatch(request, context);
  const confirm = { ...request, confirmationId: first.confirmation.id };
  request.params.path = "two.txt";
  assert.equal((await registry.dispatch(confirm, context)).code, "confirmation_mismatch");
  confirm.params = { path: "one.txt" };
  for (const changed of [{ projectId: "two" }, { projectPath: "/tmp/two" }, { branch: "other" }]) {
    assert.equal((await registry.dispatch(confirm, { ...context, ...changed })).code, "confirmation_mismatch");
  }
  assert.equal(calls.length, 0);
  assert.equal((await registry.dispatch(confirm, context)).ok, true);
  assert.deepEqual(calls[0].params, { path: "one.txt" });
});

test("session confirmation rejects selection and roster changes but ignores streaming output", async () => {
  const registry = createCapabilityRegistry();
  let calls = 0;
  registry.define({ id: "session.delete", title: "Delete", description: "d", risk: RISK.DESTRUCTIVE,
    handler: () => { calls++; return { ok: true }; } });
  const context = { projectId: "one", projectPath: "/tmp/one", activeSessionId: "a", activeSession: "Same name",
    sessions: [{ id: "a", name: "Same name", status: "running" }, { id: "b", name: "Same name" }], terminalTail: "old" };
  const first = await registry.dispatch({ capabilityId: "session.delete" }, context);
  const confirm = { capabilityId: "session.delete", confirmationId: first.confirmation.id };
  assert.equal((await registry.dispatch(confirm, { ...context, activeSessionId: "b" })).code, "confirmation_mismatch");
  assert.equal((await registry.dispatch(confirm, { ...context, sessions: context.sessions.slice(1) })).code, "confirmation_mismatch");
  assert.equal(calls, 0);
  assert.equal((await registry.dispatch(confirm, { ...context, terminalTail: "new", runningSessions: [] })).ok, true);
});

test("undo refuses a different project even when its branch has the same name", async () => {
  let calls = 0;
  const registry = undoRegistry(() => { calls++; return { ok: true }; });
  await registry.dispatch({ capabilityId: "demo.act", params: {} }, { projectId: "a", projectPath: "/tmp/a", branch: "main" });
  const result = await registry.undoLast({ projectId: "b", projectPath: "/tmp/b", branch: "main" });
  assert.equal(result.code, "undo_context_changed");
  assert.equal(calls, 0);
});

test("undo retains the original project while an action is in flight", async () => {
  const registry = createCapabilityRegistry();
  let finish;
  let undone = false;
  registry.define({ id: "demo.act", title: "Act", description: "d", risk: RISK.GUARDED,
    handler: () => new Promise((resolve) => { finish = resolve; }),
    undo: { handler: () => { undone = true; return { ok: true }; } },
  });
  const context = { projectId: "one", projectPath: "/tmp/one" };
  const started = registry.dispatch({ capabilityId: "demo.act" }, context);
  context.projectId = "two";
  context.projectPath = "/tmp/two";
  finish({ ok: true });
  await started;
  assert.equal((await registry.undoLast({ projectId: "one", projectPath: "/tmp/one" })).ok, true);
  assert.equal(undone, true);
});

test("invalid arguments are refused before the handler is reached", async () => {
  const { registry } = fixtureRegistry();
  let ran = 0;
  registry.define({
    id: "git.commit",
    title: "Commit",
    description: "d",
    risk: RISK.GUARDED,
    params: { type: "object", properties: { message: { type: "string", minLength: 1 } }, required: ["message"] },
    handler: () => {
      ran += 1;
      return { ok: true };
    },
  });
  const result = await registry.dispatch({ capabilityId: "git.commit", params: {} });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_params");
  assert.equal(ran, 0);
});

test("a throwing handler becomes a spoken failure, not a crash", async () => {
  const { registry } = fixtureRegistry();
  registry.define({
    id: "git.push",
    title: "Push",
    description: "d",
    risk: RISK.GUARDED,
    handler: () => {
      throw new Error("no upstream branch");
    },
  });
  const result = await registry.dispatch({ capabilityId: "git.push" });
  assert.equal(result.ok, false);
  assert.match(result.speak, /no upstream branch/);
});

test("unknown capabilities are rejected by name", async () => {
  const { registry } = fixtureRegistry();
  const result = await registry.dispatch({ capabilityId: "os.run_shell", params: { command: "rm -rf /" } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unknown_capability");
});

// --------------------------------------------------------------- catalog

function fixtureCatalog() {
  const calls = [];
  const record = (name) => (params) => {
    calls.push({ name, params });
    return { ok: true };
  };
  const catalog = createCapabilityCatalog({
    git: {
      status: record("git.status"),
      diff: record("git.diff"),
      commit: record("git.commit"),
      push: record("git.push"),
      createBranch: record("git.createBranch"),
      discardChanges: record("git.discardChanges"),
      openRemote: record("git.openRemote"),
    },
    project: { summarize: record("project.summarize"), readFile: record("project.readFile") },
    tests: { run: record("tests.run") },
    os: { launchApp: record("os.launchApp"), openUrl: record("os.openUrl"), revealPath: record("os.revealPath") },
    memory: { resume: record("memory.resume"), recall: record("memory.recall"), remember: record("memory.remember") },
    screen: { describe: record("screen.describe"), explainError: record("screen.explainError") },
    tracker: { pickTask: record("tracker.pickTask") },
    callRenderer: (id, params) => {
      calls.push({ name: `renderer:${id}`, params });
      return { ok: true };
    },
  });
  return { catalog, calls };
}

test("the catalog registers cleanly and exposes no shell escape hatch", () => {
  const { catalog } = fixtureCatalog();
  const { registry } = fixtureRegistry();
  registry.defineAll(catalog);
  assert.ok(registry.size >= 20, `expected a substantial catalog, got ${registry.size}`);

  for (const capability of registry.list()) {
    assert.ok(capability.description.length > 10, `${capability.id} needs a real description`);
    const serialized = JSON.stringify(capability.params);
    assert.doesNotMatch(
      serialized,
      /"(command|shell|script|argv|cmd)"\s*:/,
      `${capability.id} exposes a raw command parameter, which defeats the risk tiers`,
    );
  }
});

test("only genuinely irreversible capabilities are destructive", () => {
  const { catalog } = fixtureCatalog();
  const destructive = catalog.filter((c) => c.risk === RISK.DESTRUCTIVE).map((c) => c.id).sort();
  assert.deepEqual(destructive, ["git.discard_changes", "session.delete"]);
  for (const capability of catalog.filter((c) => c.risk === RISK.DESTRUCTIVE)) {
    assert.equal(typeof capability.confirm, "function", `${capability.id} must phrase its own confirmation`);
  }
});

test("every capability declares where it runs", () => {
  const { catalog } = fixtureCatalog();
  for (const capability of catalog) {
    assert.ok(["main", "renderer"].includes(capability.surface), `${capability.id} has no surface`);
  }
});

test("renderer capabilities are forwarded rather than run in main", async () => {
  const { catalog, calls } = fixtureCatalog();
  const { registry } = fixtureRegistry();
  registry.defineAll(catalog);
  await registry.dispatch({ capabilityId: "project.switch", params: { name: "frontend" } });
  assert.deepEqual(calls.at(-1), { name: "renderer:project.switch", params: { name: "frontend" } });
});

test("the tool schema the router sees flags destructive capabilities", () => {
  const { catalog } = fixtureCatalog();
  const { registry } = fixtureRegistry();
  registry.defineAll(catalog);
  const tools = registry.toToolSchema();
  const discard = tools.find((tool) => tool.name === "git.discard_changes");
  assert.match(discard.description, /destructive/i);
  assert.ok(tools.every((tool) => tool.input_schema && tool.name.includes(".")));
});

test("a spoken ticket number reaches task.start intact", async () => {
  const { catalog, calls } = fixtureCatalog();
  const { registry } = fixtureRegistry();
  registry.defineAll(catalog);
  const result = await registry.dispatch({
    capabilityId: "task.start",
    params: { identifier: "PROJ-999", title: "fix the parser" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1).params, { identifier: "PROJ-999", title: "fix the parser" });
});

test("a ticket identifier with shell metacharacters is refused", async () => {
  const { catalog } = fixtureCatalog();
  const { registry } = fixtureRegistry();
  registry.defineAll(catalog);
  const result = await registry.dispatch({
    capabilityId: "task.start",
    params: { identifier: "PROJ-1; rm -rf ~" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_params");
});

// ---------------------------------------------------------- intent router

test("normalizes what the transcriber hands over", () => {
  assert.equal(normalizeTranscript("  Pitwall, run the tests.  "), "run the tests.");
  assert.equal(normalizeTranscript("braveli run the tests"), "run the tests");
  assert.equal(normalizeTranscript("Bravely, open VS Code"), "open VS Code");
  assert.equal(normalizeTranscript("hey Pitwall — what's changed?"), "what's changed?");
  assert.equal(normalizeTranscript("run the tests"), "run the tests");
});

test("the router prompt carries the tools and the context", () => {
  const prompt = buildRouterPrompt({
    transcript: "run the tests",
    tools: [{ name: "tests.run", description: "Run the tests", input_schema: { type: "object", properties: {} } }],
    context: { projectName: "braveli", branch: "main" },
  });
  assert.match(prompt, /tests\.run/);
  assert.match(prompt, /braveli/);
  assert.match(prompt, /main/);
  assert.match(prompt, /run the tests/);
});

test("parses a clean router reply", () => {
  const parsed = parseRouterReply('{"capabilityId":"tests.run","params":{},"say":"Running them now."}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.intent.capabilityId, "tests.run");
  assert.equal(parsed.intent.say, "Running them now.");
});

test("survives the fences and prose models wrap JSON in", () => {
  const fenced = 'Sure!\n```json\n{"capabilityId":"git.status","params":{}}\n```\nHope that helps.';
  const parsed = parseRouterReply(fenced);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.intent.capabilityId, "git.status");
});

test("a reply with no usable JSON fails rather than guessing", () => {
  assert.equal(parseRouterReply("I'm not sure what you mean.").ok, false);
  assert.equal(parseRouterReply("").ok, false);
  assert.equal(parseRouterReply('{"params":{}}').ok, false);
});

test("router params that are not an object are refused", () => {
  const parsed = parseRouterReply('{"capabilityId":"tests.run","params":"everything"}');
  assert.equal(parsed.ok, false);
});

// ---------------------------------------------------------------- memory

test("remembers, recalls and resumes", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-memory-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const file = path.join(directory, "memory.json");
  let clock = Date.parse("2026-08-05T10:00:00Z");
  const store = createMemoryStore(file, { now: () => clock });

  store.remember({ note: "We chose Postgres over Mongo for the ledger", kind: "decision" });
  store.remember({ note: "Prefers pnpm", kind: "preference" });

  assert.equal(store.recall("postgres").length, 1);
  assert.match(store.recall("postgres")[0].note, /Postgres/);
  assert.equal(store.recall("kubernetes").length, 0);

  store.recordSnapshot({
    projectId: "p1",
    projectName: "braveli",
    projectPath: "/tmp/braveli",
    branch: "voice",
    openFiles: ["src/App.tsx"],
    sessions: [{ id: "s1", agent: "claude", name: "voice work" }],
  });

  // A store that only lives in memory would "remember" across a restart by
  // accident; reopen from disk so persistence is what is actually asserted.
  const reopened = createMemoryStore(file, { now: () => clock });
  const latest = reopened.latestSnapshot();
  assert.equal(latest.projectName, "braveli");
  assert.equal(latest.branch, "voice");
  assert.deepEqual(latest.openFiles, ["src/App.tsx"]);
  assert.equal(reopened.recall("postgres").length, 1);

  clock += 26 * 60 * 60 * 1000;
  reopened.recordSnapshot({ projectId: "p2", projectName: "other", projectPath: "/tmp/other", branch: "main" });
  const yesterday = reopened.snapshotFor("yesterday");
  assert.equal(yesterday.projectName, "braveli", "'yesterday' must not resolve to today's snapshot");
});

test("memory survives a corrupt file instead of taking the app down", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-memory-bad-"));
  const file = path.join(directory, "memory.json");
  fs.writeFileSync(file, "{ not json at all");
  const store = createMemoryStore(file);
  assert.deepEqual(store.recall("anything"), []);
  assert.equal(store.latestSnapshot(), null);
  store.remember({ note: "still works" });
  assert.equal(store.recall("still works").length, 1);
  fs.rmSync(directory, { recursive: true, force: true });
});

// ------------------------------------------------------------- os control

test("matches spoken application names to real apps", () => {
  const installed = ["Visual Studio Code", "Figma", "Slack", "Google Chrome", "iTerm"];
  assert.equal(matchApplication("VS Code", installed), "Visual Studio Code");
  assert.equal(matchApplication("vscode", installed), "Visual Studio Code");
  assert.equal(matchApplication("figma", installed), "Figma");
  assert.equal(matchApplication("the browser", installed), "Google Chrome");
  assert.equal(matchApplication("Photoshop", installed), null);
});

// --------------------------------------------------------- voice selection

const {
  rankVoices,
  pickDefaultVoice,
  describeVoiceQuality,
  scoreVoice,
  toSidecarConfig,
  PRESETS,
} = require("../electron/lib/voicePresets.cjs");

const VOICE_FIXTURE = [
  { identifier: "id.samantha", name: "Samantha", language: "en-US", quality: 1 },
  { identifier: "id.moira", name: "Moira", language: "en-IE", quality: 1 },
  { identifier: "id.zarvox", name: "Zarvox", language: "en-US", quality: 1 },
  { identifier: "id.fred", name: "Fred", language: "en-US", quality: 1 },
  { identifier: "id.grandma", name: "Grandma", language: "en-US", quality: 1 },
  { identifier: "id.marie", name: "Marie", language: "fr-FR", quality: 3 },
];

test("never offers novelty or robotic voices", () => {
  const names = rankVoices(VOICE_FIXTURE, { locale: "en-US" }).map((voice) => voice.name);
  for (const excluded of ["Zarvox", "Fred", "Grandma"]) {
    assert.ok(!names.includes(excluded), `${excluded} must not be offered`);
  }
  assert.ok(names.includes("Samantha"));
});

test("a premium voice outranks a compact one regardless of name", () => {
  const voices = [
    { identifier: "id.samantha", name: "Samantha", language: "en-US", quality: 1 },
    { identifier: "id.daniel", name: "Daniel", language: "en-GB", quality: 3 },
  ];
  // Quality dominates: the gap between tiers is far larger than between two
  // voices in the same tier, which is the whole point of the ranking.
  assert.equal(pickDefaultVoice(voices, { locale: "en-US" }).name, "Daniel");
});

test("same-locale wins a tie but never beats a higher tier", () => {
  const sameTier = [
    { identifier: "a", name: "Karen", language: "en-AU", quality: 1 },
    { identifier: "b", name: "Karen", language: "en-IE", quality: 1 },
  ];
  assert.equal(pickDefaultVoice(sameTier, { locale: "en-IE" }).language, "en-IE");

  const mixedTier = [
    { identifier: "a", name: "Moira", language: "en-IE", quality: 1 },
    { identifier: "b", name: "Ava", language: "en-US", quality: 3 },
  ];
  assert.equal(pickDefaultVoice(mixedTier, { locale: "en-IE" }).name, "Ava");
});

test("voices in another language are not offered", () => {
  assert.ok(!rankVoices(VOICE_FIXTURE, { locale: "en-US" }).some((voice) => voice.name === "Marie"));
});

test("explains why everything sounds thin when only compact voices exist", () => {
  const verdict = describeVoiceQuality(VOICE_FIXTURE);
  assert.equal(verdict.needsDownload, true);
  assert.match(verdict.message, /System Settings/);
  assert.match(verdict.message, /Premium|Enhanced/);

  const withPremium = describeVoiceQuality([
    ...VOICE_FIXTURE,
    { identifier: "id.ava", name: "Ava", language: "en-US", quality: 3 },
  ]);
  assert.equal(withPremium.needsDownload, false);
});

test("an unknown new voice is offered, but below curated ones in its tier", () => {
  const voices = [
    { identifier: "a", name: "Samantha", language: "en-US", quality: 1 },
    { identifier: "b", name: "Newvoice", language: "en-US", quality: 1 },
  ];
  assert.equal(pickDefaultVoice(voices, { locale: "en-US" }).name, "Samantha");
  assert.ok(scoreVoice(voices[1]) > 0, "an unknown voice should still be usable");
});

test("every soothing preset is slower than the screen-reader default", () => {
  for (const preset of Object.values(PRESETS)) {
    if (preset.id === "focused") continue;
    assert.ok(preset.rate < 0.5, `${preset.id} should be slower than 0.5, got ${preset.rate}`);
    assert.ok(preset.pitch <= 1, `${preset.id} should not be pitched up`);
  }
});

test("presets translate into the daemon's config shape", () => {
  const config = toSidecarConfig({ voiceIdentifier: "id.ava", preset: "warm", locale: "en-IE" });
  assert.equal(config.voice, "id.ava");
  assert.equal(config.speechRate, PRESETS.warm.rate);
  assert.equal(config.pitch, PRESETS.warm.pitch);
  assert.equal(config.locale, "en-IE");

  // An unknown preset falls back rather than producing undefined rates.
  const fallback = toSidecarConfig({ preset: "nonsense" });
  assert.equal(fallback.speechRate, PRESETS.calm.rate);
});

// ------------------------------------------------------------ opening pages

const { normalizeSpokenUrl, remoteToWebUrl } = require("../electron/lib/osControl.cjs");

test("turns what people say into a URL", () => {
  assert.equal(normalizeSpokenUrl("github.com"), "https://github.com/");
  assert.equal(normalizeSpokenUrl("github"), "https://github.com");
  assert.equal(normalizeSpokenUrl("github dot com"), "https://github.com/");
  assert.equal(normalizeSpokenUrl("github.com/braveson008"), "https://github.com/braveson008");
  assert.equal(normalizeSpokenUrl("https://figma.com/file/abc"), "https://figma.com/file/abc");
});

test("refuses schemes that are not web pages", () => {
  // A mis-transcription, or text lifted off the user's screen, must never be
  // able to produce one of these.
  for (const hostile of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<script>", "ftp://host/x"]) {
    assert.equal(normalizeSpokenUrl(hostile), null, `${hostile} must not become a URL`);
  }
  assert.equal(normalizeSpokenUrl("not a url"), null);
  assert.equal(normalizeSpokenUrl(""), null);
});

test("converts a git remote into a page a person can open", () => {
  assert.equal(remoteToWebUrl("git@github.com:braveson008/Pitwall.git"), "https://github.com/braveson008/Pitwall");
  assert.equal(remoteToWebUrl("https://github.com/braveson008/Pitwall.git"), "https://github.com/braveson008/Pitwall");
  assert.equal(remoteToWebUrl("git@gitlab.com:team/app.git"), "https://gitlab.com/team/app");
  assert.equal(remoteToWebUrl(""), null);
});

test("opening a page in a named browser resolves the browser", async () => {
  const opened = [];
  const { createOsControl } = require("../electron/lib/osControl.cjs");
  const osControl = createOsControl({
    listApplications: () => ["Google Chrome", "Safari"],
    open: async (args) => {
      opened.push(args);
      return { ok: true };
    },
  });

  // The exact failure the user hit: Chrome opened but the page did not,
  // because only os.launch_app existed.
  const result = await osControl.openUrl({ url: "github.com", browser: "chrome" }, {});
  assert.equal(result.ok, true);
  assert.deepEqual(opened.at(-1), ["-a", "Google Chrome", "https://github.com/"]);
  assert.match(result.speak, /github\.com.*Google Chrome/);
});

test("an unknown browser is refused rather than silently defaulted", async () => {
  const { createOsControl } = require("../electron/lib/osControl.cjs");
  const osControl = createOsControl({
    listApplications: () => ["Safari"],
    open: async () => ({ ok: true }),
  });
  const result = await osControl.openUrl({ url: "github.com", browser: "Netscape" }, {});
  assert.equal(result.ok, false);
  assert.match(result.speak, /couldn't find a browser/i);
});

test("os.open_url and os.launch_app are both reachable and distinct", () => {
  const { catalog } = fixtureCatalog();
  const ids = catalog.map((capability) => capability.id);
  assert.ok(ids.includes("os.open_url"));
  assert.ok(ids.includes("os.launch_app"));
  assert.ok(ids.includes("git.open_remote"));

  // The router picks by description, so open_url must actively say it wins
  // when a page is named — otherwise "open github in chrome" routes to
  // launch_app and only the browser opens.
  const openUrl = catalog.find((capability) => capability.id === "os.open_url");
  assert.match(openUrl.description, /not os\.launch_app/i);
});

// ------------------------------------------------------------------- undo

const undoRegistry = (undoHandler, { risk = RISK.GUARDED } = {}) => {
  const registry = createCapabilityRegistry();
  registry.define({
    id: "demo.act",
    title: "Act",
    description: "Does a reversible thing.",
    risk,
    handler: () => ({ ok: true, token: "abc" }),
    ...(undoHandler ? { undo: { summarize: () => "the demo action", handler: undoHandler } } : {}),
  });
  registry.define({
    id: "demo.read",
    title: "Read",
    description: "Does nothing worth reversing.",
    risk: RISK.SAFE,
    handler: () => ({ ok: true }),
  });
  return registry;
};

test("a capability that declares no undo cannot be undone", async () => {
  const registry = undoRegistry(null);
  await registry.dispatch({ capabilityId: "demo.act" });
  assert.equal(registry.getUndoable(), null);
  const result = await registry.undoLast();
  assert.equal(result.ok, false);
  assert.equal(result.code, "nothing_to_undo");
});

test("undo reverses the last action and hands the handler what the run produced", async () => {
  let seen = null;
  const registry = undoRegistry((record) => {
    seen = record;
    return { ok: true, speak: "Put back." };
  });
  await registry.dispatch({ capabilityId: "demo.act", params: {} });
  assert.equal(registry.getUndoable().capabilityId, "demo.act");

  const result = await registry.undoLast();
  assert.equal(result.ok, true);
  assert.equal(result.speak, "Put back.");
  // The undo handler's only reliable source of truth about what happened.
  assert.equal(seen.result.token, "abc");
});

test("undo is consumed, so saying it twice does not reverse twice", async () => {
  let calls = 0;
  const registry = undoRegistry(() => {
    calls += 1;
    return { ok: true };
  });
  await registry.dispatch({ capabilityId: "demo.act" });
  await registry.undoLast();
  const second = await registry.undoLast();
  assert.equal(calls, 1);
  assert.equal(second.ok, false);
  assert.equal(second.code, "nothing_to_undo");
});

test("a later action clears the undo, even one that cannot itself be undone", async () => {
  // Otherwise "commit, check status, undo that" reverses the commit — which is
  // not the last thing that happened, and not what "that" means.
  const registry = undoRegistry(() => ({ ok: true }));
  await registry.dispatch({ capabilityId: "demo.act" });
  await registry.dispatch({ capabilityId: "demo.read" });
  assert.equal(registry.getUndoable(), null);
  assert.equal((await registry.undoLast()).ok, false);
});

test("a failed action leaves nothing to undo", async () => {
  const registry = createCapabilityRegistry();
  registry.define({
    id: "demo.act",
    title: "Act",
    description: "Fails.",
    risk: RISK.GUARDED,
    handler: () => ({ ok: false, error: "nope" }),
    undo: { handler: () => ({ ok: true }) },
  });
  await registry.dispatch({ capabilityId: "demo.act" });
  assert.equal(registry.getUndoable(), null);
});

test("undo expires, so it never reverses something from before the last thing", async () => {
  let clock = 1_000;
  const registry = createCapabilityRegistry({ now: () => clock, policy: { undoWindowMs: 60_000 } });
  registry.define({
    id: "demo.act",
    title: "Act",
    description: "Reversible.",
    risk: RISK.GUARDED,
    handler: () => ({ ok: true }),
    undo: { handler: () => ({ ok: true }) },
  });
  await registry.dispatch({ capabilityId: "demo.act" });
  clock += 61_000;
  assert.equal(registry.getUndoable(), null);
  assert.equal((await registry.undoLast()).code, "nothing_to_undo");
});

test("a throwing undo becomes a spoken failure, not a crash", async () => {
  const registry = undoRegistry(() => {
    throw new Error("the branch is checked out");
  });
  await registry.dispatch({ capabilityId: "demo.act" });
  const result = await registry.undoLast();
  assert.equal(result.ok, false);
  assert.match(result.speak, /the branch is checked out/);
});

test("declaring undo without a handler is rejected at definition time", () => {
  const registry = createCapabilityRegistry();
  assert.throws(
    () =>
      registry.define({
        id: "demo.act",
        title: "Act",
        description: "Claims to be reversible.",
        risk: RISK.GUARDED,
        handler: () => ({ ok: true }),
        undo: { summarize: () => "something" },
      }),
    /undo must be an object with a handler/,
  );
});

test("only capabilities that can honestly be reversed declare an undo", () => {
  // The point of the whole design: git.push cannot be undone without a force
  // push over work that may not be yours, and session.send cannot be unsent
  // because the agent has already read it. Both must stay undeclared.
  const { catalog } = fixtureCatalog();
  const undoable = catalog.filter((capability) => capability.undo).map((capability) => capability.id).sort();
  assert.deepEqual(undoable, ["git.commit", "git.create_branch", "memory.remember"]);

  for (const id of ["git.push", "session.send", "session.delete", "git.discard_changes"]) {
    assert.equal(catalog.find((capability) => capability.id === id)?.undo, undefined, `${id} must not claim to be undoable`);
  }
});
