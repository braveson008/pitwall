"use strict";
/**
 * Merging two copies of one synced record.
 *
 * Every top-level field carries the time it last changed, so two computers
 * that edit different fields of the same task both keep their edit, and the
 * same field goes to whoever changed it last. Lists of items that are
 * independently added on each side (memory facts, findings) merge as a union
 * by id instead. A delete is a time too: it wins over everything older.
 */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function stampClock(previous, nextData, now) {
  const clock = { ...(previous?.clock || {}) };
  const before = previous?.data || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(nextData || {})])) {
    if (!previous || !same(before[key], nextData?.[key])) clock[key] = now;
  }
  return clock;
}

const tombstone = (at) => ({ deleted: true, deletedAt: at, data: null, clock: {} });
const newest = (clock) => Object.values(clock || {}).reduce((max, time) => (time > max ? time : max), "");
const itemTime = (item) => item?.updatedAt || item?.at || "";
const itemKey = (item) => item?.id ?? item?.key ?? JSON.stringify(item);

function unionById(local = [], remote = []) {
  const merged = new Map();
  for (const item of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const key = itemKey(item);
    const existing = merged.get(key);
    if (!existing || itemTime(item) > itemTime(existing)) merged.set(key, item);
  }
  return [...merged.values()];
}

function mergeRecords(local, remote, { setFields = [] } = {}) {
  if (!local) return remote;
  if (!remote) return local;
  if (local.deleted || remote.deleted) {
    const dead = local.deleted ? local : remote;
    const alive = local.deleted ? remote : local;
    if (alive.deleted) return dead.deletedAt >= alive.deletedAt ? dead : alive;
    return dead.deletedAt >= newest(alive.clock) ? dead : { data: alive.data, clock: alive.clock };
  }
  const data = {};
  const clock = {};
  const keys = new Set([...Object.keys(local.clock || {}), ...Object.keys(remote.clock || {}), ...Object.keys(local.data || {}), ...Object.keys(remote.data || {})]);
  for (const key of keys) {
    const localTime = local.clock?.[key] || "";
    const remoteTime = remote.clock?.[key] || "";
    const winner = localTime > remoteTime ? local : remote;
    clock[key] = localTime > remoteTime ? localTime : remoteTime;
    if (setFields.includes(key)) {
      data[key] = unionById(local.data?.[key], remote.data?.[key]);
    } else if (winner.data && Object.prototype.hasOwnProperty.call(winner.data, key)) {
      data[key] = winner.data[key];
    }
  }
  return { data, clock };
}

// Which fields of each kind are lists that both sides add to independently.
const SET_FIELDS = {
  knowledge: ["records", "receipts"],
  task: ["comments"],
  voiceMemory: ["notes", "snapshots"],
  watch: ["seen"],
  activity: ["events"],
};

module.exports = { SET_FIELDS, mergeRecords, stampClock, tombstone };
