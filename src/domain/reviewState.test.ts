import { describe, expect, it } from "vitest";
import { REVIEW_STATE_LABEL, reviewStateFor } from "./reviewState";

// ReviewBranchFacts is an ambient global from src/vite-env.d.ts — not imported.
const facts = (over: Partial<ReviewBranchFacts> = {}): Record<string, ReviewBranchFacts> => ({
  "web-963": { exists: true, merged: false, branchAhead: 3, trunkAhead: 0, hasOwnCommits: true, dirty: 0, pullRequest: null, ...over },
});
const withPr = (state: string) =>
  facts({ pullRequest: { headRefName: "web-963", state, url: "", title: "" } });

describe("reviewStateFor", () => {
  it("is orphaned when the task recorded no branch", () => {
    // Tested before everything else: an empty branch name would otherwise
    // satisfy "the recorded branch no longer exists" and be called done, when
    // the run in fact produced nothing.
    expect(reviewStateFor("", facts())).toBe("orphaned");
  });

  it("is done when the branch merged into the trunk", () => {
    expect(reviewStateFor("web-963", facts({ merged: true, trunkAhead: 4 }))).toBe("done");
  });

  it("is working for a branch with no commits that git calls merged", () => {
    // `git branch --merged` lists a branch whose tip is an ancestor of the
    // trunk, which is true of a branch created a minute ago. Calling that done
    // made a task vanish from Review before its agent had committed anything.
    expect(reviewStateFor("web-963", facts({ merged: true, branchAhead: 0, trunkAhead: 0, hasOwnCommits: false }))).toBe("working");
  });

  it("is working for a branch nobody committed to, however far the trunk has moved", () => {
    // The trunk moving was taken as proof of a merge. In a busy repository it
    // moves within minutes, and every agent's uncommitted work settled as done.
    expect(reviewStateFor("web-963", facts({ merged: true, branchAhead: 0, trunkAhead: 40, hasOwnCommits: false }))).toBe("working");
  });

  it("is working while the worktree holds uncommitted work", () => {
    expect(reviewStateFor("web-963", facts({ merged: true, branchAhead: 0, hasOwnCommits: true, dirty: 21 }))).toBe("working");
    expect(reviewStateFor("web-963", facts({ dirty: 3 }))).toBe("working");
  });

  it("is done when the pull request merged, even with leftovers on disk", () => {
    expect(reviewStateFor("web-963", { "web-963": { ...facts()["web-963"], dirty: 2, pullRequest: { headRefName: "web-963", state: "merged", url: "", title: "" } } })).toBe("done");
  });

  it("is still done when a merged branch has fallen behind a moving trunk", () => {
    expect(reviewStateFor("web-963", facts({ merged: true, branchAhead: 0, trunkAhead: 12 }))).toBe("done");
  });

  it("is done when the pull request merged", () => {
    expect(reviewStateFor("web-963", withPr("merged"))).toBe("done");
  });

  it("is done when the recorded branch no longer exists", () => {
    expect(reviewStateFor("web-963", facts({ exists: false, branchAhead: 0, hasOwnCommits: false }))).toBe("done");
  });

  it("is working when there are no facts for the branch at all", () => {
    // Absent facts meant "deleted" — and a capped branch list left every task
    // branch past the fortieth without facts, so they all settled as done.
    expect(reviewStateFor("web-963", {})).toBe("working");
  });

  it("prefers a merge over an earlier closed pull request", () => {
    expect(reviewStateFor("web-963", facts({
      merged: true,
      trunkAhead: 3,
      pullRequest: { headRefName: "web-963", state: "closed", url: "", title: "" },
    }))).toBe("done");
  });

  it("is rejected when a pull request closed without merging", () => {
    expect(reviewStateFor("web-963", withPr("closed"))).toBe("rejected");
  });

  it("is proposed while a pull request is open", () => {
    expect(reviewStateFor("web-963", withPr("open"))).toBe("proposed");
  });

  it("is working for a live branch with no pull request", () => {
    expect(reviewStateFor("web-963", facts())).toBe("working");
  });

  it("is working for a branch with no commits yet", () => {
    // Not orphaned: the branch is there, the agent simply has not committed.
    expect(reviewStateFor("web-963", facts({ branchAhead: 0 }))).toBe("working");
  });

  it("labels every state", () => {
    for (const state of ["orphaned", "done", "rejected", "proposed", "working"] as const) {
      expect(REVIEW_STATE_LABEL[state]).toBeTruthy();
    }
  });
});
