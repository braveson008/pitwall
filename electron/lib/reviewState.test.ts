import { describe, expect, it } from "vitest";
import { branchReviewFacts, openRequestForTicket, withTicketRequests, parseAheadBehind, parsePullRequestList, reflogHasOwnCommits, significantPullRequest } from "./reviewState.cjs";

const row = (over: Record<string, unknown> = {}) => ({
  headRefName: "web-963-login",
  state: "OPEN",
  number: 42,
  url: "https://github.com/owner/repo/pull/42",
  title: "Fix the login redirect",
  ...over,
});

describe("parsePullRequestList", () => {
  it("normalises state to lower case and keeps the row", () => {
    expect(parsePullRequestList(JSON.stringify([row()]))).toEqual([
      {
        headRefName: "web-963-login",
        state: "open",
        number: 42,
        url: "https://github.com/owner/repo/pull/42",
        title: "Fix the login redirect",
      },
    ]);
  });

  it("is an empty list for anything that is not a JSON array", () => {
    // gh prints an error to stdout in some failure modes; an exception here
    // would take down the whole refresh for one bad row.
    expect(parsePullRequestList("not json")).toEqual([]);
    expect(parsePullRequestList("")).toEqual([]);
    expect(parsePullRequestList(JSON.stringify({ headRefName: "x" }))).toEqual([]);
  });

  it("drops rows with no head branch, because they join to nothing", () => {
    expect(parsePullRequestList(JSON.stringify([row({ headRefName: "" }), row()]))).toHaveLength(1);
  });

  it("keeps a row whose url is unusable but drops the url", () => {
    // The state is the fact that decides the card. A missing link is a worse
    // row, not a reason to call a merged branch unmerged.
    const [parsed] = parsePullRequestList(JSON.stringify([row({ url: "javascript:alert(1)" })]));
    expect(parsed.url).toBe("");
    expect(parsed.state).toBe("open");
  });
});

const pr = (over: Record<string, unknown> = {}) => ({
  headRefName: "web-963-login", state: "open", number: 42, url: "https://example.com/1", title: "t", ...over,
});
const branch = (over: Record<string, unknown> = {}) => ({
  name: "web-963-login", merged: false, branchAhead: 3, trunkAhead: 0, ...over,
});

describe("significantPullRequest", () => {
  it("is null when a branch has none", () => {
    expect(significantPullRequest([])).toBeNull();
  });

  it("prefers merged over open, and open over closed", () => {
    // A branch can carry several pull requests. The one that decides its fate
    // is the furthest along, not the newest — a reopened-then-closed pair must
    // not hide a merge that already happened.
    expect(significantPullRequest([pr({ state: "closed" }), pr({ state: "merged" })])?.state).toBe("merged");
    expect(significantPullRequest([pr({ state: "closed" }), pr({ state: "open" })])?.state).toBe("open");
    expect(significantPullRequest([pr({ state: "closed" })])?.state).toBe("closed");
  });
});

describe("branchReviewFacts", () => {
  it("marks a branch that exists and carries its pull request", () => {
    const facts = branchReviewFacts({ branches: [branch()], pullRequests: [pr()] });
    expect(facts["web-963-login"]).toEqual({ exists: true, merged: false, branchAhead: 3, trunkAhead: 0, hasOwnCommits: true, dirty: 0, pullRequest: pr() });
  });

  it("keeps a pull request whose branch is gone locally", () => {
    // The branch was deleted after merging. The pull request is the only
    // remaining evidence and is exactly what settles the card.
    const facts = branchReviewFacts({ branches: [], pullRequests: [pr({ state: "merged" })] });
    expect(facts["web-963-login"]).toEqual({ exists: false, merged: false, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false, dirty: 0, pullRequest: pr({ state: "merged" }) });
  });

  it("reports a branch with no pull request", () => {
    expect(branchReviewFacts({ branches: [branch({ merged: true })], pullRequests: [] })["web-963-login"])
      .toEqual({ exists: true, merged: true, branchAhead: 3, trunkAhead: 0, hasOwnCommits: true, dirty: 0, pullRequest: null });
  });

  it("survives absent arguments and unnamed branches", () => {
    expect(branchReviewFacts()).toEqual({});
    expect(branchReviewFacts({ branches: [{ merged: true }], pullRequests: [] })).toEqual({});
  });
});

describe("parseAheadBehind", () => {
  it("reads every branch from one for-each-ref call", () => {
    const counts = parseAheadBehind("web-1010\t2 0\nweb-1043\t0 0\nmain\t\nweird line\n");
    expect(counts.get("web-1010")).toEqual({ branchAhead: 2, trunkAhead: 0 });
    expect(counts.get("web-1043")).toEqual({ branchAhead: 0, trunkAhead: 0 });
    expect(counts.has("main")).toBe(false);
  });
});

describe("reflogHasOwnCommits", () => {
  it("sees a branch that was only ever created as having no work of its own", () => {
    expect(reflogHasOwnCommits("branch: Created from origin/main\n")).toBe(false);
    expect(reflogHasOwnCommits("reset: moving to origin/main\nbranch: Created from origin/main\n")).toBe(false);
    expect(reflogHasOwnCommits("")).toBe(false);
  });

  it("sees commits, merges and rebased picks as work of its own", () => {
    expect(reflogHasOwnCommits("merge origin/main: Merge made by the 'ort' strategy.\ncommit: [WEB-1010] Show BT2 results\nbranch: Created from origin/main")).toBe(true);
    expect(reflogHasOwnCommits("commit (amend): fix\nbranch: Created from main")).toBe(true);
    expect(reflogHasOwnCommits("rebase (finish): refs/heads/x onto abc\nbranch: Created from main")).toBe(true);
  });
});

describe("branchReviewFacts aliases and missing", () => {
  it("answers for a worktree folder whose branch was renamed, and reports a branch asked for that is gone", () => {
    const facts = branchReviewFacts({
      branches: [{ name: "web-963-specialist-documents", aliases: ["claude-session-2"], merged: false, branchAhead: 0, trunkAhead: 3, hasOwnCommits: false, dirty: 52 }],
      missing: ["web-500"],
    });
    expect(facts["claude-session-2"]).toBe(facts["web-963-specialist-documents"]);
    expect(facts["claude-session-2"].dirty).toBe(52);
    expect(facts["web-500"]).toEqual({ exists: false, merged: false, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false, dirty: 0, pullRequest: null });
  });
});

describe("openRequestForTicket", () => {
  const rows = [
    { headRefName: "feature/ACME-2687-customer-vip-tag", state: "open", number: 394, url: "https://github.com/o/r/pull/394", title: "feat: VIP tag" },
    { headRefName: "fix/ACME-268-old", state: "open", number: 12, url: "https://github.com/o/r/pull/12", title: "old" },
    { headRefName: "feature/ACME-2600-x", state: "merged", number: 300, url: "https://github.com/o/r/pull/300", title: "x" },
  ];

  it("finds the open request an agent already made for the ticket", () => {
    expect(openRequestForTicket(rows, "acme-2687")?.number).toBe(394);
  });

  it("matches the key as a whole token, so ACME-268 is not ACME-2687", () => {
    expect(openRequestForTicket(rows, "ACME-268")?.number).toBe(12);
    expect(openRequestForTicket([rows[0]], "ACME-268")).toBeNull();
  });

  it("finds a request by its title when the branch does not carry the key", () => {
    expect(openRequestForTicket([{ ...rows[0], headRefName: "vip-tag", title: "ACME-2687: VIP tag" }], "ACME-2687")?.number).toBe(394);
  });

  it("ignores requests that are no longer open, and a task with no key", () => {
    expect(openRequestForTicket(rows, "ACME-2600")).toBeNull();
    expect(openRequestForTicket(rows, "")).toBeNull();
  });
});

describe("withTicketRequests", () => {
  const fact = { exists: true, merged: false, branchAhead: 1, trunkAhead: 0, hasOwnCommits: true, dirty: 0, pullRequest: null };
  const pr = (over: Record<string, unknown>) => ({ headRefName: "feature/ACME-2687-vip", state: "open", number: 394, url: "https://github.com/o/r/pull/394", title: "VIP", ...over });

  it("gives a task's branch the request the agent opened on its own branch", () => {
    const facts = withTicketRequests({ "acme-2687": fact }, [pr({})], { "acme-2687": "ACME-2687" });
    expect(facts["acme-2687"].pullRequest?.number).toBe(394);
  });

  it("prefers a merged request, so the task settles", () => {
    const facts = withTicketRequests({ "acme-2687": fact }, [pr({}), pr({ number: 380, state: "merged" })], { "acme-2687": "ACME-2687" });
    expect(facts["acme-2687"].pullRequest?.number).toBe(380);
  });

  it("never takes a closed request, nor replaces the branch's own", () => {
    expect(withTicketRequests({ "acme-2687": fact }, [pr({ state: "closed" })], { "acme-2687": "ACME-2687" })["acme-2687"].pullRequest).toBeNull();
    const own = { ...fact, pullRequest: pr({ headRefName: "acme-2687", number: 1 }) };
    expect(withTicketRequests({ "acme-2687": own }, [pr({})], { "acme-2687": "ACME-2687" })["acme-2687"].pullRequest?.number).toBe(1);
  });
});
