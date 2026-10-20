"use strict";
/**
 * The account's encryption key on this computer, and the ways to get it.
 *
 * Held like the gateway key: encrypted with safeStorage (Keychain / DPAPI) in
 * `cloud/vault.json`, or in memory only for the session when safeStorage is
 * unavailable. The file never holds the master key in the clear.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  CloudCryptoError, commitTo, comparisonCode, createDeviceKeyPair, createRecoveryKey, createVault, openFromDevice, sealToDevice,
  unwrapWithRecovery, vaultVerifier, verifierOf, wrapWithRecovery,
} = require("./crypto.cjs");

function createVaultStore({ userDataPath, safeStorage }) {
  const file = path.join(userDataPath, "cloud", "vault.json");
  let memoryOnly = null;

  function read() {
    if (memoryOnly) return memoryOnly;
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!record?.cipher || !safeStorage?.isEncryptionAvailable?.()) return null;
      const secret = JSON.parse(safeStorage.decryptString(Buffer.from(record.cipher, "base64")));
      return { ...secret, vaultId: record.vaultId, masterKey: Buffer.from(secret.masterKey, "base64") };
    } catch {
      return null;
    }
  }

  function write(vault) {
    const secret = { ...vault, masterKey: vault.masterKey.toString("base64") };
    delete secret.vaultId;
    if (!safeStorage?.isEncryptionAvailable?.()) {
      memoryOnly = vault;
      return { persisted: false };
    }
    memoryOnly = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cipher = safeStorage.encryptString(JSON.stringify(secret)).toString("base64");
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ vaultId: vault.vaultId, cipher }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return { persisted: true };
  }

  function clear() {
    memoryOnly = null;
    fs.rmSync(file, { force: true });
  }

  return { read, write, clear, file };
}

/** This computer's key for the signed-in account, or null: a key kept for another account is never used. */
function vaultFor(store, account) {
  const vault = store.read();
  if (!vault) return null;
  return !vault.email || !account?.email || vault.email === account.email ? vault : null;
}

async function vaultStatus({ account, store, client }) {
  if (!account?.key) return "signed-out";
  if (vaultFor(store, account)) return "ready";
  const remote = await client.getVault();
  if (!remote.ok) return remote.status === 401 ? "signed-out" : "unreachable";
  return remote.data.initialised ? "needs-join" : "off";
}

/** First computer: a new key, its recovery envelope on the server, the key here. */
async function setUpVault({ store, client, email = null }) {
  const remote = await client.getVault();
  if (!remote.ok) throw new Error(remote.message);
  if (remote.data.initialised) throw new Error("This account already has sync set up on another computer.");
  const vault = createVault();
  const recoveryKey = createRecoveryKey();
  const saved = await client.putVault(wrapWithRecovery(vault, recoveryKey));
  if (!saved.ok) throw new Error(saved.code === "vault_exists" ? "This account already has sync set up on another computer." : saved.message);
  store.write({ ...vault, email });
  return { recoveryKey };
}

async function joinWithRecovery({ store, client, email = null }, recoveryKey) {
  const remote = await client.getVault();
  if (!remote.ok) return { ok: false, code: remote.code, message: remote.message };
  if (!remote.data.initialised) return { ok: false, code: "not_set_up", message: "This account has no synced data yet." };
  let vault;
  try {
    vault = unwrapWithRecovery(remote.data.recovery, recoveryKey);
  } catch (error) {
    if (error instanceof CloudCryptoError) return { ok: false, code: "wrong_key", message: "That recovery key doesn't open this account's data." };
    throw error;
  }
  store.write({ ...vault, email });
  await client.markJoined(vaultVerifier(vault.masterKey));
  return { ok: true };
}

/** A new key for everything. The old cloud copy is deleted, as nothing could open it any more. */
async function resetVault({ store, client, email = null }) {
  const vault = createVault();
  const recoveryKey = createRecoveryKey();
  const saved = await client.putVault(wrapWithRecovery(vault, recoveryKey), true);
  if (!saved.ok) throw new Error(saved.message);
  store.write({ ...vault, email });
  return { recoveryKey };
}

/**
 * The new computer's side of being approved. It commits to a fresh key, waits
 * for an approver to commit to theirs, reveals its own, and shows the code
 * both screens now agree on; then it opens the vault the approver sends.
 */
async function requestJoin({ client }, { name, platform }) {
  const keyPair = createDeviceKeyPair();
  const created = await client.createLink({ commit: commitTo(keyPair.publicKey), name, platform });
  if (!created.ok) return { ok: false, code: created.code, message: created.message };
  return { ok: true, pending: { linkId: created.data.link_id, keyPair, expiresAt: created.data.expires_at } };
}

async function advanceJoin({ store, client }, pending) {
  const seen = await client.readLink(pending.linkId);
  if (!seen.ok) return { state: seen.status === 404 ? "expired" : "error", message: seen.message };
  const { state, approver_key: approverKey, envelope } = seen.data;
  if (state === "approving") {
    const revealed = await client.revealKey(pending.linkId, pending.keyPair.publicKey);
    if (!revealed.ok) return { state: "error", message: revealed.message };
    pending.approverKey = approverKey;
    return { state: "revealed", code: comparisonCode(approverKey, pending.keyPair.publicKey) };
  }
  if (state === "revealed") return { state, code: comparisonCode(pending.approverKey || approverKey, pending.keyPair.publicKey) };
  if (state === "approved") {
    // Held until the person says the codes match here too.
    pending.envelope = envelope;
    pending.approverKey ||= approverKey;
    return { state: "confirm", code: comparisonCode(pending.approverKey, pending.keyPair.publicKey) };
  }
  return { state };
}

/** The person confirmed the codes match: open the key, check it is this account's, keep it. */
async function confirmJoin({ store, client, email = null }, pending) {
  if (!pending?.envelope) return { state: "error", message: "Nothing has arrived to confirm yet." };
  let vault;
  try {
    // Only from the key whose code was on screen: an envelope from any other is refused.
    vault = openFromDevice(pending.envelope, pending.keyPair.privateKey, pending.approverKey);
  } catch (error) {
    if (error instanceof CloudCryptoError) return { state: "error", message: "The key that arrived wasn't from the computer you compared codes with." };
    throw error;
  }
  const remote = await client.getVault();
  if (!remote.ok) return { state: "error", message: remote.message };
  if (!remote.data.initialised || verifierOf(remote.data.recovery) !== vaultVerifier(vault.masterKey)) {
    return { state: "error", message: "The key that arrived isn't this account's. Nothing was changed." };
  }
  store.write({ ...vault, email });
  await client.markJoined(vaultVerifier(vault.masterKey));
  return { state: "joined" };
}

/** The approving computer's side: offer a key, wait for the reveal, show the code. */
async function beginApproval({ client }, linkId) {
  // The new computer's commitment is read before this computer shows its own
  // key. Only then can't the server pick a key to match a code it already knows.
  const seen = await client.readLink(linkId);
  if (!seen.ok) return { ok: false, code: seen.code, message: seen.message };
  if (!/^[0-9a-f]{64}$/.test(String(seen.data?.commit || ""))) return { ok: false, code: "invalid", message: "That request can't be approved. Ask the other computer to try again." };
  const keyPair = createDeviceKeyPair();
  const offered = await client.offerApproverKey(linkId, keyPair.publicKey);
  if (!offered.ok) return { ok: false, code: offered.code, message: offered.message };
  return { ok: true, approval: { linkId, keyPair, commit: seen.data.commit } };
}

async function approvalCode({ client }, approval) {
  const seen = await client.readLink(approval.linkId);
  if (!seen.ok) return { state: "error", message: seen.message };
  if (seen.data.state !== "revealed") return { state: seen.data.state };
  // The server could swap in a key of its own; it cannot make one match the earlier commitment.
  if (commitTo(seen.data.revealed_key) !== approval.commit) return { state: "error", message: "The new computer's key changed on the way. Start again." };
  approval.deviceKey = seen.data.revealed_key;
  return { state: "revealed", code: comparisonCode(approval.keyPair.publicKey, seen.data.revealed_key) };
}

async function confirmApproval({ store, client }, approval) {
  const vault = store.read();
  if (!vault || !approval.deviceKey) return { ok: false, message: "Nothing to approve yet." };
  const sent = await client.approveLink(approval.linkId, sealToDevice(vault, approval.deviceKey, approval.keyPair));
  return sent.ok ? { ok: true } : { ok: false, message: sent.message };
}

module.exports = {
  advanceJoin, approvalCode, beginApproval, confirmApproval, confirmJoin, createVaultStore, joinWithRecovery, vaultFor, requestJoin, resetVault, setUpVault, vaultStatus,
};
