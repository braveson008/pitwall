import { describe, expect, it } from "vitest";
import { SCHEDULE_STATE_LABEL, byTimeOfDay, clockTime, DAY_PRESETS, daysFromKey, daysKey, describeDays, describeRepeat, formatDuration, formatScheduleSpan, formatScheduleTime, bookingTimes, minutesUntil, missedStreak, nextJob, parseClock, runsOn, scheduleOverlap, scheduleRunBranch, scheduledRunEnded, settlingJob, scheduleStateFor, slotStatus, splitDay } from "./schedule";

const job = (history: ScheduleRun[] = []): ScheduleJob => ({
  id: "j", hour: 13, minute: 5, prompt: "p", projectId: "p1", agent: "Codex",
  enabled: true, lastRunDate: "", history,
});

describe("scheduleStateFor", () => {
  it("is never before anything has run", () => {
    expect(scheduleStateFor(job())).toBe("never");
  });

  it("reads the newest entry", () => {
    expect(scheduleStateFor(job([{ at: "2026-09-15T13:00:00Z", outcome: "ok" }]))).toBe("ok");
    expect(scheduleStateFor(job([{ at: "2026-09-15T13:00:00Z", outcome: "failed" }]))).toBe("failed");
  });

  it("looks past a skip to the last run that actually happened", () => {
    // "Skipped because the previous one is still going" is a fact about today,
    // not a verdict on the job.
    expect(scheduleStateFor(job([
      { at: "2026-09-16T13:00:00Z", outcome: "skipped", reason: "disabled" },
      { at: "2026-09-15T13:00:00Z", outcome: "blocked" },
    ]))).toBe("blocked");
  });

  it("is running when a skip says the previous run is still going", () => {
    expect(scheduleStateFor(job([
      { at: "2026-09-16T13:00:00Z", outcome: "skipped", reason: "still running" },
    ]))).toBe("running");
  });

  it("is never when every entry is a skip with no run behind it", () => {
    expect(scheduleStateFor(job([{ at: "2026-09-16T13:00:00Z", outcome: "skipped", reason: "disabled" }]))).toBe("never");
  });

  it("labels every state", () => {
    for (const state of ["never", "running", "ok", "blocked", "failed"] as const) {
      expect(SCHEDULE_STATE_LABEL[state]).toBeTruthy();
    }
  });
});

describe("formatScheduleTime", () => {
  it("pads to HH:MM so a column of times lines up", () => {
    expect(formatScheduleTime({ hour: 9, minute: 5 })).toBe("09:05");
    expect(formatScheduleTime({ hour: 13, minute: 0 })).toBe("13:00");
  });
});

describe("the day", () => {
  const job = (hour: number, over: Partial<ScheduleJob> = {}): ScheduleJob => ({
    id: `j${hour}`, hour, minute: 0, prompt: `p${hour}`, projectId: "p1", agent: "Codex",
    enabled: true, lastRunDate: "", history: [], ...over,
  });
  const at = (iso: string) => new Date(iso).getTime();

  it("orders a day by the clock, not by when jobs were added", () => {
    expect(byTimeOfDay([job(18), job(9), job(13)]).map((j) => j.hour)).toEqual([9, 13, 18]);
  });

  it("splits the day at now", () => {
    // What has already come round today, and what is still to come. This is
    // the fact a schedule exists to show and the old list could not.
    const day = splitDay([job(9), job(13), job(18)], at("2026-09-15T14:00:00"));
    expect(day.past.map((j) => j.hour)).toEqual([9, 13]);
    expect(day.upcoming.map((j) => j.hour)).toEqual([18]);
  });

  it("puts everything ahead of now at the start of the day", () => {
    const day = splitDay([job(9), job(18)], at("2026-09-15T07:00:00"));
    expect(day.past).toEqual([]);
    expect(day.upcoming.map((j) => j.hour)).toEqual([9, 18]);
  });

  it("counts a disabled job as neither", () => {
    const day = splitDay([job(9, { enabled: false }), job(18)], at("2026-09-15T14:00:00"));
    expect(day.past).toEqual([]);
    expect(day.upcoming.map((j) => j.hour)).toEqual([18]);
    expect(day.off.map((j) => j.hour)).toEqual([9]);
  });

  it("names the next job to run", () => {
    expect(nextJob([job(9), job(13), job(18)], at("2026-09-15T14:00:00"))?.hour).toBe(18);
  });

  it("wraps to tomorrow's first job once the day is spent", () => {
    expect(nextJob([job(9), job(18)], at("2026-09-15T20:00:00"))?.hour).toBe(9);
  });

  it("has no next job when every job is off", () => {
    expect(nextJob([job(9, { enabled: false })], at("2026-09-15T20:00:00"))).toBeNull();
  });
});

describe("clockTime", () => {
  it("is the wall clock, padded", () => {
    expect(clockTime(new Date("2026-09-15T09:05:00").getTime())).toBe("09:05");
    expect(clockTime(new Date("2026-09-15T19:23:00").getTime())).toBe("19:23");
  });
});

describe("parseClock", () => {
  it("reads HH:MM, with or without a leading zero", () => {
    expect(parseClock("13:00")).toEqual({ hour: 13, minute: 0 });
    expect(parseClock("9:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseClock(" 09:05 ")).toEqual({ hour: 9, minute: 5 });
  });

  it("is null for anything that is not a time on the clock", () => {
    // The field is five characters wide and strict: one form, so a booking
    // always means the hour it looks like.
    for (const bad of ["", "13", "1pm", "25:00", "12:60", "13:0", "abc"]) {
      expect(parseClock(bad)).toBeNull();
    }
  });
});

describe("bookingTimes", () => {
  it("reads a start, and an end only for a repeat", () => {
    expect(bookingTimes("13:00", 0, "")).toEqual({ hour: 13, minute: 0, untilMinutes: 0 });
    expect(bookingTimes("08:00", 2, "20:00")).toEqual({ hour: 8, minute: 0, untilMinutes: 20 * 60 });
    expect(bookingTimes("08:00", 2, "  ")).toEqual({ hour: 8, minute: 0, untilMinutes: 0 });
    expect(bookingTimes("08:00", 0, "8pm")).toEqual({ hour: 8, minute: 0, untilMinutes: 0 });
  });

  it("asks for a time when there is none, and says which one is wrong when there is", () => {
    expect(bookingTimes("", 0, "")).toEqual({ error: "Add a time first, like 13:00." });
    expect(bookingTimes("25:00", 0, "")).toEqual({ error: "Write the time as 13:00 — 25:00 is not a time on the clock." });
  });

  it("refuses an end it cannot read rather than running all day", () => {
    expect(bookingTimes("08:00", 2, "8pm")).toEqual({ error: "Write the last hour as 20:00, or leave it empty to run all day." });
  });

  it("refuses an end that is not after the start", () => {
    expect(bookingTimes("10:00", 2, "09:00")).toEqual({ error: "It would stop before it started — 09:00 is not after 10:00." });
    expect(bookingTimes("10:00", 2, "10:00")).toEqual({ error: "It would stop before it started — 10:00 is not after 10:00." });
  });
});

describe("formatDuration", () => {
  it("is minutes under an hour, and hours with minutes above it", () => {
    expect(formatDuration(12)).toBe("12m");
    expect(formatDuration(59)).toBe("59m");
    expect(formatDuration(438)).toBe("7h 18m");
    expect(formatDuration(120)).toBe("2h 00m");
  });

  it("is days once hours stop being readable", () => {
    // A weekly booking is 140 hours away, and nobody reads that as five days.
    expect(formatDuration(140 * 60 + 30)).toBe("5d 20h");
    expect(formatDuration(48 * 60)).toBe("2d 0h");
  });

  it("never shows nothing", () => {
    expect(formatDuration(0)).toBe("1m");
    expect(formatDuration(-5)).toBe("1m");
  });
});

describe("minutesUntil", () => {
  it("counts to the next time the clock reaches it", () => {
    const from = new Date("2026-09-15T13:42:00").getTime();
    expect(minutesUntil({ hour: 21, minute: 0 }, from)).toBe(438);
    expect(minutesUntil({ hour: 9, minute: 0 }, from)).toBe(1158);
  });
});

describe("missedStreak", () => {
  const run = (outcome: string, at = "2026-09-15T06:00:00") => ({ at, outcome }) as ScheduleRun;
  const job = (history: ScheduleRun[]): ScheduleJob => ({
    id: "j", hour: 6, minute: 0, prompt: "p", projectId: "p1", agent: "Codex", enabled: true, lastRunDate: "", history,
  });

  it("counts the misses since the last run that happened", () => {
    expect(missedStreak(job([run("missed"), run("missed"), run("ok")]))).toBe(2);
  });

  it("stops at the first real run", () => {
    expect(missedStreak(job([run("missed"), run("ok"), run("missed")]))).toBe(1);
  });

  it("is zero when the last run happened", () => {
    expect(missedStreak(job([run("ok")]))).toBe(0);
  });
});

describe("slotStatus", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const job = (over: Partial<ScheduleJob> = {}): ScheduleJob => ({
    id: "j", hour: 9, minute: 0, prompt: "p", projectId: "p1", agent: "Codex", enabled: true, lastRunDate: "", history: [], ...over,
  });

  it("marks a finished run done, and says when it finished", () => {
    const status = slotStatus(job({ history: [{ at: "2026-09-15T09:02:00", outcome: "ok" }] }), at("2026-09-15T14:00:00"));
    expect(status.box).toBe("[x]");
    expect(status.label).toBe("ok 09:02");
    expect(status.attention).toBe(false);
  });

  it("marks a live run running, with how long it has been going", () => {
    const status = slotStatus(job({ history: [{ at: "2026-09-15T09:00:00", outcome: "running" }] }), at("2026-09-15T09:12:00"));
    expect(status.box).toBe("[>]");
    expect(status.label).toBe("running 12m");
    expect(status.tone).toBe("green");
  });

  it("marks anything wanting a person, and says why underneath", () => {
    const blocked = slotStatus(
      job({ history: [{ at: "2026-09-15T07:14:00", outcome: "blocked", reason: "sat on a prompt" }] }),
      at("2026-09-15T14:00:00"),
    );
    expect(blocked.box).toBe("[!]");
    expect(blocked.label).toBe("blocked 07:14");
    expect(blocked.tone).toBe("amber");
    expect(blocked.attention).toBe(true);
    expect(blocked.note).toBe("sat on a prompt");
  });

  it("counts repeated misses rather than listing them", () => {
    const status = slotStatus(job({ history: [
      { at: "2026-09-15T06:00:00", outcome: "missed" },
      { at: "2026-09-14T06:00:00", outcome: "missed" },
      { at: "2026-09-13T06:00:00", outcome: "missed" },
      { at: "2026-09-12T06:00:00", outcome: "missed" },
    ] }), at("2026-09-15T14:00:00"));
    expect(status.label).toBe("missed ×4");
    expect(status.attention).toBe(true);
  });

  it("shows work still to come as an empty box and a countdown", () => {
    const status = slotStatus(job({ hour: 21 }), at("2026-09-15T13:42:00"));
    expect(status.box).toBe("[ ]");
    expect(status.label).toBe("in 7h 18m");
  });
});

describe("days of the week", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const job = (over: Partial<ScheduleJob> = {}): ScheduleJob => ({
    id: "j", hour: 13, minute: 0, prompt: "p", projectId: "p1", agent: "Codex",
    enabled: true, lastRunDate: "", history: [], ...over,
  });

  it("runs every day when no days are set", () => {
    // Bookings made before days existed keep running daily rather than
    // silently stopping.
    for (const day of ["2026-09-14", "2026-09-19", "2026-09-20"]) {
      expect(runsOn(job(), at(`${day}T13:00:00`))).toBe(true);
    }
  });

  it("runs only on the days it was given", () => {
    const weekdays = job({ days: [1, 2, 3, 4, 5] });
    expect(runsOn(weekdays, at("2026-09-14T13:00:00"))).toBe(true);  // Monday
    expect(runsOn(weekdays, at("2026-09-18T13:00:00"))).toBe(true);  // Friday
    expect(runsOn(weekdays, at("2026-09-19T13:00:00"))).toBe(false); // Saturday
    expect(runsOn(weekdays, at("2026-09-20T13:00:00"))).toBe(false); // Sunday
  });

  it("says the repeat in words", () => {
    // Seven one-character toggles made eight-pixel hit targets and asked the
    // reader to tell two Ts and two Ss apart. Words do neither.
    expect(describeDays(undefined)).toBe("every day");
    expect(describeDays([])).toBe("every day");
    expect(describeDays([1, 2, 3, 4, 5])).toBe("weekdays");
    expect(describeDays([0, 6])).toBe("weekends");
    expect(describeDays([1])).toBe("Mondays");
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("round-trips a repeat through its key", () => {
    for (const days of [[], [1, 2, 3, 4, 5], [0, 6], [4]]) {
      expect(daysFromKey(daysKey(days))).toEqual(days);
    }
  });

  it("offers the repeats people actually want", () => {
    const labels = DAY_PRESETS.map((preset) => preset.label);
    expect(labels.slice(0, 3)).toEqual(["every day", "weekdays", "weekends"]);
    expect(labels).toContain("Mondays");
    // Day rules first, then intervals: both are repeats, and one list keeps the
    // booking line a line.
    expect(labels).toContain("every hour");
    expect(labels).toContain("every 4 hours");
    expect(DAY_PRESETS.filter((preset) => preset.everyHours > 0)).toHaveLength(7);
  });

  it("names an interval repeat by its interval", () => {
    expect(describeRepeat({ days: [], everyHours: 1 })).toBe("every hour");
    // The end of the range belongs to the time column, not said twice.
    expect(describeRepeat({ days: [], everyHours: 1, untilMinutes: 1200 })).toBe("every hour");
    expect(describeRepeat({ days: [], everyHours: 4 })).toBe("every 4 hours");
    expect(describeRepeat({ days: [1, 2, 3, 4, 5], everyHours: 0 })).toBe("weekdays");
  });

  it("states a repeat's hours as one span, and a single run as one time", () => {
    expect(formatScheduleSpan({ hour: 8, minute: 0 })).toBe("08:00");
    // No repeat means no range, however the end was left behind.
    expect(formatScheduleSpan({ hour: 8, minute: 0, everyHours: 0, untilMinutes: 1200 })).toBe("08:00");
    // A repeat with no end runs to midnight, and says only where it starts.
    expect(formatScheduleSpan({ hour: 8, minute: 0, everyHours: 2 })).toBe("08:00");
    expect(formatScheduleSpan({ hour: 8, minute: 0, everyHours: 2, untilMinutes: 1200 })).toBe("08:00\u201320:00");
    expect(formatScheduleSpan({ hour: 9, minute: 30, everyHours: 1, untilMinutes: 1005 })).toBe("09:30\u201316:45");
  });

  it("counts to the next time it comes round, not the next day", () => {
    // An hourly booking looked at ten past the hour runs again in fifty
    // minutes, not tomorrow.
    const hourly = { hour: 9, minute: 0, days: [], everyHours: 1 };
    expect(minutesUntil(hourly, at("2026-09-16T09:10:00"))).toBe(50);
    expect(minutesUntil(hourly, at("2026-09-16T23:30:00"))).toBe(9 * 60 + 30);
  });

  it("counts to the next day it actually runs", () => {
    // Friday 14:00, booked for weekdays only: the next run is Monday, not
    // tomorrow. A countdown that ignores the days would be a lie.
    const friday = at("2026-09-18T14:00:00");
    expect(minutesUntil(job({ days: [1, 2, 3, 4, 5] }), friday)).toBe(3 * 24 * 60 - 60);
    expect(minutesUntil(job({ days: [1, 2, 3, 4, 5] }), at("2026-09-14T12:00:00"))).toBe(60);
  });

  it("is a week away when only today is booked and today has passed", () => {
    expect(minutesUntil(job({ days: [1] }), at("2026-09-14T14:00:00"))).toBe(7 * 24 * 60 - 60);
  });
});

describe("scheduleRunBranch", () => {
  const at = (iso: string) => new Date(iso);

  it("puts the time in the name, so two runs on one day do not collide", () => {
    // While a booking ran once a day the date was unique. The moment one could
    // repeat, every run after the first asked git for a branch that already
    // existed and got the first run's work instead of its own.
    const first = scheduleRunBranch("job-abc123", at("2026-09-16T13:00:00"));
    const second = scheduleRunBranch("job-abc123", at("2026-09-16T14:00:00"));
    expect(first).not.toBe(second);
    expect(first).toBe("sched-abc123-20260916-1300");
    expect(second).toBe("sched-abc123-20260916-1400");
  });

  it("is a legal git branch name for an id full of punctuation", () => {
    expect(scheduleRunBranch("job/../x y!", at("2026-09-16T09:05:00"))).toMatch(/^sched-[a-z0-9]*-\d{8}-\d{4}$/);
  });

  it("reads as local time, not UTC", () => {
    // The booking is at 13:00 where the person is. A UTC stamp would name the
    // branch for a different hour, and for anyone far enough east, a different
    // day than the row they are looking at.
    const local = new Date(2026, 8, 16, 13, 0, 0);
    expect(scheduleRunBranch("job-1", local)).toContain("-20260916-1300");
  });
});

describe("scheduleOverlap", () => {
  const run = (over: Partial<ScheduleRun> = {}): ScheduleRun =>
    ({ at: "2026-09-16T13:00:00.000Z", outcome: "running", taskId: "task-1", ...over }) as ScheduleRun;
  const job = (history: ScheduleRun[]): ScheduleJob =>
    ({ id: "job-1", hour: 13, minute: 0, prompt: "p", projectId: "x", enabled: true, history }) as ScheduleJob;
  const live = () => true;
  const dead = () => false;
  const hoursLater = (n: number) => Date.parse("2026-09-16T13:00:00.000Z") + n * 60 * 60 * 1000;

  it("is free when nothing has run", () => {
    expect(scheduleOverlap(job([]), live, hoursLater(0)).kind).toBe("free");
  });

  it("is free when the previous run's session is gone", () => {
    // A run whose session ended but was never settled must not wedge the
    // booking shut for ever.
    expect(scheduleOverlap(job([run()]), dead, hoursLater(99)).kind).toBe("free");
  });

  it("is running while the previous run is still going", () => {
    expect(scheduleOverlap(job([run()]), live, hoursLater(1)).kind).toBe("running");
  });

  it("turns overdue once a run passes the limit", () => {
    const overlap = scheduleOverlap(job([run()]), live, hoursLater(5));
    expect(overlap.kind).toBe("overdue");
    expect(overlap.kind === "overdue" && overlap.hours).toBe(5);
  });

  it("reports an overdue run once, not every hour", () => {
    // A booking that repeats hourly would otherwise raise the same wedged
    // session every hour, which is a notification people learn to dismiss.
    const flagged = job([run({ outcome: "blocked", at: "2026-09-16T17:30:00.000Z" }), run()]);
    expect(scheduleOverlap(flagged, live, hoursLater(6)).kind).toBe("running");
  });

  it("looks past a newer entry to the run that is actually live", () => {
    // Flagging a run as overdue writes a newer entry. Reading only the newest
    // one would make the booking look free and start a second session
    // alongside the first — the exact thing the guard exists to prevent.
    const history = [run({ outcome: "blocked", taskId: "task-1" }), run({ taskId: "task-1" })];
    expect(scheduleOverlap(job(history), live, hoursLater(6)).kind).not.toBe("free");
  });

  it("ignores a run that never recorded a task", () => {
    expect(scheduleOverlap(job([run({ taskId: undefined })]), live, hoursLater(1)).kind).toBe("free");
  });
});

describe("a booking that has already run today", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const done = (over: Partial<ScheduleJob> = {}): ScheduleJob => ({
    id: "job-1", hour: 8, minute: 0, everyHours: 1, prompt: "p", projectId: "x",
    agent: "Claude", days: [], enabled: true, lastRunDate: "", lastRunAt: 0,
    history: [{ at: "2026-09-16T20:12:00", outcome: "ok", reason: "marked done by you" }],
    ...over,
  }) as ScheduleJob;

  it("says when it runs next, so done cannot be read as over", () => {
    // Marking a run done greys the row, and grey reads as finished for good.
    // For a booking that comes round again in an hour that is the wrong thing
    // to say, so the row carries the next time.
    const status = slotStatus(done(), at("2026-09-16T20:15:00"));
    expect(status.label).toMatch(/^ok /);
    expect(status.note).toBe("next 45m");
  });

  it("says nothing about next for a booking that is switched off", () => {
    expect(slotStatus(done({ enabled: false }), at("2026-09-16T20:15:00")).note).toBeUndefined();
  });
});

describe("settlingJob", () => {
  const job = (history: ScheduleRun[], id = "job-1"): ScheduleJob =>
    ({ id, hour: 8, minute: 0, prompt: "p", projectId: "x", enabled: true, history }) as ScheduleJob;
  const run = (outcome: string, over: Partial<ScheduleRun> = {}): ScheduleRun =>
    ({ at: "2026-09-16T20:12:00", outcome, taskId: "task-1", ...over }) as ScheduleRun;

  it("settles a run that is still going", () => {
    expect(settlingJob([job([run("running")])], "task-1")?.id).toBe("job-1");
  });

  it("settles a run that was blocked and has since finished", () => {
    // The bug this exists for: a run waiting on a person was invisible to the
    // settler, so clearing the blocker and letting the agent finish left the
    // booking saying "blocked" for ever.
    expect(settlingJob([job([run("blocked"), run("running")])], "task-1")?.id).toBe("job-1");
  });

  it("leaves a run that already settled alone", () => {
    // Re-settling would overwrite a finished record with a second opinion.
    expect(settlingJob([job([run("ok"), run("running")])], "task-1")).toBeNull();
    expect(settlingJob([job([run("failed"), run("running")])], "task-1")).toBeNull();
  });

  it("looks past a skip, which is about the occurrence and not this run", () => {
    expect(settlingJob([job([run("skipped"), run("blocked")])], "task-1")?.id).toBe("job-1");
  });

  it("knows nothing about a task no booking has run", () => {
    expect(settlingJob([job([run("running")])], "task-2")).toBeNull();
    expect(settlingJob([job([run("running")])], "")).toBeNull();
  });

  it("finds the booking the run belongs to among several", () => {
    const other = job([run("running", { taskId: "task-9" })], "job-9");
    expect(settlingJob([other, job([run("blocked")])], "task-1")?.id).toBe("job-1");
  });
});

describe("scheduledRunEnded", () => {
  const job = (history: ScheduleRun[]): ScheduleJob =>
    ({ id: "job-1", hour: 8, minute: 0, prompt: "p", projectId: "x", enabled: true, history }) as ScheduleJob;
  const run = (outcome: string): ScheduleRun =>
    ({ at: "2026-09-16T20:12:00", outcome, taskId: "task-1" }) as ScheduleRun;

  it("ends on ok or failed, looking past a skip", () => {
    expect(scheduledRunEnded([job([run("ok"), run("running")])], "task-1")).toBe(true);
    expect(scheduledRunEnded([job([run("skipped"), run("failed")])], "task-1")).toBe(true);
  });

  it("is not over while running or blocked, including a later turn of the same run", () => {
    expect(scheduledRunEnded([job([run("running"), run("ok")])], "task-1")).toBe(false);
    expect(scheduledRunEnded([job([run("blocked")])], "task-1")).toBe(false);
  });

  it("knows nothing about a task no booking ran", () => {
    expect(scheduledRunEnded([job([run("ok")])], "task-2")).toBe(false);
    expect(scheduledRunEnded([job([run("ok")])], "")).toBe(false);
  });
});

describe("a booking that stopped running", () => {
  const at = (iso: string) => new Date(iso).getTime();

  /*
   * Taken from a real schedule.json. Three bookings had recorded nothing but
   * "skipped — still running" every hour for two days, while the row showed a
   * two-day-old "missed". The run they were waiting for had finished at 08:17
   * the first morning, with the `ok` sitting two rows above the `running` in
   * the same history.
   */
  const stuck = (): ScheduleJob => ({
    id: "job-1", hour: 8, minute: 0, prompt: "pick up tickets", projectId: "p1",
    agent: "Claude", enabled: true, everyHours: 1, untilMinutes: 1200, days: [], lastRunDate: "",
    history: [
      { at: "2026-09-22T09:00:02.000Z", outcome: "skipped", reason: "still running" },
      { at: "2026-09-22T08:00:05.000Z", outcome: "skipped", reason: "still running" },
      { at: "2026-09-21T10:06:15.000Z", outcome: "missed", reason: "its time passed while Pitwall was not running" },
      { at: "2026-09-21T08:17:45.000Z", outcome: "ok", taskId: "task-a" },
      { at: "2026-09-21T08:11:32.000Z", outcome: "blocked", taskId: "task-a", reason: "a pull request already exists" },
      { at: "2026-09-21T08:02:13.000Z", outcome: "running", taskId: "task-a" },
    ],
  } as ScheduleJob);

  // The session record was never settled, so it still reads as live.
  const stillLive = () => true;

  it("does not wait for a run that already finished", () => {
    const overlap = scheduleOverlap(stuck(), stillLive, at("2026-09-22T13:04:00"));
    // The `ok` at 08:17 ended it, whatever the session record says.
    expect(overlap.kind).toBe("free");
  });

  it("keeps waiting when the run genuinely never finished", () => {
    // With the `ok` removed the run really is unfinished, and a booking that
    // started a second session beside a live one would be worse than a booking
    // that waits. It waits — and the row now says so, which is the part that
    // was missing.
    const job = stuck();
    job.history = job.history!.filter((entry) => entry.outcome !== "ok");
    expect(scheduleOverlap(job, stillLive, at("2026-09-22T13:04:00")).kind).toBe("running");
  });

  it("still waits for a run that is genuinely in progress", () => {
    const job = stuck();
    job.history = [{ at: "2026-09-22T12:50:00.000Z", outcome: "running", taskId: "task-b" }];
    expect(scheduleOverlap(job, stillLive, at("2026-09-22T13:04:00")).kind).toBe("running");
  });

  it("reports a long-running unflagged run as overdue, once", () => {
    const job = stuck();
    job.history = [{ at: "2026-09-22T02:00:00.000Z", outcome: "running", taskId: "task-c" }];
    const overlap = scheduleOverlap(job, stillLive, at("2026-09-22T13:04:00"));
    expect(overlap.kind).toBe("overdue");
  });

  it("says it is waiting rather than showing a two-day-old miss", () => {
    const status = slotStatus(stuck(), at("2026-09-22T13:04:00"));
    expect(status.label).not.toContain("missed");
    expect(status.label).toBe("waiting on the last run");
    expect(status.attention).toBe(true);
  });
});

describe("scheduled run tasks", () => {
  it("are known by their source, or by the branch older runs were given", async () => {
    const { isScheduledRunTask } = await import("./schedule");
    expect(isScheduledRunTask({ source: { kind: "schedule" } })).toBe(true);
    expect(isScheduledRunTask({ source: { kind: "local" }, worktree: "sched-987452-20260929-1200" })).toBe(true);
    expect(isScheduledRunTask({ source: { kind: "local" }, worktree: "sched-954930-20260915" })).toBe(true);
    expect(isScheduledRunTask({ source: { kind: "mcp" }, worktree: "acme-2679", identifier: "acme-2679" })).toBe(false);
    expect(isScheduledRunTask({ identifier: "SCHED-12" })).toBe(false);
  });
});
