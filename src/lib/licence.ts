/**
 * Whether Pitwall is paid for, and what to do when it is not.
 *
 * Two things make this different from a normal licence check.
 *
 * The first is that Pitwall is local-first and its whole pitch is that it keeps
 * working on your machine. A check that phones home on every launch and locks
 * the app when the network is down would contradict that in the most visible
 * way possible. So a verified licence is cached with an expiry, and an
 * unreachable server costs the user nothing until the cache is old.
 *
 * The second is that agents run for a long time. Locking the app the moment a
 * subscription lapses could kill a Council that is twenty minutes into a task
 * and holding uncommitted work in a worktree. Lapsing therefore stops new work
 * from being started; it never destroys work in flight.
 */

/** Statuses in which the app is fully usable. */
export type LicenceStatus =
  | "trial"
  | "licensed"
  /** Verified once, offline since; still working while the cache is good. */
  | "grace"
  | "trial-expired"
  | "lapsed";

export type Licence = {
  status: LicenceStatus;
  /** Whole days remaining, for the states that count down. Null otherwise. */
  daysLeft: number | null;
  /** Whether new sessions and Councils may be started. */
  canStartWork: boolean;
  /** Said plainly, in the interface's voice. */
  message: string;
};

export type LicenceRecord = {
  /** When the app first ran. The trial is measured from here. */
  installedAt: string;
  /** The key, if one has been entered. */
  key?: string;
  /** Result of the last successful check against the merchant. */
  verifiedAt?: string;
  /** What that check said. `false` means the merchant denied it. */
  active?: boolean;
  /** When the subscription itself runs out, when the merchant tells us. */
  activeUntil?: string | null;
};

export const TRIAL_DAYS = 30;

/**
 * How long a verified licence is trusted without re-checking.
 *
 * Long enough that a fortnight on a plane, or a merchant outage, is invisible.
 * The cost of being generous is a few days of use by someone who has cancelled;
 * the cost of being strict is locking out a paying customer with bad wifi, and
 * those two mistakes are not equally bad.
 */
export const GRACE_DAYS = 14;

/** How often to re-check when the network is available. */
export const RECHECK_AFTER_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

function wholeDaysBetween(from: number, to: number): number {
  return Math.floor((to - from) / DAY);
}

function parse(value: string | undefined | null): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * The licence state, from the stored record and the clock.
 *
 * Pure: it reads no storage and makes no requests, so every branch below is
 * reachable from a test rather than from a subscription that has to be allowed
 * to actually expire.
 */
export function readLicence(
  record: LicenceRecord | null,
  now: number,
  { enforced = true }: { enforced?: boolean } = {},
): Licence {
  // A build with no licence service configured cannot sell a licence, so it
  // must never be able to withhold one. Without this, shipping the gate before
  // the service is live would brick every install thirty days after download:
  // the trial would expire, and the key box could not activate anything because
  // `verifyWithMerchant` has nowhere to ask. Forks and development builds land
  // here too, which is the behaviour they should have.
  if (!enforced) {
    return { status: "licensed", daysLeft: null, canStartWork: true, message: "Licensed." };
  }

  // No record at all is a first run that has not been written yet, not a
  // tampered install. Treating it as a fresh trial is both friendlier and
  // exactly what happens a moment later anyway.
  const installedAt = parse(record?.installedAt) ?? now;

  if (record?.active === true) {
    const until = parse(record.activeUntil);
    if (until !== null && until <= now) {
      return {
        status: "lapsed",
        daysLeft: null,
        canStartWork: false,
        message: "Your subscription has ended. Sessions already running will finish.",
      };
    }

    const verifiedAt = parse(record.verifiedAt);
    if (verifiedAt === null) {
      return { status: "licensed", daysLeft: null, canStartWork: true, message: "Licensed." };
    }

    const sinceCheck = wholeDaysBetween(verifiedAt, now);
    if (sinceCheck < RECHECK_AFTER_DAYS) {
      return { status: "licensed", daysLeft: null, canStartWork: true, message: "Licensed." };
    }
    if (sinceCheck < GRACE_DAYS) {
      // Due a re-check but not yet doubted. The caller re-checks in the
      // background; nothing about this state is shown to the user.
      return { status: "licensed", daysLeft: null, canStartWork: true, message: "Licensed." };
    }

    const graceLeft = GRACE_DAYS + RECHECK_AFTER_DAYS - sinceCheck;
    if (graceLeft > 0) {
      return {
        status: "grace",
        daysLeft: graceLeft,
        canStartWork: true,
        message: `Pitwall has not been able to confirm your licence. It keeps working for ${graceLeft} more ${graceLeft === 1 ? "day" : "days"}.`,
      };
    }

    return {
      status: "lapsed",
      daysLeft: null,
      canStartWork: false,
      message: "Pitwall could not confirm your licence. Connect to the internet, or enter your key again.",
    };
  }

  // A key the merchant actively denied. Distinct from never having had one.
  if (record?.active === false && record.key) {
    return {
      status: "lapsed",
      daysLeft: null,
      canStartWork: false,
      message: "That licence is not active. Check your subscription, or enter a different key.",
    };
  }

  const used = wholeDaysBetween(installedAt, now);
  const daysLeft = TRIAL_DAYS - used;
  if (daysLeft > 0) {
    return {
      status: "trial",
      daysLeft,
      canStartWork: true,
      message:
        daysLeft === 1
          ? "Last day of your free month."
          : `${daysLeft} days left in your free month.`,
    };
  }

  return {
    status: "trial-expired",
    daysLeft: 0,
    canStartWork: false,
    message: "Your free month has ended. Sessions already running will finish.",
  };
}

/**
 * The shortest true thing to put on a chip in the top bar.
 *
 * Null when there is nothing worth saying — a licensed app should not carry a
 * badge reminding you that you paid. The states that do return a label are the
 * ones where something is either running out or already has.
 */
export function licenceChipLabel(licence: Licence): string | null {
  switch (licence.status) {
    case "licensed":
      return null;
    case "trial":
      return licence.daysLeft === 1 ? "Last day" : `${licence.daysLeft} days left`;
    case "grace":
      return "Confirm licence";
    case "trial-expired":
      return "Trial ended";
    case "lapsed":
      return "Subscribe";
  }
}

/** Whether a background re-check is worth making right now. */
export function shouldRecheck(record: LicenceRecord | null, now: number): boolean {
  if (!record?.key) return false;
  const verifiedAt = parse(record.verifiedAt);
  if (verifiedAt === null) return true;
  return wholeDaysBetween(verifiedAt, now) >= RECHECK_AFTER_DAYS;
}

/**
 * Keys are shown to people, typed by people, and pasted with stray whitespace.
 * Normalising here means the same key entered three ways is one key.
 */
export function normaliseKey(input: string): string {
  return input.trim().replace(/\s+/g, "").toUpperCase();
}

/** A shape check only — whether it is *valid* is the merchant's to answer. */
export function looksLikeKey(input: string): boolean {
  const key = normaliseKey(input);
  return key.length >= 8 && /^[A-Z0-9-]+$/.test(key);
}
