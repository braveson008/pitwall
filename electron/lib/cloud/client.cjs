"use strict";
/**
 * Pitwall Cloud's HTTP client. Every method resolves to
 * `{ ok, status, data | bytes, code, message }` and never throws, like the
 * credits client: a sync failure is a state to show, not an exception.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

function createCloudClient({ gateway, key, appVersion = "", fetchImpl = fetch }) {
  const base = String(gateway || "").replace(/\/+$/, "");

  async function request(route, { method = "GET", json, bytes, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, raw = false, signal } = {}) {
    const all = { authorization: `Bearer ${key}`, ...(appVersion ? { "x-pitwall-version": appVersion } : {}), ...headers };
    let body;
    if (json !== undefined) {
      all["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (bytes !== undefined) {
      all["content-type"] = "application/octet-stream";
      body = bytes;
    }
    let response;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      response = await fetchImpl(`${base}${route}`, { method, headers: all, body, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    } catch {
      return { ok: false, status: 0, code: "unreachable", message: "Pitwall could not reach the sync service." };
    }
    if (response.ok && raw) {
      return { ok: true, status: response.status, bytes: Buffer.from(await response.arrayBuffer()), rev: Number(response.headers.get("x-rev")) };
    }
    const data = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data };
    return {
      ok: false,
      status: response.status,
      code: data?.error?.code || "error",
      message: data?.error?.message || `The sync service answered ${response.status}.`,
      ...(data?.error?.rev !== undefined ? { rev: data.error.rev } : {}),
      ...(data?.error?.holder ? { holder: data.error.holder, expiresAt: data.error.expires_at } : {}),
    };
  }

  return {
    registerDevice: (name, platform) => request("/v1/sync/device", { method: "POST", json: { name, platform } }),
    getVault: () => request("/v1/sync/vault"),
    putVault: (recovery, replace = false) => request("/v1/sync/vault", { method: "PUT", json: { recovery, replace } }),
    markJoined: (proof) => request("/v1/sync/vault/joined", { method: "POST", json: { proof } }),
    putObject: (id, rev, bytes) => request(`/v1/sync/objects/${id}`, { method: "PUT", bytes, headers: { "if-match": String(rev) } }),
    getObject: (id) => request(`/v1/sync/objects/${id}`, { raw: true }),
    deleteObject: (id, rev) => request(`/v1/sync/objects/${id}`, { method: "DELETE", headers: { "if-match": String(rev) } }),
    changes: (since, { wait = 0, limit = 500, signal } = {}) =>
      request(`/v1/sync/changes?since=${since}&limit=${limit}${wait ? `&wait=${wait}` : ""}`, { timeoutMs: (wait + 15) * 1000, signal }),
    usage: () => request("/v1/sync/usage"),
    devices: () => request("/v1/sync/devices"),
    removeDevice: (id) => request(`/v1/sync/devices/${id}`, { method: "DELETE" }),
    createLink: ({ commit, name, platform }) => request("/v1/sync/links", { method: "POST", json: { commit, name, platform } }),
    links: () => request("/v1/sync/links"),
    readLink: (id) => request(`/v1/sync/links/${id}`),
    offerApproverKey: (id, publicKey) => request(`/v1/sync/links/${id}/approver`, { method: "POST", json: { public_key: publicKey } }),
    revealKey: (id, publicKey) => request(`/v1/sync/links/${id}/reveal`, { method: "POST", json: { public_key: publicKey } }),
    approveLink: (id, envelope) => request(`/v1/sync/links/${id}/approve`, { method: "POST", json: { envelope } }),
    denyLink: (id) => request(`/v1/sync/links/${id}/deny`, { method: "POST", json: {} }),
    acquireLease: (task, ttlSeconds) => request(`/v1/sync/leases/${task}`, { method: "PUT", json: { ttl_seconds: ttlSeconds } }),
    releaseLease: (task) => request(`/v1/sync/leases/${task}`, { method: "DELETE" }),
    leases: () => request("/v1/sync/leases"),
    requestHandoff: (task) => request(`/v1/sync/leases/${task}/handoff`, { method: "POST", json: {} }),
    request,
  };
}

module.exports = { createCloudClient };
