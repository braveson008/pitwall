/**
 * What a scheduled job's row says.
 *
 * Derived from the history on every render and never stored — the same rule
 * the review list follows, and for the same reason: a state written once and
 * reconciled by nothing is how a screen starts lying.
 */
export type ScheduleState = "never" | "running" | "ok" | "blocked" | "failed" | "missed";

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, string> = {
  never: "never run",
  running: "running",
  ok: "ok",
  blocked: "blocked",
  failed: "failed",
  missed: "missed",
};

export function scheduleStateFor(job: ScheduleJob): ScheduleState {
  for (const entry of job.history ?? []) {
    if (entry.outcome === "skipped") {
      // One skip describes the job right now rather than the day: the fire
      // that found the previous run still going.
      if (/still running|already running/i.test(entry.reason || "")) return "running";
      continue;
    }
    if (entry.outcome === "running") return "running";
    if (entry.outcome === "ok") return "ok";
    if (entry.outcome === "blocked") return "blocked";
    if (entry.outcome === "failed") return "failed";
    if (entry.outcome === "missed") return "missed";
  }
  return "never";
}

/** Padded, so a column of times lines up on the character grid. */
export function formatScheduleTime(job: Pick<ScheduleJob, "hour" | "minute">): string {
  return `${String(job.hour).padStart(2, "0")}:${String(job.minute).padStart(2, "0")}`;
}

/**
 * A booked time. Five characters, one form.
 *
 * The time is its own field now rather than the head of a typed sentence, so
 * there is nothing to interpret: a booking always means the hour it looks
 * like. The earlier forgiving grammar accepted several spellings of a time,
 * which meant a line could look right and mean something else, and the mistake
 * only showed at the hour it fired.
 */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The start and, for a repeat, the last hour of a booking — or what is wrong
 * with them. Booking and editing both read times through this, so a typo in
 * the end is refused in both rather than quietly becoming "all day".
 */
export function bookingTimes(
  time: string,
  everyHours: number,
  until: string,
): { hour: number; minute: number; untilMinutes: number } | { error: string } {
  const clock = parseClock(time);
  if (!clock) {
    return time.trim()
      ? { error: `Write the time as 13:00 — ${time.trim()} is not a time on the clock.` }
      : { error: "Add a time first, like 13:00." };
  }
  if (everyHours <= 0 || !until.trim()) return { ...clock, untilMinutes: 0 };
  const end = parseClock(until);
  if (!end) return { error: "Write the last hour as 20:00, or leave it empty to run all day." };
  const untilMinutes = end.hour * 60 + end.minute;
  if (untilMinutes <= clock.hour * 60 + clock.minute) {
    return { error: `It would stop before it started — ${until.trim()} is not after ${time.trim()}.` };
  }
  return { ...clock, untilMinutes };
}

/** One duration format everywhere: `12m`, `7h 18m`. Never nothing. */
export function formatDuration(minutes: number): string {
  const total = Math.max(1, Math.round(minutes));
  const hours = Math.floor(total / 60);
  // Past two days, hours stop being readable: a weekly booking is 140 hours
  // away and nobody reads that as five days.
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  const rest = total % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

/**
 * The week, Monday first, as seven characters.
 *
 * One letter per day and a dot where it does not run, so a column of bookings
 * can be read down: MTWTFSS is every day, MTWTF\u00b7\u00b7 is weekdays,
 * M\u00b7W\u00b7F\u00b7\u00b7 is Monday, Wednesday and Friday. Seven characters,
 * no chrome, and it lines up with everything else on the grid.
 */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAME: Record<number, string> = {
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 0: "Sunday",
};

const DAY_SHORT: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 0: "Sun",
};

/**
 * The repeat, in words.
 *
 * It was seven one-character toggles: eight-pixel hit targets that also asked
 * the reader to tell two Ts and two Ss apart. Words cost more space and are
 * worth it — this is the line that decides when unattended work happens.
 */
export function describeDays(days: number[] | undefined): string {
  if (!days || days.length === 0 || days.length === 7) return "every day";
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return "weekdays";
  if (sorted.join() === "0,6") return "weekends";
  if (sorted.length === 1) return `${DAY_NAME[sorted[0]]}s`;
  return DAY_ORDER.filter((day) => sorted.includes(day)).map((day) => DAY_SHORT[day]).join(", ");
}

/** A repeat as one string, so it can be the value of a plain dropdown. */
export function daysKey(days: number[] | undefined, everyHours = 0): string {
  if (everyHours > 0) return `h${everyHours}`;
  return !days || days.length === 0 ? "" : [...days].sort().join("");
}

export function daysFromKey(key: string): number[] {
  if (key.startsWith("h")) return [];
  return key ? key.split("").map(Number) : [];
}

/** The interval a preset key stands for, 0 when it is a day rule. */
export function hoursFromKey(key: string): number {
  return key.startsWith("h") ? Number(key.slice(1)) || 0 : 0;
}

/**
 * The repeats worth offering, in the order a person thinks of them.
 *
 * One list rather than a day control beside an interval control: the line is
 * a line, and "every hour on Tuesdays" is a shape nobody has asked for. The
 * hourly entries run every day, which is what "every hour" means.
 */
export const DAY_PRESETS: Array<{ key: string; label: string; days: number[]; everyHours: number }> = [
  { key: "", label: "every day", days: [], everyHours: 0 },
  { key: "12345", label: "weekdays", days: [1, 2, 3, 4, 5], everyHours: 0 },
  { key: "06", label: "weekends", days: [0, 6], everyHours: 0 },
  ...DAY_ORDER.map((day) => ({ key: String(day), label: `${DAY_NAME[day]}s`, days: [day], everyHours: 0 })),
  ...[1, 2, 3, 4, 6, 8, 12].map((hours) => ({
    key: `h${hours}`,
    label: hours === 1 ? "every hour" : `every ${hours} hours`,
    days: [],
    everyHours: hours,
  })),
];

/**
 * The hours a booking covers, as one string: "08:00" for a single run,
 * "08:00-20:00" for one that repeats until an end.
 *
 * A booking whose whole point is "office hours only" is otherwise
 * indistinguishable on the row from one that runs all night, and the end was
 * only visible while the row was open for editing.
 */
export function formatScheduleSpan(
  job: Pick<ScheduleJob, "hour" | "minute"> & Partial<Pick<ScheduleJob, "everyHours" | "untilMinutes">>,
): string {
  const start = formatScheduleTime(job);
  const every = Number(job.everyHours) || 0;
  const until = Number(job.untilMinutes) || 0;
  if (every <= 0 || !until) return start;
  return `${start}\u2013${String(Math.floor(until / 60)).padStart(2, "0")}:${String(until % 60).padStart(2, "0")}`;
}

/**
 * What a booking's repeat is called, whether it is a day rule or an interval.
 *
 * Deliberately no end time: `formatScheduleSpan` puts that in the time column,
 * where it reads as one range. Said in both places it was said twice and fit
 * in neither.
 */
export function describeRepeat(job: Pick<ScheduleJob, "days" | "everyHours"> & Partial<Pick<ScheduleJob, "untilMinutes">>): string {
  const every = Number(job.everyHours) || 0;
  if (every === 0) return describeDays(job.days);
  return every === 1 ? "every hour" : `every ${every} hours`;
}

/**
 * No days means every day.
 *
 * Bookings made before days existed carry no list, and must keep running daily
 * rather than silently stopping — a schedule that quietly does nothing is the
 * failure this whole screen is built to prevent.
 */
function runsOnDay(days: number[] | undefined, weekday: number): boolean {
  return !days || days.length === 0 || days.includes(weekday);
}

export function runsOn(job: Pick<ScheduleJob, "days">, when: number): boolean {
  return runsOnDay(job.days, new Date(when).getDay());
}

/**
 * Minutes until this booking next comes round.
 *
 * Walks forward a day at a time rather than wrapping at midnight, because a
 * weekday booking looked at on Friday afternoon next runs on Monday, and a
 * countdown that said "in 23h" would be a lie.
 */
export function minutesUntil(
  job: Pick<ScheduleJob, "hour" | "minute"> & Partial<Pick<ScheduleJob, "days" | "everyHours" | "untilMinutes">>,
  now = Date.now(),
): number {
  const at = new Date(now);
  const minutesNow = at.getHours() * 60 + at.getMinutes();
  const start = job.hour * 60 + job.minute;
  const every = Number(job.everyHours) || 0;

  // Every time it comes round in a day, so an interval and a once-a-day
  // booking are counted the same way.
  const occurrences: number[] = [];
  // The same bound the scheduler itself applies: a repeat given a last hour
  // stops there, so the row must not count down to an occurrence that will
  // never come.
  const until = Number.isFinite(Number(job.untilMinutes)) && Number(job.untilMinutes) > start
    ? Math.min(Number(job.untilMinutes), 1439)
    : 1439;
  if (every > 0) for (let m = start; m <= until; m += every * 60) occurrences.push(m);
  else occurrences.push(start);

  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    if (!runsOnDay(job.days, day.getDay())) continue;
    for (const occurrence of occurrences) {
      if (ahead === 0 && occurrence <= minutesNow) continue;
      return ahead * 1440 + occurrence - minutesNow;
    }
  }
  return 7 * 1440;
}

/**
 * How many times in a row this job's time came and went with nothing run.
 *
 * Counted rather than listed: four identical missed lines say no more than one
 * line saying four, and a job quietly missing every day is the thing this
 * screen exists to surface.
 */
export function missedStreak(job: ScheduleJob): number {
  let count = 0;
  for (const entry of job.history ?? []) {
    if (entry.outcome === "skipped") continue;
    if (entry.outcome !== "missed") break;
    count += 1;
  }
  return count;
}

export type SlotTone = "ink" | "muted" | "blue" | "amber" | "green";

export interface SlotStatus {
  /** The checkbox, in the character grid: ran, running, to come, wants a person. */
  box: "[x]" | "[>]" | "[ ]" | "[!]";
  label: string;
  tone: SlotTone;
  /** Said underneath, only when something needs explaining. */
  note?: string;
  attention: boolean;
}

function clockOf(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

/**
 * What one booked slot says today.
 *
 * The state is a word first and a colour second, so every one of these reads
 * without colour — which is the accessibility rule and also why the checkbox
 * carries the same fact in the character grid.
 */
export function slotStatus(job: ScheduleJob, now = Date.now()): SlotStatus {
  const history = job.history ?? [];

  /*
   * A skip is the most recent thing that happened, and saying otherwise is how
   * this row came to show a two-day-old "missed" while every hour since had
   * been skipped for a run that had in fact already finished. Skips were
   * stepped over to find the last real outcome, which is right for one skip and
   * a lie once they are all there is.
   */
  const newest = history[0];
  if (newest?.outcome === "skipped" && /still running|already running/i.test(newest.reason || "")) {
    return {
      box: "[>]",
      label: "waiting on the last run",
      tone: "amber",
      attention: true,
      note: "an earlier run has not finished, so this occurrence was skipped",
    };
  }

  const latest = history.find((entry) => entry.outcome !== "skipped");

  if (latest?.outcome === "running") {
    const started = new Date(latest.at).getTime();
    const minutes = Number.isNaN(started) ? 1 : (now - started) / 60_000;
    return { box: "[>]", label: `running ${formatDuration(minutes)}`, tone: "green", attention: false };
  }

  if (latest?.outcome === "missed") {
    const streak = missedStreak(job);
    return {
      box: "[!]",
      label: streak > 1 ? `missed \u00d7${streak}` : "missed",
      tone: "amber",
      note: latest.reason || "its time passed while Pitwall was not running.",
      attention: true,
    };
  }

  if (latest?.outcome === "blocked" || latest?.outcome === "failed") {
    return {
      box: "[!]",
      label: `${latest.outcome} ${clockOf(latest.at)}`.trim(),
      tone: "amber",
      note: latest.reason || "the run did not finish.",
      attention: true,
    };
  }

  // Today's run only, taken from the run's own timestamp rather than from
  // lastRunDate: a slot should say "ok 09:02" about this morning, not about a
  // morning last week, and the run knows its own date.
  if (latest?.outcome === "ok" && localDateKey(new Date(latest.at).getTime()) === localDateKey(now)) {
    // A finished run goes quiet, and quiet reads as finished for good — which
    // is the wrong thing for a booking that runs again in an hour. The row
    // says when it next comes round, so "done" cannot be mistaken for "over".
    const until = job.enabled === false ? null : minutesUntil(job, now);
    return {
      box: "[x]",
      label: `ok ${clockOf(latest.at)}`.trim(),
      tone: "muted",
      note: until === null ? undefined : `next ${formatDuration(until)}`,
      attention: false,
    };
  }

  return { box: "[ ]", label: `in ${formatDuration(minutesUntil(job, now))}`, tone: "muted", attention: false };
}

/**
 * The day, which is what a schedule actually is.
 *
 * The first version was a list of rows in the order jobs happened to be
 * created — text with times in it, rather than a schedule. A schedule's whole
 * subject is time: what has already come round today, what is still to come,
 * and where now sits between them.
 */
function localDateKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function byTimeOfDay<T extends Pick<ScheduleJob, "hour" | "minute">>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
}

function minutesOfDay(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

/** The wall clock, padded, so a column of times lines up with the jobs. */
export function clockTime(now = Date.now()): string {
  const date = new Date(now);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Today's jobs, split where the clock is.
 *
 * Disabled jobs are neither past nor upcoming: they are not part of today at
 * all, and putting them in the day would claim they were going to run.
 */
export function splitDay(
  jobs: ScheduleJob[],
  now = Date.now(),
): { past: ScheduleJob[]; upcoming: ScheduleJob[]; off: ScheduleJob[] } {
  const minutesNow = minutesOfDay(now);
  const ordered = byTimeOfDay(jobs);
  return {
    past: ordered.filter((job) => job.enabled !== false && job.hour * 60 + job.minute <= minutesNow),
    upcoming: ordered.filter((job) => job.enabled !== false && job.hour * 60 + job.minute > minutesNow),
    off: ordered.filter((job) => job.enabled === false),
  };
}

/**
 * The next job that will actually run.
 *
 * Wraps to tomorrow once the day is spent, because "next" with nothing after
 * it is the answer a clock would never give.
 */
export function nextJob(jobs: ScheduleJob[], now = Date.now()): ScheduleJob | null {
  const day = splitDay(jobs, now);
  return day.upcoming[0] ?? day.past[0] ?? null;
}

/**
 * The branch a scheduled run works on.
 *
 * The time is in the name, not just the date. While a booking ran once a day
 * the date was enough to be unique; the moment one could repeat through the
 * day, every run after the first asked git for a branch that already existed
 * and got the first run's work instead of its own.
 */
/**
 * A task that exists only because a booking fired. It carries the run's
 * session and review, but it is not work anyone filed, so it stays off the
 * task board. Runs from before the source was recorded are known by branch.
 */
export function isScheduledRunTask(task: { source?: { kind?: string }; worktree?: string; identifier?: string }): boolean {
  if (task.source?.kind === "schedule") return true;
  return /^sched-[a-z0-9]{1,6}-\d{8}(?:-\d{4})?$/i.test(task.worktree || task.identifier || "");
}

export function scheduleRunBranch(jobId: string, at: Date): string {
  const id = jobId.replace(/[^a-z0-9]+/gi, "").slice(-6);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
    + `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `sched-${id}-${stamp}`;
}

/**
 * How long a scheduled run may go before it is worth telling someone.
 *
 * Long enough that real work is never interrupted, short enough that a run
 * wedged on a prompt nobody will answer does not sit there until you happen
 * to look.
 */
export const RUN_OVERDUE_MS = 4 * 60 * 60 * 1000;

/** Outcomes that mean a run is over, whatever its session record still says. */
const ENDS_A_RUN = new Set(["ok", "failed", "missed", "cancelled"]);

export type ScheduleOverlap =
  | { kind: "free" }
  | { kind: "running"; entry: ScheduleRun }
  | { kind: "overdue"; entry: ScheduleRun; hours: number };

/**
 * Whether this booking's previous run is still going, and whether that has
 * stopped being normal.
 *
 * Asked of every run with a live session rather than only the newest history
 * entry, so that flagging a run as overdue does not itself look like the end
 * of it and let the next occurrence start a second session alongside.
 *
 * "overdue" is raised once per run. A booking that repeats hourly would
 * otherwise report the same wedged session every hour, which is a notification
 * people learn to dismiss.
 */
export function scheduleOverlap(
  job: ScheduleJob,
  isLive: (taskId: string) => boolean,
  now: number,
): ScheduleOverlap {
  const history = job.history ?? [];

  /*
   * A run that has already ended is not one to wait for.
   *
   * This looked only for a `running` entry whose session still reads as live,
   * and a session record that is never settled reads as live for ever. So a run
   * that started at 08:02 and finished at 08:17 — with the `ok` sitting right
   * there in the history, two rows above — went on blocking the booking, and
   * every occurrence after it was skipped as "still running". Walking newest
   * first, an outcome that ends a run settles that task, and any older
   * `running` for it is history rather than a reason to wait.
   */
  const settled = new Set<string>();
  let entry: ScheduleRun | undefined;
  for (const item of history) {
    if (item.taskId && ENDS_A_RUN.has(item.outcome)) settled.add(item.taskId);
    if (item.outcome !== "running" || !item.taskId) continue;
    if (settled.has(item.taskId)) continue;
    if (!isLive(item.taskId)) continue;
    entry = item;
    break;
  }
  if (!entry) return { kind: "free" };

  const startedAt = Date.parse(entry.at);
  const elapsed = Number.isFinite(startedAt) ? now - startedAt : 0;
  // Reported once and then left alone: an hourly booking would otherwise raise
  // the same wedged session every hour. It keeps waiting rather than starting a
  // second session beside a live one, which is what this guard is for.
  const flagged = history.some((item) => item.outcome === "blocked" && item.taskId === entry?.taskId);
  if (elapsed <= RUN_OVERDUE_MS || flagged) return { kind: "running", entry };
  return { kind: "overdue", entry, hours: Math.floor(elapsed / (60 * 60 * 1000)) };
}

/**
 * The booking a finished run belongs to, if it is still waiting to be settled.
 *
 * "Waiting" includes blocked. A blocked run is one waiting on a person — an
 * unanswered prompt, a push the remote refused — and the point of saying so is
 * that the person clears it and the agent carries on. Matching only `running`
 * meant that the moment a run was called blocked it became invisible to the
 * settler, so it stayed blocked for ever and had to be marked done by hand.
 *
 * A run already settled is left alone: re-settling would overwrite a finished
 * record with a second opinion.
 */
/** Whether a scheduled run's task has an outcome that ends it, so its worktree may go. */
export function scheduledRunEnded(jobs: ScheduleJob[], taskId: string): boolean {
  if (!taskId) return false;
  return jobs.some((job) => {
    const latest = (job.history ?? []).find((entry) => entry.taskId === taskId && entry.outcome !== "skipped");
    return Boolean(latest && ENDS_A_RUN.has(latest.outcome));
  });
}

export function settlingJob(jobs: ScheduleJob[], taskId: string): ScheduleJob | null {
  if (!taskId) return null;
  for (const job of jobs) {
    const mine = (job.history ?? []).filter((entry) => entry.taskId === taskId);
    if (!mine.length) continue;
    // Newest first, and a skip is a fact about an occurrence rather than about
    // this run — it cannot be the thing that settles or unsettles it.
    const latest = mine.find((entry) => entry.outcome !== "skipped");
    if (latest?.outcome === "running" || latest?.outcome === "blocked") return job;
  }
  return null;
}
