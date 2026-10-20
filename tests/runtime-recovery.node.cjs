const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRuntimeJournal } = require("../electron/lib/runtimeJournal.cjs");

function journalFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-recovery-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "runtime.json");
}

test("another crash before recovery preserves the durable session inventory", (t) => {
  const file = journalFile(t);
  const first = createRuntimeJournal(file);
  first.beginStartup();
  first.registerTerminal({ sessionId: "original", projectId: "project", nativeSessionId: "native" });
  const second = createRuntimeJournal(file);
  assert.equal(second.beginStartup().restorable, true);
  assert.equal(second.acknowledgeRecovery().ok, false);
  assert.equal(second.acknowledgeRecovery(null).ok, false);
  assert.equal(second.getRecovery().terminals.length, 1);
  const third = createRuntimeJournal(file);
  const recovery = third.beginStartup();
  assert.equal(recovery.interrupted, true);
  assert.equal(recovery.terminals[0].sessionId, "original");
  assert.equal(recovery.terminals[0].nativeSessionId, "native");
});

test("successful restoration clears only its pending record", (t) => {
  const file = journalFile(t);
  const first = createRuntimeJournal(file);
  first.beginStartup();
  first.registerTerminal({ sessionId: "restored" });
  first.registerTerminal({ sessionId: "unavailable" });
  const second = createRuntimeJournal(file);
  second.beginStartup();
  second.registerTerminal({ sessionId: "restored" });
  assert.deepEqual(second.getRecovery().terminals.map((item) => item.sessionId), ["unavailable"]);
  second.acknowledgeRecovery({ sessionIds: ["restored"] });
  assert.deepEqual(second.getRecovery().terminals.map((item) => item.sessionId), ["unavailable"]);
  second.markCleanShutdown();
  const third = createRuntimeJournal(file);
  const recovery = third.beginStartup();
  assert.equal(recovery.restorable, true);
  assert.deepEqual(recovery.terminals.map((item) => item.sessionId).sort(), ["restored", "unavailable"]);
});

test("explicit dismissal survives restart without deleting running session records", (t) => {
  const file = journalFile(t);
  const first = createRuntimeJournal(file);
  first.beginStartup();
  first.registerTerminal({ sessionId: "dismiss" });
  const second = createRuntimeJournal(file);
  second.beginStartup();
  second.registerTerminal({ sessionId: "running" });
  second.acknowledgeRecovery({ sessionIds: ["dismiss"] });
  const third = createRuntimeJournal(file);
  assert.deepEqual(third.beginStartup().terminals.map((item) => item.sessionId), ["running"]);
});
