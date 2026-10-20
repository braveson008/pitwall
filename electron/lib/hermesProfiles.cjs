"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { LEGACY_HERMES_PROFILE_PREFIX } = require("./legacyNames.cjs");

/**
 * Each Pitwall project runs Hermes in a Hermes profile of its own.
 *
 * A profile is a separate Hermes home: its own memory, skills, sessions, MCP
 * servers and plugins. Hermes writes what it learns into its home on its own,
 * so with one home for everything, a fact learned in one project is in its
 * prompt in every other — and Hermes's documentation warns against two agents
 * sharing a home at all. Keyed by project id rather than path: a reviewer runs
 * in a worktree, at a different path, on the same project.
 *
 * Given Hermes's profiles directory, an existing profile from an older version
 * is kept.
 */
function hermesProfileName(projectId, profilesDir = "") {
  const id = String(projectId || "").trim();
  if (!id) return "";
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 12);
  const name = `pitwall-${hash}`;
  if (!profilesDir || fs.existsSync(path.join(profilesDir, name))) return name;
  // A profile made under the old name holds what Hermes learned; it is used where it is, not renamed.
  const legacy = `${LEGACY_HERMES_PROFILE_PREFIX}${hash}`;
  return fs.existsSync(path.join(profilesDir, legacy)) ? legacy : name;
}

/** `-p <profile>` is Hermes's own flag and must come before the subcommand. */
function withHermesProfile(launch, profile) {
  if (!launch || !profile) return launch;
  const args = ["-p", profile, ...launch.args];
  return { ...launch, args, display: [launch.command, ...args].join(" "), hermesProfile: profile };
}

module.exports = { hermesProfileName, withHermesProfile };
