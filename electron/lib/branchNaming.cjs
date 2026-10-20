"use strict";

/**
 * A branch name the repository will accept.
 *
 * Pitwall names a task's branch before any work exists (`acme-2687`), and a
 * repository with a branch-name ruleset refuses it at push time — GitHub with
 * GH013, GitLab through its push rules. The repository's own branches show its
 * convention, so the name is read off them: the prefix most branches carry in
 * front of a ticket key (`feature/`, `fix/`, `bugfix/`), then the ticket, then
 * a few words of the title.
 */

const TICKET = /([A-Za-z][A-Za-z0-9]*-\d+)/;

function isBranchRuleRejection(text) {
  return /\bGH013\b|repository rule violations|branch name .*(?:not allowed|does not match|is not valid)|push rules|pre-receive hook declined[\s\S]*branch/i.test(String(text || ""));
}

function slug(title, words = 5) {
  return String(title || "")
    .replace(/^[A-Za-z][A-Za-z0-9]*-\d+[:\s-]*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join("-");
}

/** Remote branch names out of `git ls-remote --heads`. */
function parseRemoteHeads(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.split("\t")[1] || "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length));
}

/**
 * @param remoteBranches  the repository's branch names
 * @param rejected        the name the repository just refused; its prefix is never reused
 * @param ticket          the task's key, e.g. "ACME-2687"
 * @param title           the task's title, for the words after the key
 */
function conventionalBranchName({ remoteBranches = [], rejected = "", ticket = "", title = "" }) {
  // Branches that predate a ruleset still sit on the remote, so a refused
  // prefix can be the commonest one; retrying with it is refused again.
  const refused = rejected ? rejected.slice(0, rejected.lastIndexOf("/") + 1) : undefined;
  const project = (ticket.match(/^[A-Za-z][A-Za-z0-9]*/) || [""])[0].toUpperCase();
  const keyed = [];
  for (const name of remoteBranches) {
    const match = name.match(TICKET);
    if (!match || match.index === undefined) continue;
    const prefix = name.slice(0, match.index);
    if ((prefix && !/\/$/.test(prefix)) || prefix === refused) continue;
    keyed.push({ prefix, key: match[1] });
  }
  const own = keyed.filter((entry) => entry.key.split("-")[0].toUpperCase() === project);
  const pool = own.length ? own : keyed;
  const prefixes = new Map();
  let upper = 0;
  let lower = 0;
  for (const { prefix, key } of pool) {
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    if (key === key.toUpperCase()) upper += 1;
    else lower += 1;
  }
  let prefix = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (prefix === undefined) {
    // No ticket-keyed branches to learn from: the most common folder, if any.
    const folders = new Map();
    for (const name of remoteBranches) {
      const folder = name.includes("/") ? `${name.split("/")[0]}/` : "";
      if (folder && folder !== refused) folders.set(folder, (folders.get(folder) || 0) + 1);
    }
    prefix = [...folders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "feature/";
  }
  const key = ticket ? (lower > upper ? ticket.toLowerCase() : ticket.toUpperCase()) : "";
  const words = slug(title);
  return `${prefix}${[key, words].filter(Boolean).join("-")}`.replace(/-+$/, "") || `${prefix}work`;
}

module.exports = { conventionalBranchName, isBranchRuleRejection, parseRemoteHeads };
