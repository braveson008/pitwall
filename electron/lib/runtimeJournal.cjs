const fs = require("node:fs");
const path = require("node:path");

const EMPTY_RECOVERY = Object.freeze({
  recovered: false,
  restorable: false,
  interrupted: false,
  terminals: [],
});

function defaultState() {
  return {
    version: 1,
    cleanShutdown: true,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    terminals: {},
    pendingTerminals: {},
  };
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.version === 1 ? { ...defaultState(), ...parsed } : defaultState();
  } catch {
    return defaultState();
  }
}

function createRuntimeJournal(filePath) {
  let state = readState(filePath);
  let recovery = EMPTY_RECOVERY;

  function refreshRecovery() {
    const terminals = Object.values(state.pendingTerminals || {});
    recovery = terminals.length ? { ...recovery, restorable: true, terminals } : EMPTY_RECOVERY;
  }

  function write() {
    state.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  function beginStartup() {
    const pendingTerminals = { ...(state.pendingTerminals || {}), ...(state.terminals || {}) };
    const terminals = Object.values(pendingTerminals);
    if (terminals.length > 0) {
      recovery = {
        recovered: !state.cleanShutdown,
        restorable: true,
        interrupted: !state.cleanShutdown,
        detectedAt: new Date().toISOString(),
        terminals,
      };
    }

    state = {
      ...defaultState(),
      cleanShutdown: false,
      startedAt: new Date().toISOString(),
      pendingTerminals,
    };
    write();
    return recovery;
  }

  return {
    beginStartup,
    getRecovery: () => recovery,
    acknowledgeRecovery(payload = {}) {
      if (!Array.isArray(payload?.sessionIds) || payload.sessionIds.some((id) => typeof id !== "string" || !id)) {
        return { ok: false, error: "Explicit session ids are required to dismiss recovery" };
      }
      for (const id of payload.sessionIds) delete state.pendingTerminals[id];
      refreshRecovery();
      write();
      return { ok: true };
    },
    registerTerminal(payload) {
      delete state.pendingTerminals[payload.sessionId];
      state.terminals[payload.sessionId] = {
        sessionId: payload.sessionId,
        projectId: payload.projectId || "",
        projectPath: payload.projectPath || "",
        sessionName: payload.sessionName || "",
        agent: payload.agent || "",
        model: payload.model || "auto",
        nativeSessionId: payload.nativeSessionId || "",
        startedAt: new Date().toISOString(),
      };
      refreshRecovery();
      write();
    },
    removeTerminal(sessionId) {
      delete state.terminals[sessionId];
      delete state.pendingTerminals[sessionId];
      refreshRecovery();
      write();
    },
    markCleanShutdown() {
      state.cleanShutdown = true;
      write();
    },
    snapshot: () => JSON.parse(JSON.stringify(state)),
  };
}

module.exports = { createRuntimeJournal };
