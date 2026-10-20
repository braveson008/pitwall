import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileDiff, MessageSquarePlus, SquarePen } from "lucide-react";
import { LARGE_DIFF_LINES, countLines, parseDiff, type DiffHunk } from "../lib/diff";
import { highlightHunks, languageFromPath, type Token } from "../lib/highlight";
import { shortcutLabel } from "../lib/shortcutLabel";

type PatchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; hunks: DiffHunk[]; tokens: Token[][][]; truncated: boolean };

const STATUS_LABEL: Record<PitwallChangedFile["status"], string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  typechange: "type changed",
  conflicted: "conflicted",
};

/**
 * What the agent changed, in the place the change is being judged.
 *
 * The review card already asserts that work happened; this is the evidence for
 * it. Loaded when it is asked for rather than with the card, because a task can
 * touch tens of files and a review page can list many tasks — and read on
 * demand again per file, since one patch can be longer than all the rest.
 */
interface TaskChangesetProps {
  projectPath: string;
  branch: string;
  baseBranch: string;
  /** Requests already made, so a file that has one says so. */
  requests?: { filePath?: string; deliveredAt: string | null }[];
  onRequestChange?: (filePath: string, body: string) => Promise<boolean>;
}

export function TaskChangeset(props: TaskChangesetProps) {
  return <TaskChangesetContent key={JSON.stringify([props.projectPath, props.branch, props.baseBranch])} {...props} />;
}

function TaskChangesetContent({ projectPath, branch, baseBranch, requests = [], onRequestChange }: TaskChangesetProps) {
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [open, setOpen] = useState(false);
  const [changeset, setChangeset] = useState<PitwallChangeset | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [patches, setPatches] = useState<Record<string, PatchState>>({});
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setChangeset(null);
    setPatches({});
    setExpanded(new Set());
    try {
      const result = await window.pitwall?.getTaskChangeset?.({ projectPath, branch, baseBranch });
      if (request === generation.current) setChangeset(result ?? { ok: false, error: "Unavailable", files: [], additions: 0, deletions: 0 });
    } catch (error) {
      if (request === generation.current) setChangeset({ ok: false, error: error instanceof Error ? error.message : "Could not read changes.", files: [], additions: 0, deletions: 0 });
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [projectPath, branch, baseBranch]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    if (next && !changeset?.ok && !loading) void load();
  }, [open, changeset, loading, load]);

  const openFile = useCallback(
    async (file: PitwallChangedFile, retry = false) => {
      const next = new Set(expanded);
      if (next.has(file.path) && !retry) {
        next.delete(file.path);
        setExpanded(next);
        return;
      }
      next.add(file.path);
      setExpanded(next);
      if ((patches[file.path] && !retry) || file.binary) return;

      const request = generation.current;
      setPatches((current) => ({ ...current, [file.path]: { status: "loading" } }));
      try {
        const result = await window.pitwall?.getTaskFileDiff?.({
          projectPath,
          branch,
          base: changeset?.base ?? "",
          filePath: file.path,
          untracked: file.untracked,
        });
        if (request !== generation.current) return;
        setPatches((current) => {
          if (!result?.ok) {
            return { ...current, [file.path]: { status: "error", message: result?.error || "Could not read this file" } };
          }
          const hunks = parseDiff(result.diff);
          const total = countLines(hunks);
          // A patch of thousands of lines is not read, it is scrolled past, and
          // rendering it costs a visible pause. Offer the beginning and say so.
          const truncated = total > LARGE_DIFF_LINES;
          const shown = truncated ? trimTo(hunks, LARGE_DIFF_LINES) : hunks;
          return {
            ...current,
            [file.path]: {
              status: "ready",
              truncated,
              hunks: shown,
              // Done once here rather than per render: a patch does not change
              // after it is fetched, and re-tokenising on every keystroke
              // elsewhere in the app would be pure waste.
              tokens: highlightHunks(shown, languageFromPath(file.path)),
            },
          };
        });
      } catch (error) {
        if (request === generation.current) setPatches((current) => ({ ...current, [file.path]: { status: "error", message: error instanceof Error ? error.message : "Could not read this file." } }));
      }
    },
    [expanded, patches, projectPath, branch, changeset],
  );

  async function send(filePath: string) {
    if (!onRequestChange || sendingRequest || !draft.trim()) return;
    setSendingRequest(true);
    try {
      await onRequestChange(filePath, draft);
      setDraft("");
      setComposingFor(null);
    } finally {
      setSendingRequest(false);
    }
  }

  const summary = changeset?.ok
    ? `${changeset.files.length} ${changeset.files.length === 1 ? "file" : "files"} changed`
    : "Changed files";

  // Named, because the base is now found rather than configured, and a review of
  // an unexpected size is a great deal easier to judge when it says what it was
  // measured from.
  const comparedAgainst = changeset?.baseBranch || baseBranch;

  return (
    <div className="dk-changeset">
      <button className="dk-changeset-head" type="button" onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileDiff size={14} />
        <span>{summary}</span>
        {changeset?.ok && (changeset.additions > 0 || changeset.deletions > 0) ? (
          <span className="dk-diffstat">
            <span className="dk-add">+{changeset.additions}</span>
            <span className="dk-del">−{changeset.deletions}</span>
          </span>
        ) : null}
        {changeset?.ok ? <span className="dk-changeset-base">vs {comparedAgainst}</span> : null}
      </button>

      {open ? (
        <div className="dk-changeset-body">
          {loading ? <p className="dk-changeset-note">Reading the worktree…</p> : null}
          <button className="dk-link dk-changeset-refresh" type="button" disabled={loading} onClick={() => void load()}>{changeset && !changeset.ok ? "Retry changes" : "Refresh changes"}</button>

          {changeset && !changeset.ok ? (
            <p className="dk-changeset-note">{changeset.error || "No changes could be read for this task."}</p>
          ) : null}

          {changeset?.ok && changeset.files.length === 0 ? (
            <p className="dk-changeset-note">
              The agent reported finishing, but nothing on this branch differs from {comparedAgainst}.
            </p>
          ) : null}

          {changeset?.ok
            ? changeset.files.map((file) => {
                const isOpen = expanded.has(file.path);
                const patch = patches[file.path];
                return (
                  <div className="dk-changeset-file" key={file.path}>
                    <div className="dk-changeset-row">
                    <button className="dk-changeset-file-open" type="button" onClick={() => void openFile(file)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className={`dk-changeset-status is-${file.status}`}>{STATUS_LABEL[file.status]}</span>
                      <span className="dk-changeset-path" title={file.from ? `${file.from} → ${file.path}` : file.path}>
                        <span className="dk-changeset-dir">{dirnameOf(file.path)}</span>
                        <span className="dk-changeset-name">{basenameOf(file.path)}</span>
                      </span>
                      {file.binary ? (
                        <span className="dk-badge">Binary</span>
                      ) : (
                        <span className="dk-diffstat">
                          {file.additions > 0 ? <span className="dk-add">+{file.additions}</span> : null}
                          {file.deletions > 0 ? <span className="dk-del">−{file.deletions}</span> : null}
                        </span>
                      )}
                    </button>

                    {onRequestChange ? (
                      <button
                        className={`dk-icon-btn dk-icon-btn--sm${requests.some((r) => r.filePath === file.path) ? " is-current" : ""}`}
                        aria-label={`Request a change to ${file.path}`}
                        type="button"
                        title={`Request a change to ${file.path}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraft("");
                          setComposingFor(composingFor === file.path ? null : file.path);
                        }}
                      >
                        <MessageSquarePlus size={13} />
                      </button>
                    ) : null}

                    {file.status === "deleted" ? null : (
                      <button
                        className="dk-icon-btn dk-icon-btn--sm"
                        aria-label={`Open ${file.path} in your editor`}
                        type="button"
                        title={`Open ${file.path} in your editor`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void window.pitwall?.openFileInEditor?.({
                            projectPath,
                            branch,
                            filePath: file.path,
                            line: firstChangedLine(patches[file.path]),
                          });
                        }}
                      >
                        <SquarePen size={13} />
                      </button>
                    )}
                    </div>

                    {composingFor === file.path ? (
                      <div className="dk-changeset-ask">
                        <textarea
                          className="dk-textarea"
                          value={draft}
                          autoFocus
                          rows={2}
                          placeholder={`What should change in ${basenameOf(file.path)}?`}
                          disabled={sendingRequest}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setComposingFor(null);
                            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                              void send(file.path);
                            }
                          }}
                        />
                        <div className="dk-request-actions">
                          <span className="dk-hint">{shortcutLabel("⌘↵ to send")}</span>
                          <span className="dk-spacer" />
                          <button className="dk-btn dk-btn--ghost dk-btn--sm" type="button" onClick={() => setComposingFor(null)} disabled={sendingRequest}>
                            Cancel
                          </button>
                          <button
                            className="dk-btn dk-btn--primary dk-btn--sm"
                            type="button"
                            disabled={sendingRequest || !draft.trim()}
                            onClick={() => void send(file.path)}
                          >
                            {sendingRequest ? "Sending…" : "Send"}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {isOpen ? (
                      <div className="dk-changeset-patch dk-diff">
                        {file.binary ? (
                          <p className="dk-changeset-note">Binary file — no line-by-line view.</p>
                        ) : patch?.status === "loading" ? (
                          <p className="dk-changeset-note">Loading…</p>
                        ) : patch?.status === "error" ? (
                          <p className="dk-changeset-note" role="alert">{patch.message} <button className="dk-link" type="button" onClick={() => void openFile(file, true)}>Retry patch</button></p>
                        ) : patch?.status === "ready" ? (
                          <>
                            {patch.hunks.map((hunk, index) => (
                              <div key={index}>
                                {hunk.header ? <div className="dk-diff-hunk">{hunk.header}</div> : null}
                                {hunk.lines.map((line, lineIndex) => (
                                  <div className={`dk-diff-line is-${line.kind}`} key={lineIndex}>
                                    <span className="dk-diff-no">{line.before ?? ""}</span>
                                    <span className="dk-diff-no">{line.after ?? ""}</span>
                                    <span className="dk-diff-sign">
                                      {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                                    </span>
                                    <code className="dk-diff-code">
                                      {(patch.tokens[index]?.[lineIndex] ?? []).map((token, tokenIndex) => (
                                        <span className={`tok-${token.kind}`} key={tokenIndex}>
                                          {token.text}
                                        </span>
                                      ))}
                                      {line.text ? null : " "}
                                    </code>
                                  </div>
                                ))}
                              </div>
                            ))}
                            {patch.truncated ? (
                              <p className="dk-changeset-note">
                                Showing the first {LARGE_DIFF_LINES} lines. Open the file in your editor for the rest.
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {changeset?.ok && changeset.untrackedFiles?.length ? (
            <details className="dk-changeset-untracked">
              <summary>
                {changeset.untrackedFiles.length} untracked{" "}
                {changeset.untrackedFiles.length === 1 ? "file" : "files"} — not in the pull request
              </summary>
              <p className="dk-changeset-note">
                Nothing has committed these, so they cannot appear in a pull request and are not
                counted above. Some are Pitwall's own Council transcripts; the rest are whatever else
                is sitting in the worktree untracked. They will keep showing in{" "}
                <code>git status</code> until they are committed or ignored.
              </p>
              {changeset.untrackedFiles.map((file) => (
                <div className="dk-changeset-row is-untracked" key={file.path}>
                  <span className="dk-changeset-path" title={file.path}>
                    <span className="dk-changeset-dir">{dirnameOf(file.path)}</span>
                    <span className="dk-changeset-name">{basenameOf(file.path)}</span>
                  </span>
                  <span className="dk-diffstat">
                    {file.additions > 0 ? <span className="dk-add">+{file.additions}</span> : null}
                  </span>
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The line the change starts on, for the editor to open at.
 *
 * The first added line if there is one, otherwise the first line of the first
 * hunk — a file whose change is pure deletion still has a place worth landing
 * on. Null before the patch is loaded, which just means the file opens at the
 * top.
 */
function firstChangedLine(patch: PatchState | undefined): number | undefined {
  if (patch?.status !== "ready") return undefined;
  for (const hunk of patch.hunks) {
    const added = hunk.lines.find((line) => line.kind === "added" && line.after !== null);
    if (added?.after != null) return added.after;
    const any = hunk.lines.find((line) => line.after !== null);
    if (any?.after != null) return any.after;
  }
  return undefined;
}

/**
 * A path is split so the directory can be truncated and the filename cannot.
 *
 * The previous approach was `direction: rtl`, which truncates from the left as
 * wanted but hands the string to the bidi algorithm — and a leading dot is a
 * neutral character, so `.pitwall/x.md` renders as `pitwall/x.md.` with the dot
 * moved to the far end. A hidden leading dot on a path is not a cosmetic
 * problem: it is the difference between a dotfile and an ordinary directory.
 */
function dirnameOf(filePath: string): string {
  const cut = filePath.lastIndexOf("/");
  return cut === -1 ? "" : filePath.slice(0, cut + 1);
}

function basenameOf(filePath: string): string {
  const cut = filePath.lastIndexOf("/");
  return cut === -1 ? filePath : filePath.slice(cut + 1);
}

/** Keeps whole hunks up to a line budget, so a patch never ends mid-hunk. */
function trimTo(hunks: DiffHunk[], budget: number): DiffHunk[] {
  const kept: DiffHunk[] = [];
  let used = 0;
  for (const hunk of hunks) {
    if (used >= budget) break;
    if (used + hunk.lines.length <= budget) {
      kept.push(hunk);
      used += hunk.lines.length;
    } else {
      kept.push({ ...hunk, lines: hunk.lines.slice(0, budget - used) });
      break;
    }
  }
  return kept;
}
