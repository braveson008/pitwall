"use strict";

/**
 * What git and GitHub say about the branches behind review cards.
 *
 * The review list used to render from a stored status that nothing reconciled,
 * so a branch merged on GitHub kept its card forever. This module gathers the
 * facts that settle the question instead. It knows nothing about tasks or the
 * screen: it answers "what is true of this branch", and the renderer decides
 * what that means.
 */

/**
 * One `gh pr list --json ...` row, validated.
 *
 * Every field is defended because this is parsed output from a program that
 * prints errors to stdout in some failure modes. A malformed row is dropped
 * rather than thrown on: one bad entry must not cost the whole refresh.
 */
function parsePullRequestList(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || "").trim());
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  const rows = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const headRefName = typeof item.headRefName === "string" ? item.headRefName.trim().slice(0, 200) : "";
    if (!headRefName) continue;

    // A row that cannot be linked is still evidence about the branch, so the
    // url is dropped rather than the row. Same rule as pullRequest.cjs: never
    // manufacture a link, but never discard a state because a link was bad.
    let url = "";
    try {
      const parsed = new URL(String(item.url || ""));
      if (parsed.protocol === "https:") url = parsed.toString();
    } catch {
      url = "";
    }

    const number = Number(item.number);
    rows.push({
      headRefName,
      state: typeof item.state === "string" ? item.state.trim().toLowerCase().slice(0, 40) : "",
      number: Number.isInteger(number) && number > 0 ? number : undefined,
      url,
      title: typeof item.title === "string" ? item.title.trim().slice(0, 300) : "",
    });
  }
  return rows;
}

/**
 * How far along a pull request is. A branch can carry several, and the one
 * that decides its fate is the furthest along rather than the most recent.
 */
const PULL_REQUEST_RANK = { merged: 3, open: 2, closed: 1 };

function significantPullRequest(rows) {
  let best = null;
  for (const row of rows || []) {
    if ((PULL_REQUEST_RANK[row?.state] ?? 0) > (PULL_REQUEST_RANK[best?.state] ?? 0)) best = row;
  }
  return best;
}

/**
 * `for-each-ref --format=%(refname:short)%09%(ahead-behind:<trunk>)`, one call
 * for every branch instead of a capped `rev-list` per branch.
 */
function parseAheadBehind(stdout) {
  const counts = new Map();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const [name, pair] = line.split("\t");
    const match = String(pair || "").trim().match(/^(\d+)\s+(\d+)$/);
    if (!name || !match) continue;
    counts.set(name.trim(), { branchAhead: Number(match[1]), trunkAhead: Number(match[2]) });
  }
  return counts;
}

/**
 * Whether a branch ever carried work of its own, from its reflog subjects.
 *
 * `git branch --merged` lists a branch whose tip is an ancestor of the trunk,
 * which a branch nobody has committed to is from the moment it is created.
 * Counting only commits ahead cannot tell that apart from work that merged,
 * and waiting for the trunk to move does not either: in a busy repository it
 * moves within minutes, and every agent's uncommitted work read as merged.
 */
function reflogHasOwnCommits(stdout) {
  return String(stdout || "").split(/\r?\n/).some((line) =>
    /^(commit|merge |cherry-pick|revert|rebase[^:]*\((pick|finish|continue)\))/.test(line.trim()));
}

/**
 * Branch facts keyed by branch name.
 *
 * Both directions matter. A branch with no pull request is ordinary work in
 * progress; a pull request whose branch is gone locally is the merged-and-
 * tidied case, and dropping it would lose the only evidence that settles it.
 * A branch may also be asked for by its worktree's folder name, which is what
 * a task records when the agent renamed the branch it works on.
 */
function branchReviewFacts({ branches = [], pullRequests = [], missing = [] } = {}) {
  const byBranch = new Map();
  for (const row of pullRequests) {
    if (!row?.headRefName) continue;
    const rows = byBranch.get(row.headRefName) || [];
    rows.push(row);
    byBranch.set(row.headRefName, rows);
  }

  const facts = {};
  for (const branch of branches) {
    if (!branch?.name) continue;
    facts[branch.name] = {
      exists: true,
      merged: Boolean(branch.merged),
      branchAhead: Number(branch.branchAhead) || 0,
      trunkAhead: Number(branch.trunkAhead) || 0,
      hasOwnCommits: Boolean(branch.hasOwnCommits) || (Number(branch.branchAhead) || 0) > 0,
      dirty: Number(branch.dirty) || 0,
      pullRequest: significantPullRequest(byBranch.get(branch.name)),
    };
  }
  for (const branch of branches) {
    for (const alias of branch?.aliases || []) {
      if (alias && !facts[alias] && facts[branch.name]) facts[alias] = facts[branch.name];
    }
  }

  for (const name of missing) {
    if (!facts[name] && !byBranch.has(name)) {
      facts[name] = { exists: false, merged: false, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false, dirty: 0, pullRequest: null };
    }
  }

  for (const [name, rows] of byBranch) {
    if (facts[name]) continue;
    facts[name] = { exists: false, merged: false, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false, dirty: 0, pullRequest: significantPullRequest(rows) };
  }
  return facts;
}

/** Whether a request's branch or title names the ticket as a whole key: ACME-268 is not ACME-2687. */
function carriesTicket(ticket) {
  const key = String(ticket || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) return null;
  const token = new RegExp(`(^|[^A-Za-z0-9])${key}(?!\\d)`, "i");
  return (row) => token.test(row?.headRefName || "") || token.test(row?.title || "");
}

/**
 * The open request already carrying a ticket. An agent often cuts its own
 * branch and opens the request itself, on a name Pitwall never chose; a second
 * request for the same ticket is the one thing the person did not want.
 */
function openRequestForTicket(rows, ticket) {
  const carries = carriesTicket(ticket);
  return carries ? (rows || []).find((row) => row?.state === "open" && carries(row)) || null : null;
}

/**
 * A task's branch with no request of its own takes the one carrying its
 * ticket, when that is open or merged. Closed is left out: an abandoned
 * earlier attempt says nothing about this work.
 */
function withTicketRequests(facts, pullRequests, tickets) {
  const result = { ...facts };
  for (const [branch, ticket] of Object.entries(tickets || {})) {
    const fact = result[branch];
    if (!fact || fact.pullRequest) continue;
    const carries = carriesTicket(ticket);
    if (!carries) continue;
    const rows = (pullRequests || []).filter((row) => (row?.state === "open" || row?.state === "merged") && carries(row));
    const found = significantPullRequest(rows);
    if (found) result[branch] = { ...fact, pullRequest: found };
  }
  return result;
}

module.exports = { withTicketRequests, openRequestForTicket, parsePullRequestList, significantPullRequest, branchReviewFacts, parseAheadBehind, reflogHasOwnCommits };
