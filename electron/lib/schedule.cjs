"use strict";

/**
 * Jobs Pitwall runs by itself, and the arithmetic that decides when.
 *
 * Pure: no launchd, no clock of its own. Every function that needs the time is
 * given it, so a rule like "at most one run per day" can be tested across a
 * missed fire and a double fire without waiting a day to find out.
 */

const fs = require("node:fs");
const path = require("node:path");

const KEEP_HISTORY = 50;

/**
 * The local calendar date, which is what "once a day" means to a person.
 *
 * UTC would roll over mid-afternoon for anyone far enough east, and a job
 * would run twice on one of their days and not at all on another.
 */
function localDateKey(at) {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * How long after its time a job may still start.
 *
 * Not zero: launchd waking a notarised app, and its window reaching the point
 * where it can run anything, is not instant. Not open-ended either — a chore
 * starting at 21:00 because a laptop happened to wake then is a surprise, and
 * a surprise is worse than a miss that is visible on the row.
 */
const RUN_WINDOW_MINUTES = 5;

/**
 * Every minute-of-day this booking comes round today.
 *
 * One entry for a booking that runs once, several for one that repeats through
 * the day. Writing both as a list of occurrences means the due and missed
 * rules are the same rule, rather than a daily path and an hourly path that
 * drift apart.
 */
function occurrencesToday(job) {
  const start = Number(job.hour) * 60 + Number(job.minute);
  const every = Number(job.everyHours) || 0;
  if (every <= 0) return [start];
  /**
   * Where a repeat stops.
   *
   * A booking that repeats ran from its hour to midnight, because that is
   * where the day ends — not because anybody wanted a run at 23:00. Work that
   * picks up tickets belongs to the hours people are filing them, so a repeat
   * can be given a last hour and stops there.
   *
   * An end before the start means the person meant the same day and typed the
   * wrong order; it is ignored rather than producing a booking that never runs.
   */
  const until = Number.isFinite(Number(job.untilMinutes)) && Number(job.untilMinutes) > start
    ? Math.min(Number(job.untilMinutes), 1439)
    : 1439;
  const out = [];
  for (let minute = start; minute <= until; minute += every * 60) out.push(minute);
  return out;
}

/** The occurrence this booking is in, or last was: the one to judge it by. */
function currentOccurrence(job, at) {
  const now = new Date(at);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  let latest = null;
  for (const occurrence of occurrencesToday(job)) {
    if (occurrence <= minutesNow) latest = occurrence;
  }
  return latest;
}

/** Midnight local, so an occurrence can be compared against a real instant. */
function startOfDay(at) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * Whether this booking has already run for the occurrence it is in.
 *
 * Recorded as an instant rather than a date. A date said "it ran today", which
 * is the right question for a booking that runs once and the wrong one for a
 * booking that comes round every hour.
 */
function ranThisOccurrence(job, at, occurrence) {
  /**
   * An occurrence from before the booking existed is not one it missed.
   *
   * A booking made at 23:51 that repeats from 08:00 has fifteen occurrences
   * behind it the moment it is saved, and every one of them was reported as
   * missed — a row that said "missed" about a booking created a second ago,
   * before it had ever had the chance to run.
   */
  const born = Number(job.createdAt) || 0;
  if (born && startOfDay(at) + occurrence * 60_000 < born) return true;
  const lastRun = Number(job.lastRunAt) || 0;
  if (lastRun) return lastRun >= startOfDay(at) + occurrence * 60_000;
  // Older records only carry the date. For a once-a-day booking that answers
  // the same question; for a repeating one it is the best that record can say.
  return job.lastRunDate === localDateKey(at);
}

/**
 * No days means every day.
 *
 * A booking made before days existed carries no list, and has to keep running
 * daily rather than silently stopping — a schedule that quietly does nothing
 * is the failure this whole feature exists to prevent.
 */
function runsToday(job, at) {
  const days = Array.isArray(job.days) ? job.days : [];
  return days.length === 0 || days.includes(new Date(at).getDay());
}

function eligible(job, at) {
  if (!job || job.enabled === false) return false;
  return runsToday(job, at);
}

/**
 * The jobs that should run now.
 *
 * Two conditions, and both matter. "Already ran today" stops a second run when
 * launchd fires twice or the app restarts. The window is what makes the
 * schedule mean the time it says.
 */
/**
 * Whether an occurrence can still be run, or has been missed.
 *
 * A booking that names one time a day names that time: running it at 22:00
 * because the machine was asleep at 09:00 is a surprise, and a visible miss is
 * the better answer. Five minutes of slack covers a wake-up that is not instant.
 *
 * A repeat is a different promise. "Every hour from 08:00 to 20:00" asks for
 * the work to keep happening through those hours, so an occurrence whose top of
 * the hour was missed by ten minutes should still run — the machine having been
 * asleep at 15:00 is not a reason to skip 15:00 entirely and wait for 16:00. It
 * catches up until the next occurrence is due, and stops at the end of the
 * hours the booking actually named, so nothing runs at midnight on the strength
 * of a booking that ended at eight.
 *
 * Without this, a laptop that sleeps marked almost every occurrence missed and
 * the row never changed — which reads exactly like a scheduler that has stopped.
 */
function catchUpMinutes(job) {
  const every = Number(job.everyHours) || 0;
  if (every <= 0) return RUN_WINDOW_MINUTES;
  return every * 60;
}

/** The last minute of the day this booking still means anything. */
function lastActiveMinute(job) {
  const every = Number(job.everyHours) || 0;
  if (every <= 0) return null;
  const until = Number(job.untilMinutes);
  return Number.isFinite(until) && until > 0 ? Math.min(until, 1439) : 1439;
}

function runnable(job, minutesNow, occurrence) {
  if (minutesNow - occurrence > catchUpMinutes(job)) return false;
  const last = lastActiveMinute(job);
  if (last !== null && minutesNow > last + RUN_WINDOW_MINUTES) return false;
  return true;
}

function dueJobs(jobs, at) {
  const now = new Date(at);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return (jobs || []).filter((job) => {
    if (!eligible(job, at)) return false;
    const occurrence = currentOccurrence(job, at);
    if (occurrence === null) return false;
    if (!runnable(job, minutesNow, occurrence)) return false;
    return !ranThisOccurrence(job, at, occurrence);
  });
}

/**
 * Jobs whose time came and went today with nothing run.
 *
 * Recorded rather than run, so a job that never fires because the machine is
 * always asleep at its hour is visible on its row instead of being silence.
 */
function missedJobs(jobs, at) {
  const now = new Date(at);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return (jobs || []).filter((job) => {
    if (!eligible(job, at)) return false;
    const occurrence = currentOccurrence(job, at);
    if (occurrence === null) return false;
    // Only once it can no longer be run. While it still can, it is late rather
    // than missed, and saying otherwise stamps the row with a verdict that
    // stops it being tried.
    if (runnable(job, minutesNow, occurrence)) return false;
    return !ranThisOccurrence(job, at, occurrence);
  });
}

/**
 * Every clock time launchd must wake Pitwall for.
 *
 * Derived from the same occurrence list the due rule uses, because the two
 * drifting apart is exactly how a booking stops happening: for its first week
 * the hourly repeat installed one wake-up, at the hour it was booked, and the
 * ten occurrences after it were arithmetic nobody ever asked for.
 *
 * A booking with named days carries its weekday, so a Monday chore stops
 * waking a laptop the other six mornings to decide it has nothing to do.
 */
function wakeTimes(jobs) {
  const seen = new Set();
  const times = [];
  for (const job of jobs || []) {
    if (!job || job.enabled === false) continue;
    const days = Array.isArray(job.days) && job.days.length ? job.days : [null];
    for (const minuteOfDay of occurrencesToday(job)) {
      const hour = Math.floor(minuteOfDay / 60);
      const minute = minuteOfDay % 60;
      for (const weekday of days) {
        const key = `${weekday === null ? "*" : weekday}:${hour}:${minute}`;
        if (seen.has(key)) continue;
        seen.add(key);
        times.push(weekday === null ? { hour, minute } : { hour, minute, weekday });
      }
    }
  }
  // Sorted so the same schedule always renders the same plist: syncLaunchAgent
  // compares file contents to decide whether to bootout a live agent, and an
  // unstable order would tear it down on every launch.
  return times.sort((a, b) =>
    (a.weekday ?? -1) - (b.weekday ?? -1) || a.hour - b.hour || a.minute - b.minute);
}

function readJobs(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

/**
 * The schedule on disk.
 *
 * In `userData` rather than the renderer's local storage, because the main
 * process is what the clock reaches and it cannot read the page. Written
 * atomically through a temporary file, matching `memoryStore`.
 */
function createScheduleStore(filePath, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  let jobs = readJobs(filePath);

  function write() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ jobs }, null, 2)}\n`, "utf8");
      fs.renameSync(temporary, filePath);
    } catch {
      // A schedule that cannot be persisted still works for this session. The
      // LaunchAgent is what makes it survive a restart, and that is separate.
    }
  }

  function save(job) {
    const id = String(job?.id || `job-${now()}-${jobs.length}`);
    const next = {
      id,
      hour: Number(job.hour),
      minute: Number(job.minute),
      prompt: String(job.prompt || "").trim(),
      projectId: String(job.projectId || ""),
      // Pinned when the slot is booked. Work that runs while nobody is there
      // must not inherit whichever agent the session dialog happened to be
      // showing — that changed when you touched something unrelated, and
      // reverted to the default every time the app restarted.
      agent: String(job.agent || ""),
      /** Weekdays it runs on, 0 = Sunday. Empty means every day. */
      /** Hours between runs through the day. 0 means it runs once. */
      everyHours: Number(job.everyHours) || 0,
      /** Minutes past midnight a repeat stops at. 0 means the end of the day. */
      untilMinutes: Number(job.untilMinutes) || 0,
      /** When the booking was made, so occurrences before it are not misses. */
      createdAt: Number(job.createdAt) || now(),
      lastRunAt: Number(job.lastRunAt) || 0,
      days: Array.isArray(job.days)
        ? [...new Set(job.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : [],
      enabled: job.enabled !== false,
      lastRunDate: String(job.lastRunDate || ""),
      history: Array.isArray(job.history) ? job.history.slice(0, KEEP_HISTORY) : [],
    };
    const index = jobs.findIndex((item) => item.id === id);
    if (index >= 0) jobs[index] = next;
    else jobs.push(next);
    write();
    return next;
  }

  function remove(id) {
    jobs = jobs.filter((job) => job.id !== id);
    write();
  }

  /**
   * Newest first.
   *
   * Every outcome stamps the instant, a skip included: it settles the
   * occurrence it is in, so the minute tick cannot file a booking that was
   * deliberately skipped at 14:00 as a miss at 14:06. Only a real run stamps
   * the day, because `lastRunDate` is what an older record means by "it ran
   * today", and a skip did not run.
   */
  function recordRun(id, entry) {
    const job = jobs.find((item) => item.id === id);
    if (!job) return null;
    const record = { at: new Date(now()).toISOString(), ...entry };
    job.history = [record, ...(job.history || [])].slice(0, KEEP_HISTORY);
    job.lastRunAt = now();
    if (record.outcome !== "skipped") {
      job.lastRunDate = localDateKey(now());
    }
    write();
    return record;
  }

  /** Every job at once, as another computer's copy of the schedule says. */
  function replaceAll(next) {
    jobs = Array.isArray(next) ? next.map((job) => ({ ...job })) : [];
    write();
  }

  return { list: () => jobs.map((job) => ({ ...job })), save, remove, recordRun, replaceAll };
}

module.exports = { RUN_WINDOW_MINUTES, catchUpMinutes, runnable, localDateKey, runsToday, occurrencesToday, currentOccurrence, wakeTimes, dueJobs, missedJobs, createScheduleStore };
