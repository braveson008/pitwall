/**
 * The branches a project is actually working, and how far apart they have got.
 *
 * ## Why this is not a commit graph
 *
 * The obvious thing to draw is `git log --graph`, and it is the wrong shape
 * for what Pitwall does. A task gets a branch and a worktree, works, and
 * merges back to the trunk; task branches never merge into each other. The
 * topology is a star, so a commit graph draws parallel lanes that never
 * interact — a great deal of ink for "these are all independent", which the
 * user already knew.
 *
 * What is not obvious, and what nobody can see without asking git several
 * questions, is how far each branch has drifted from the trunk since it left,
 * and whether two branches being worked right now are editing the same files.
 * The second one is Pitwall's alone: it is the only thing that knows which
 * branches have live agent sessions in them. Two agents editing one file is a
 * conflict that has already happened and nobody has noticed yet.
 */

/** `git rev-list --left-right --count trunk...branch` → both sides. */
function parseDivergence(output) {
  const [left, right] = String(output || "").trim().split(/\s+/);
  const trunkAhead = Number.parseInt(left, 10);
  const branchAhead = Number.parseInt(right, 10);
  return {
    trunkAhead: Number.isFinite(trunkAhead) ? trunkAhead : 0,
    branchAhead: Number.isFinite(branchAhead) ? branchAhead : 0,
  };
}

/** One tab-separated line of `git for-each-ref`, in the order we ask for it. */
function parseRefLine(line) {
  const [name, sha, date, ...subject] = String(line || "").split("\t");
  if (!name) return null;
  return {
    name,
    sha: sha || "",
    committedAt: date || "",
    subject: subject.join("\t") || "",
  };
}

function parseRefs(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map(parseRefLine)
    .filter(Boolean);
}

/**
 * How far behind the trunk a branch may fall before it is worth saying so.
 *
 * Not a measure of danger on its own — a hundred commits touching other parts
 * of the tree cost nothing. It is the point at which a rebase stops being
 * free, and it is paired with the overlap check, which is the part that
 * actually predicts a conflict.
 */
const DRIFT_WARNING = 25;

/**
 * What state a branch is in, in the order the answers matter.
 *
 * "Merged" comes first because a merged branch is finished whatever else is
 * true of it, and the useful thing to do with it is delete it. "Working" beats
 * every other description because a branch with an agent in it right now is
 * not stale, however old its last commit.
 */
function branchState({ merged, hasSession, branchAhead, trunkAhead }) {
  if (merged) return "merged";
  if (hasSession) return "working";
  if (branchAhead === 0) return "empty";
  if (trunkAhead >= DRIFT_WARNING) return "drifted";
  return "ahead";
}

/**
 * A word for the row, and a sentence for the legend.
 *
 * The sentence used to sit on every row, which read well with three branches
 * and became wallpaper with thirty — the same line repeated down the screen,
 * carrying nothing per row. The row gets the word; the legend explains it
 * once, where somebody looks when they want to know what a colour means.
 */
const STATE_LABEL = {
  merged: "merged",
  working: "working",
  empty: "no commits",
  drifted: "behind",
  ahead: "ahead",
};

const STATE_NOTE = {
  merged: "Merged into the trunk. Safe to delete.",
  working: "An agent is working in this one now.",
  empty: "No commits of its own yet.",
  drifted: `The trunk has moved ${DRIFT_WARNING}+ commits since it forked.`,
  ahead: "Has work the trunk does not.",
};

/**
 * Branches that are being worked at the same time and touch the same files.
 *
 * Only live ones are compared. Two finished branches that both edited a file
 * is history; two agents editing it right now is a conflict being written as
 * you watch, and the only moment when saying so is any use.
 */
function fileOverlaps(branches) {
  const live = branches.filter((branch) => branch.hasSession && branch.files?.length);
  const pairs = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      const shared = a.files.filter((file) => b.files.includes(file));
      if (shared.length) pairs.push({ branches: [a.name, b.name], files: shared });
    }
  }
  return pairs;
}

/**
 * The tree, ordered the way somebody reads it.
 *
 * The trunk first, then what is being worked, then what is waiting, then what
 * is finished — which is the order things need attention in, rather than
 * alphabetical or by date.
 */
const STATE_ORDER = { working: 0, drifted: 1, ahead: 2, empty: 3, merged: 4 };

function buildBranchTree({ trunk, branches }) {
  const decorated = branches
    .filter((branch) => branch.name !== trunk)
    .map((branch) => {
      const state = branchState(branch);
      return { ...branch, state, label: STATE_LABEL[state], note: STATE_NOTE[state] };
    })
    .sort((a, b) => {
      const byState = (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9);
      if (byState !== 0) return byState;
      return String(b.committedAt).localeCompare(String(a.committedAt));
    });

  return {
    trunk,
    branches: decorated,
    overlaps: fileOverlaps(decorated),
  };
}

module.exports = {
  DRIFT_WARNING,
  STATE_LABEL,
  STATE_NOTE,
  parseDivergence,
  parseRefs,
  parseRefLine,
  branchState,
  fileOverlaps,
  buildBranchTree,
};
