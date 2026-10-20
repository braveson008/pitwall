"use strict";

/**
 * Where a project's code lives, and how Pitwall talks to it.
 *
 * Git itself is host-agnostic, and most of Pitwall only ever uses git. The rest
 * — finding the request for a branch, listing them for Review, opening one for
 * a scheduled run, and the per-project account — went through `gh`, so a
 * project on GitLab got GitHub errors and a prompt to add a GitHub account it
 * had no use for. GitLab is driven through `glab`, which mirrors `gh` closely;
 * a host with neither gets the host's own "new request" page and an honest
 * sentence instead of an error.
 */

const KINDS = {
  github: { kind: "github", label: "GitHub", cli: "gh", requestNoun: "pull request", requestShort: "PR" },
  gitlab: { kind: "gitlab", label: "GitLab", cli: "glab", requestNoun: "merge request", requestShort: "MR" },
  bitbucket: { kind: "bitbucket", label: "Bitbucket", cli: null, requestNoun: "pull request", requestShort: "PR" },
  other: { kind: "other", label: "Git host", cli: null, requestNoun: "pull request", requestShort: "PR" },
};

/**
 * The host and repository path of a remote URL.
 *
 * Unlike the GitHub parser this keeps the whole path: GitLab projects live in
 * nested groups (`group/subgroup/project`), and cutting that to two segments
 * names a project that does not exist.
 */
function parseRemote(remote) {
  const value = String(remote || "").trim();
  if (!value) return { host: "", repository: "", protocol: "unknown" };
  const clean = (pathname) => String(pathname || "").replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");

  const scp = value.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scp && !value.includes("://")) return { host: scp[1].toLowerCase(), repository: clean(scp[2]), protocol: "ssh" };
  try {
    const parsed = new URL(value);
    return { host: parsed.hostname.toLowerCase(), repository: clean(parsed.pathname), protocol: parsed.protocol.replace(":", "") || "unknown" };
  } catch {
    return { host: "", repository: "", protocol: "unknown" };
  }
}

/**
 * Which kind of host this is, from its name alone, or null when the name does
 * not say — a self-hosted instance at git.example.com could be either, and the
 * caller asks the CLIs.
 */
function kindFromHostname(host) {
  const name = String(host || "").toLowerCase();
  if (!name) return null;
  if (name === "github.com" || name.endsWith(".ghe.com") || /(^|[.-])github([.-]|$)/.test(name)) return "github";
  if (name === "gitlab.com" || /(^|[.-])gitlab([.-]|$)/.test(name)) return "gitlab";
  if (name === "bitbucket.org" || /(^|[.-])bitbucket([.-]|$)/.test(name)) return "bitbucket";
  return null;
}

function describeHost(kind, host = "") {
  return { ...(KINDS[kind] || KINDS.other), host };
}

/** The web page where a person opens a request for a branch, or "" when unknown. */
function newRequestUrl({ kind, host, repository, branch, base }) {
  if (!host || !repository || !branch) return "";
  const root = `https://${host}/${repository}`;
  const enc = encodeURIComponent;
  if (kind === "github") return `${root}/compare/${base ? `${enc(base)}...` : ""}${enc(branch)}?expand=1`;
  if (kind === "gitlab") {
    return `${root}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(branch)}${base ? `&merge_request%5Btarget_branch%5D=${enc(base)}` : ""}`;
  }
  if (kind === "bitbucket") return `${root}/pull-requests/new?source=${enc(branch)}${base ? `&dest=${enc(base)}` : ""}`;
  return "";
}

/** GitLab says "opened"; the rest of Pitwall speaks GitHub's words for state. */
function gitlabState(state) {
  const value = String(state || "").toLowerCase();
  if (value === "opened") return "open";
  if (value === "locked") return "closed";
  return value;
}

function gitlabRequest(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return {
    url: item.web_url,
    number: item.iid,
    title: item.title,
    state: gitlabState(item.state),
    headRefName: item.source_branch,
    baseRefName: item.target_branch,
  };
}

/**
 * `glab mr view -F json`, reshaped as `gh pr view --json …` so one validator
 * (pullRequest.cjs) checks both and nothing downstream knows the difference.
 */
function gitlabViewAsGitHub(stdout) {
  try {
    const shaped = gitlabRequest(JSON.parse(String(stdout || "").trim()));
    return shaped ? JSON.stringify(shaped) : "";
  } catch {
    return "";
  }
}

/** `glab mr list -F json`, reshaped as `gh pr list --json …` for reviewState.cjs. */
function gitlabListAsGitHub(stdout) {
  try {
    const value = JSON.parse(String(stdout || "").trim());
    return Array.isArray(value) ? JSON.stringify(value.map(gitlabRequest).filter(Boolean)) : "[]";
  } catch {
    return "[]";
  }
}

/**
 * What glab actually said, as one line.
 *
 * glab reports a failure twice: a JSON object, then a framed "ERROR" heading
 * with the message wrapped across lines at the terminal's width. Reading the
 * first line gave the heading alone — the Review page said "ERROR" and nothing
 * else — and the wrap split "401 Unauthorized" so no rule could recognise it.
 */
function glabMessage(stderr, stdout) {
  const text = `${stderr || ""}\n${stdout || ""}`;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const message = JSON.parse(trimmed)?.error?.message;
      if (typeof message === "string" && message.trim()) return message.replace(/\s+/g, " ").trim();
    } catch {
      // Not the error object; keep looking.
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^error$/i.test(line) && !line.startsWith("{"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingMergeRequest(stderr, stdout = "") {
  return /no (?:open )?merge requests? (?:available|found)|merge request not found|404 not found|404 \{message: 404/i.test(glabMessage(stderr, stdout));
}

function describeGlabError(stderr, stdout) {
  const text = glabMessage(stderr, stdout);
  if (/glab auth login|not authenticated|401\b|unauthorized|no token/i.test(text)) {
    return "GitLab CLI is not signed in, or its token has expired. Run `glab auth login`, or connect an account for this project.";
  }
  if (/403\b|forbidden/i.test(text)) return "The GitLab account in use cannot see this project.";
  if (/no git remotes|not a git repository|could not find|none of the git remotes/i.test(text)) {
    return "This checkout has no GitLab remote, so there is no merge request to find.";
  }
  if (/already exists/i.test(text)) return text.slice(0, 300);
  return text.slice(0, 300) || "GitLab CLI did not say why.";
}

/** The first https URL a CLI printed, which is how both report a created request. */
function firstHttpsUrl(text) {
  return String(text || "").split(/\s+/).find((word) => /^https:\/\//.test(word)) || "";
}

/**
 * The environment that makes git and the host's CLI act as one account.
 *
 * Tokens travel in variables, never on a command line, and the git credential
 * helper reads the token from the environment so it never lands in a config
 * file. GitHub expects `x-access-token` as the user name; GitLab accepts any
 * name with a token and documents `oauth2`.
 */
function tokenEnvironment({ kind, host, token }) {
  if (!token || !host) return {};
  let cli;
  if (kind === "gitlab") {
    cli = { GITLAB_TOKEN: token, GITLAB_HOST: host };
  } else if (host === "github.com" || host.endsWith(".ghe.com")) {
    cli = { GH_TOKEN: token, GITHUB_TOKEN: token };
  } else {
    cli = { GH_ENTERPRISE_TOKEN: token, GITHUB_ENTERPRISE_TOKEN: token, GH_HOST: host };
  }
  const user = kind === "gitlab" ? "oauth2" : "x-access-token";
  const credentialKey = `credential.https://${host}.helper`;
  return {
    ...cli,
    PITWALL_GIT_TOKEN: token,
    // Kept for agents and scripts written against the old name.
    PITWALL_GITHUB_TOKEN: token,
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: credentialKey,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: credentialKey,
    GIT_CONFIG_VALUE_1: `!f() { if [ "$1" = get ]; then printf '%s\\n' 'username=${user}' "password=$PITWALL_GIT_TOKEN"; fi; }; f`,
    GIT_CONFIG_KEY_2: `credential.https://${host}.useHttpPath`,
    GIT_CONFIG_VALUE_2: "true",
  };
}

/**
 * Why requests cannot be read on a host Pitwall has no CLI for. A repository
 * with no remote at all is the common case, and calling that "a remote it does
 * not recognise" sent people looking for a remote that is not there.
 */
function unsupportedHostMessage(host) {
  if (!host) return "this project has no remote, so there are no requests to read.";
  return `Pitwall reads requests from GitHub and GitLab, and this project is on ${host}.`;
}

/** Where a host's REST API answers "who is this token". */
function identityEndpoint({ kind, host }) {
  if (kind === "gitlab") return { hostname: host, path: "/api/v4/user", loginField: "username" };
  if (host === "github.com") return { hostname: "api.github.com", path: "/user", loginField: "login" };
  return { hostname: host, path: "/api/v3/user", loginField: "login" };
}

/** Where a host's REST API answers "can this token see the repository". */
function repositoryEndpoint({ kind, host, repository }) {
  if (!repository) return null;
  if (kind === "gitlab") return { hostname: host, path: `/api/v4/projects/${encodeURIComponent(repository)}` };
  if (host === "github.com") return { hostname: "api.github.com", path: `/repos/${repository}` };
  return { hostname: host, path: `/api/v3/repos/${repository}` };
}

module.exports = {
  describeGlabError,
  glabMessage,
  describeHost,
  firstHttpsUrl,
  gitlabListAsGitHub,
  gitlabViewAsGitHub,
  identityEndpoint,
  isMissingMergeRequest,
  kindFromHostname,
  newRequestUrl,
  parseRemote,
  repositoryEndpoint,
  tokenEnvironment,
  unsupportedHostMessage,
};
