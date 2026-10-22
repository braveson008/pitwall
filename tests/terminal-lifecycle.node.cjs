const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");

function section(start, end) {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `main.cjs no longer has ${JSON.stringify(start)} before ${JSON.stringify(end)}`);
  return main.slice(from, to);
}

// Run the main-process lifecycle functions with deterministic PTY scheduling.
// Real IPC tests cannot reliably make an old exit arrive after replacement.
function fixture({ releaseRuntime = async () => 0, allocate = async () => ({ previewPort: 8100 }), terminate = async () => ({ ok: true }), trust = async () => ({ ok: true, trusted: true }) } = {}) {
  const spawned = [];
  const sent = [];
  const removed = [];
  const swept = [];
  const context = {
    agentInvocation: (file, args) => ({ file, args }), agentSandbox: null,
    terminateSessionProcesses: async (target, options) => {
      swept.push({ ...target, ended: options.ended });
      return { ok: true, pids: [] };
    },
    // Every session here runs in a folder that exists; the missing-folder guard has its own test.
    expandHome: (value) => value || os.tmpdir(), fs: { ...fs, existsSync: () => true }, liveChanges: () => ({ start: async () => {} }), setTimeout, clearTimeout, process, tracedChunks: new Map(),
    resolveLaunch: () => ({ command: "inert", args: [], display: "inert" }),
    pty: { spawn() {
      const child = { pid: 1000 + spawned.length, onData: (fn) => { child.data = fn; }, onExit: (fn) => { child.exit = fn; } };
      spawned.push(child);
      return child;
    } },
    terminalProcesses: new Map(), terminalMetadata: new Map(), terminalStarts: new Map(), terminalStops: new Map(),
    projectMcpLaunchOptions: () => ({ args: [], env: {}, deniedTools: [] }), agentProfiles: {},
    getProviderCompatibility: () => ({}), normalizeAgentProvider: () => "custom",
    prepareAgentNotificationLaunch: () => ({ args: [], env: {} }),
    taskRuntimeAllocator: { allocate, release: releaseRuntime }, agentEnvironment: () => ({}), githubCredentialStore: null,
    taskRuntimeEnvironment: () => ({}), resolveShellPath: () => "",
    runtimeJournal: { registerTerminal() {}, removeTerminal: (id) => removed.push(id) },
    mainWindow: { webContents: { send: (...args) => sent.push(args) } },
    terminalCompletionSignal: () => false, isQuitting: false, intentionalTerminalStops: new Set(),
    emitAgentCompletion() {}, cleanupAgentNotificationRuntime() {}, terminateProcessTree: terminate,
    ensureProjectTrust: trust,
  };
  vm.createContext(context);
  vm.runInContext(section("function startAgentTerminal(", "\nfunction appleScriptString"), context);
  vm.runInContext(section("function stopAgentTerminal(", "\nasync function stopAllTerminals"), context);
  return { ...context, spawned, sent, removed, swept };
}

test("concurrent starts join one PTY launch", async () => {
  const runtime = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => runtime.startAgentTerminal({ sessionId: "one" })));
  // A name main.cjs uses that the fixture does not provide surfaces here as a
  // failed launch; say which one rather than only that the counts are off.
  assert.equal(results[0].ok, true, results[0].error);
  assert.equal(runtime.spawned.length, 1);
  assert.equal(runtime.terminalProcesses.size, 1);
  assert.equal(new Set(results.map(({ pid }) => pid)).size, 1);
  assert.equal(runtime.terminalStarts.size, 0);
});

test("late output and exit from a stopped process cannot erase its replacement", async () => {
  const runtime = fixture();
  await runtime.startAgentTerminal({ sessionId: "one" });
  const old = runtime.spawned[0];
  assert.equal((await runtime.stopAgentTerminal("one")).ok, true);
  await runtime.startAgentTerminal({ sessionId: "one" });
  const current = runtime.spawned[1];
  const removedBefore = runtime.removed.length;
  const sentBefore = runtime.sent.length;
  old.data("late output");
  old.exit({ exitCode: 0 });
  assert.equal(runtime.terminalProcesses.get("one"), current);
  assert.equal(runtime.terminalMetadata.has("one"), true);
  assert.equal(runtime.removed.length, removedBefore);
  assert.equal(runtime.sent.length, sentBefore);
});

test("stop during pending allocation cancels launch before a PTY is spawned", async () => {
  let release;
  const runtime = fixture({ allocate: () => new Promise((resolve) => { release = resolve; }) });
  const starting = runtime.startAgentTerminal({ sessionId: "one" });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const stopping = runtime.stopAgentTerminal("one");
  release({ previewPort: 8100 });
  assert.equal((await starting).ok, false);
  assert.equal((await stopping).ok, true);
  assert.equal(runtime.spawned.length, 0);
  assert.equal(runtime.terminalStarts.size, 0);
  assert.equal(runtime.terminalStops.size, 0);
});

test("failed termination retains process ownership and reports failure", async () => {
  const runtime = fixture({ terminate: async () => ({ ok: false, error: "still alive" }) });
  await runtime.startAgentTerminal({ sessionId: "one" });
  assert.equal((await runtime.stopAgentTerminal("one")).ok, false);
  assert.equal(runtime.terminalProcesses.get("one"), runtime.spawned[0]);
  assert.equal(runtime.terminalMetadata.has("one"), true);
  assert.equal(runtime.removed.length, 0);
});

test("a leader exiting during a failed stop does not lose ownership of its descendants", async () => {
  const runtime = fixture({ terminate: async (child) => {
    child.exit({ exitCode: 0 });
    return { ok: false, error: "descendant still alive" };
  } });
  await runtime.startAgentTerminal({ sessionId: "one" });
  assert.equal((await runtime.stopAgentTerminal("one")).ok, false);
  assert.equal(runtime.terminalProcesses.get("one"), runtime.spawned[0]);
  assert.equal(runtime.terminalMetadata.has("one"), true);
  assert.equal(runtime.removed.length, 0);
});

test("allocation exhaustion never starts a terminal without its runtime", async () => {
  const runtime = fixture({ allocate: async () => { throw new Error("ports exhausted"); } });
  const result = await runtime.startAgentTerminal({ sessionId: "one" });
  assert.equal(result.ok, false);
  assert.match(result.error, /ports exhausted/);
  assert.equal(runtime.spawned.length, 0);
});

test("initial task prompts fail closed when project trust cannot be established", async () => {
  const runtime = fixture({ trust: async () => ({ ok: false, error: "trust file is locked" }) });
  const result = await runtime.startAgentTerminal({ sessionId: "one", initialPrompt: "Edit the project" });
  assert.equal(result.ok, false);
  assert.match(result.error, /trust file is locked/);
  assert.equal(runtime.spawned.length, 0);
});

test("manual CLI attachment without a task does not bypass its native trust prompt", async () => {
  let trustCalls = 0;
  const runtime = fixture({ trust: async () => { trustCalls++; return { ok: false }; } });
  const result = await runtime.startAgentTerminal({ sessionId: "one" });
  assert.equal(result.ok, true);
  assert.equal(trustCalls, 0);
  assert.equal(runtime.spawned.length, 1);
});

test("launching resolves the current runtime instead of accepting a stale renderer plan", async () => {
  const runtime = fixture({ allocate: async () => ({ previewPort: 8200 }) });
  const result = await runtime.startAgentTerminal({ sessionId: "one", taskId: "task", taskRuntime: { previewPort: 8100 } });
  assert.equal(result.ok, true);
  assert.equal(result.taskRuntime.previewPort, 8200);
});


test("standalone runtime reservations are released after natural exit and confirmed stop", async () => {
  const released = [];
  const runtime = fixture({ releaseRuntime: async (payload) => { released.push(payload); return 1; } });
  await runtime.startAgentTerminal({ projectId: "project", sessionId: "natural" });
  runtime.spawned[0].exit({ exitCode: 0 });
  await runtime.startAgentTerminal({ projectId: "project", sessionId: "stopped" });
  await runtime.stopAgentTerminal("stopped");
  assert.deepEqual(released.map((item) => `${item.projectId}:${item.taskId}`), ["project:natural", "project:stopped"]);
  await runtime.startAgentTerminal({ projectId: "project", sessionId: "member", taskId: "shared-task" });
  await runtime.stopAgentTerminal("member");
  assert.equal(released.length, 2, "one council member must not release its shared task runtime");
});

test("terminal closed is emitted only after runtime ownership is removed", async () => {
  const runtime = fixture();
  let closed = 0;
  runtime.mainWindow.webContents.send = (channel, payload) => {
    if (channel !== "terminal:closed") return;
    closed += 1;
    assert.equal(runtime.terminalMetadata.has(payload.sessionId), false);
    assert.equal(runtime.terminalProcesses.has(payload.sessionId), false);
  };
  await runtime.startAgentTerminal({ sessionId: "natural" });
  runtime.spawned[0].exit({ exitCode: 0 });
  await runtime.startAgentTerminal({ sessionId: "stopped" });
  await runtime.stopAgentTerminal("stopped");
  assert.equal(closed, 2);
});

test("a stop ends what the session started outside its process group, and says it was a stop", async () => {
  const runtime = fixture();
  await runtime.startAgentTerminal({ sessionId: "one", projectPath: "/worktrees/one" });
  assert.equal((await runtime.stopAgentTerminal("one")).ok, true);
  assert.deepEqual(runtime.swept.map(({ sessionId, root }) => ({ sessionId, root })), [{ sessionId: "one", root: "/worktrees/one" }]);
  assert.deepEqual(runtime.sent.filter(([channel]) => channel === "terminal:closed").map(([, payload]) => ({ ...payload })), [{ sessionId: "one", stopped: true }]);
});

test("a natural exit ends the session's leftovers and reports its exit code", async () => {
  const runtime = fixture();
  await runtime.startAgentTerminal({ sessionId: "one", projectPath: "/worktrees/one" });
  runtime.spawned[0].exit({ exitCode: 3 });
  assert.equal(runtime.swept.length, 1);
  assert.deepEqual(runtime.sent.filter(([channel]) => channel === "terminal:closed").map(([, payload]) => ({ ...payload })), [{ sessionId: "one", exitCode: 3 }]);
});

test("a failed stop leaves the session's other processes alone", async () => {
  const runtime = fixture({ terminate: async () => ({ ok: false, error: "still alive" }) });
  await runtime.startAgentTerminal({ sessionId: "one", projectPath: "/worktrees/one" });
  assert.equal((await runtime.stopAgentTerminal("one")).ok, false);
  assert.equal(runtime.swept.length, 0);
});

test("a session restarted before its sweep runs keeps its new processes", async () => {
  const runtime = fixture();
  await runtime.startAgentTerminal({ sessionId: "one", projectPath: "/worktrees/one" });
  runtime.spawned[0].exit({ exitCode: 0 });
  assert.equal(runtime.swept[0].ended(), true);
  // Their children carry the same session marker, so the sweep must ask again.
  await runtime.startAgentTerminal({ sessionId: "one", projectPath: "/worktrees/one" });
  assert.equal(runtime.swept[0].ended(), false);
});
