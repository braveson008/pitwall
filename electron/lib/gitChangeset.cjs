/**
 * What an agent actually changed while working on a task.
 *
 * The question a reviewer is asking is "what did this run do to my code", and
 * the honest answer is everything on the task's branch since it left the base —
 * committed or not. That is a different question from the one `git:status`
 * answers (uncommitted work right now) and from `git diff base..branch` (which
 * also shows anything the base gained in the meantime, none of which the agent
 * wrote).
 *
 * So the comparison point is the merge base. Diffing from there to the working
 * tree covers commits the agent made and edits it left behind, and excludes
 * everything that happened on main while it worked.
 *
 * Files git is not tracking are kept apart from that. Whatever they are —
 * Pitwall's own transcripts, a tool's output directory, a scratch file — they
 * cannot be in a pull request, because nothing has committed them. Counting
 * them alongside the change makes the review disagree with the PR it is about,
 * which is the one comparison a reviewer is certain to make.
 */

/** `git diff --numstat` — additions, deletions, path. Binary files report "-". */
function parseNumstat(stdout) {
  const stats = new Map();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [additions, deletions, ...rest] = line.split("\t");
    const path = normalisePath(rest.join("\t"));
    if (!path) continue;
    stats.set(path, {
      // A binary file has no line counts, which is different from having none.
      binary: additions === "-" || deletions === "-",
      additions: additions === "-" ? null : Number(additions),
      deletions: deletions === "-" ? null : Number(deletions),
    });
  }
  return stats;
}

/**
 * `git diff --name-status` — a status letter and a path.
 *
 * Renames and copies arrive as `R100\told\tnew`, with the letter carrying a
 * similarity score. The score is not interesting to a reviewer; which file it
 * became is.
 */
function parseNameStatus(stdout) {
  const entries = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]?.[0] ?? "";
    if (code === "R" || code === "C") {
      const from = parts[1];
      const to = parts[2];
      if (!to) continue;
      entries.push({ path: to, from, status: code === "R" ? "renamed" : "copied" });
      continue;
    }
    const path = parts[1];
    if (!path) continue;
    entries.push({ path, from: null, status: statusFromCode(code) });
  }
  return entries;
}

function statusFromCode(code) {
  switch (code) {
    case "A": return "added";
    case "D": return "deleted";
    case "M": return "modified";
    case "T": return "typechange";
    case "U": return "conflicted";
    default: return "modified";
  }
}

/**
 * Numstat writes a rename as `{old => new}/file` or `old => new`, which does not
 * match the plain path name-status gives. Reduced to the destination so the two
 * lists can be joined.
 */
function normalisePath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const braced = value.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/{2,}/g, "/");
  const arrow = value.split(" => ");
  return arrow.length === 2 ? arrow[1] : value;
}

/** Joins the two listings into one row per file, largest change first. */
function buildChangeset(nameStatusOut, numstatOut) {
  const stats = parseNumstat(numstatOut);
  const all = parseNameStatus(nameStatusOut).map((entry) => {
    const stat = stats.get(entry.path) || {};
    return {
      path: entry.path,
      from: entry.from,
      status: entry.status,
      binary: Boolean(stat.binary),
      additions: stat.additions ?? 0,
      deletions: stat.deletions ?? 0,
    };
  });

  const files = all.sort(bySize);

  return {
    files,
    // Filled in by the caller, which is the only place that can ask git what it
    // is not tracking.
    untrackedFiles: [],
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

/** Largest change first, so a reviewer starts where the work is. */
function bySize(a, b) {
  return b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path);
}

/**
 * Which branch a task actually forked from.
 *
 * Pitwall recorded a project's default branch once, at the time it was added,
 * and compared every task against it forever. A repository that works on `dev`
 * and keeps `main` for releases then produced a review of six hundred and
 * thirty-nine files for a task that touched three — because the fork point with
 * `main` was three months and a hundred and seventy-four commits ago, and every
 * one of those commits landed in the diff.
 *
 * Nothing about that was detectable from inside: the number was enormous but it
 * was a real diff, correctly computed, against the wrong thing.
 *
 * So the base is not recorded, it is found: of the branches this one could have
 * come from, the answer is whichever shares the most recent history with it. A
 * fork point six hours old beats one three months old, whatever either branch
 * happens to be called — which is what makes this hold for a repository whose
 * conventions nobody here has seen.
 *
 * @param candidates {Array<{ ref: string, mergeBase: string, at: number }>}
 *        every candidate that resolved, with the timestamp of its fork point.
 */
function nearestForkPoint(candidates) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) => candidate && candidate.mergeBase && Number.isFinite(candidate.at),
  );
  if (usable.length === 0) return null;

  // Newest fork point wins. A tie goes to the earlier candidate, which is the
  // caller's stated preference — the branch it believed it was working from.
  return usable.reduce((best, candidate) => (candidate.at > best.at ? candidate : best));
}

/** The branches worth asking about, most likely first, without duplicates. */
function forkCandidates(recorded, branches) {
  const known = new Set(Array.isArray(branches) ? branches : []);
  const ordered = [];
  const add = (ref) => {
    const name = String(ref || "").trim();
    if (!name || ordered.includes(name) || !known.has(name)) return;
    ordered.push(name);
  };

  // What the project says first: on a repository that follows the convention it
  // is both correct and the cheapest answer.
  add(recorded);
  for (const name of ["main", "master", "dev", "develop", "trunk"]) {
    add(name);
    add(`origin/${name}`);
  }
  if (recorded) add(`origin/${recorded}`);
  return ordered;
}


/**
 * Which branch new task branches should be cut from.
 *
 * Fork-point discovery answers this for a branch that already exists. A branch
 * about to be created has no history to read, so the question is the harder
 * one: which branch is this repository's working trunk?
 *
 * The recorded default is one answer and `origin/HEAD` is another, and in the
 * repository that prompted this both said `main` while all the work happened on
 * `dev`. Pitwall cut acme-2581 from `main` accordingly — three months and a
 * hundred and seventy-four commits behind — and somebody had to reset the
 * branch onto `origin/dev` by hand before the agent could do anything useful.
 * The reflog still reads `branch: Created from main`, then `reset: moving to
 * origin/dev`.
 *
 * Names cannot settle it, because both repositories use the same two and mean
 * opposite things by them. What separates them is motion: `dev` had a commit
 * six hours ago and `origin/main` had one five months ago. A trunk nobody has
 * committed to since spring is not where today's work starts, whatever it is
 * called.
 *
 * So: of the branches that could be a trunk, the one still moving. On a
 * repository that develops on `main`, `main` is also the one still moving and
 * nothing changes.
 *
 * @param candidates {Array<{ ref: string, at: number }>} trunk-shaped branches
 *        with the timestamp of their tip.
 */
function livingTrunk(candidates) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) => candidate && candidate.ref && Number.isFinite(candidate.at),
  );
  if (usable.length === 0) return null;

  // A tie leaves the caller's stated preference standing: it is asked first.
  return usable.reduce((best, candidate) => (candidate.at > best.at ? candidate : best));
}

module.exports = {
  buildChangeset,
  bySize,
  parseNameStatus,
  parseNumstat,
  normalisePath,
  nearestForkPoint,
  forkCandidates,
  livingTrunk,
};
