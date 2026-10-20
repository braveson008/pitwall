const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createVoiceRuntime } = require("../electron/lib/voiceRuntime.cjs");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-voice-runtime-"));
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  const runtime = createVoiceRuntime({
    ipcMain,
    getMainWindow: () => null,
    userDataPath: root,
    runGit: async () => ({ ok: false, stdout: "", stderr: "unused" }),
    runConductor: async () => ({ ok: false }),
    resolveProjectFile: (cwd, file) => ({ root: cwd, target: path.join(cwd, file) }),
    ...overrides,
  });
  t.after(() => { runtime.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, ipcMain, runtime };
}

test("voice file reading uses the resolver's target and respects its rejection", async (t) => {
  const prompts = [];
  const { root, runtime } = fixture(t, {
    resolveProjectFile(cwd, file) {
      if (file.startsWith("..")) throw new Error("outside project");
      return { root: cwd, target: path.join(cwd, file) };
    },
    runConductor: async (prompt) => { prompts.push(prompt); return { ok: true, raw: "A fixture file." }; },
  });
  fs.writeFileSync(path.join(root, "example.txt"), "fixture content\nsecond line");
  const result = await runtime.registry.dispatch({ capabilityId: "editor.read_file", params: { path: "example.txt" } }, { projectPath: root });
  assert.equal(result.ok, true);
  assert.equal(result.lineCount, 2);
  assert.match(prompts[0], /fixture content/);
  const rejected = await runtime.registry.dispatch({ capabilityId: "editor.read_file", params: { path: "../outside" } }, { projectPath: root });
  assert.equal(rejected.ok, false);
  assert.equal(prompts.length, 1);
});

test("confirmed session deletion forwards the checked identity to the renderer", async (t) => {
  const sent = [];
  let ipc;
  const { runtime, ipcMain } = fixture(t, {
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { send(channel, payload) {
        sent.push({ channel, ...payload });
        setImmediate(() => ipc.emit("voice:renderer-result", {}, { id: payload.id, result: { ok: true } }));
      } },
    }),
  });
  ipc = ipcMain;
  const context = { projectId: "project", projectPath: "/tmp/project", activeSessionId: "one", activeSession: "One",
    sessions: [{ id: "one", name: "One", status: "running" }] };
  const request = { capabilityId: "session.delete", params: { name: "One", expectedProjectId: "forged" } };
  const first = await runtime.registry.dispatch(request, context);
  assert.equal(sent.length, 0);
  assert.equal((await runtime.registry.dispatch({ ...request, confirmationId: first.confirmation.id }, context)).ok, true);
  assert.deepEqual(sent[0].params, {
    name: "One", expectedProjectId: "project", expectedProjectPath: "/tmp/project", expectedSessionId: "one",
    expectedSessions: [{ id: "one", name: "One" }],
  });
});
