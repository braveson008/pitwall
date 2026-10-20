import { useEffect, useState, type CSSProperties } from "react";
import { parseUnifiedDiff, gutterWidth } from "../lib/diffLines";

/**
 * What a branch contains, compared with the trunk it left.
 *
 * Two panes, because that is the shape of the question: which files, and what
 * happened in this one. A list you have to expand a row at a time makes you
 * lose your place between the file you are reading and the rest of the change.
 *
 * Separate from `TaskChangeset`, which looks similar and answers something
 * different: that diffs a task's *worktree* against a fork point, which is
 * right on the review screen and wrong here. Most branches have no worktree,
 * so it falls back to whatever the project directory is checked out on and
 * reports a branch full of work as "0 files changed" — worse than showing
 * nothing, because it looks like an answer.
 */

interface Changes {
  ok: boolean;
  error?: string;
  base?: string;
  /** What it was actually measured against, which is often not the trunk. */
  forkedFrom?: string;
  files: PitwallChangedFile[];
  additions: number;
  deletions: number;
}

/**
 * Files nobody opens a diff to read.
 *
 * Changesets are sorted biggest-first, so on a real branch the first file is
 * almost always a lockfile — two thousand lines of machine-written churn, and
 * the worst possible thing to open automatically.
 */
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum)$|(^|\/)dist\//;

/** Past this, a patch is something to open deliberately, not automatically. */
const AUTO_OPEN_LINES = 400;

/** Beyond this a patch is truncated: the browser is not a pager. */
const MAX_PATCH_LINES = 2000;

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  conflicted: "!",
};

interface BranchChangesProps {
  projectPath: string;
  branch: string;
  trunk: string;
}

export function BranchChanges(props: BranchChangesProps) {
  const [revision, setRevision] = useState(0);
  return (
    <section className="dk-branch-changes" aria-label={`Changes on ${props.branch}`}>
      <button className="dk-link dk-changeset-refresh" type="button" onClick={() => setRevision((value) => value + 1)}>Refresh branch diff</button>
      <BranchChangesContent key={JSON.stringify([props.projectPath, props.branch, props.trunk, revision])} {...props} />
    </section>
  );
}

function BranchChangesContent({
  projectPath,
  branch,
  trunk,
}: BranchChangesProps) {
  /**
   * Opens the file where you are looking, in the editor you already use.
   *
   * The alternative to embedding an editor: a click on line 47 lands on line
   * 47 in the tool with your keybindings, your extensions and your language
   * server. Pitwall does not need to be a worse version of that.
   */
  const openAtLine = (filePath: string, line?: number) => {
    void window.pitwall?.openFileInEditor?.({ projectPath, branch, filePath, line });
  };
  const [changes, setChanges] = useState<Changes | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [patchError, setPatchError] = useState("");
  const [patchAttempt, setPatchAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        if (typeof window.pitwall?.branchChanges !== "function") {
          // The preload is loaded once when a window is created, so a window
          // older than this feature has no such method. Saying that beats an
          // empty pane, which looks like a branch with nothing in it.
          if (!cancelled) {
            setChanges({ ok: false, error: "This window was opened before branch diffs existed — restart Pitwall.", files: [], additions: 0, deletions: 0 });
          }
          return;
        }
        const result = (await window.pitwall.branchChanges({ projectPath, branch, trunk })) as Changes | undefined;
        if (cancelled) return;
        setChanges(result ?? { ok: false, error: "No answer from git.", files: [], additions: 0, deletions: 0 });
        // Open something worth reading straight away — but not a lockfile,
        // and not a two-thousand-line patch. Arriving at a list and having to
        // click before seeing anything answers nothing; opening the largest
        // generated file in the branch is worse.
        const worthOpening = result?.files?.find((file) =>
          !file.binary
          && !GENERATED.test(file.path)
          && file.additions + file.deletions <= AUTO_OPEN_LINES);
        setSelected(worthOpening?.path ?? "");
      } catch (error) {
        if (!cancelled) setChanges({ ok: false, error: error instanceof Error ? error.message : "Could not read this branch.", files: [], additions: 0, deletions: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, branch, trunk]);

  useEffect(() => {
    if (!selected || !changes?.base || patches[selected] !== undefined) return;
    let cancelled = false;
    setPatchError("");
    void (async () => {
      try {
        const result = await window.pitwall?.branchFileDiff?.({
          projectPath,
          branch,
          base: changes.base as string,
          filePath: selected,
        });
        if (cancelled) return;
        if (!result?.ok) {
          setPatchError(result?.error || "Could not read this patch.");
          return;
        }
        setPatches((current) => ({ ...current, [selected]: result.diff }));
      } catch (error) {
        if (!cancelled) setPatchError(error instanceof Error ? error.message : "Could not read this patch.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, changes?.base, projectPath, branch, patches, patchAttempt]);

  if (loading) return <p className="dk-changeset-note">Reading the branch…</p>;
  // Never nothing: an empty pane reads as "this branch changed nothing", which
  // is a claim, and the wrong one.
  if (!changes) return <p className="dk-changeset-note">Nothing came back for this branch.</p>;
  if (!changes.ok) return <p className="dk-changeset-note">{changes.error || "Could not read this branch."}</p>;
  if (changes.files.length === 0) {
    return <p className="dk-changeset-note">Nothing on this branch that is not already in {trunk}.</p>;
  }

  const patch = patches[selected];
  const selectedFile = changes.files.find((file) => file.path === selected);

  return (
    <div className="dk-branchdiff">
      <div className="dk-branchdiff-files">
        <p className="dk-branchdiff-total">
          {changes.files.length} {changes.files.length === 1 ? "file" : "files"}
          <span className="dk-add">+{changes.additions}</span>
          <span className="dk-del">−{changes.deletions}</span>
          {/* Named because it is frequently not the trunk: a branch carrying
              merges from other long-lived branches forked somewhere else, and
              the numbers mean nothing without knowing from what. */}
          {changes.forkedFrom ? <em className="dk-faint">since {changes.forkedFrom}</em> : null}
        </p>
        <ul>
          {changes.files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                className={`dk-branchdiff-file${file.path === selected ? " is-current" : ""}`}
                onClick={() => { if (file.path !== selected) setPatchError(""); setSelected(file.path); }}
                title={file.path}
              >
                <em className={`dk-changeset-status is-${file.status}`}>{STATUS_LETTER[file.status] ?? "?"}</em>
                {/* Name and directory share one cell so the name always has
                    room: as two grid columns the name could be squeezed to
                    nothing by a long path, and the list showed status letters
                    and counts with no filenames at all. */}
                <span className="dk-branchdiff-name">{file.path.split("/").pop()}</span>
                <span className="dk-diffstat">
                  <span className="dk-add">+{file.additions}</span>
                  <span className="dk-del">−{file.deletions}</span>
                </span>
                {file.path.includes("/") ? (
                  <span className="dk-branchdiff-dir">{file.path.split("/").slice(0, -1).join("/")}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="dk-branchdiff-patch">
        {!selected ? (
          <p className="dk-changeset-note">Pick a file to read its diff.</p>
        ) : selectedFile?.binary ? (
          <p className="dk-changeset-note">Binary file — no text diff to show.</p>
        ) : patchError ? (
          <p className="dk-changeset-note" role="alert">{patchError} <button className="dk-link" type="button" onClick={() => setPatchAttempt((value) => value + 1)}>Retry patch</button></p>
        ) : patch === undefined ? (
          <p className="dk-changeset-note">Reading the patch…</p>
        ) : patch.trim() === "" ? (
          <p className="dk-changeset-note">No textual change in this file.</p>
        ) : (
          <>
            <p className="dk-branchdiff-path">
              <button type="button" className="dk-link dk-mono" onClick={() => openAtLine(selected)}>
                {selected}
              </button>
            </p>
            {(() => {
              const lines = parseUnifiedDiff(patch).slice(0, MAX_PATCH_LINES);
              const width = gutterWidth(lines);
              return (
                <div className="dk-diff" style={{ "--gutter": `${width}ch` } as CSSProperties}>
                  {lines.map((line, index) => {
                    if (line.kind === "hunk") {
                      // A rule, not a line of `@@` arithmetic — the numbers
                      // beside every line already say where you are.
                      return (
                        <div className="dk-diff-hunk" key={index}>
                          <span>{line.label}</span>
                        </div>
                      );
                    }
                    if (line.kind === "meta") {
                      return <div className="dk-diff-hunk" key={index}>{line.text}</div>;
                    }
                    return (
                      <div
                        className={`dk-diff-line is-${line.kind}`}
                        key={index}
                        onDoubleClick={() => openAtLine(selected, line.newNo ?? line.oldNo)}
                        title="Double-click to open this line in your editor"
                      >
                        <span className="dk-diff-no">{line.oldNo ?? ""}</span>
                        <span className="dk-diff-no">{line.newNo ?? ""}</span>
                        {/* A sign as well as a colour: a diff that is only
                            colour is unreadable to a good many people. */}
                        <span className="dk-diff-sign" aria-hidden="true">
                          {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                        </span>
                        <span className="dk-diff-code">{line.text || " "}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {parseUnifiedDiff(patch).length > MAX_PATCH_LINES ? (
              <p className="dk-changeset-note">
                {parseUnifiedDiff(patch).length - MAX_PATCH_LINES} more lines not shown.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
