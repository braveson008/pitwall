"use strict";
/**
 * The sync loop: this computer's records up, everyone else's down.
 *
 * Push collects every record, turns paths into tokens, redacts any absolute
 * path left, and uploads those whose content changed since the last sync,
 * each sealed to its id and next revision. A conflict means another computer
 * wrote first: its copy is fetched, merged field by field, applied here, and
 * the merge is uploaded on top. Pull reads the account's change feed from
 * where this computer left off, merges each change with what is here
 * (including edits not yet pushed) and hands the result to `apply`.
 *
 * Local state (`cloud/state.json`) remembers the last synced copy of every
 * record, so a restart uploads nothing that has not changed.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { deriveKeys, objectId, open, openBytes, seal, sealBytes, CloudCryptoError } = require("./crypto.cjs");
const { SET_FIELDS, mergeRecords, stampClock } = require("./merge.cjs");
const { relativise, resolve, scrubAbsolutePaths } = require("./pathMap.cjs");

const PART_BYTES = 8 * 1024 * 1024;
const MAX_CONFLICT_RETRIES = 3;
const PUSH_DEBOUNCE_MS = 2000;
const CURSOR_SAVE_MS = 30_000;
const LONG_POLL_SECONDS = 25;
// Never-synced local copies are older than anything already in the cloud: on a
// computer's first sync, the cloud's version of a shared record wins.
const NEVER_SYNCED = "1970-01-01T00:00:00.000Z";
// Kinds kept in local state as a fingerprint only: large, and never merged field by field.
const FINGERPRINT_KINDS = new Set(["attachment", "knowledge"]);
const MASS_DELETION_COUNT = 20;
const MASS_DELETION_SHARE = 0.25;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
const hashOf = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

function createSyncEngine({ client, vault, stateDir, collect, apply, roots = () => [], now = () => new Date().toISOString(), log = () => {} }) {
  const { objectKey, idKey } = deriveKeys(vault.masterKey);
  const stateFile = path.join(stateDir, "state.json");
  const slot = (id, rev) => ({ vaultId: vault.vaultId, id, rev });
  let state = load();
  let status = { state: "idle", lastSyncedAt: null, pending: 0, error: null };
  const listeners = new Set();
  let queue = Promise.resolve();
  let running = false;
  let pushTimer = null;
  let loopTimer = null;
  let backoffMs = 5000;
  // The long poll in flight, so stopping the engine ends it at once.
  let poll = null;
  let allowMassDeletion = false;

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (parsed?.vaultId === vault.vaultId) {
        for (const record of Object.values(parsed.records || {})) {
          if (FINGERPRINT_KINDS.has(record?.kind)) Object.assign(record, { data: null, clock: {} });
        }
        return { cursor: 0, records: {}, blobs: {}, unreadable: {}, ...parsed };
      }
    } catch {
      // First sync on this computer.
    }
    return { vaultId: vault.vaultId, cursor: 0, records: {}, blobs: {}, unreadable: {} };
  }

  // Only the change-feed position moved: written within the minute, not on every round.
  let cursorTimer = null;
  function saveSoon() {
    if (cursorTimer) return;
    cursorTimer = setTimeout(() => {
      cursorTimer = null;
      save();
    }, CURSOR_SAVE_MS);
    cursorTimer.unref?.();
  }

  function save() {
    clearTimeout(cursorTimer);
    cursorTimer = null;
    fs.mkdirSync(stateDir, { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  }

  function setStatus(patch) {
    status = { ...status, ...patch, unreadable: Object.keys(state.unreadable || {}).length, heldDeletions: (state.held || []).length };
    for (const listener of listeners) listener(status);
  }

  /** One thing at a time: pushes and pulls both read and write the local state. */
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  const idFor = (kind, localId) => objectId(idKey, kind, localId);

  function portable(record, knownRoots = roots()) {
    const { value, dropped } = scrubAbsolutePaths(relativise(record.data, knownRoots));
    if (dropped) log(`cloud: redacted ${dropped} path(s) in a ${record.kind} record`);
    return value;
  }

  /**
   * Merged data as this computer should hold it. A field still equal to what
   * this computer sent keeps this computer's own value, so a path redacted on
   * the way out never replaces the text it came from.
   */
  function forLocal(merged, here) {
    const resolved = resolve(merged, roots());
    if (!here?.raw || !merged || typeof merged !== "object") return resolved;
    const out = { ...resolved };
    for (const key of Object.keys(merged)) {
      if (Object.prototype.hasOwnProperty.call(here.data || {}, key) && hashOf(merged[key]) === hashOf(here.data[key])) out[key] = here.raw[key];
    }
    return out;
  }

  function failure(result) {
    if (result.status === 0) return { state: "offline", error: null };
    if (result.status === 507) return { state: "quota", error: result.message };
    return { state: "error", error: result.message };
  }

  async function fetchRemote(id) {
    const got = await client.getObject(id);
    // Only a sealed tombstone means deleted; a server that drops a record has not deleted it.
    if (!got.ok) return got.status === 410 || got.status === 404 ? { ok: true, missing: true, rev: null } : got;
    try {
      return { ok: true, rev: got.rev, envelope: open(objectKey, slot(id, got.rev), got.bytes) };
    } catch (error) {
      if (error instanceof CloudCryptoError) return { ok: false, status: -1, message: "A synced record could not be decrypted." };
      throw error;
    }
  }

  /** Uploads one record, merging with whatever another computer wrote first. */
  async function upload(id, kind, localId, data, clock, applyLocally, here = null) {
    let rev = state.records[id]?.rev || 0;
    let body = { data, clock };
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      const sealed = seal(objectKey, slot(id, rev + 1), { v: 1, kind, localId, ...body });
      const put = await client.putObject(id, rev, sealed);
      if (process.env.PITWALL_CLOUD_DEBUG) log(`cloud: put ${kind}/${localId} at ${rev} -> ${put.ok ? put.data.rev : put.status}`);
      if (put.ok) {
        const light = FINGERPRINT_KINDS.has(kind);
        state.records[id] = { kind, localId, rev: put.data.rev, hash: hashOf(body.data), data: light ? null : body.data, clock: light ? {} : body.clock };
        return { ok: true };
      }
      if (put.status !== 409) return put;
      const remote = await fetchRemote(id);
      if (!remote.ok) return remote;
      if (remote.missing) {
        rev = put.rev;
        continue;
      }
      const merged = mergeRecords(body, remote.envelope, { setFields: SET_FIELDS[kind] || [] });
      if (merged.deleted) {
        state.records[id] = { kind, localId, rev: remote.rev, hash: null, data: null, clock: {}, deleted: true };
        applyLocally.push({ kind, localId, data: null });
        return { ok: true };
      }
      if (hashOf(merged.data) !== hashOf(data)) applyLocally.push({ kind, localId, data: forLocal(merged.data, here) });
      body = merged;
      rev = remote.rev;
    }
    return { ok: false, status: 409, message: "Another computer kept changing this record; it will sync next time." };
  }

  /** This computer's records, or null while it cannot say yet (the window has not reported its state). */
  // Portable form and hash per record, reused while the record and the roots are unchanged.
  let prepared = new Map();
  let preparedRoots = "";
  async function currentLocal() {
    const collected = await collect();
    if (!collected) return null;
    const knownRoots = roots();
    const rootsKey = JSON.stringify(knownRoots);
    if (rootsKey !== preparedRoots) {
      prepared = new Map();
      preparedRoots = rootsKey;
    }
    const next = new Map();
    const records = new Map();
    for (const record of collected) {
      if (!record?.kind || record.localId === undefined || record.localId === null) continue;
      const id = idFor(record.kind, String(record.localId));
      const key = record.fingerprint ? `fingerprint:${record.fingerprint}` : JSON.stringify(record.data);
      let entry = prepared.get(id);
      if (!entry || entry.key !== key) {
        const data = portable(record, knownRoots);
        entry = { key, data, hash: hashOf(data) };
      }
      next.set(id, entry);
      const { fingerprint: _fingerprint, ...rest } = record;
      records.set(id, { ...rest, localId: String(record.localId), data: entry.data, hash: entry.hash, raw: record.data });
    }
    prepared = next;
    return records;
  }

  async function pushOnce() {
    const local = await currentLocal();
    // Without this computer's state, every record would look deleted here.
    if (!local) return { problem: null, pending: 0 };
    const applyLocally = [];
    let pending = 0;
    let problem = null;
    let changed = false;
    for (const [id, record] of local) {
      const previous = state.records[id];
      const hash = record.hash;
      if (previous && !previous.deleted && previous.hash === hash) continue;
      // Too large to sync as it is: not tried again until it changes.
      if (state.tooLarge?.[id] === hash) continue;
      changed = true;
      const clock = stampClock(previous && !previous.deleted ? previous : null, record.data, previous ? now() : state.cursor ? now() : NEVER_SYNCED);
      const result = await upload(id, record.kind, record.localId, record.data, clock, applyLocally, record);
      if (!result.ok) {
        pending += 1;
        if (result.status === 413) {
          state.tooLarge = { ...(state.tooLarge || {}), [id]: hash };
          problem ||= { ...result, message: `A ${record.kind} is too large to sync; the rest of your work syncs normally.` };
          continue;
        }
        problem ||= result;
        if (result.status === 0) break;
      }
    }
    const gone = Object.entries(state.records).filter(([id, previous]) => !previous.deleted && !local.has(id) && previous.kind !== "blob");
    const live = Object.values(state.records).filter((previous) => !previous.deleted && previous.kind !== "blob").length;
    // A wiped or broken local state looks exactly like deleting everything. Past a
    // handful, deletions wait for the person instead of reaching every computer.
    const heldBefore = JSON.stringify(state.held || []);
    if (gone.length > MASS_DELETION_COUNT && gone.length > live * MASS_DELETION_SHARE && !allowMassDeletion) {
      state.held = gone.map(([id]) => id);
    } else if (!problem) {
      state.held = [];
      if (gone.length) changed = true;
      allowMassDeletion = false;
      for (const [id, previous] of gone) {
        // A deletion is a sealed record too, so nobody but a computer holding the key can make one.
        const deletedAt = now();
        const sealed = seal(objectKey, slot(id, previous.rev + 1), { v: 1, kind: previous.kind, localId: previous.localId, deleted: true, deletedAt, data: null, clock: {} });
        const removed = await client.putObject(id, previous.rev, sealed);
        if (removed.ok) state.records[id] = { ...previous, rev: removed.data.rev, deleted: true, deletedAt, data: null, hash: null };
        else if (removed.status === 409) {
          // Changed elsewhere after we last saw it: bring it back rather than lose that edit.
          const remote = await fetchRemote(id);
          if (remote.ok && remote.envelope && !remote.envelope.deleted) {
            state.records[id] = { kind: previous.kind, localId: previous.localId, rev: remote.rev, hash: hashOf(remote.envelope.data), data: remote.envelope.data, clock: remote.envelope.clock };
            applyLocally.push({ kind: previous.kind, localId: previous.localId, data: resolve(remote.envelope.data, roots()) });
          }
        } else {
          problem ||= removed;
          pending += 1;
        }
      }
    }
    if (changed || JSON.stringify(state.held || []) !== heldBefore) save();
    if (applyLocally.length) await apply(applyLocally);
    return { problem, pending };
  }

  async function pullOnce({ wait = 0 } = {}) {
    let local = null;
    let more = true;
    while (more) {
      let changed = false;
      const feed = await client.changes(state.cursor, { wait });
      if (!feed.ok) return { problem: feed };
      wait = 0;
      more = feed.data.more;
      const toApply = [];
      for (const change of feed.data.changes) {
        if (change.id.includes(".")) continue;
        const previous = state.records[change.id];
        if (previous && previous.rev >= change.rev) continue;
        // The server's own deletion flag is not trusted; only sealed tombstones delete.
        if (change.deleted) continue;
        changed = true;
        const remote = await fetchRemote(change.id);
        if (!remote.ok && remote.status === -1) {
          // Sealed under some other key: set aside so one record can't stop everything else.
          state.unreadable[change.id] = change.rev;
          continue;
        }
        if (!remote.ok) return { problem: remote };
        if (remote.missing) continue;
        // Never an older copy over a newer one, whatever the feed says.
        if (previous && remote.rev <= previous.rev) continue;
        const { kind, localId } = remote.envelope;
        if (remote.envelope.deleted) {
          const local = previous && !previous.deleted ? { data: previous.data, clock: previous.clock } : null;
          const merged = mergeRecords(local, { deleted: true, deletedAt: remote.envelope.deletedAt, data: null, clock: {} });
          if (merged.deleted) {
            if (previous && !previous.deleted) toApply.push({ kind, localId, data: null });
            state.records[change.id] = { kind, localId, rev: remote.rev, deleted: true, deletedAt: remote.envelope.deletedAt, data: null, hash: null, clock: {} };
          } else {
            // Edited here after it was deleted there: the edit stands and goes back up.
            state.records[change.id] = { kind, localId, rev: remote.rev, data: merged.data, clock: merged.clock, hash: null };
          }
          continue;
        }
        if (kind === "blob") {
          state.records[change.id] = { kind, localId, rev: remote.rev, hash: hashOf(remote.envelope.data), data: remote.envelope.data, clock: remote.envelope.clock };
          continue;
        }
        local ||= (await currentLocal()) || new Map();
        const here = local.get(change.id);
        let mine = previous && !previous.deleted ? { data: previous.data, clock: previous.clock } : null;
        // Edits made here since the last sync take part in the merge.
        if (here && (!previous || previous.deleted || here.hash !== previous.hash)) {
          mine = { data: here.data, clock: stampClock(mine, here.data, previous ? now() : NEVER_SYNCED) };
        }
        const merged = mergeRecords(mine, remote.envelope, { setFields: SET_FIELDS[kind] || [] });
        const differs = mine && hashOf(merged.data) !== hashOf(remote.envelope.data);
        const light = FINGERPRINT_KINDS.has(kind);
        state.records[change.id] = {
          kind, localId, rev: remote.rev, data: light ? null : merged.data, clock: light ? {} : merged.clock,
          // A merge that kept something of ours goes back up on the next push.
          hash: differs ? null : hashOf(merged.data),
        };
        const mergedHash = hashOf(merged.data);
        if (process.env.PITWALL_CLOUD_DEBUG && here && here.hash !== mergedHash) {
          const keys = [...new Set([...Object.keys(here.data || {}), ...Object.keys(merged.data || {})])].filter((key) => hashOf(here.data?.[key] ?? null) !== hashOf(merged.data?.[key] ?? null));
          log(`cloud: ${kind}/${localId} differs in ${keys.join(",")}: ${keys.map((key) => `${JSON.stringify(here.data?.[key])?.slice(0, 80)} vs ${JSON.stringify(merged.data?.[key])?.slice(0, 80)}`).join(" | ")}`);
        }
        if (!here || here.hash !== mergedHash) toApply.push({ kind, localId, data: forLocal(merged.data, here) });
      }
      if (process.env.PITWALL_CLOUD_DEBUG) log(`cloud: pulled ${feed.data.changes.length} change(s), applying ${toApply.map((change) => `${change.kind}/${change.localId}`).join(", ") || "nothing"}`);
      if (toApply.length) await apply(toApply);
      const moved = state.cursor !== feed.data.next;
      state.cursor = feed.data.next;
      if (changed) save();
      else if (moved) saveSoon();
    }
    return { problem: null };
  }

  async function cycle({ quiet = false } = {}) {
    const wait = 0;
    // A round woken by the change feed is routine; one somebody asked for says it is syncing.
    if (!quiet) setStatus({ state: "syncing" });
    // A computer's first sync reads the account first, so what it already has is matched to that before anything goes up.
    if (!state.cursor) {
      const first = await serial(() => pullOnce({ wait: 0 }));
      if (first.problem) {
        setStatus(failure(first.problem));
        return false;
      }
    }
    const pushed = await serial(pushOnce);
    // Offline stops the round; a record that failed on its own doesn't stop the others coming in.
    if (pushed.problem?.status === 0) {
      setStatus({ ...failure(pushed.problem), pending: pushed.pending });
      return false;
    }
    const pulled = await serial(() => pullOnce({ wait }));
    if (pulled.problem) {
      setStatus(failure(pulled.problem));
      return false;
    }
    // A pull can leave merged records to send back; send them now rather than next time.
    const again = await serial(pushOnce);
    const problem = again.problem || pushed.problem;
    if (problem) {
      setStatus({ ...failure(problem), pending: again.pending || pushed.pending });
      return false;
    }
    setStatus({ state: "idle", lastSyncedAt: now(), pending: 0, error: null });
    return true;
  }

  async function putBlob(kind, localId, bytes) {
    const id = idFor(`${kind}:blob`, localId);
    const previous = state.blobs[id] || { parts: [], hashes: [] };
    const parts = [];
    const hashes = [];
    for (let index = 0, offset = 0; offset < bytes.length || index === 0; index += 1, offset += PART_BYTES) {
      const partId = `${id}.${index}`;
      const rev = previous.parts[index] || 0;
      const partHash = crypto.createHash("sha256").update(bytes.subarray(offset, offset + PART_BYTES)).digest("hex");
      hashes.push(partHash);
      // A conversation only grows at the end: parts already uploaded unchanged are not sent again.
      if (rev && previous.hashes?.[index] === partHash) {
        parts.push(rev);
        continue;
      }
      const put = await client.putObject(partId, rev, sealBytes(objectKey, slot(partId, rev + 1), bytes.subarray(offset, offset + PART_BYTES)));
      if (!put.ok) {
        // Another computer wrote this part; take over from its revision.
        if (put.status === 409) {
          const retry = await client.putObject(partId, put.rev, sealBytes(objectKey, slot(partId, put.rev + 1), bytes.subarray(offset, offset + PART_BYTES)));
          if (!retry.ok) return retry;
          parts.push(retry.data.rev);
          continue;
        }
        return put;
      }
      parts.push(put.data.rev);
    }
    state.blobs[id] = { parts, hashes };
    const manifest = { parts: parts.length, revs: parts, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    const applyLocally = [];
    const result = await serial(() => upload(id, "blob", `${kind}:${localId}`, manifest, stampClock(null, manifest, now()), applyLocally));
    save();
    return result;
  }

  async function getBlob(kind, localId) {
    const id = idFor(`${kind}:blob`, localId);
    const remote = await fetchRemote(id);
    if (!remote.ok || remote.deleted) return null;
    const manifest = remote.envelope.data;
    const chunks = [];
    for (let index = 0; index < manifest.parts; index += 1) {
      const partId = `${id}.${index}`;
      const got = await client.getObject(partId);
      if (!got.ok) return null;
      chunks.push(openBytes(objectKey, slot(partId, got.rev), got.bytes));
    }
    const bytes = Buffer.concat(chunks);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) return null;
    return bytes;
  }

  function schedule(delay, wait) {
    clearTimeout(loopTimer);
    loopTimer = setTimeout(async () => {
      if (!running) return;
      if (wait) {
        // Waiting for news holds nothing: a push or "Sync now" meanwhile goes straight through.
        poll = new AbortController();
        await client.changes(state.cursor, { wait, signal: poll.signal }).catch(() => null);
        poll = null;
        if (!running) return;
      }
      const ok = await cycle({ quiet: Boolean(wait) }).catch((error) => {
        setStatus({ state: "error", error: error.message });
        return false;
      });
      backoffMs = ok ? 5000 : Math.min(backoffMs * 2, 60_000);
      schedule(ok ? 0 : backoffMs, ok ? LONG_POLL_SECONDS : 0);
    }, delay);
    loopTimer.unref?.();
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule(0, 0);
    },
    stop() {
      running = false;
      poll?.abort();
      clearTimeout(loopTimer);
      clearTimeout(pushTimer);
      if (cursorTimer) save();
    },
    /** Something changed here: push it soon, without waiting for the long poll to return. */
    pushSoon() {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        void serial(pushOnce).then((pushed) => {
          if (pushed.problem) setStatus({ ...failure(pushed.problem), pending: pushed.pending });
          else if (status.state !== "syncing") setStatus({ state: "idle", lastSyncedAt: now(), pending: 0, error: null });
        }).catch((error) => setStatus({ state: "error", error: error.message }));
      }, PUSH_DEBOUNCE_MS);
      pushTimer.unref?.();
    },
    syncNow: () => cycle(),
    status: () => ({ ...status, unreadable: Object.keys(state.unreadable || {}).length, heldDeletions: (state.held || []).length }),
    /** The person meant it: the held deletions go to every computer. */
    async confirmHeldDeletions() {
      allowMassDeletion = true;
      await serial(pushOnce);
      setStatus({});
    },
    /** It wasn't meant: what was missing here comes back from the last synced copy. */
    async restoreHeldDeletions() {
      const held = state.held || [];
      state.held = [];
      save();
      const changes = held.map((id) => state.records[id]).filter((record) => record && !record.deleted && record.data)
        .map((record) => ({ kind: record.kind, localId: record.localId, data: resolve(record.data, roots()) }));
      if (changes.length) await apply(changes);
      setStatus({});
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    putBlob,
    getBlob,
    idFor,
    /** Applies again every synced record that mentions `text`, e.g. a project token that now has a path here. */
    async reapplyMentioning(text) {
      const changes = Object.values(state.records)
        .filter((record) => !record.deleted && record.kind !== "blob" && record.data && JSON.stringify(record.data).includes(text))
        .map((record) => ({ kind: record.kind, localId: record.localId, data: resolve(record.data, roots()) }));
      if (changes.length) await apply(changes);
      return changes.length;
    },
  };
}

module.exports = { createSyncEngine, hashOf };
