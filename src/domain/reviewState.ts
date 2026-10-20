/**
 * What the repository says about a task's branch.
 *
 * This is computed on every render and never stored. That is the whole point:
 * a status written once and reconciled by nothing is what left cards reading
 * "review requested" for work that merged last week. A derived value cannot
 * disagree with git, because there is nothing for it to disagree with.
 */
export type ReviewState = "orphaned" | "done" | "rejected" | "proposed" | "working";

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  orphaned: "no branch",
  done: "done",
  rejected: "closed",
  proposed: "pr open",
  working: "working",
};

/** States that still want a person. `done` is everything else. */
export const LISTED_REVIEW_STATES: ReviewState[] = ["orphaned", "rejected", "proposed", "working"];

/**
 * The conditions overlap, so order decides. Orphaned comes first because a
 * task with no branch would otherwise look like a branch that has been tidied
 * away. A merge beats a closed pull request because merging is the later fact.
 */
export function reviewStateFor(
  branch: string,
  facts: Record<string, ReviewBranchFacts>,
): ReviewState {
  const name = String(branch || "").trim();
  if (!name) return "orphaned";

  const fact = facts[name];
  // Not asked about, or not answered: no evidence, so nothing is settled.
  if (!fact) return "working";

  const pullRequestState = fact.pullRequest?.state || "";
  if (pullRequestState === "merged") return "done";
  // Work still on disk is not finished, whatever the branch says.
  if ((fact.dirty ?? 0) > 0) return "working";

  // `git branch --merged` lists a branch whose tip is an ancestor of the
  // trunk — true of work that merged, and equally true of a branch nobody has
  // committed to. Only a branch that ever carried a commit of its own can
  // have merged; the trunk moving says nothing, because in a busy repository
  // it moves within minutes of every branch being created.
  if (fact.merged && (fact.hasOwnCommits ?? fact.branchAhead > 0)) return "done";
  // A branch that was asked for and is now absent is work you finished with:
  // deleting a branch is deliberate.
  if (!fact.exists) return "done";
  if (pullRequestState === "closed") return "rejected";
  if (pullRequestState === "open") return "proposed";
  return "working";
}
