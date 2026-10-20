import { describe, expect, it } from "vitest";
import cloudCrypto from "./crypto.cjs";

const {
  CloudCryptoError, commitTo, comparisonCode, createDeviceKeyPair, createRecoveryKey, createVault, deriveKeys, objectId, open, openBytes,
  openFromDevice, parseRecoveryKey, seal, sealBytes, sealToDevice, unwrapWithRecovery, wrapWithRecovery,
} = cloudCrypto;

const vault = createVault();
const { objectKey, idKey } = deriveKeys(vault.masterKey);
const slot = { vaultId: vault.vaultId, id: "a".repeat(64), rev: 3 };

describe("records", () => {
  it("seals and opens a value", () => {
    const value = { title: "Ship it", nested: [1, "two"] };
    const sealed = seal(objectKey, slot, value);
    expect(sealed[0]).toBe(1);
    expect(sealed.toString("utf8")).not.toContain("Ship it");
    expect(open(objectKey, slot, sealed)).toEqual(value);
  });

  it("refuses a tampered body or a record moved to another slot", () => {
    const sealed = seal(objectKey, slot, { a: 1 });
    const tampered = Buffer.from(sealed);
    tampered[20] ^= 1;
    expect(() => open(objectKey, slot, tampered)).toThrow(CloudCryptoError);
    expect(() => open(objectKey, { ...slot, rev: 4 }, sealed)).toThrow(CloudCryptoError);
    expect(() => open(objectKey, { ...slot, id: "b".repeat(64) }, sealed)).toThrow(CloudCryptoError);
    expect(() => open(objectKey, { ...slot, vaultId: createVault().vaultId }, sealed)).toThrow(CloudCryptoError);
    expect(() => open(deriveKeys(createVault().masterKey).objectKey, slot, sealed)).toThrow(CloudCryptoError);
  });

  it("seals raw bytes", () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    expect(openBytes(objectKey, slot, sealBytes(objectKey, slot, bytes))).toEqual(bytes);
  });

  it("derives stable ids that differ by kind and account", () => {
    expect(objectId(idKey, "task", "t1")).toMatch(/^[0-9a-f]{64}$/);
    expect(objectId(idKey, "task", "t1")).toBe(objectId(idKey, "task", "t1"));
    expect(objectId(idKey, "task", "t1")).not.toBe(objectId(idKey, "session", "t1"));
    expect(objectId(deriveKeys(createVault().masterKey).idKey, "task", "t1")).not.toBe(objectId(idKey, "task", "t1"));
  });
});

describe("recovery key", () => {
  it("is 26 readable characters in groups of five and survives sloppy typing", () => {
    const key = createRecoveryKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}-[0-9A-HJKMNP-TV-Z]$/);
    const sloppy = key.toLowerCase().replaceAll("-", " ").replaceAll("0", "o").replaceAll("1", "l");
    expect(parseRecoveryKey(sloppy)).toEqual(parseRecoveryKey(key));
    expect(parseRecoveryKey("not a key")).toBeNull();
    expect(parseRecoveryKey(key.slice(0, -2))).toBeNull();
  });

  it("wraps the vault so only the right key opens it", () => {
    const key = createRecoveryKey();
    const blob = wrapWithRecovery(vault, key);
    expect(blob).not.toContain(vault.masterKey.toString("base64"));
    const opened = unwrapWithRecovery(blob, key.toLowerCase());
    expect(opened.vaultId).toBe(vault.vaultId);
    expect(opened.masterKey.equals(vault.masterKey)).toBe(true);
    expect(() => unwrapWithRecovery(blob, createRecoveryKey())).toThrow(CloudCryptoError);
    expect(() => unwrapWithRecovery(blob, "garbage")).toThrow(CloudCryptoError);
  });
});

describe("device envelopes", () => {
  it("hands the vault to a new device and to no one else", () => {
    const device = createDeviceKeyPair();
    const approver = createDeviceKeyPair();
    const envelope = sealToDevice(vault, device.publicKey, approver);
    const opened = openFromDevice(envelope, device.privateKey, approver.publicKey);
    expect(opened.masterKey.equals(vault.masterKey)).toBe(true);
    expect(opened.vaultId).toBe(vault.vaultId);
    expect(() => openFromDevice(envelope, createDeviceKeyPair().privateKey, approver.publicKey)).toThrow(CloudCryptoError);
    // An envelope from a key other than the one whose code the user compared is refused.
    expect(() => openFromDevice(envelope, device.privateKey, createDeviceKeyPair().publicKey)).toThrow(CloudCryptoError);
  });

  it("commits to a key before the other side's key is known", () => {
    const device = createDeviceKeyPair();
    expect(commitTo(device.publicKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(commitTo(device.publicKey)).toBe(commitTo(device.publicKey));
    expect(commitTo(createDeviceKeyPair().publicKey)).not.toBe(commitTo(device.publicKey));
  });

  it("gives both screens the same six-digit code, and a different one for a swapped key", () => {
    const a = createDeviceKeyPair().publicKey;
    const b = createDeviceKeyPair().publicKey;
    expect(comparisonCode(a, b)).toMatch(/^\d{3} \d{3}$/);
    expect(comparisonCode(a, b)).toBe(comparisonCode(b, a));
    expect(comparisonCode(a, createDeviceKeyPair().publicKey)).not.toBe(comparisonCode(a, b));
  });
});
