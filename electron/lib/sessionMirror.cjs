const fs = require("node:fs");
const {
  claudeProjectDirectory,
  findActiveClaudeSession,
  readClaudeSessionSince,
} = require("./nativeSessions.cjs");

/** Longest tool output kept per record before it is cut short. */
const MAX_RESULT_CHARS = 4000;
/** Most records sent in one go. */
const MAX_BATCH = 150;

/**
 * Trims what crosses the process boundary.
 *
 * A working session's history file runs to megabytes, nearly all of it tool
 * output — one real session here was 8.7MB across 589 records. Sending that as
 * a single message is slow enough to stall the loop that is supposed to be
 * delivering the next turn, and no one reads a four-thousand-line file dump in
 * a transcript anyway.
 */
function trimRecord(record) {
  const content = record?.message?.content;
  if (!Array.isArray(content)) return record;
  let changed = false;
  const trimmed = content.map((block) => {
    if (typeof block?.content === "string" && block.content.length > MAX_RESULT_CHARS) {
      changed = true;
      const dropped = block.content.length - MAX_RESULT_CHARS;
      return { ...block, content: `${block.content.slice(0, MAX_RESULT_CHARS)}\n… ${dropped} more characters` };
    }
    if (typeof block?.text === "string" && block.text.length > MAX_RESULT_CHARS) {
      changed = true;
      return { ...block, text: `${block.text.slice(0, MAX_RESULT_CHARS)}\n… truncated` };
    }
    return block;
  });
  return changed ? { ...record, message: { ...record.message, content: trimmed } } : record;
}

/**
 * Follows the conversation a session's CLI is writing and reports what is new.
 *
 * The CLI is the only writer; this only ever reads. Which file it reads is
 * re-resolved on every pass rather than pinned once, because the CLI moves to a
 * new session file under a running terminal — a resume that does not take, a
 * compaction that opens a fresh one — and a follower holding the old file keeps
 * rendering a conversation that never gains another word.
 *
 * `emit`, `watch` and `now` are injected so the loop can be exercised without
 * an Electron main process or a real agent.
 */
function createSessionMirror({
  cwd,
  preferredId = "",
  emit,
  intervalMs = 1200,
  watch = fs.watch,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let claudeSessionId = null;
  let offset = 0;
  let delivered = 0;
  let watcher = null;
  let stopped = false;

  function pump() {
    if (stopped) return;
    const active = findActiveClaudeSession(cwd, preferredId);
    if (!active) return;

    if (active !== claudeSessionId) {
      claudeSessionId = active;
      offset = 0;
      delivered = 0;
      // A different file is a different conversation, so what is already drawn
      // no longer belongs to the live one.
      emit({ reset: true });
    }

    const result = readClaudeSessionSince(cwd, active, offset);
    offset = result.offset;
    delivered += result.records.length;

    if (result.records.length) {
      // Only the tail on a first pass: the interesting part of a long session
      // is the end of it, and the beginning is what makes the message huge.
      const batch = result.records.slice(-MAX_BATCH).map(trimRecord);
      emit({ history: batch });
    }

    // Reported every pass so a stalled follower is visible as a stalled
    // follower, rather than as a chat that has simply gone quiet.
    emit({ status: { claudeSessionId: active, records: delivered, at: Date.now() } });
  }

  try {
    // The directory, not one file: a new session file appearing is precisely
    // the event that must not be missed, and a file watch cannot see it.
    watcher = watch(claudeProjectDirectory(cwd), { persistent: false }, pump);
  } catch {
    // The project may hold no conversations yet; the poll covers it.
  }
  // fs.watch is unreliable on some filesystems, so a poll backs it up rather
  // than being the only mechanism.
  const timer = setIntervalFn(pump, intervalMs);
  pump();

  return {
    pump,
    get sessionId() {
      return claudeSessionId;
    },
    stop() {
      stopped = true;
      try {
        watcher?.close();
      } catch {
        // Already closed.
      }
      clearIntervalFn(timer);
    },
  };
}

module.exports = { createSessionMirror };
