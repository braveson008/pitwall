/**
 * Which watches to check, and checking each at most once at a time.
 *
 * One lock used to cover every watch, so a tracker read that took four
 * minutes held back the host watches, the timer and Check now alike — and
 * Check now returned without a word, which looked like a dead button. Each
 * watch now has its own run: a slow one delays nothing else, and a forced
 * check joins a run already under way instead of skipping it.
 */
function createWatchRunner({ list, detect, intervalMs }) {
  const running = new Map();

  function run(watch) {
    if (running.has(watch.id)) return running.get(watch.id);
    const done = Promise.resolve()
      .then(() => detect(watch))
      .catch(() => {})
      .finally(() => running.delete(watch.id));
    running.set(watch.id, done);
    return done;
  }

  async function check({ projectId, force = false } = {}) {
    const due = list().filter((watch) => {
      if (!watch.enabled || (projectId && watch.projectId !== projectId)) return false;
      if (force || running.has(watch.id)) return true;
      return Date.now() - (watch.lastCheckedAt || 0) >= intervalMs(watch) - 5000;
    });
    // A watch already being checked is waited for only when asked to: the timer
    // must not sit behind a slow read, but Check now should end when it has.
    await Promise.all(due.filter((watch) => force || !running.has(watch.id)).map(run));
  }

  return { check, isRunning: (watchId) => running.has(watchId) };
}

module.exports = { createWatchRunner };
