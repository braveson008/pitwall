"use strict";

const { createHash } = require("node:crypto");

/**
 * Each Pitwall project runs Hermes in a Hermes profile of its own.
 *
 * A profile is a separate Hermes home: its own memory, skills, sessions, MCP
 * servers and plugins. Hermes writes what it learns into its home on its own,
 * so with one home for everything, a fact learned in one project is in its
 * prompt in every other — and Hermes's documentation warns against two agents
 * sharing a home at all. Keyed by project id rather than path: a reviewer runs
 * in a worktree, at a different path, on the same project.
 */
function hermesProfileName(projectId) {
  const id = String(projectId || "").trim();
  return id ? `braveli-${createHash("sha256").update(id).digest("hex").slice(0, 12)}` : "";
}

/** `-p <profile>` is Hermes's own flag and must come before the subcommand. */
function withHermesProfile(launch, profile) {
  if (!launch || !profile) return launch;
  const args = ["-p", profile, ...launch.args];
  return { ...launch, args, display: [launch.command, ...args].join(" "), hermesProfile: profile };
}

module.exports = { hermesProfileName, withHermesProfile };
