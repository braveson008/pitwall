const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const {
  FILE,
  readRecord,
  writeRecord,
  ensureInstalled,
  verifyWithMerchant,
  applyVerification,
} = require("../electron/lib/licenceStore.cjs");

/** Stands in for Electron's safeStorage, which is the Keychain on macOS. */
const keychain = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`sealed:${text}`),
  decryptString: (buf) => buf.toString().replace(/^sealed:/, ""),
};

function withStore(run) {
  const userDataPath = mkdtempSync(path.join(tmpdir(), "pitwall-licence-"));
  try {
    return run({ userDataPath, safeStorage: keychain }, userDataPath);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the record

test("reads back what was written", () => {
  withStore((context) => {
    writeRecord(context, { installedAt: "2026-08-01T00:00:00.000Z", key: "PITWALL-1234" });
    assert.equal(readRecord(context).key, "PITWALL-1234");
  });
});

test("never leaves the key in plain text on disk", () => {
  withStore((context, dir) => {
    writeRecord(context, { installedAt: "2026-08-01T00:00:00.000Z", key: "PITWALL-SECRET" });
    const onDisk = readFileSync(path.join(dir, FILE), "utf8");
    assert.ok(!onDisk.includes("PITWALL-SECRET"));
    assert.ok(onDisk.includes("keyCipher"));
  });
});

test("treats a first run as no record rather than as an error", () => {
  withStore((context) => assert.equal(readRecord(context), null));
});

test("survives a corrupted file", () => {
  withStore((context, dir) => {
    writeFileSync(path.join(dir, FILE), "{ not json", "utf8");
    assert.equal(readRecord(context), null);
  });
});

test("drops a key this machine cannot decrypt instead of failing forever", () => {
  // A restored backup, or a different user account: the cipher is real but not
  // ours. The user should land on the key box, not on a dead app.
  withStore((context, dir) => {
    writeRecord(context, { installedAt: "2026-08-01T00:00:00.000Z", key: "K" });
    const hostile = {
      isEncryptionAvailable: () => true,
      decryptString: () => { throw new Error("not for this machine"); },
    };
    const record = readRecord({ userDataPath: dir, safeStorage: hostile });
    assert.notEqual(record, null);
    assert.equal(record.key, undefined);
  });
});

test("stores the key in the clear only when encryption is unavailable", () => {
  withStore((_context, dir) => {
    const none = { userDataPath: dir, safeStorage: { isEncryptionAvailable: () => false } };
    writeRecord(none, { installedAt: "x", key: "PLAIN" });
    assert.equal(readRecord(none).key, "PLAIN");
  });
});

// ---------------------------------------------------------------- install date

test("stamps the install date on first run", () => {
  withStore((context) => {
    assert.equal(ensureInstalled(context, "2026-08-23T00:00:00.000Z").installedAt, "2026-08-23T00:00:00.000Z");
  });
});

test("never moves the install date afterwards", () => {
  // Otherwise every launch would restart the free month.
  withStore((context) => {
    ensureInstalled(context, "2026-08-01T00:00:00.000Z");
    assert.equal(ensureInstalled(context, "2026-09-01T00:00:00.000Z").installedAt, "2026-08-01T00:00:00.000Z");
  });
});

test("keeps an existing key when stamping", () => {
  withStore((context) => {
    writeRecord(context, { key: "PITWALL-1234" });
    assert.equal(ensureInstalled(context, "2026-08-23T00:00:00.000Z").key, "PITWALL-1234");
  });
});

// ---------------------------------------------------------------- the merchant

const endpoint = "https://example.test/verify";

test("reports an active subscription", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ active: true, activeUntil: "2026-09-23T00:00:00.000Z" }) });
  const result = await verifyWithMerchant("K", { endpoint, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.activeUntil, "2026-09-23T00:00:00.000Z");
});

test("reports a denial as a clear answer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ active: false }) });
  const result = await verifyWithMerchant("K", { endpoint, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.active, false);
});

test("does not turn an outage into a denial", async () => {
  // The distinction the whole design rests on: "no" revokes a licence,
  // "could not ask" must not, or one outage locks out every customer at once.
  const fetchImpl = async () => { throw new Error("network down"); };
  const result = await verifyWithMerchant("K", { endpoint, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.active, undefined);
});

test("does not turn a server error into a denial", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const result = await verifyWithMerchant("K", { endpoint, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http-503");
});

test("does not trust a malformed answer", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ active: "yes" }) });
  const result = await verifyWithMerchant("K", { endpoint, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed");
});

test("says so when no merchant is configured yet", async () => {
  const result = await verifyWithMerchant("K", {});
  assert.equal(result.reason, "not-configured");
});

// ---------------------------------------------------------------- applying it

test("records a successful check", () => {
  const record = { installedAt: "2026-08-01T00:00:00.000Z", key: "K" };
  const next = applyVerification(record, { ok: true, active: true, activeUntil: null }, "2026-08-23T00:00:00.000Z");
  assert.equal(next.active, true);
  assert.equal(next.verifiedAt, "2026-08-23T00:00:00.000Z");
});

test("leaves the record untouched when the check failed", () => {
  // The grace window decides how long an unverifiable licence keeps working,
  // not a single bad request.
  const record = { installedAt: "2026-08-01T00:00:00.000Z", key: "K" };
  assert.deepEqual(applyVerification(record, { ok: false, reason: "timeout" }), record);
});
