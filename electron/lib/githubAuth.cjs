function parseGitHubRemote(remote) {
  const value = String(remote || "").trim();
  if (!value) return { host: "github.com", repository: "", protocol: "unknown" };

  const scpMatch = value.match(/^(?:[^@]+@)?([^:/]+):(.+)$/);
  if (scpMatch && !value.includes("://")) {
    return {
      host: scpMatch[1],
      repository: normalizeRepository(scpMatch[2]),
      protocol: "ssh",
    };
  }

  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname || "github.com",
      repository: normalizeRepository(parsed.pathname),
      protocol: parsed.protocol.replace(":", "") || "unknown",
    };
  } catch {
    return { host: "github.com", repository: "", protocol: "unknown" };
  }
}

function tokenFromGitHubRemote(remote) {
  try {
    const parsed = new URL(String(remote || "").trim());
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return decodeURIComponent(parsed.password || "");
  } catch {
    return "";
  }
}

function normalizeRepository(repositoryPath) {
  const parts = String(repositoryPath || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "";
}

function parseGhAccounts(raw, host) {
  try {
    const parsed = JSON.parse(raw);
    const accounts = parsed?.hosts?.[host];
    if (!Array.isArray(accounts)) return [];
    return accounts
      .filter((account) => account?.state === "success" && account?.login)
      .map((account) => ({
        login: String(account.login),
        active: Boolean(account.active),
      }));
  } catch {
    return [];
  }
}

/**
 * Which GitHub account the machine should be on for the project being opened.
 *
 * Agents Pitwall launches already carry their project's token in their
 * environment, which takes precedence over whichever account is active. This is
 * for everything else the user touches from that project — their own terminal,
 * and any agent in a project that has no credential of its own — so that
 * opening a project does not leave `gh` pointed at the last one.
 *
 * Pure so the choice can be read and tested without running `gh`. The caller
 * holds the token; only whether one exists is needed here.
 */
function resolveAccountActivation({ record, accounts }) {
  if (!record) return { action: "prompt", reason: "unconfigured" };
  // Standing aside is a decision the user already made. See markRejected.
  if (record.rejectedAt) return { action: "none", reason: "rejected" };

  const known = Array.isArray(accounts) ? accounts : [];
  const login = String(record.login || "");
  const match = login ? known.find((account) => account.login === login) : null;

  // A project uses its own account through the token getEnvironment supplies
  // per command: GH_TOKEN overrides the active account for both git and gh, so
  // nothing machine-wide has to change.
  //
  // This used to return "switch", which ran `gh auth switch` — a global
  // mutation. Opening a project in Pitwall then changed which account every
  // terminal and every other project used, and the breakage surfaced far away
  // as "Repository not found", which is what GitHub returns for a private
  // repository the caller cannot see. Two projects on different accounts could
  // never both be right, which is the thing per-project accounts are for.
  if (match) return { action: "scoped", login };
  if (record.hasToken) return { action: "login", login };
  return { action: "prompt", reason: "unusable" };
}

module.exports = { parseGhAccounts, parseGitHubRemote, resolveAccountActivation, tokenFromGitHubRemote };
