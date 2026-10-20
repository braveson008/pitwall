import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch, RefreshCw } from "lucide-react";

/**
 * The branches of a project, against the trunk they left.
 *
 * ## Why this is not a commit graph
 *
 * A task gets a branch and a worktree, works, and merges back. Task branches
 * never merge into each other, so the shape is a star and `git log --graph`
 * would draw parallel lanes that never touch — a lot of ink for "these are
 * independent", which the reader already knew.
 *
 * The two things that are genuinely invisible are how far the trunk has moved
 * since a branch left it, and whether two branches being worked *right now*
 * are editing the same file. The second is Pitwall's alone to answer: it is
 * the only thing that knows which branches have agents in them. Two agents in
 * one file is a conflict that has already happened and nobody has noticed.
 */

interface Branch {
  name: string;
  sha: string;
  committedAt: string;
  subject: string;
  merged: boolean;
  hasSession: boolean;
  branchAhead: number;
  trunkAhead: number;
  files: string[];
  worktreePath?: string;
  state: "merged" | "working" | "empty" | "drifted" | "ahead";
  label: string;
  note: string;
}

/**
 * What each colour means, said once.
 *
 * A dot is only readable if something tells you what it stands for, and the
 * alternative — repeating the sentence on every row — turned into wallpaper
 * the moment a real repository with thirty branches was opened.
 */
const LEGEND: Array<{ state: Branch["state"]; label: string; note: string }> = [
  { state: "working", label: "working", note: "an agent is in it now" },
  { state: "drifted", label: "behind", note: "the trunk has moved a long way since it forked" },
  { state: "ahead", label: "ahead", note: "has work the trunk does not" },
  { state: "empty", label: "no commits", note: "branched but nothing committed" },
  { state: "merged", label: "merged", note: "already in the trunk — safe to delete" },
];

const BRANCH_DOT: Record<Branch["state"], string> = {
  working: "is-working",
  drifted: "is-needs",
  ahead: "is-ready",
  empty: "",
  merged: "is-quiet",
};

interface Tree {
  ok: boolean;
  error?: string;
  trunk: string;
  branches: Branch[];
  overlaps: Array<{ branches: [string, string]; files: string[] }>;
  omitted?: number;
}

/** A date a person would say out loud, not an ISO string. */
function when(value: string): string {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

export function BranchTree({
  projectPath,
  baseBranch,
  sessionBranches,
  onOpenBranch,
}: {
  projectPath: string;
  baseBranch?: string;
  /** Branches with a live agent session in them. */
  sessionBranches: string[];
  onOpenBranch?: (branch: Branch) => void;
}) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(false);
  /** Finished branches are collapsed: they are the longest part of the list
      and the least likely to be what somebody came here to look at. */
  const [showMerged, setShowMerged] = useState(false);
  /**
   * Shut until asked. The branches are context for the work waiting above
   * them, and a repository with forty of them pushed the review queue off
   * the screen entirely.
   */
  const [expanded, setExpanded] = useState(false);

  const key = sessionBranches.join(",");

  /**
   * Reads the branches once.
   *
   * Shared by the effect and the refresh button, which is the point: they had
   * been written separately, and only the effect did any of the things that
   * make a read safe. The button set no loading state, so pressing it looked
   * like nothing had happened; it caught nothing, so a rejected read became an
   * unhandled rejection; and it wrote `result as Tree` straight into state, so
   * a read that returned nothing replaced a good tree with `undefined` and the
   * whole section vanished from the page.
   *
   * `latest` is a ref rather than a flag per call: two reads in flight at once
   * should leave the newer one's answer on screen, not whichever happens to
   * land second.
   */
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const result = await window.braveli?.branchTree?.({ projectPath, baseBranch, sessionBranches });
      if (ticket !== latest.current) return;
      // Only replace what is on screen with something that is actually a
      // reading. A failed refresh leaves the last good tree where it is.
      if (result) setTree(result as Tree);
      else if (!tree) setTree(null);
    } catch {
      // The tree renders its own error when a *reading* says it failed. A
      // refresh that could not run at all leaves the last one in place rather
      // than blanking the section over a transient failure.
      if (ticket === latest.current && !tree) setTree({ ok: false, error: "Branches could not be read." } as Tree);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // `tree` is read only to decide whether there is anything worth keeping,
    // and including it would rebuild the callback after every successful read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, baseBranch, key]);

  useEffect(() => {
    void load();
    // Re-reads when a session starts or stops, since that is what changes
    // which branches are being worked — and therefore which can collide.
  }, [load]);

  if (!tree) return loading ? <p className="dk-changeset-note">Reading branches…</p> : null;
  if (!tree.ok) return <p className="dk-changeset-note">{tree.error || "Branches could not be read."}</p>;

  const attention = tree.branches.filter((branch) => branch.state === "working").length;
  const mergedCount = tree.branches.filter((branch) => branch.state === "merged").length;
  const shown = showMerged ? tree.branches : tree.branches.filter((branch) => branch.state !== "merged");

  return (
    <section className="dk-branches">
      <header className="dk-branches-head">
        <button
          type="button"
          className="dk-branches-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <strong>Branches</strong>
          <span className="dk-mono dk-faint">{tree.trunk}</span>
          {/* Collapsed, the header has to be worth reading on its own: how
              many there are, and whether any of them need attention. */}
          <span className="dk-branches-summary">
            {tree.branches.length} {tree.branches.length === 1 ? "branch" : "branches"}
            {attention > 0 ? <span className="dk-status is-working">{attention} being worked</span> : null}
            {tree.overlaps.length > 0 ? <span className="dk-status is-needs">{tree.overlaps.length} colliding</span> : null}
          </span>
        </button>
        {/* Disabled while a read is in flight, and the icon turns: a button
            that does something slow and says nothing is a button people press
            twice and then call broken. */}
        <button
          type="button"
          className="dk-icon-btn dk-icon-btn--sm"
          title={loading ? "Reading the branches…" : "Read the branches again"}
          aria-label={loading ? "Reading the branches" : "Read the branches again"}
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={12} className={loading ? "dk-spin" : ""} />
        </button>
      </header>

      {expanded ? (
      <>
      {/* What the colours mean, once. */}
      <ul className="dk-branches-legend">
        {LEGEND.map((entry) => (
          <li key={entry.state}>
            <span className={`dk-dot ${BRANCH_DOT[entry.state]}`} aria-hidden="true" />
            <strong>{entry.label.charAt(0).toUpperCase() + entry.label.slice(1)}</strong>
            <small>{entry.note}</small>
          </li>
        ))}
      </ul>

      {/* The collision warning first. Everything else here is description;
          this is the only part that is asking for a decision. */}
      {tree.overlaps.length > 0 ? (
        <div className="dk-notice is-needs dk-branches-collision">
          <AlertTriangle size={13} />
          <div>
            {tree.overlaps.map((overlap) => (
              <p key={overlap.branches.join("+")}>
                <strong>{overlap.branches[0]}</strong> and <strong>{overlap.branches[1]}</strong> are both being
                worked and both change{" "}
                {overlap.files.slice(0, 3).map((file) => <code key={file}>{file}</code>)}
                {overlap.files.length > 3 ? ` and ${overlap.files.length - 3} more` : ""}.
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <ol className="dk-branches-list">
        <li className="dk-branches-row is-trunk">
          <span className="dk-dot is-quiet" aria-hidden="true" />
          <span className="dk-branches-name dk-mono">{tree.trunk}</span>
          <span className="dk-faint">The trunk everything forks from</span>
        </li>

        {shown.map((branch) => {
          return (
            <li key={branch.name} className="dk-branches-row">
              <span className={`dk-dot ${BRANCH_DOT[branch.state]}`} aria-hidden="true" />
              <button
                type="button"
                className="dk-branches-name dk-mono"
                onClick={() => onOpenBranch?.(branch)}
                title={`Open ${branch.name} — ${branch.note}`}
              >
                <GitBranch size={11} />
                {branch.name}
              </button>

              <span className="dk-diffstat">
                {branch.branchAhead > 0 ? <em className="dk-add" title={`${branch.branchAhead} commit${branch.branchAhead === 1 ? "" : "s"} the trunk does not have`}>↑{branch.branchAhead}</em> : null}
                {/* How far the trunk has moved since this left it. The number
                    that predicts how much a rebase will hurt, and the one no
                    other screen in Pitwall shows. */}
                {branch.trunkAhead > 0 ? (
                  <em className="dk-del" title={`the trunk has ${branch.trunkAhead} commit${branch.trunkAhead === 1 ? "" : "s"} this branch does not`}>
                    ↓{branch.trunkAhead}
                  </em>
                ) : null}
              </span>

              {/* The word, not the sentence. The legend above carries the
                  meaning; repeating it on thirty rows carried nothing. */}
              <span className="dk-branches-state">{branch.label}</span>
              <span className="dk-faint">{when(branch.committedAt)}</span>

            </li>
          );
        })}
      </ol>

      {mergedCount > 0 ? (
        <button type="button" className="dk-link dk-branches-more" onClick={() => setShowMerged(!showMerged)}>
          {showMerged
            ? `Hide ${mergedCount} merged ${mergedCount === 1 ? "branch" : "branches"}`
            : `${mergedCount} merged ${mergedCount === 1 ? "branch" : "branches"} — already in ${tree.trunk}`}
        </button>
      ) : null}

      {tree.omitted ? (
        // Said rather than silently dropped: a list that stops without saying
        // so reads as the whole truth.
        <p className="dk-changeset-note">{tree.omitted} more branches not shown.</p>
      ) : null}
      </>
      ) : null}
    </section>
  );
}
