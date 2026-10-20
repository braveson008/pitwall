import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleStore, dueJobs, localDateKey, missedJobs, occurrencesToday, wakeTimes } from "./schedule.cjs";

const at = (iso: string) => new Date(iso).getTime();
const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1", hour: 13, minute: 0, prompt: "do the thing", projectId: "p1",
  enabled: true, lastRunDate: "", history: [], ...over,
});

describe("dueJobs", () => {
  it("is due at its time, and for a few minutes after", () => {
    // The grace covers a cold start: launchd waking a notarised app and its
    // window reaching the point where it can run anything is not instant.
    expect(dueJobs([job()], at("2026-09-15T13:00:00")).map((j) => j.id)).toEqual(["job-1"]);
    expect(dueJobs([job()], at("2026-09-15T13:04:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("is not due before its time", () => {
    expect(dueJobs([job()], at("2026-09-15T12:59:00"))).toEqual([]);
  });

  it("is not due once the window has passed", () => {
    // Strict: a job runs at the hour it says, or it does not run. A chore
    // starting at 21:00 because a laptop woke up then is a surprise, and a
    // surprise is worse than a miss you can see on the row.
    expect(dueJobs([job()], at("2026-09-15T13:06:00"))).toEqual([]);
    expect(dueJobs([job()], at("2026-09-15T21:00:00"))).toEqual([]);
  });

  it("is not due twice on the same day", () => {
    expect(dueJobs([job({ lastRunDate: "2026-09-15" })], at("2026-09-15T13:02:00"))).toEqual([]);
  });

  it("is due again the next day", () => {
    expect(dueJobs([job({ lastRunDate: "2026-09-15" })], at("2026-09-16T13:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("ignores disabled jobs", () => {
    expect(dueJobs([job({ enabled: false })], at("2026-09-15T13:00:00"))).toEqual([]);
  });
});

describe("missedJobs", () => {
  it("names a job whose window has passed today without a run", () => {
    expect(missedJobs([job()], at("2026-09-15T21:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("says nothing while the job is still due, or still to come", () => {
    expect(missedJobs([job()], at("2026-09-15T13:02:00"))).toEqual([]);
    expect(missedJobs([job()], at("2026-09-15T11:00:00"))).toEqual([]);
  });

  it("says nothing about a job that already ran today", () => {
    expect(missedJobs([job({ lastRunDate: "2026-09-15" })], at("2026-09-15T21:00:00"))).toEqual([]);
  });

  it("ignores disabled jobs", () => {
    expect(missedJobs([job({ enabled: false })], at("2026-09-15T21:00:00"))).toEqual([]);
  });
});

describe("localDateKey", () => {
  it("is the local calendar date, not UTC", () => {
    expect(localDateKey(at("2026-09-15T13:00:00"))).toBe("2026-09-15");
  });
});

const storeIn = () => createScheduleStore(
  join(mkdtempSync(join(tmpdir(), "sched-")), "schedule.json"),
  { now: () => new Date("2026-09-15T13:00:00").getTime() },
);

describe("createScheduleStore", () => {
  it("starts empty and survives a missing file", () => {
    expect(storeIn().list()).toEqual([]);
  });

  it("pins the agent a booking was made with", () => {
    // Otherwise a run inherits whatever the session dialog was showing, which
    // changes when you touch something unrelated and resets on restart.
    const store = storeIn();
    const saved = store.save({ hour: 13, minute: 0, prompt: "do it", projectId: "p1", agent: "Codex" });
    expect(saved.agent).toBe("Codex");
    expect(store.list()[0].agent).toBe("Codex");
  });

  it("saves a job and reads it back", () => {
    const store = storeIn();
    const saved = store.save({ hour: 13, minute: 0, prompt: "do it", projectId: "p1" });
    expect(saved.id).toBeTruthy();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].prompt).toBe("do it");
    expect(store.list()[0].enabled).toBe(true);
  });

  it("updates in place when the id already exists", () => {
    const store = storeIn();
    const saved = store.save({ hour: 13, minute: 0, prompt: "do it", projectId: "p1" });
    store.save({ ...saved, prompt: "do it differently" });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].prompt).toBe("do it differently");
  });

  it("removes a job", () => {
    const store = storeIn();
    const saved = store.save({ hour: 9, minute: 0, prompt: "x", projectId: "p1" });
    store.remove(saved.id);
    expect(store.list()).toEqual([]);
  });

  it("records a run, stamps lastRunDate, and caps the history", () => {
    const store = storeIn();
    const saved = store.save({ hour: 9, minute: 0, prompt: "x", projectId: "p1" });
    for (let i = 0; i < 60; i += 1) store.recordRun(saved.id, { outcome: "ok", branch: `b-${i}` });
    const job = store.list()[0];
    expect(job.history).toHaveLength(50);
    expect(job.history[0].branch).toBe("b-59");
    expect(job.lastRunDate).toBe("2026-09-15");
  });

  it("does not stamp lastRunDate for a skipped fire", () => {
    // A skip is a fact about today, not a run. Stamping it would make the skip
    // itself suppress tomorrow's run.
    const store = storeIn();
    const saved = store.save({ hour: 9, minute: 0, prompt: "x", projectId: "p1" });
    store.recordRun(saved.id, { outcome: "skipped", reason: "already running" });
    expect(store.list()[0].lastRunDate).toBe("");
  });

  it("survives a reopened file", () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "sched-")), "schedule.json");
    createScheduleStore(filePath).save({ hour: 7, minute: 30, prompt: "early", projectId: "p1" });
    expect(createScheduleStore(filePath).list()[0].prompt).toBe("early");
  });
});

describe("days of the week", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const weekdayJob = (over: Record<string, unknown> = {}) => ({
    id: "job-1", hour: 13, minute: 0, prompt: "do the thing", projectId: "p1",
    enabled: true, lastRunDate: "", history: [], days: [1, 2, 3, 4, 5], ...over,
  });

  it("is due on a day it runs", () => {
    expect(dueJobs([weekdayJob()], at("2026-09-14T13:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("is not due, and not missed, on a day it does not run", () => {
    // Saturday. A booking that was never going to run today has not missed
    // anything, and saying it did would be the screen crying wolf.
    expect(dueJobs([weekdayJob()], at("2026-09-19T13:00:00"))).toEqual([]);
    expect(missedJobs([weekdayJob()], at("2026-09-19T21:00:00"))).toEqual([]);
  });

  it("still misses a day it was supposed to run", () => {
    expect(missedJobs([weekdayJob()], at("2026-09-14T21:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("runs every day when no days are set", () => {
    const daily = weekdayJob({ days: [] });
    expect(dueJobs([daily], at("2026-09-19T13:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });
});

describe("repeating through the day", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const hourly = (over: Record<string, unknown> = {}) => ({
    id: "job-1", hour: 9, minute: 0, prompt: "do the thing", projectId: "p1",
    enabled: true, lastRunDate: "", lastRunAt: 0, history: [], days: [], everyHours: 1, ...over,
  });

  it("comes round every hour from its start time", () => {
    expect(occurrencesToday(hourly()).slice(0, 3)).toEqual([540, 600, 660]);
    expect(occurrencesToday(hourly({ everyHours: 4 }))).toEqual([540, 780, 1020, 1260]);
  });

  it("is one occurrence a day when it does not repeat", () => {
    expect(occurrencesToday(hourly({ everyHours: 0 }))).toEqual([540]);
  });

  it("is due at each occurrence, not once a day", () => {
    // The daily rule — at most one run per calendar date — is exactly what an
    // hourly booking must not obey.
    const ranAtNine = hourly({ lastRunAt: at("2026-09-16T09:00:30") });
    expect(dueJobs([ranAtNine], at("2026-09-16T09:02:00"))).toEqual([]);
    expect(dueJobs([ranAtNine], at("2026-09-16T10:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("does not run twice for the same occurrence", () => {
    const ranAtTen = hourly({ lastRunAt: at("2026-09-16T10:00:30") });
    expect(dueJobs([ranAtTen], at("2026-09-16T10:04:00"))).toEqual([]);
  });

  it("still honours the days it runs on", () => {
    const weekdayHourly = hourly({ days: [1, 2, 3, 4, 5] });
    expect(dueJobs([weekdayHourly], at("2026-09-19T10:00:00"))).toEqual([]);
  });

  it("is late rather than missed while its own hour is still running", () => {
    // Half past ten on an hourly booking is thirty minutes late, not a write-off.
    // Calling it missed stamps the row with a verdict, and a row that says
    // "missed" is one nobody looks at again — which is how an hourly booking on
    // a laptop that sleeps stopped happening at all.
    expect(missedJobs([hourly()], at("2026-09-16T10:30:00"))).toEqual([]);
    expect(dueJobs([hourly()], at("2026-09-16T10:30:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("misses one occurrence, not the whole day", () => {
    // An occurrence already run is neither due nor missed, and the ones after
    // it are unaffected.
    expect(missedJobs([hourly({ lastRunAt: at("2026-09-16T10:00:30") })], at("2026-09-16T10:30:00"))).toEqual([]);
    expect(dueJobs([hourly({ lastRunAt: at("2026-09-16T10:00:30") })], at("2026-09-16T10:30:00"))).toEqual([]);
    expect(dueJobs([hourly({ lastRunAt: at("2026-09-16T10:00:30") })], at("2026-09-16T11:00:10")).map((j) => j.id))
      .toEqual(["job-1"]);
  });

  it("leaves a daily booking behaving exactly as before", () => {
    const daily = hourly({ everyHours: 0, lastRunAt: at("2026-09-16T09:00:30") });
    expect(dueJobs([daily], at("2026-09-16T10:00:00"))).toEqual([]);
    expect(dueJobs([hourly({ everyHours: 0 })], at("2026-09-16T09:02:00")).map((j) => j.id)).toEqual(["job-1"]);
  });
});

describe("wakeTimes", () => {
  it("wakes for every occurrence a repeat has, not just the hour it starts", () => {
    // The bug this exists to prevent: an hourly booking installed one wake-up
    // at 13:00, and the ten occurrences after it were arithmetic nobody asked.
    const times = wakeTimes([job({ everyHours: 1 })]);
    expect(times).toHaveLength(occurrencesToday(job({ everyHours: 1 })).length);
    expect(times[0]).toEqual({ hour: 13, minute: 0 });
    expect(times.at(-1)).toEqual({ hour: 23, minute: 0 });
  });

  it("wakes once for a booking that runs once", () => {
    expect(wakeTimes([job()])).toEqual([{ hour: 13, minute: 0 }]);
  });

  it("folds two bookings that share a time into one wake-up", () => {
    expect(wakeTimes([job(), job({ id: "job-2" })])).toEqual([{ hour: 13, minute: 0 }]);
  });

  it("carries the weekday, so a Monday chore does not wake a laptop on Sunday", () => {
    expect(wakeTimes([job({ days: [1, 3] })])).toEqual([
      { hour: 13, minute: 0, weekday: 1 },
      { hour: 13, minute: 0, weekday: 3 },
    ]);
  });

  it("ignores disabled bookings", () => {
    expect(wakeTimes([job({ enabled: false })])).toEqual([]);
  });

  it("is stable, so the same schedule never rewrites the plist", () => {
    const a = wakeTimes([job({ days: [3] }), job({ id: "b", hour: 9, days: [1] })]);
    const b = wakeTimes([job({ id: "b", hour: 9, days: [1] }), job({ days: [3] })]);
    expect(a).toEqual(b);
  });

  it("carries a repeat's hours across every named day", () => {
    const times = wakeTimes([job({ hour: 22, everyHours: 1, days: [0, 6] })]);
    expect(times).toEqual([
      { hour: 22, minute: 0, weekday: 0 },
      { hour: 23, minute: 0, weekday: 0 },
      { hour: 22, minute: 0, weekday: 6 },
      { hour: 23, minute: 0, weekday: 6 },
    ]);
  });
});

describe("a skipped run", () => {
  const store = () => createScheduleStore(join(mkdtempSync(join(tmpdir(), "sched-")), "schedule.json"),
    { now: () => at("2026-09-15T14:00:00") });

  it("settles the occurrence it is in, so the minute tick cannot call it missed", () => {
    // The tick asks every minute. Without this, a booking deliberately skipped
    // at 14:00 because its previous run was still going would be filed as a
    // miss at 14:06 — and "missed" says Pitwall was not running, which is a
    // lie about the one case it was.
    const s = store();
    const saved = s.save({ hour: 14, minute: 0, prompt: "p", projectId: "x" });
    s.recordRun(saved.id, { outcome: "skipped", reason: "still running" });
    expect(missedJobs(s.list(), at("2026-09-15T14:30:00"))).toEqual([]);
  });

  it("still leaves tomorrow alone", () => {
    const s = store();
    const saved = s.save({ hour: 14, minute: 0, prompt: "p", projectId: "x" });
    s.recordRun(saved.id, { outcome: "skipped", reason: "still running" });
    expect(dueJobs(s.list(), at("2026-09-16T14:00:00")).map((j) => j.id)).toEqual([saved.id]);
  });

  it("does not claim the day ran", () => {
    const s = store();
    const saved = s.save({ hour: 14, minute: 0, prompt: "p", projectId: "x" });
    s.recordRun(saved.id, { outcome: "skipped", reason: "still running" });
    expect(s.list()[0].lastRunDate).toBe("");
  });
});

describe("a repeat with an end", () => {
  it("stops at its last hour rather than at midnight", () => {
    // A booking that picks up tickets belongs to the hours people file them.
    // Running to 23:00 was where the day ended, not what anyone asked for.
    const day = occurrencesToday(job({ everyHours: 2, hour: 8, minute: 0, untilMinutes: 20 * 60 }));
    expect(day).toEqual([480, 600, 720, 840, 960, 1080, 1200]);
  });

  it("includes the end when it lands on it exactly", () => {
    const day = occurrencesToday(job({ everyHours: 4, hour: 8, minute: 0, untilMinutes: 16 * 60 }));
    expect(day.at(-1)).toBe(16 * 60);
  });

  it("runs to the end of the day when no end is given", () => {
    expect(occurrencesToday(job({ everyHours: 2, hour: 8, minute: 0 })).at(-1)).toBe(22 * 60);
  });

  it("ignores an end before the start rather than never running", () => {
    // Typing them the wrong way round should not produce a booking that
    // silently does nothing.
    const day = occurrencesToday(job({ everyHours: 2, hour: 8, minute: 0, untilMinutes: 6 * 60 }));
    expect(day.length).toBeGreaterThan(1);
  });

  it("books a wake-up for each occurrence and no more", () => {
    expect(wakeTimes([job({ everyHours: 2, hour: 8, minute: 0, untilMinutes: 20 * 60 })])).toHaveLength(7);
  });
});

describe("a booking that has only just been made", () => {
  const at = (iso: string) => new Date(iso).getTime();

  it("has not missed the occurrences it was never there for", () => {
    // Made at 23:51, repeating hourly from 08:00: fifteen occurrences are
    // already behind it, and it reported every one as missed the moment it
    // was saved.
    const fresh = job({ everyHours: 1, hour: 8, minute: 0, createdAt: at("2026-09-15T23:51:00") });
    expect(missedJobs([fresh], at("2026-09-15T23:55:00"))).toEqual([]);
  });

  it("is not let off an occurrence that passed after it was made", () => {
    // Being newly created excuses the occurrences from before it existed and
    // nothing after. For a repeat that now means the 10:00 one is run late
    // rather than reported missed, but either way the booking is not excused.
    const fresh = job({ everyHours: 1, hour: 8, minute: 0, createdAt: at("2026-09-15T08:30:00") });
    expect(dueJobs([fresh], at("2026-09-15T10:30:00")).map((j) => j.id)).toEqual(["job-1"]);
  });

  it("is due at its next occurrence like any other", () => {
    const fresh = job({ everyHours: 1, hour: 8, minute: 0, createdAt: at("2026-09-15T23:51:00") });
    expect(dueJobs([fresh], at("2026-09-16T08:00:00")).map((j) => j.id)).toEqual(["job-1"]);
  });
});

describe("catching up a repeat", () => {
  /*
   * A laptop that sleeps is almost never awake at the exact top of the hour, so
   * with a five-minute window nearly every occurrence of an hourly booking was
   * written off as missed. The row said "missed" and never changed, which reads
   * as a scheduler that has stopped — and effectively was one.
   */
  const hourly = (over: Record<string, unknown> = {}) =>
    job({ hour: 8, minute: 0, everyHours: 1, untilMinutes: 1200, createdAt: at("2026-09-21T00:00:00"), ...over });

  it("runs an hourly booking that was joined ten minutes late", () => {
    const now = at("2026-09-21T15:10:00");
    expect(dueJobs([hourly()], now).map((entry) => entry.id)).toEqual(["job-1"]);
    // And says nothing about a miss, because it has not missed anything.
    expect(missedJobs([hourly()], now)).toEqual([]);
  });

  it("still refuses to run a once-a-day booking hours late", () => {
    // 09:00 means 09:00. Running it at 14:00 is a surprise, and the miss is the
    // better answer.
    const daily = job({ hour: 9, minute: 0, everyHours: 0, createdAt: at("2026-09-21T00:00:00") });
    const now = at("2026-09-21T14:00:00");
    expect(dueJobs([daily], now)).toEqual([]);
    expect(missedJobs([daily], now).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("stops at the end of the hours the booking named", () => {
    // "every hour until 20:00" does not mean a run at 23:00 because the machine
    // was asleep all evening.
    const now = at("2026-09-21T23:00:00");
    expect(dueJobs([hourly()], now)).toEqual([]);
    expect(missedJobs([hourly()], now).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("gives up on an occurrence once the next one is due", () => {
    // Two hours past a 15:00 occurrence on an hourly booking means 16:00 and
    // 17:00 are the ones that matter, not a stale 15:00.
    const now = at("2026-09-21T15:00:00") + 61 * 60_000;
    const late = hourly({ lastRunAt: 0 });
    // 16:00 is the current occurrence by now, and it is within its own hour.
    expect(dueJobs([late], now).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("does not report a repeat as missed while it can still be run", () => {
    // Recording a miss stamps the row, and a row stamped "missed" is one nobody
    // looks at again.
    for (const minutes of [0, 5, 20, 45, 59]) {
      const now = at("2026-09-21T15:00:00") + minutes * 60_000;
      expect(missedJobs([hourly()], now), `at 15:${String(minutes).padStart(2, "0")}`).toEqual([]);
    }
  });
});
