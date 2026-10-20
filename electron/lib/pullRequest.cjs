"use strict";

/**
 * Normalise the narrow JSON shape returned by `gh pr view`.
 *
 * The URL is deliberately validated here before it crosses into the renderer.
 * A branch name is not enough evidence that a pull request exists, so callers
 * must never manufacture a compare URL when this parser returns null.
 */
function parsePullRequest(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || "").trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  let url;
  try {
    url = new URL(String(value.url || ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const number = Number(value.number);
  return {
    url: url.toString(),
    number: Number.isInteger(number) && number > 0 ? number : undefined,
    title: typeof value.title === "string" ? value.title.trim().slice(0, 300) : "",
    state: typeof value.state === "string" ? value.state.trim().toLowerCase().slice(0, 40) : "",
    headRefName: typeof value.headRefName === "string" ? value.headRefName.trim().slice(0, 200) : "",
    baseRefName: typeof value.baseRefName === "string" ? value.baseRefName.trim().slice(0, 200) : "",
  };
}

function isMissingPullRequest(stderr) {
  return /no pull requests found|could not find a pull request|no pull request found/i.test(String(stderr || ""));
}

/**
 * Turns what `gh` said into something worth showing a person.
 *
 * The raw output is a GraphQL error naming a repository, which reads as though
 * the repository does not exist. It usually does — GitHub returns the same
 * message for a private repository the signed-in account cannot see, because
 * saying "you may not look at this" would confirm it is there. Passing that
 * through sent someone looking for a typo in a repository name that was
 * perfectly correct.
 */
function describePullRequestError(stderr, stdout) {
  const text = String(stderr || stdout || "").trim();

  const unresolvable = text.match(/Could not resolve to a Repository with the name '([^']+)'/);
  if (unresolvable) {
    return `The signed-in GitHub account cannot see ${unresolvable[1]}. If it is private, sign in with an account that has access — \`gh auth login\`, or connect one in Connections.`;
  }

  if (/gh auth login|not logged into|authentication required/i.test(text)) {
    return "GitHub CLI is not signed in. Run `gh auth login`, or connect an account in Connections.";
  }

  if (/could not determine|no git remotes|not a git repository/i.test(text)) {
    return "This checkout has no GitHub remote, so there is no pull request to find.";
  }

  // Unrecognised. One line of it beats a paragraph nobody reads.
  return text.split(/\r?\n/).find(Boolean) || "GitHub CLI did not say why.";
}

module.exports = { describePullRequestError, isMissingPullRequest, parsePullRequest };
