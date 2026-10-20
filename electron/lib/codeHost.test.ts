import { describe, expect, it } from "vitest";
import codeHost from "./codeHost.cjs";
import reviewState from "./reviewState.cjs";
import pullRequest from "./pullRequest.cjs";

const {
  describeGlabError,
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
} = codeHost;

describe("parseRemote", () => {
  it("keeps a GitLab project's whole group path", () => {
    expect(parseRemote("git@gitlab.com:acme/platform/payments-api.git")).toEqual({
      host: "gitlab.com",
      repository: "acme/platform/payments-api",
      protocol: "ssh",
    });
    expect(parseRemote("https://gitlab.example.com/acme/platform/payments-api.git")).toMatchObject({
      host: "gitlab.example.com",
      repository: "acme/platform/payments-api",
      protocol: "https",
    });
  });

  it("reads ssh:// remotes with a port, and nothing from an empty one", () => {
    expect(parseRemote("ssh://git@git.example.com:2222/team/app.git")).toMatchObject({ host: "git.example.com", repository: "team/app" });
    expect(parseRemote("")).toEqual({ host: "", repository: "", protocol: "unknown" });
  });
});

describe("kindFromHostname", () => {
  it("knows the public hosts and hosts that name themselves", () => {
    expect(kindFromHostname("github.com")).toBe("github");
    expect(kindFromHostname("acme.ghe.com")).toBe("github");
    expect(kindFromHostname("gitlab.com")).toBe("gitlab");
    expect(kindFromHostname("gitlab.acme.io")).toBe("gitlab");
    expect(kindFromHostname("bitbucket.org")).toBe("bitbucket");
  });

  it("leaves an anonymous self-hosted name for the CLIs to identify", () => {
    expect(kindFromHostname("git.example.com")).toBeNull();
    // A word inside another word is not the host's name.
    expect(kindFromHostname("notgitlabby.com")).toBeNull();
  });
});

describe("describeHost", () => {
  it("names GitLab's request a merge request and drives it with glab", () => {
    expect(describeHost("gitlab", "gitlab.com")).toMatchObject({ label: "GitLab", cli: "glab", requestNoun: "merge request" });
    expect(describeHost("bitbucket", "bitbucket.org")).toMatchObject({ cli: null, requestNoun: "pull request" });
    expect(describeHost("nonsense")).toMatchObject({ kind: "other", cli: null });
  });
});

describe("GitLab merge requests in GitHub's shape", () => {
  const mr = {
    iid: 42,
    title: "Retry failed webhooks",
    state: "opened",
    source_branch: "pay-214",
    target_branch: "main",
    web_url: "https://gitlab.com/acme/payments/-/merge_requests/42",
  };

  it("reads `glab mr view -F json` through the same validator as gh", () => {
    expect(pullRequest.parsePullRequest(gitlabViewAsGitHub(JSON.stringify(mr)))).toEqual({
      url: mr.web_url,
      number: 42,
      title: "Retry failed webhooks",
      state: "open",
      headRefName: "pay-214",
      baseRefName: "main",
    });
    expect(gitlabViewAsGitHub("not json")).toBe("");
  });

  it("reads `glab mr list -F json` into Review's states", () => {
    const list = [mr, { ...mr, iid: 7, state: "merged", source_branch: "pay-209" }, { ...mr, iid: 3, state: "locked", source_branch: "x" }];
    const rows = reviewState.parsePullRequestList(gitlabListAsGitHub(JSON.stringify(list)));
    expect(rows.map((row: { headRefName: string; state: string; number?: number }) => [row.headRefName, row.state, row.number])).toEqual([
      ["pay-214", "open", 42],
      ["pay-209", "merged", 7],
      ["x", "closed", 3],
    ]);
    expect(gitlabListAsGitHub("{}")).toBe("[]");
  });

  it("tells a branch with no merge request from a failure", () => {
    expect(isMissingMergeRequest('no open merge request available for "pay-214"')).toBe(true);
    expect(isMissingMergeRequest("404 Not Found")).toBe(true);
    expect(isMissingMergeRequest("401 Unauthorized")).toBe(false);
    expect(describeGlabError("ERROR: 401 Unauthorized", "")).toMatch(/glab auth login/);
    expect(describeGlabError("", "")).toBe("GitLab CLI did not say why.");
  });

  it("reads glab's framed, wrapped error rather than its heading", () => {
    const stderr = [
      '{"error":{"message":"GET https://gitlab.com/api/v4/projects/a%2Fb/merge_requests: 401 {message: 401 Unauthorized}"}}',
      "          ",
      "   ERROR  ",
      "          ",
      "  Get https://gitlab.com/api/v4/projects/a%2Fb/merge_requests: 401 {message: 401             ",
      "  Unauthorized}.                                                                              ",
    ].join("\n");
    expect(describeGlabError(stderr, "")).toMatch(/not signed in/);
    // Without the JSON line the wrapped box alone still reads as one sentence.
    expect(describeGlabError(stderr.split("\n").slice(1).join("\n"), "")).toMatch(/not signed in/);
    expect(describeGlabError("\n   ERROR  \n\n  Something odd\n  happened.  \n", "")).toBe("Something odd happened.");
  });

  it("finds the URL glab prints for a created merge request", () => {
    expect(firstHttpsUrl("Creating merge request for pay-214 into main in acme/payments\n\n!42 Retry (pay-214)\n https://gitlab.com/acme/payments/-/merge_requests/42\n")).toBe(
      "https://gitlab.com/acme/payments/-/merge_requests/42",
    );
  });
});

describe("newRequestUrl", () => {
  it("builds each host's own new-request page", () => {
    expect(newRequestUrl({ kind: "gitlab", host: "gitlab.com", repository: "acme/platform/app", branch: "feat/x", base: "main" })).toBe(
      "https://gitlab.com/acme/platform/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx&merge_request%5Btarget_branch%5D=main",
    );
    expect(newRequestUrl({ kind: "bitbucket", host: "bitbucket.org", repository: "acme/app", branch: "x" })).toBe(
      "https://bitbucket.org/acme/app/pull-requests/new?source=x",
    );
    expect(newRequestUrl({ kind: "github", host: "github.com", repository: "acme/app", branch: "x", base: "main" })).toBe(
      "https://github.com/acme/app/compare/main...x?expand=1",
    );
  });

  it("offers nothing it would have to guess", () => {
    expect(newRequestUrl({ kind: "other", host: "git.example.com", repository: "a/b", branch: "x" })).toBe("");
    expect(newRequestUrl({ kind: "gitlab", host: "gitlab.com", repository: "", branch: "x" })).toBe("");
  });
});

describe("tokenEnvironment", () => {
  it("gives glab its token and git a GitLab-shaped credential", () => {
    const environment = tokenEnvironment({ kind: "gitlab", host: "gitlab.example.com", token: "glpat-secret" });
    expect(environment).toMatchObject({ GITLAB_TOKEN: "glpat-secret", GITLAB_HOST: "gitlab.example.com", PITWALL_GIT_TOKEN: "glpat-secret" });
    expect(environment.GH_TOKEN).toBeUndefined();
    expect(environment.GIT_CONFIG_KEY_1).toBe("credential.https://gitlab.example.com.helper");
    expect(environment.GIT_CONFIG_VALUE_1).toContain("username=oauth2");
    // The token stays in the environment; it is never written into the helper.
    expect(environment.GIT_CONFIG_VALUE_1).not.toContain("glpat-secret");
  });

  it("keeps GitHub's variables as they were", () => {
    expect(tokenEnvironment({ kind: "github", host: "github.com", token: "t" })).toMatchObject({ GH_TOKEN: "t", GITHUB_TOKEN: "t" });
    expect(tokenEnvironment({ kind: "github", host: "git.corp.com", token: "t" })).toMatchObject({ GH_ENTERPRISE_TOKEN: "t", GH_HOST: "git.corp.com" });
    expect(tokenEnvironment({ kind: "github", host: "github.com", token: "t" }).GIT_CONFIG_VALUE_1).toContain("username=x-access-token");
    expect(tokenEnvironment({ kind: "gitlab", host: "gitlab.com", token: "" })).toEqual({});
  });
});

describe("API endpoints", () => {
  it("asks GitLab's v4 API and encodes a nested project path", () => {
    expect(identityEndpoint({ kind: "gitlab", host: "gitlab.com" })).toEqual({ hostname: "gitlab.com", path: "/api/v4/user", loginField: "username" });
    expect(repositoryEndpoint({ kind: "gitlab", host: "gitlab.com", repository: "acme/platform/app" })).toEqual({
      hostname: "gitlab.com",
      path: "/api/v4/projects/acme%2Fplatform%2Fapp",
    });
    expect(identityEndpoint({ kind: "github", host: "github.com" })).toMatchObject({ hostname: "api.github.com", path: "/user" });
  });
});

describe("unsupportedHostMessage", () => {
  it("says a repository with no remote has none, rather than an unrecognised one", () => {
    expect(unsupportedHostMessage("")).toBe("this project has no remote, so there are no requests to read.");
    expect(unsupportedHostMessage("git.example.com")).toMatch(/this project is on git\.example\.com\.$/);
  });
});
