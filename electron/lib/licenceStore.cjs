"use strict";

/**
 * Where the licence lives, and how it is checked.
 *
 * The record is small and boring — when the app was installed, the key, and
 * what the merchant last said about it. The key itself is encrypted with
 * Electron's safe storage, which is the Keychain on macOS, because it is a
 * credential and the rest of Pitwall already treats credentials that way.
 *
 * The merchant is behind one function on purpose. Lemon Squeezy, Paddle and a
 * hand-rolled endpoint all answer the same question — "is this key active, and
 * until when" — so which one is chosen is a detail of `verifyWithMerchant` and
 * nothing above it needs to know.
 */

const fs = require("node:fs");
const path = require("node:path");

const FILE = "licence.json";

/**
 * Reads the stored record.
 *
 * A missing or unreadable file is a first run, not an error to surface: the
 * caller treats a null record as a fresh trial, which is both the friendly
 * reading and the correct one on a new machine.
 */
function readRecord({ userDataPath, safeStorage }) {
  try {
    const raw = fs.readFileSync(path.join(userDataPath, FILE), "utf8");
    const record = JSON.parse(raw);
    if (!record || typeof record !== "object") return null;

    if (record.keyCipher && safeStorage?.isEncryptionAvailable?.()) {
      try {
        record.key = safeStorage.decryptString(Buffer.from(record.keyCipher, "base64"));
      } catch {
        // A cipher this machine cannot read — a restored backup, a new user
        // account — is not a licence. Dropping it sends them to the key box
        // rather than to a permanent unexplained failure.
        delete record.key;
      }
    }
    delete record.keyCipher;
    return record;
  } catch {
    return null;
  }
}

function writeRecord({ userDataPath, safeStorage }, record) {
  const stored = { ...record };
  if (stored.key && safeStorage?.isEncryptionAvailable?.()) {
    stored.keyCipher = safeStorage.encryptString(stored.key).toString("base64");
    delete stored.key;
  }
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(path.join(userDataPath, FILE), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return record;
}

/** Stamps the install date the first time Pitwall runs. Never moves it later. */
function ensureInstalled(context, now = new Date().toISOString()) {
  const existing = readRecord(context);
  if (existing?.installedAt) return existing;
  return writeRecord(context, { ...(existing ?? {}), installedAt: now });
}

/**
 * Asks the merchant whether a key is active.
 *
 * Returns `{ ok: false }` for anything that is not a clear answer — a timeout,
 * a 500, no network. That distinction matters: "the merchant says no" revokes a
 * licence, while "we could not ask" must not, or every outage would lock out
 * every paying customer at once.
 */
async function verifyWithMerchant(key, { endpoint, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!endpoint) return { ok: false, reason: "not-configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    const body = await response.json();
    // Only an explicit boolean counts. A malformed answer is not a denial.
    if (typeof body?.active !== "boolean") return { ok: false, reason: "malformed" };
    return {
      ok: true,
      active: body.active,
      activeUntil: typeof body.activeUntil === "string" ? body.activeUntil : null,
    };
  } catch (error) {
    return { ok: false, reason: error?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies a verification result to the record.
 *
 * A failed check leaves everything as it was, so the grace window in
 * `readLicence` is what decides how long an unverifiable licence keeps working
 * — rather than one bad request quietly clearing the record.
 */
function applyVerification(record, result, now = new Date().toISOString()) {
  if (!result?.ok) return record;
  return {
    ...record,
    active: result.active,
    activeUntil: result.activeUntil ?? null,
    verifiedAt: now,
  };
}

module.exports = {
  FILE,
  readRecord,
  writeRecord,
  ensureInstalled,
  verifyWithMerchant,
  applyVerification,
};
