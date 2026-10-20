import { describe, expect, it } from "vitest";
import { describePullRequestError, isMissingPullRequest, parsePullRequest } from "./pullRequest.cjs";

describe("parsePullRequest", () => {
  it("keeps an authoritative HTTPS pull request result", () => {
    expect(parsePullRequest(JSON.stringify({
      url: "https://github.com/acme/app/pull/42",
      number: 42,
      title: "Ship it",
      state: "OPEN",
      headRefName: "feat/ship-it",
      baseRefName: "main",
    }))).toEqual({
      url: "https://github.com/acme/app/pull/42",
      number: 42,
      title: "Ship it",
      state: "open",
      headRefName: "feat/ship-it",
      baseRefName: "main",
    });
  });

  it("rejects malformed, non-HTTPS, and incomplete results", () => {
    expect(parsePullRequest("not json")).toBeNull();
    expect(parsePullRequest('{"url":"javascript:alert(1)"}')).toBeNull();
    expect(parsePullRequest('{"title":"No URL"}')).toBeNull();
  });
});

describe("isMissingPullRequest", () => {
  it("distinguishes no PR from an operational failure", () => {
    expect(isMissingPullRequest("no pull requests found for branch feat/x")).toBe(true);
    expect(isMissingPullRequest("authentication required")).toBe(false);
  });
});

describe("describePullRequestError", () => {
  it("explains that a repository it cannot resolve is usually one it cannot see", () => {
    const message = describePullRequestError(
      "GraphQL: Could not resolve to a Repository with the name 'acme/widgets'. (repository)",
      "",
    );
    expect(message).toContain("acme/widgets");
    expect(message).toContain("cannot see");
    // The raw text reads as "no such repository", which sends people hunting
    // for a typo in a name that is correct.
    expect(message).not.toContain("GraphQL");
  });

  it("says to sign in when that is the problem", () => {
    expect(describePullRequestError("gh auth login required", "")).toContain("gh auth login");
  });

  it("says so when there is no remote to ask about", () => {
    expect(describePullRequestError("no git remotes found", "")).toContain("no GitHub remote");
  });

  it("passes an unrecognised failure through as one line, not a wall", () => {
    expect(describePullRequestError("something odd\nstack trace line\nmore", "")).toBe("something odd");
  });

  it("never returns an empty message", () => {
    expect(describePullRequestError("", "")).toBeTruthy();
    expect(describePullRequestError(null, null)).toBeTruthy();
  });
});
