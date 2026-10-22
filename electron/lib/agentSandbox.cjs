const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * A place for an agent to keep the machine-level state its CLI insists on
 * having, so that two projects running at once cannot write over each other.
 *
 * ## What was actually going wrong
 *
 * `gh` stores one active account for the whole machine — a single `user:` line
 * in `~/.config/gh/hosts.yml`. Every process reads it, and `gh auth switch`
 * rewrites it, so an agent in one repository could change who an agent in
 * another repository was. Git was caught by the same line: the usual global
 * credential helper is `!gh auth git-credential`, which resolves whatever that
 * account currently is, so pushes and pull requests followed it too.
 *
 * ## The shape of the fix
 *
 * Each project gets a directory, and the CLIs are pointed at it:
 *
 * - `GH_CONFIG_DIR` — deliberately left empty. Pitwall already injects the
 *   project's token as `GH_TOKEN`, which is all `gh` needs to be authenticated,
 *   so nothing has to be written down: the token stays encrypted where the
 *   credential store put it, and the only copy in the clear is the environment
 *   of the process using it. `gh auth switch` finds no hosts file to edit and
 *   fails instead of reaching the real one.
 *
 * - `GIT_CONFIG_GLOBAL` — a file holding nothing but an include of the user's
 *   real `~/.gitconfig`. Their settings still apply, reads still see them, and
 *   `git config --global` from an agent lands here rather than in the file the
 *   rest of the machine shares. A repository's own `user.name` still wins, as
 *   it always did.
 *
 * ## Per project, not per session
 *
 * Agents working in the same repository are the same identity — they share its
 * worktrees and its `.git/config` already — so a sandbox each would isolate
 * them from nothing and lose anything one of them set up.
 *
 * ## What is deliberately not here
 *
 * `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are not set. They would work, and would
 * mean signing every agent's CLI in again for each project. Nobody has reported
 * those sign-ins interfering, and the cost is certain where the benefit is not.
 */

/** A directory name for a project: its id where there is one, else its path. */
function sandboxKey({ projectId, projectPath } = {}) {
  const id = String(projectId || "").trim();
  // Ids come from the renderer and end up as a path segment, so they are
  // reduced to something that cannot climb out of the sandbox root.
  if (id) return id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 120);
  const resolved = projectPath ? path.resolve(projectPath) : "";
  if (!resolved) return "";
  return crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 32);
}

/**
 * A git config value is a quoted string, so a home directory with a space in it
 * survives and one with a quote or a backslash cannot end the value early.
 */
function configPathValue(target) {
  return `"${target.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Every global config git itself would read: the XDG file, then `~/.gitconfig`, where `~` is `HOME` when set
 * (Git for Windows honours it over the user profile). GIT_CONFIG_GLOBAL replaces all of them at once.
 */
function globalGitConfigs(homeDirectory, variables) {
  const base = variables.HOME || homeDirectory;
  const xdg = variables.XDG_CONFIG_HOME || path.join(base, ".config");
  return [...new Set([path.join(xdg, "git", "config"), path.join(base, ".gitconfig")])];
}

function createAgentSandbox({ directory, homeDirectory = os.homedir(), variables = process.env }) {
  /**
   * The variables to layer over an agent's environment.
   *
   * `isolateGitHub` is the caller's answer to "is a token being injected for
   * this project" — without one, an empty `GH_CONFIG_DIR` would leave the agent
   * signed out rather than isolated, which is a worse day than sharing. So a
   * project with no connected account is left exactly as it was.
   *
   * Every failure here returns what it has rather than throwing: a sandbox that
   * could not be made is a reason to run less isolated, never a reason not to
   * start the session someone asked for.
   */
  function environment({ projectId, projectPath, isolateGitHub = false } = {}) {
    const key = sandboxKey({ projectId, projectPath });
    if (!key) return {};
    const root = path.join(directory, key);
    const gitConfig = path.join(root, "git", "config");

    const result = {};
    try {
      fs.mkdirSync(path.dirname(gitConfig), { recursive: true, mode: 0o700 });
      // Never rewritten: that would throw away whatever an agent had legitimately set for the project. A file an
      // older build wrote only gains the includes it lacks.
      const existing = fs.existsSync(gitConfig) ? fs.readFileSync(gitConfig, "utf8") : "";
      const missing = globalGitConfigs(homeDirectory, variables)
        .filter((file) => !existing.includes(`path = ${configPathValue(file)}`))
        .map((file) => `[include]\n\tpath = ${configPathValue(file)}\n`);
      if (!existing) fs.writeFileSync(gitConfig, missing.join(""), { encoding: "utf8", mode: 0o600 });
      else if (missing.length) fs.appendFileSync(gitConfig, `${existing.endsWith("\n") ? "" : "\n"}${missing.join("")}`);
      result.GIT_CONFIG_GLOBAL = gitConfig;
    } catch {
      // No git sandbox. The session still runs, against the real global config.
    }

    if (!isolateGitHub) return result;
    const ghDirectory = path.join(root, "gh");
    try {
      fs.mkdirSync(ghDirectory, { recursive: true, mode: 0o700 });
      result.GH_CONFIG_DIR = ghDirectory;
    } catch {
      // No gh sandbox either, and the injected token still authenticates it.
    }
    return result;
  }

  /**
   * Removes only the GitHub half, for an account being disconnected.
   *
   * Separate from `forget` because the git config beside it is not about
   * GitHub: an agent may have set something there for the project, and
   * disconnecting an account is no reason to throw that away.
   */
  function forgetGitHub({ projectId, projectPath } = {}) {
    const key = sandboxKey({ projectId, projectPath });
    if (!key) return false;
    try {
      fs.rmSync(path.join(directory, key, "gh"), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Removes a project's sandbox, for a project being removed from Pitwall. */
  function forget({ projectId, projectPath } = {}) {
    const key = sandboxKey({ projectId, projectPath });
    if (!key) return false;
    try {
      fs.rmSync(path.join(directory, key), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  return { environment, forget, forgetGitHub };
}

module.exports = { createAgentSandbox, sandboxKey };
