const fs = require("node:fs");
const path = require("node:path");

/**
 * Which model the automations run on, and how often the board re-reads its
 * tracker — set by the person, not fixed in code.
 *
 * Everything ran on Opus by default, and a ticket watch every five minutes
 * was half of someone's Claude usage. Sonnet is the default now; each kind of
 * work has its own setting, and each watch can override it.
 */
const KINDS = ["tracker", "review", "fix", "writer"];
const DEFAULTS = Object.freeze({
  models: Object.freeze({ tracker: "sonnet", review: "sonnet", fix: "sonnet", writer: "sonnet" }),
  boardSyncMinutes: 15,
});
const BOARD_SYNC_CHOICES = [0, 15, 30, 60, 120];
const MODEL = /^[\w.\-[\]:]{1,80}$/;

function validModel(value) {
  const model = String(value ?? "").trim();
  return MODEL.test(model) ? model : "";
}

function normalize(raw) {
  const models = {};
  for (const kind of KINDS) models[kind] = validModel(raw?.models?.[kind]) || DEFAULTS.models[kind];
  const minutes = Number(raw?.boardSyncMinutes);
  return { models, boardSyncMinutes: BOARD_SYNC_CHOICES.includes(minutes) ? minutes : DEFAULTS.boardSyncMinutes };
}

function createAutomationSettings(filePath) {
  let state = normalize(null);
  try { state = normalize(JSON.parse(fs.readFileSync(filePath, "utf8"))); } catch { /* first run */ }
  return {
    get: () => ({ models: { ...state.models }, boardSyncMinutes: state.boardSyncMinutes }),
    set(patch) {
      const models = { ...state.models };
      // A value that does not validate leaves the setting as it was.
      for (const kind of KINDS) {
        const model = validModel(patch?.models?.[kind]);
        // Tracker reads use the tracker connection set up in Claude; Codex has none
        // Pitwall can scope. Hermes reviews only: its guard keeps it read-only.
        const hermes = model === "hermes" || model.startsWith("hermes:");
        if (model && !(kind === "tracker" && model.startsWith("codex:")) && !(hermes && kind !== "review")) models[kind] = model;
      }
      const minutes = Number(patch?.boardSyncMinutes);
      state = { models, boardSyncMinutes: BOARD_SYNC_CHOICES.includes(minutes) ? minutes : state.boardSyncMinutes };
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
      } catch { /* kept for this run; the next change tries again */ }
      return this.get();
    },
  };
}

/** The model for one piece of a watch's work: the watch's own choice, else the default for that kind. */
function modelFor(settings, kind, watch) {
  return validModel(watch?.config?.model) || settings.models[kind] || DEFAULTS.models[kind];
}

module.exports = { createAutomationSettings, modelFor, validModel, DEFAULTS, KINDS, BOARD_SYNC_CHOICES };
