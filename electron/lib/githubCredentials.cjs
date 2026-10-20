const fs = require("node:fs");
const path = require("node:path");
const { identityEndpoint, repositoryEndpoint, tokenEnvironment } = require("./codeHost.cjs");

function defaultState() {
  return { version: 1, projects: {} };
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.version === 1 && parsed.projects ? parsed : defaultState();
  } catch {
    return defaultState();
  }
}

function normalizeProjectPath(projectPath) {
  return projectPath ? path.resolve(projectPath) : "";
}

/**
 * Asks the host whether a token is still accepted.
 *
 * Separated and injectable so the store's logic is testable without a network,
 * and so the store itself never has to know about HTTP.
 */
function requestTokenIdentity({ host, token, kind = "github" }) {
  const https = require("node:https");
  const { hostname, path, loginField } = identityEndpoint({ kind, host });
  return new Promise((resolve) => {
    const request = https.request(
      { hostname, path, method: "GET", timeout: 10_000,
        // Both hosts take a personal access token as a bearer token.
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Pitwall" } },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          let login = "";
          try { login = JSON.parse(body)?.[loginField] || ""; } catch { /* not JSON */ }
          resolve({ status: response.statusCode || 0, ok: response.statusCode === 200, login });
        });
      },
    );
    // A host Pitwall cannot reach says nothing about the token, so this resolves
    // with no verdict rather than condemning a credential that may be fine.
    request.on("error", () => resolve(null));
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.end();
  });
}

/** Whether a token can see a repository: true, false, or null when the host could not be asked. */
function requestRepositoryAccess({ host, token, kind = "github", repository }) {
  const endpoint = repositoryEndpoint({ kind, host, repository });
  if (!endpoint) return Promise.resolve(null);
  const https = require("node:https");
  return new Promise((resolve) => {
    const request = https.request(
      { ...endpoint, method: "GET", timeout: 10_000,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Pitwall" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode === 200));
      },
    );
    request.on("error", () => resolve(null));
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.end();
  });
}

function createGitHubCredentialStore(filePath, encryption) {
  let state = readState(filePath);

  function encryptionAvailable() {
    try {
      return Boolean(encryption?.isEncryptionAvailable?.());
    } catch {
      return false;
    }
  }

  function write() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Some platforms do not expose POSIX permissions.
    }
  }

  /**
   * The record for a project, by id where the caller knows it and by path
   * otherwise.
   *
   * The path fallback takes the freshest match rather than the first one it
   * finds. A project removed and added again gets a new id, so the same folder
   * can hold more than one record, and object key order is insertion order —
   * which handed every path-only caller the oldest credential the folder had
   * ever had. The account screen, which knows the id, showed the new one at the
   * same time: connected in the dialog, refused by the API, with nothing on
   * screen able to explain the difference.
   */
  function freshness(record) {
    return Date.parse(record.verifiedAt || record.updatedAt || "") || 0;
  }

  function findRecord({ projectId, projectPath }) {
    if (projectId && state.projects[projectId]) return state.projects[projectId];
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return null;
    const matches = Object.values(state.projects).filter((record) => record.projectPath === normalizedPath);
    if (!matches.length) return null;
    // A usable one before a refused one, then the most recently confirmed.
    return matches.sort((a, b) => (Number(Boolean(a.rejectedAt)) - Number(Boolean(b.rejectedAt))) || (freshness(b) - freshness(a)))[0];
  }

  return {
    getStatus(payload = {}) {
      const record = findRecord(payload);
      return {
        configured: Boolean(record),
        encryptionAvailable: encryptionAvailable(),
        host: record?.host || "github.com",
        kind: record?.kind || "github",
        login: record?.login || "",
        source: record?.source || "gh",
        updatedAt: record?.updatedAt || null,
        rejectedAt: record?.rejectedAt || null,
        rejectedReason: record?.rejectedReason || "",
      };
    },
    remember({ projectId, projectPath, host = "github.com", kind = "github", login, token, source = "gh" }) {
      if (!projectId || !projectPath) throw new Error("Project id and path are required");
      if (!token) throw new Error("A token is required");
      if (!encryptionAvailable()) throw new Error("Secure credential storage is unavailable on this system");

      const encryptedToken = encryption.encryptString(token).toString("base64");
      // One record per folder. Connecting an account is how someone replaces
      // the credential for a project, and leaving the old one behind under a
      // stale id meant it could still be picked by anything asking by path.
      const normalized = normalizeProjectPath(projectPath);
      for (const [id, record] of Object.entries(state.projects)) {
        if (id !== projectId && record.projectPath === normalized) delete state.projects[id];
      }
      state.projects[projectId] = {
        projectId,
        projectPath: normalizeProjectPath(projectPath),
        host,
        kind,
        login: login || "",
        source,
        encryptedToken,
        updatedAt: new Date().toISOString(),
        // A freshly supplied token is not known to be bad, whatever the last
        // one did.
        rejectedAt: null,
        rejectedReason: "",
      };
      write();
      return this.getStatus({ projectId });
    },
    /**
     * Records that GitHub refused this credential.
     *
     * Kept because a dead token here is worse than no token at all: Pitwall
     * injects it as GH_TOKEN, which takes precedence over the user's own gh
     * login and over the keychain, so a stale credential silently breaks
     * authentication that would otherwise have worked.
     */
    markRejected(payload = {}, reason = "") {
      const record = findRecord(payload);
      if (!record) return this.getStatus(payload);
      record.rejectedAt = new Date().toISOString();
      record.rejectedReason = String(reason || "").slice(0, 200);
      write();
      return this.getStatus(payload);
    },
    forget(payload = {}) {
      const record = findRecord(payload);
      if (record) {
        delete state.projects[record.projectId];
        write();
      }
      return this.getStatus(payload);
    },
    /**
     * Checks the stored credential against the host and records the verdict.
     *
     * Nothing else ever noticed a token going bad: it was stored once and
     * injected forever, so a rotated or expired token kept being handed to
     * every agent — where, as GH_TOKEN, it also shadowed the user's own working
     * gh login. Only an outright refusal condemns a credential; an unreachable
     * host leaves it as it was.
     */
    async verify(payload = {}, request = requestTokenIdentity) {
      const record = findRecord(payload);
      if (!record || !encryptionAvailable()) return this.getStatus(payload);
      let token = "";
      try {
        token = encryption.decryptString(Buffer.from(record.encryptedToken, "base64"));
      } catch {
        return this.getStatus(payload);
      }
      if (!token) return this.getStatus(payload);

      const kind = record.kind || "github";
      const result = await request({ host: record.host, token, kind });
      if (!result) return this.getStatus(payload);
      if (result.status === 401) {
        return this.markRejected(payload, `${kind === "gitlab" ? "GitLab" : "GitHub"} rejected this token. Sign in again to replace it.`);
      }
      if (result.ok) {
        record.rejectedAt = null;
        record.rejectedReason = "";
        record.verifiedAt = new Date().toISOString();
        if (result.login) record.login = result.login;
        write();
      }
      return this.getStatus(payload);
    },
    /** The project's sign-in as it is, for Pitwall Cloud to carry (encrypted) to the person's other computers. */
    exportCredential(payload = {}) {
      const record = findRecord(payload);
      if (!record || record.rejectedAt || !encryptionAvailable()) return null;
      try {
        const token = encryption.decryptString(Buffer.from(record.encryptedToken, "base64"));
        return token ? { host: record.host, kind: record.kind || "github", login: record.login || "", source: record.source || "gh", token } : null;
      } catch {
        return null;
      }
    },
    getEnvironment(payload = {}) {
      const record = findRecord(payload);
      if (!record || !encryptionAvailable()) return {};
      // Standing aside lets the agent's own gh login and keychain be used. See
      // markRejected: injecting a refused token overrides both of them.
      if (record.rejectedAt) return {};
      try {
        const token = encryption.decryptString(Buffer.from(record.encryptedToken, "base64"));
        if (!token) return {};
        return tokenEnvironment({ kind: record.kind || "github", host: record.host, token });
      } catch {
        return {};
      }
    },
  };
}

module.exports = { createGitHubCredentialStore, requestRepositoryAccess, requestTokenIdentity };
