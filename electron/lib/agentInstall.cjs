/**
 * Installing an agent's CLI from inside Pitwall.
 *
 * Pitwall runs every agent through its own CLI, so a CLI that is not
 * installed is the one thing it cannot work around — and the answer, until
 * now, was a command printed on a row for you to copy into a terminal
 * yourself.
 *
 * Three things decide whether Pitwall should offer to run it instead:
 *
 *   Whether we know the command at all. `providers.ts` deliberately leaves
 *   `installCommand` empty where nobody has confirmed one, on the grounds
 *   that a wrong install command is worse than none. That holds here: an
 *   Install button that runs a guess is worse than a link to the docs.
 *
 *   Whether the tool the command needs exists. Every command we know is an
 *   `npm install -g`, and npm is not on every machine — a fair number of
 *   people install these through Homebrew instead. Failing with "npm: command
 *   not found" after a click is worse than saying so before one.
 *
 *   Whether it is safe to run. This executes third-party code, so the command
 *   is shown before it runs and the output is shown while it does. Nothing
 *   here ever runs on its own.
 */

/** The tool a shell command invokes first — `npm` in `npm install -g x`. */
function commandTool(installCommand) {
  const first = String(installCommand || "").trim().split(/\s+/)[0] || "";
  // A leading environment assignment is not the tool: `FOO=1 npm install`.
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(first) ? "" : first;
}

/**
 * Whether a command is one Pitwall is willing to run for you.
 *
 * Only the shapes we publish. A command arriving from anywhere else — a
 * provider definition edited by hand, a future registry — is shown rather
 * than executed, because "install" is exactly the word an attacker would
 * choose for a button that runs arbitrary shell.
 */
const RUNNABLE = [
  /^npm install -g (@[a-z0-9-]+\/)?[a-z0-9._-]+$/i,
  /^npm i -g (@[a-z0-9-]+\/)?[a-z0-9._-]+$/i,
  // Homebrew, including a tapped formula: `charmbracelet/tap/crush`.
  /^brew install [a-z0-9._-]+(\/[a-z0-9._-]+){0,2}$/i,
  // uv and pipx, for the agents published to PyPI rather than npm.
  /^uv tool install [a-z0-9._-]+$/i,
  /^pipx install [a-z0-9._-]+$/i,
  // winget, Windows' own package manager, by exact package id.
  /^winget install --id [a-z0-9._-]+ -e$/i,
];

/**
 * Nothing with shell punctuation in it, whatever else it matches.
 *
 * The shapes above are anchored, so this is belt and braces — but the cost of
 * being wrong here is running arbitrary code on somebody's machine, and a
 * second check that cannot be reasoned around is worth its four lines.
 */
const SHELL_METACHARACTERS = /[;&|<>$`\\(){}\[\]!*?~\n\r]/;

function isRunnable(installCommand) {
  const command = String(installCommand || "").trim();
  if (SHELL_METACHARACTERS.test(command)) return false;
  return RUNNABLE.some((shape) => shape.test(command));
}

/**
 * What the Install action should do for one provider.
 *
 * @param provider  { installCommand, installDocs, command, displayName }
 * @param tools     which tools are present, e.g. `{ npm: true }`
 */
function installPlan(provider, tools = {}) {
  const command = String(provider?.installCommand || "").trim();
  const docs = String(provider?.installDocs || "").trim();

  if (!command) {
    return {
      action: docs ? "docs" : "none",
      docs,
      reason: "Pitwall does not know a confirmed install command for this agent.",
    };
  }

  if (!isRunnable(command)) {
    return {
      action: "copy",
      command,
      docs,
      reason: "This command is not one of the forms Pitwall runs for you. Run it yourself to see exactly what it does.",
    };
  }

  const tool = commandTool(command);
  if (tool && tools[tool] === false) {
    return {
      action: "copy",
      command,
      docs,
      reason: `${tool} is not installed, so this command cannot run here. Install ${tool}, or use the agent's own instructions.`,
    };
  }

  return { action: "run", command, docs, tool, reason: "" };
}

/**
 * Whether an install looks like it worked.
 *
 * The exit code alone is not enough: `npm install -g` exits 0 having printed
 * a permissions warning and installed nothing on a system Node, which is the
 * most common way this fails. The check that matters is whether the command
 * the provider is launched by exists afterwards, and that is done by the same
 * provider check the rest of Pitwall uses.
 */
function installOutcome({ exitCode, installedAfter }) {
  if (installedAfter) return { ok: true, message: "" };
  if (exitCode !== 0) {
    return { ok: false, message: `The install command exited with code ${exitCode}.` };
  }
  return {
    ok: false,
    message:
      "The install command finished without an error, but the CLI still is not on your PATH. " +
      "A global npm install can report success and write nothing when it lacks permission, " +
      "or install somewhere your shell does not look.",
  };
}

module.exports = { installPlan, isRunnable, commandTool, installOutcome };
