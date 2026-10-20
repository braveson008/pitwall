"use strict";
/**
 * Pitwall Cloud's cryptography, built only from Node's own primitives.
 *
 * One random master key per account never leaves a device in the clear. From
 * it come an encryption key (AES-256-GCM over gzip'd JSON) and an id key
 * (HMAC), so the server sees neither content nor what a record is about. Each
 * record is bound to its vault, id and revision through the AEAD's additional
 * data, so the server cannot move, replay or roll back a record unnoticed.
 *
 * A new device gets the master key either from the recovery key (wrapped with
 * HKDF, as the key is 130 random bits) or from a signed-in device over X25519,
 * after both screens show the same code from a commit-then-reveal exchange.
 */
const crypto = require("node:crypto");
const zlib = require("node:zlib");

class CloudCryptoError extends Error {}

const FORMAT = 1;
const hkdf = (key, info, salt = Buffer.alloc(0), length = 32) =>
  Buffer.from(crypto.hkdfSync("sha256", key, salt, Buffer.from(info), length));

function createVault() {
  return { vaultId: crypto.randomBytes(16).toString("hex"), masterKey: crypto.randomBytes(32) };
}

function deriveKeys(masterKey) {
  return { objectKey: hkdf(masterKey, "pitwall/object/v1"), idKey: hkdf(masterKey, "pitwall/id/v1") };
}

/** Proof of holding the master key that reveals nothing about it: stored beside the recovery envelope. */
function vaultVerifier(masterKey) {
  return crypto.createHmac("sha256", hkdf(masterKey, "pitwall/verifier/v1")).update("pitwall vault").digest("hex");
}

function verifierOf(recoveryBlob) {
  try {
    return String(JSON.parse(recoveryBlob).verifier || "");
  } catch {
    return "";
  }
}

function objectId(idKey, kind, localId) {
  return crypto.createHmac("sha256", idKey).update(`${kind}\n${localId}`).digest("hex");
}

function aead(key, nonce, plain, aad) {
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function unaead(key, nonce, sealed, aad) {
  if (sealed.length < 16) throw new CloudCryptoError("Sealed data is too short.");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  } catch {
    throw new CloudCryptoError("This data could not be decrypted with this account's key.");
  }
}

const slotAad = ({ vaultId, id, rev }) => Buffer.from(`${vaultId}\n${id}\n${rev}`);

function sealBytes(objectKey, slot, bytes) {
  const nonce = crypto.randomBytes(12);
  return Buffer.concat([Buffer.from([FORMAT]), nonce, aead(objectKey, nonce, zlib.gzipSync(bytes), slotAad(slot))]);
}

function openBytes(objectKey, slot, sealed) {
  const buffer = Buffer.from(sealed);
  if (buffer.length < 29 || buffer[0] !== FORMAT) throw new CloudCryptoError("Unknown sync record format.");
  const plain = unaead(objectKey, buffer.subarray(1, 13), buffer.subarray(13), slotAad(slot));
  try {
    return zlib.gunzipSync(plain);
  } catch {
    throw new CloudCryptoError("Sync record is corrupt.");
  }
}

const seal = (objectKey, slot, value) => sealBytes(objectKey, slot, Buffer.from(JSON.stringify(value), "utf8"));

function open(objectKey, slot, sealed) {
  const bytes = openBytes(objectKey, slot, sealed);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CloudCryptoError("Sync record is corrupt.");
  }
}

// Crockford base32: no I, L, O or U, so a written-down key cannot be misread.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CHARS = 26;

function createRecoveryKey() {
  const bytes = crypto.randomBytes(17);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let index = 0; index < RECOVERY_CHARS; index += 1) {
    text += ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return text.match(/.{1,5}/g).join("-");
}

/** The key's 26 characters, forgiving case, spaces, dashes and the usual look-alikes; null if it is not one. */
function parseRecoveryKey(input) {
  const cleaned = String(input || "").toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (cleaned.length !== RECOVERY_CHARS || [...cleaned].some((char) => !ALPHABET.includes(char))) return null;
  return Buffer.from(cleaned, "ascii");
}

function vaultPayload({ vaultId, masterKey }) {
  return Buffer.from(JSON.stringify({ vaultId, masterKey: masterKey.toString("base64") }));
}

function readVaultPayload(bytes) {
  try {
    const { vaultId, masterKey } = JSON.parse(bytes.toString("utf8"));
    const key = Buffer.from(masterKey, "base64");
    if (typeof vaultId !== "string" || key.length !== 32) throw new Error("shape");
    return { vaultId, masterKey: key };
  } catch {
    throw new CloudCryptoError("The key envelope is corrupt.");
  }
}

function wrapWithRecovery(vault, recoveryKey) {
  const material = parseRecoveryKey(recoveryKey);
  if (!material) throw new CloudCryptoError("That is not a recovery key.");
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const kek = hkdf(material, "pitwall/recovery/v1", salt);
  const ct = aead(kek, nonce, vaultPayload(vault), Buffer.from("pitwall/recovery"));
  return JSON.stringify({ v: 1, salt: salt.toString("base64"), nonce: nonce.toString("base64"), ct: ct.toString("base64"), verifier: vaultVerifier(vault.masterKey) });
}

function unwrapWithRecovery(blob, recoveryKey) {
  const material = parseRecoveryKey(recoveryKey);
  if (!material) throw new CloudCryptoError("That is not a recovery key.");
  let parsed;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new CloudCryptoError("The key envelope is corrupt.");
  }
  const kek = hkdf(material, "pitwall/recovery/v1", Buffer.from(parsed.salt, "base64"));
  const plain = unaead(kek, Buffer.from(parsed.nonce, "base64"), Buffer.from(parsed.ct, "base64"), Buffer.from("pitwall/recovery"));
  return readVaultPayload(plain);
}

const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const rawPublic = (keyObject) => keyObject.export({ type: "spki", format: "der" }).subarray(X25519_SPKI_PREFIX.length);

function publicKeyObject(base64) {
  const raw = Buffer.from(String(base64 || ""), "base64");
  if (raw.length !== 32) throw new CloudCryptoError("That is not a device key.");
  return crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function createDeviceKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { publicKey: rawPublic(publicKey).toString("base64"), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

const commitTo = (publicKey) => crypto.createHash("sha256").update(`pitwall/commit\n${publicKey}`).digest("hex");

/** The code both screens show. Order-free, so each side can compute it the same way. */
function comparisonCode(publicKeyA, publicKeyB) {
  const [first, second] = [publicKeyA, publicKeyB].sort();
  const digest = crypto.createHash("sha256").update(`pitwall/sas\n${first}\n${second}`).digest();
  const value = digest.readUInt32BE(0) % 1_000_000;
  const digits = String(value).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function sharedKey(privateKeyPem, publicKeyBase64, approverPublic, devicePublic) {
  let secret;
  try {
    secret = crypto.diffieHellman({ privateKey: crypto.createPrivateKey(privateKeyPem), publicKey: publicKeyObject(publicKeyBase64) });
  } catch (error) {
    if (error instanceof CloudCryptoError) throw error;
    throw new CloudCryptoError("The device key could not be used.");
  }
  return hkdf(secret, `pitwall/device/v1\n${approverPublic}\n${devicePublic}`);
}

/** The approving device sends the vault to the new one, from the key pair whose code the user compared. */
function sealToDevice(vault, devicePublicKey, approverKeyPair) {
  const key = sharedKey(approverKeyPair.privateKey, devicePublicKey, approverKeyPair.publicKey, devicePublicKey);
  const nonce = crypto.randomBytes(12);
  const ct = aead(key, nonce, vaultPayload(vault), Buffer.from("pitwall/device"));
  return JSON.stringify({ v: 1, from: approverKeyPair.publicKey, nonce: nonce.toString("base64"), ct: ct.toString("base64") });
}

function openFromDevice(envelope, devicePrivateKey, expectedApproverPublic) {
  let parsed;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new CloudCryptoError("The key envelope is corrupt.");
  }
  if (parsed.from !== expectedApproverPublic) throw new CloudCryptoError("This key did not come from the device you approved.");
  const devicePublic = rawPublic(crypto.createPublicKey(crypto.createPrivateKey(devicePrivateKey))).toString("base64");
  const key = sharedKey(devicePrivateKey, parsed.from, parsed.from, devicePublic);
  const plain = unaead(key, Buffer.from(parsed.nonce, "base64"), Buffer.from(parsed.ct, "base64"), Buffer.from("pitwall/device"));
  return readVaultPayload(plain);
}

module.exports = {
  CloudCryptoError,
  commitTo,
  comparisonCode,
  createDeviceKeyPair,
  createRecoveryKey,
  createVault,
  deriveKeys,
  objectId,
  open,
  openBytes,
  openFromDevice,
  parseRecoveryKey,
  seal,
  sealBytes,
  sealToDevice,
  unwrapWithRecovery,
  vaultVerifier,
  verifierOf,
  wrapWithRecovery,
};
