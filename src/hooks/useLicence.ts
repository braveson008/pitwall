import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  looksLikeKey,
  normaliseKey,
  readLicence,
  shouldRecheck,
  type Licence,
  type LicenceRecord,
} from "../lib/licence";

/** Why an activation attempt did not end in a working licence. */
export type ActivationResult = { ok: boolean; reason?: string };

/**
 * How long to wait before asking the merchant again after a check that did not
 * complete.
 *
 * The state that drives re-checking ticks every minute, and a request that
 * fails leaves the record untouched — so without this the app would retry the
 * moment the tick fired, once a minute, for as long as the service was down.
 * Half an hour is invisible next to the fourteen-day grace window.
 */
const RETRY_AFTER_MS = 30 * 60 * 1000;

/** How often to recompute. A trial that runs out mid-session should say so. */
const TICK_MS = 60 * 1000;

/**
 * Owns whether Pitwall is paid for.
 *
 * Storage and the network live in main; the meaning of the record lives in
 * `lib/licence`, which is pure. This hook is the join: it holds the record,
 * re-derives the licence as the clock moves, and re-checks in the background
 * when a check is due. Nothing here decides policy.
 */
export function useLicence() {
  const [record, setRecord] = useState<LicenceRecord | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState("https://braveli.app/#pricing");
  const [loaded, setLoaded] = useState(false);
  // Assume enforcement until told otherwise, so a build that does gate never
  // has a window at startup where it does not.
  const [enforced, setEnforced] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const attemptedAtRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await window.braveli?.getLicence?.();
      if (cancelled) return;
      setRecord(result?.record ?? null);
      if (result?.checkoutUrl) setCheckoutUrl(result.checkoutUrl);
      if (result && result.enforced === false) setEnforced(false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Until the record has loaded this reads as a fresh trial, which is the
   * permissive answer. A slow disk read must never be the reason someone cannot
   * start work.
   */
  const licence: Licence = useMemo(
    () => readLicence(record, now, { enforced }),
    [record, now, enforced],
  );

  useEffect(() => {
    if (!loaded || !enforced || inFlightRef.current) return;
    if (!shouldRecheck(record, now)) return;
    if (now - attemptedAtRef.current < RETRY_AFTER_MS) return;

    attemptedAtRef.current = now;
    inFlightRef.current = true;
    void (async () => {
      try {
        const result = await window.braveli?.verifyLicence?.();
        if (result?.record) setRecord(result.record);
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [loaded, enforced, record, now]);

  const activate = useCallback(async (raw: string): Promise<ActivationResult> => {
    const key = normaliseKey(raw);
    // Checked here so an obvious typo is answered instantly rather than after a
    // round trip. Whether the key is *real* remains the merchant's to say.
    if (!looksLikeKey(key)) return { ok: false, reason: "malformed" };

    const result = await window.braveli?.activateLicence?.({ key });
    if (result?.record) setRecord(result.record);
    if (!result) return { ok: false, reason: "unavailable" };
    // A completed check that came back negative is a different answer from a
    // check that could not be made, and the two read differently to the user.
    if (result.ok && result.active === false) return { ok: false, reason: "inactive" };
    return { ok: Boolean(result.ok), reason: result.reason };
  }, []);

  const clear = useCallback(async () => {
    const result = await window.braveli?.clearLicence?.();
    setRecord(result?.record ?? null);
    attemptedAtRef.current = 0;
  }, []);

  return {
    licence,
    checkoutUrl,
    loaded,
    hasKey: Boolean(record?.key),
    activate,
    clear,
  };
}
