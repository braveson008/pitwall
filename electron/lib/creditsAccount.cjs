"use strict";

/**
 * The Pitwall account that buys model usage as credits.
 *
 * The app holds one thing: a per-Mac key the gateway issued at sign-in. It is
 * kept in safe storage (the Keychain) and never written in the clear; where
 * safe storage is unavailable it lives in memory for the session only.
 */

const fs = require("node:fs");
const path = require("node:path");

const FILE = "pitwall-account.json";
// A build that sells credits names its gateway in Resources/credits-config.json, baked at release;
// one without (the open-source build) has none. BRAVELI_GATEWAY_URL points any build at another, e.g. a local one.
function bakedGateway() {
  if (!process.resourcesPath) return "";
  try {
    return String(JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "credits-config.json"), "utf8")).gateway || "");
  } catch {
    return "";
  }
}

let memoryOnly = null;

function gatewayUrl(env = process.env, baked = bakedGateway()) {
  const url = (env.BRAVELI_GATEWAY_URL || baked || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(url) ? url : "";
}

function isLocalGateway(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function readAccount({ userDataPath, safeStorage }) {
  if (memoryOnly) return memoryOnly;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(userDataPath, FILE), "utf8"));
    if (!record?.keyCipher || !safeStorage?.isEncryptionAvailable?.()) return null;
    const key = safeStorage.decryptString(Buffer.from(record.keyCipher, "base64"));
    return { email: record.email || "", gateway: record.gateway || "", key };
  } catch {
    return null;
  }
}

function writeAccount({ userDataPath, safeStorage }, { email, gateway, key }) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    memoryOnly = { email, gateway, key };
    return { persisted: false };
  }
  memoryOnly = null;
  const record = { email, gateway, keyCipher: safeStorage.encryptString(key).toString("base64") };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(path.join(userDataPath, FILE), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { persisted: true };
}

function clearAccount({ userDataPath }) {
  memoryOnly = null;
  try { fs.rmSync(path.join(userDataPath, FILE), { force: true }); } catch { /* already gone */ }
}

/** One gateway call. Errors come back as `{ ok: false, status, code, message }`, never thrown. */
async function gatewayRequest(base, route, { method = "GET", body, key, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (!base) return { ok: false, status: 0, code: "not_available", message: "Credits are not available in this build yet." };
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    const response = await fetchImpl(`${base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data };
    return {
      ok: false,
      status: response.status,
      code: data?.error?.code || data?.error?.type || "error",
      message: data?.error?.message || `The gateway answered ${response.status}.`,
      retryAfter: data?.error?.retry_after,
    };
  } catch {
    return { ok: false, status: 0, code: "unreachable", message: "Pitwall could not reach the credits service. Check your connection and try again." };
  }
}

/**
 * Points a Codex launch at the gateway: a provider of its own with the key in
 * the environment, so there is no OpenAI login and the key never appears on a
 * command line or in a config file.
 */
function withCreditsProvider(launch, { gateway, key }) {
  const provider = `model_providers.pitwall={name="Pitwall",base_url="${gateway}/v1",env_key="PITWALL_KEY",wire_api="responses"}`;
  const args = ["-c", "model_provider=pitwall", "-c", provider];
  return {
    ...launch,
    args: [...launch.args, ...args],
    display: [launch.display, "-c model_provider=pitwall"].join(" "),
    env: { ...(launch.env || {}), PITWALL_KEY: key },
  };
}

/** What the gateway's refusal looks like on a CLI's screen, and what to offer. */
function readCreditsScreen(text) {
  if (/overage cap are used up|credits_exhausted/i.test(text)) return "exhausted";
  if (/has no active plan|no_active_plan/i.test(text)) return "no-plan";
  if (/Pitwall key is not valid|has been revoked/i.test(text)) return "signed-out";
  return null;
}

module.exports = {
  clearAccount,
  gatewayRequest,
  gatewayUrl,
  isLocalGateway,
  readAccount,
  readCreditsScreen,
  withCreditsProvider,
  writeAccount,
};
