import { describe, expect, it } from "vitest";
import {
  GRACE_DAYS,
  RECHECK_AFTER_DAYS,
  TRIAL_DAYS,
  licenceChipLabel,
  looksLikeKey,
  normaliseKey,
  readLicence,
  shouldRecheck,
  type LicenceRecord,
} from "./licence";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const trial = (installedDaysAgo: number): LicenceRecord => ({ installedAt: daysAgo(installedDaysAgo) });
const licensed = (verifiedDaysAgo: number, extra: Partial<LicenceRecord> = {}): LicenceRecord => ({
  installedAt: daysAgo(90),
  key: "PITWALL-1234-5678",
  active: true,
  verifiedAt: daysAgo(verifiedDaysAgo),
  ...extra,
});

describe("the free month", () => {
  it("starts on first run", () => {
    const licence = readLicence(trial(0), NOW);
    expect(licence.status).toBe("trial");
    expect(licence.daysLeft).toBe(TRIAL_DAYS);
    expect(licence.canStartWork).toBe(true);
  });

  it("counts down", () => {
    expect(readLicence(trial(10), NOW).daysLeft).toBe(TRIAL_DAYS - 10);
  });

  it("says so on the last day rather than showing a 1", () => {
    expect(readLicence(trial(TRIAL_DAYS - 1), NOW).message).toBe("Last day of your free month.");
  });

  it("ends after the full month", () => {
    const licence = readLicence(trial(TRIAL_DAYS), NOW);
    expect(licence.status).toBe("trial-expired");
    expect(licence.canStartWork).toBe(false);
  });

  it("treats a missing record as a fresh install, not as tampering", () => {
    // First run writes the record a moment after the app opens; the gap must
    // not read as an expired trial.
    expect(readLicence(null, NOW).status).toBe("trial");
  });

  it("promises that running work is not killed", () => {
    expect(readLicence(trial(TRIAL_DAYS + 5), NOW).message).toContain("already running will finish");
  });
});

describe("a paid licence", () => {
  it("works when recently verified", () => {
    const licence = readLicence(licensed(0), NOW);
    expect(licence.status).toBe("licensed");
    expect(licence.canStartWork).toBe(true);
  });

  it("keeps working while a re-check is merely due", () => {
    expect(readLicence(licensed(RECHECK_AFTER_DAYS + 1), NOW).status).toBe("licensed");
  });

  it("works without ever having been verified, once activated", () => {
    const record: LicenceRecord = { installedAt: daysAgo(40), key: "K-1234-5678", active: true };
    expect(readLicence(record, NOW).status).toBe("licensed");
  });

  it("ends when the subscription's own end date passes", () => {
    const licence = readLicence(licensed(0, { activeUntil: daysAgo(1) }), NOW);
    expect(licence.status).toBe("lapsed");
    expect(licence.canStartWork).toBe(false);
  });

  it("keeps working before that date", () => {
    const until = new Date(NOW + 20 * DAY).toISOString();
    expect(readLicence(licensed(0, { activeUntil: until }), NOW).status).toBe("licensed");
  });

  it("rejects a key the merchant denied", () => {
    const record: LicenceRecord = { installedAt: daysAgo(90), key: "K-1234-5678", active: false };
    const licence = readLicence(record, NOW);
    expect(licence.status).toBe("lapsed");
    expect(licence.canStartWork).toBe(false);
  });
});

describe("being offline", () => {
  it("costs nothing until the cache is genuinely old", () => {
    // The point of the grace window: a fortnight away from the network, or a
    // merchant outage, must not lock out someone who has paid.
    expect(readLicence(licensed(GRACE_DAYS - 1), NOW).canStartWork).toBe(true);
  });

  it("warns before it stops, with a count of what is left", () => {
    const licence = readLicence(licensed(GRACE_DAYS + 1), NOW);
    expect(licence.status).toBe("grace");
    expect(licence.canStartWork).toBe(true);
    expect(licence.daysLeft).toBeGreaterThan(0);
    expect(licence.message).toContain("keeps working");
  });

  it("eventually stops, and says what to do about it", () => {
    const licence = readLicence(licensed(GRACE_DAYS + RECHECK_AFTER_DAYS + 1), NOW);
    expect(licence.status).toBe("lapsed");
    expect(licence.canStartWork).toBe(false);
    expect(licence.message).toContain("Connect to the internet");
  });

  it("never leaves a paying user with a negative countdown", () => {
    for (let day = 0; day <= GRACE_DAYS + RECHECK_AFTER_DAYS + 10; day += 1) {
      const licence = readLicence(licensed(day), NOW);
      expect(licence.daysLeft === null || licence.daysLeft >= 0).toBe(true);
    }
  });
});

describe("shouldRecheck", () => {
  it("does not phone home without a key", () => {
    expect(shouldRecheck(trial(3), NOW)).toBe(false);
    expect(shouldRecheck(null, NOW)).toBe(false);
  });

  it("checks a key that has never been verified", () => {
    expect(shouldRecheck({ installedAt: daysAgo(1), key: "K-1234-5678" }, NOW)).toBe(true);
  });

  it("leaves a recent check alone", () => {
    expect(shouldRecheck(licensed(0), NOW)).toBe(false);
  });

  it("checks again once due", () => {
    expect(shouldRecheck(licensed(RECHECK_AFTER_DAYS), NOW)).toBe(true);
  });
});

describe("keys as people actually enter them", () => {
  it("survives padding, line breaks and case", () => {
    expect(normaliseKey("  pitwall-1234-5678\n ")).toBe("PITWALL-1234-5678");
  });

  it("accepts a plausible key", () => {
    expect(looksLikeKey("PITWALL-1234-5678")).toBe(true);
  });

  it("rejects something that is obviously not one", () => {
    expect(looksLikeKey("")).toBe(false);
    expect(looksLikeKey("short")).toBe(false);
    expect(looksLikeKey("has spaces and punctuation!")).toBe(false);
  });
});

describe("licenceChipLabel", () => {
  it("says nothing when the app is licensed", () => {
    expect(licenceChipLabel(readLicence(licensed(0), NOW))).toBeNull();
  });

  it("counts the trial down", () => {
    expect(licenceChipLabel(readLicence(trial(0), NOW))).toBe(`${TRIAL_DAYS} days left`);
    expect(licenceChipLabel(readLicence(trial(TRIAL_DAYS - 2), NOW))).toBe("2 days left");
  });

  it("does not say '1 days left'", () => {
    expect(licenceChipLabel(readLicence(trial(TRIAL_DAYS - 1), NOW))).toBe("Last day");
  });

  it("distinguishes a trial that ended from a subscription that lapsed", () => {
    expect(licenceChipLabel(readLicence(trial(TRIAL_DAYS), NOW))).toBe("Trial ended");
    expect(licenceChipLabel(readLicence(licensed(0, { active: false, key: "K-12345678" }), NOW))).toBe(
      "Subscribe",
    );
  });

  it("asks for confirmation rather than money while in grace", () => {
    const graceDays = GRACE_DAYS + 1;
    expect(licenceChipLabel(readLicence(licensed(graceDays), NOW))).toBe("Confirm licence");
  });
});

describe("a build with no licence service", () => {
  const unenforced = { enforced: false };

  it("never expires, however old the install", () => {
    const ancient = readLicence(trial(TRIAL_DAYS + 400), NOW, unenforced);
    expect(ancient.canStartWork).toBe(true);
    expect(ancient.status).toBe("licensed");
  });

  it("does not lock out a key the merchant denied, because it cannot have asked", () => {
    const denied = licensed(0, { active: false, key: "K-12345678" });
    expect(readLicence(denied, NOW, unenforced).canStartWork).toBe(true);
  });

  it("shows no chip, since there is nothing running out", () => {
    expect(licenceChipLabel(readLicence(trial(TRIAL_DAYS + 400), NOW, unenforced))).toBeNull();
  });

  it("still gates when enforcement is on, which is the default", () => {
    expect(readLicence(trial(TRIAL_DAYS + 1), NOW).canStartWork).toBe(false);
    expect(readLicence(trial(TRIAL_DAYS + 1), NOW, { enforced: true }).canStartWork).toBe(false);
  });
});
