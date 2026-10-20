"use strict";
/**
 * Which computer is driving each task. While a task's agent runs here, this
 * computer holds the task's lease and renews it; when the agent stops, the
 * lease is released. Another computer sees who holds a task, and can ask for
 * it ("Continue here"), which this computer hears on its next check.
 */
const { objectId } = require("./crypto.cjs");

const TTL_SECONDS = Number(process.env.PITWALL_LEASE_TTL) || 180;
// A task just taken over has a little while to get its agent started before it counts as idle.
const CLAIM_GRACE_MS = 2 * 60_000;

function createLeaseKeeper({ client, idKey, runningTasks, knownTasks, onHandoffRequested = () => {}, onLeases = () => {}, log = () => {}, now = () => Date.now() }) {
  const held = new Set();
  const claimed = new Map();
  const leaseId = (taskId) => objectId(idKey, "lease", taskId);
  let announced = "";
  const asked = new Set();

  async function tick() {
    const running = new Set(runningTasks());
    for (const taskId of running) {
      const taken = await client.acquireLease(leaseId(taskId), TTL_SECONDS);
      if (taken.ok) held.add(taskId);
      else if (taken.status === 409) log(`cloud: task is running here and on ${taken.holder?.name || "another computer"}`);
    }
    for (const taskId of [...held]) {
      if (running.has(taskId)) {
        claimed.delete(taskId);
        continue;
      }
      if (now() - (claimed.get(taskId) ?? 0) < CLAIM_GRACE_MS) continue;
      claimed.delete(taskId);
      const released = await client.releaseLease(leaseId(taskId));
      if (released.ok) held.delete(taskId);
    }
    const listed = await client.leases();
    if (!listed.ok) return;
    const byId = new Map(knownTasks().map((taskId) => [leaseId(taskId), taskId]));
    const leases = {};
    for (const lease of listed.data.leases) {
      const taskId = byId.get(lease.task);
      if (!taskId) continue;
      leases[taskId] = { mine: lease.mine, holder: lease.name || lease.platform || "another computer", expiresAt: lease.expires_at, handoffRequested: lease.handoff_requested, handoffToMe: lease.handoff_to_me };
      if (lease.mine && lease.handoff_requested && !asked.has(taskId)) {
        asked.add(taskId);
        onHandoffRequested(taskId);
      }
      if (!lease.handoff_requested) asked.delete(taskId);
    }
    const fingerprint = JSON.stringify(leases);
    if (fingerprint !== announced) {
      announced = fingerprint;
      onLeases(leases);
    }
  }

  return {
    tick,
    leaseId,
    /** Asks the holder for a task. Resolves `{ free }` when nobody holds it, `{ holder }` otherwise. */
    async requestHandoff(taskId) {
      const asked = await client.requestHandoff(leaseId(taskId));
      return asked.ok ? asked.data : { error: asked.message };
    },
    async take(taskId) {
      const taken = await client.acquireLease(leaseId(taskId), TTL_SECONDS);
      if (taken.ok) {
        held.add(taskId);
        claimed.set(taskId, now());
      }
      return taken;
    },
    async release(taskId) {
      held.delete(taskId);
      claimed.delete(taskId);
      return client.releaseLease(leaseId(taskId));
    },
    held: () => new Set(held),
  };
}

module.exports = { createLeaseKeeper };
