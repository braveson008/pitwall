"use strict";
/**
 * Continuing a task on another computer.
 *
 * Unfinished work is saved when a task's agent stops, when Pitwall quits,
 * every few minutes while this computer holds the task, and when another
 * computer asks for it. It is restored just before the task's agent starts
 * here, or straight away on "Continue here" when the worktree already exists.
 * The latest save per task is a synced `wip` record, whichever computer made it.
 */
const fs = require("node:fs");
const path = require("node:path");
const { bundleWip, restoreWip, snapshotWip } = require("./gitHandoff.cjs");

const isTokenPath = (value) => typeof value === "string" && value.startsWith("@{");
const SAVE_EVERY_MS = 5 * 60_000;
const HANDOFF_WAIT_MS = 200_000;

function age(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "moments";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function createContinuity({ userDataPath, getSnapshot, getEngine, getKeeper, deviceId, deviceName, runningSessionIds, stopSession, notify, log = () => {}, beforeRelease = async () => {} }) {
  const file = path.join(userDataPath, "cloud", "wip.json");
  let saved = { records: {}, restored: {} };
  try {
    saved = { records: {}, restored: {}, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    // Nothing carried yet.
  }
  let leases = {};

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved));
  }

  const sessions = () => getSnapshot()?.braveli?.sessions || [];
  const taskTitle = (taskId) => getSnapshot()?.braveli?.tasks?.find((task) => task.id === taskId)?.title || "This task";

  function taskForSession(sessionId, fallback) {
    return fallback || sessions().find((session) => session.id === sessionId)?.taskId || null;
  }

  function worktreeForTask(taskId) {
    for (const session of sessions()) {
      if (session.taskId !== taskId || !session.worktreePath || isTokenPath(session.worktreePath)) continue;
      if (fs.existsSync(session.worktreePath)) return session.worktreePath;
    }
    return null;
  }

  function runningTasks() {
    const running = new Set(runningSessionIds());
    return [...new Set(sessions().filter((session) => running.has(session.id) && session.taskId).map((session) => session.taskId))];
  }

  async function saveWork(taskId, { handingOver = false } = {}) {
    const worktree = worktreeForTask(taskId);
    if (!worktree) return null;
    const snap = await snapshotWip({ worktree });
    if (!snap.ok) {
      log(`cloud: couldn't save unfinished work: ${snap.message}`);
      return null;
    }
    const previous = saved.records[taskId];
    // Nothing changed since this computer last saved it: nothing to send.
    if (!handingOver && previous?.device === deviceId() && previous.tree === snap.tree) return previous;
    const at = new Date().toISOString();
    let record = { taskId, clean: !snap.dirty, parent: snap.parent, tree: snap.tree, at, device: deviceId(), deviceName: deviceName() };
    if (snap.dirty) {
      const bundle = await bundleWip({ worktree, sha: snap.sha });
      if (!bundle.ok) {
        log(bundle.tooLarge ? "cloud: unfinished work is too large to carry" : `cloud: couldn't bundle unfinished work: ${bundle.message}`);
        if (bundle.tooLarge) notify({ tone: "warn", title: "Unfinished work is too large to carry", message: `${taskTitle(taskId)}: commit and push it to bring it to another computer.` });
        return null;
      }
      const stored = await getEngine()?.putBlob("wip", taskId, bundle.bytes);
      if (!stored?.ok) return null;
      record = { ...record, via: "bundle", sha: snap.sha };
    }
    saved.records[taskId] = record;
    persist();
    await getEngine()?.syncNow().catch(() => false);
    return record;
  }

  /** Brings over another computer's unfinished work for this task, once per save. */
  async function restore(taskId, worktree) {
    const record = saved.records[taskId];
    if (!record || record.clean || record.device === deviceId() || saved.restored[taskId] === record.sha) return null;
    const bytes = await getEngine()?.getBlob("wip", taskId);
    if (!bytes) return null;
    const restored = await restoreWip({ worktree, bundle: bytes });
    if (restored.applied) {
      saved.restored[taskId] = record.sha;
      persist();
      notify({ tone: "info", title: `Brought over unfinished changes from ${record.deviceName || "another computer"}`, message: `${taskTitle(taskId)}: saved ${age(Date.now() - Date.parse(record.at))} ago.` });
    } else if (restored.busy) {
      notify({ tone: "warn", title: `Unfinished changes from ${record.deviceName || "another computer"} are waiting`, message: `${taskTitle(taskId)} has uncommitted changes here, so nothing was applied over them. Commit or stash them, then continue again.` });
    } else if (restored.conflicts?.length) {
      notify({ tone: "warn", title: "Unfinished changes from another computer conflict here", message: `${restored.conflicts.join(", ")} changed on both. Nothing was overwritten; commit or stash here, then continue again.` });
    }
    return restored;
  }

  return {
    records() {
      return Object.values(saved.records).map((record) => ({ kind: "wip", localId: record.taskId, data: record }));
    },
    applyRemote(changes) {
      for (const change of changes) {
        if (change.data) saved.records[change.localId] = change.data;
        else delete saved.records[change.localId];
      }
      persist();
    },
    runningTasks,
    knownTasks: () => (getSnapshot()?.braveli?.tasks || []).map((task) => task.id),
    setLeases(next) {
      leases = next;
    },

    /** Before a task's agent starts here: not while another computer drives it, and with its unfinished work. */
    async beforeAgentStart({ sessionId, taskId: given, cwd }) {
      const taskId = taskForSession(sessionId, given);
      if (!taskId) return { ok: true };
      const lease = leases[taskId];
      if (lease && !lease.mine && Date.parse(lease.expiresAt) > Date.now()) {
        return { ok: false, error: `This task is running on ${lease.holder}. Use Continue here to bring it to this computer.` };
      }
      // Taken now, not trusted from the last check: two computers starting together can't both win.
      const taken = await getKeeper()?.take(taskId);
      if (taken && !taken.ok && taken.status === 409) {
        return { ok: false, error: `This task is running on ${taken.holder?.name || "another computer"}. Use Continue here to bring it to this computer.` };
      }
      if (cwd && fs.existsSync(cwd)) await restore(taskId, cwd).catch((error) => log(`cloud: restore failed: ${error.message}`));
      return { ok: true };
    },

    async afterAgentExit({ sessionId, taskId: given }) {
      const taskId = taskForSession(sessionId, given);
      if (!taskId) return;
      await saveWork(taskId).catch((error) => log(`cloud: save failed: ${error.message}`));
      await getKeeper()?.tick().catch(() => {});
    },

    /** Another computer asked for a task this one drives: stop, save, let go. */
    async handOver(taskId) {
      // Held until the work is saved, so the lease can't lapse halfway through.
      await getKeeper()?.take(taskId);
      const running = new Set(runningSessionIds());
      for (const session of sessions()) {
        if (session.taskId === taskId && running.has(session.id)) await stopSession(session.id).catch(() => {});
      }
      // Always a fresh save, so the asking computer knows this one answered.
      await saveWork(taskId, { handingOver: true }).catch(() => null);
      await beforeRelease(taskId).catch(() => null);
      await getEngine()?.syncNow().catch(() => false);
      await getKeeper()?.release(taskId);
      notify({ tone: "info", title: "Handed over to another computer", message: `${taskTitle(taskId)} continues there.` });
    },

    /** "Continue here": ask the holder, wait for it to let go (or for its lease to lapse), then take over. */
    async continueHere(taskId) {
      const keeper = getKeeper();
      if (!keeper) return { ok: false, message: "Sync isn't on." };
      // What was saved before asking: an answer is a save that differs from it, whatever the clocks say.
      const before = JSON.stringify(saved.records[taskId] || null);
      const asked = await keeper.requestHandoff(taskId);
      if (asked.error) return { ok: false, message: asked.error };
      const waited = !asked.free && !asked.mine;
      if (waited) {
        const deadline = Date.now() + HANDOFF_WAIT_MS;
        for (;;) {
          const taken = await keeper.take(taskId);
          if (taken.ok) break;
          if (Date.now() > deadline) return { ok: false, message: `${asked.holder?.name || "The other computer"} still has this task. Try again in a minute.` };
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } else {
        await keeper.take(taskId);
      }
      await getEngine()?.syncNow().catch(() => false);
      const record = saved.records[taskId];
      const fromElsewhere = Boolean(record && record.device !== deviceId());
      const answered = waited && fromElsewhere && JSON.stringify(record) !== before;
      const worktree = worktreeForTask(taskId);
      if (worktree) await restore(taskId, worktree).catch(() => null);
      const savedAgo = record?.at ? `Continuing from changes saved ${age(Date.now() - Date.parse(record.at))} ago.` : "Continuing from what was last synced.";
      if (waited && !answered) {
        notify({ tone: "warn", title: `${asked.holder?.name || "The other computer"} didn't answer`, message: savedAgo });
      } else if (!waited && fromElsewhere) {
        notify({ tone: "info", title: `Picking up from ${record.deviceName || "another computer"}`, message: savedAgo });
      }
      return { ok: true, answered, savedAt: record?.at ?? null };
    },

    async beforeQuit() {
      const keeper = getKeeper();
      const tasks = keeper ? [...keeper.held()] : [];
      await Promise.race([
        Promise.all(tasks.map((taskId) => saveWork(taskId).catch(() => null))).then(() => getEngine()?.syncNow().catch(() => false)),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    },

    async saveHeldTasks() {
      const keeper = getKeeper();
      for (const taskId of keeper ? keeper.held() : []) await saveWork(taskId).catch(() => null);
    },
    SAVE_EVERY_MS,
    saveWork,
    restore,
  };
}

module.exports = { createContinuity };
