/**
 * Pitwall's long-term memory of how the user works.
 *
 * Two kinds of thing live here:
 *
 *   - **notes** — decisions, preferences and facts worth recalling later.
 *   - **snapshots** — periodic captures of the development context (project,
 *     branch, open files, running sessions). These are what make "continue
 *     yesterday's work" mean something concrete rather than a guess.
 *
 * Storage is a single JSON file written atomically, matching `runtimeJournal`.
 * A database would be the obvious reach, but Electron 33 ships Node 20, which
 * has no `node:sqlite`, and pulling in a native module to hold a few hundred
 * rows would cost more in packaging pain than it returns.
 *
 * Every read path tolerates a corrupt or absent file. Memory is an enhancement;
 * losing it must degrade the assistant, never prevent it from starting.
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_NOTES = 500;
const MAX_SNAPSHOTS = 200;
const STOP_WORDS = new Set([
  "the", "a", "an", "was", "were", "what", "that", "this", "did", "we", "i",
  "about", "for", "and", "with", "our", "my", "is", "are", "to", "of", "on",
  "it", "why", "how", "when", "me", "you", "do", "does", "have", "has",
]);

function emptyState() {
  return { version: 1, notes: [], snapshots: [] };
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed?.version !== 1) return emptyState();
    return {
      version: 1,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    // Missing, unreadable or corrupt: start clean rather than throw.
    return emptyState();
  }
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function startOfDay(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function createMemoryStore(filePath, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  let state = readState(filePath);

  function write() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, filePath);
    } catch {
      // A memory that cannot be persisted is still useful for this session.
    }
  }

  function remember({ note, kind = "note", projectId = null } = {}) {
    const text = String(note || "").trim();
    if (!text) return null;
    const entry = { id: `${now()}-${state.notes.length}`, note: text, kind, projectId, at: new Date(now()).toISOString() };
    state.notes.push(entry);
    if (state.notes.length > MAX_NOTES) state.notes = state.notes.slice(-MAX_NOTES);
    write();
    return entry;
  }

  /**
   * Token-overlap search. Deliberately not fuzzy: a voice assistant that
   * confidently recalls the wrong decision is worse than one that says it
   * doesn't remember.
   */
  function recall(query, { limit = 5, projectId = null } = {}) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    return state.notes
      .filter((entry) => !projectId || !entry.projectId || entry.projectId === projectId)
      .map((entry) => {
        const haystack = entry.note.toLowerCase();
        const hits = tokens.filter((token) => haystack.includes(token)).length;
        return { entry, hits };
      })
      .filter((scored) => scored.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.entry.at.localeCompare(a.entry.at))
      .slice(0, limit)
      .map((scored) => scored.entry);
  }

  function recordSnapshot(snapshot = {}) {
    const entry = {
      at: new Date(now()).toISOString(),
      projectId: snapshot.projectId || null,
      projectName: snapshot.projectName || null,
      projectPath: snapshot.projectPath || null,
      branch: snapshot.branch || null,
      openFiles: Array.isArray(snapshot.openFiles) ? snapshot.openFiles.slice(0, 20) : [],
      sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions.slice(0, 20) : [],
      task: snapshot.task || null,
      note: snapshot.note || null,
    };
    state.snapshots.push(entry);
    if (state.snapshots.length > MAX_SNAPSHOTS) state.snapshots = state.snapshots.slice(-MAX_SNAPSHOTS);
    write();
    return entry;
  }

  function latestSnapshot() {
    return state.snapshots.length ? state.snapshots[state.snapshots.length - 1] : null;
  }

  /**
   * Resolve "yesterday" / "Friday" / "last time" to a snapshot.
   *
   * "Yesterday" means the last thing worked on *before today*, not literally
   * the calendar day before — after a weekend, "continue yesterday's work"
   * plainly means Friday's work, and resolving it to an empty Sunday would be
   * technically right and practically useless.
   */
  function snapshotFor(when) {
    const phrase = String(when || "").toLowerCase().trim();
    if (!state.snapshots.length) return null;

    if (!phrase || /(last time|where i left off|previous|recent)/.test(phrase)) {
      return latestSnapshot();
    }

    const todayStart = startOfDay(now());

    if (/(yesterday|last night|earlier|before)/.test(phrase)) {
      for (let index = state.snapshots.length - 1; index >= 0; index -= 1) {
        if (Date.parse(state.snapshots[index].at) < todayStart) return state.snapshots[index];
      }
      return latestSnapshot();
    }

    const weekday = WEEKDAYS.findIndex((day) => phrase.includes(day));
    if (weekday !== -1) {
      for (let index = state.snapshots.length - 1; index >= 0; index -= 1) {
        const at = Date.parse(state.snapshots[index].at);
        if (at < todayStart && new Date(at).getDay() === weekday) return state.snapshots[index];
      }
      return null;
    }

    return latestSnapshot();
  }

  function history({ limit = 10 } = {}) {
    return state.snapshots.slice(-limit).reverse();
  }

  function forget(id) {
    const before = state.notes.length;
    state.notes = state.notes.filter((entry) => entry.id !== id);
    if (state.notes.length !== before) write();
    return before !== state.notes.length;
  }

  function exportAll() {
    return JSON.parse(JSON.stringify(state));
  }

  function replaceAll(next) {
    state = { version: 1, notes: Array.isArray(next?.notes) ? next.notes : [], snapshots: Array.isArray(next?.snapshots) ? next.snapshots : [] };
    write();
  }

  return { remember, recall, recordSnapshot, latestSnapshot, snapshotFor, history, forget, exportAll, replaceAll };
}

module.exports = { createMemoryStore, tokenize };
