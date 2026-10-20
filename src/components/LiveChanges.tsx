import { useEffect, useRef, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { parseDiff, LARGE_DIFF_LINES, type DiffHunk } from "../lib/diff";

const STATUS_LETTER: Record<BraveliChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  conflicted: "U",
};

/** Subscribes to what a session's agent has changed, pushed by main as files change. */
export function useLiveChanges(sessionId: string | undefined, projectPath: string | undefined): BraveliLiveChanges | null {
  const [summary, setSummary] = useState<BraveliLiveChanges | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!sessionId || !projectPath || !window.braveli?.subscribeLiveChanges) return;
    const stop = window.braveli.onLiveChanges?.((next) => { if (next.sessionId === sessionId) setSummary(next); });
    void window.braveli.subscribeLiveChanges({ sessionId, projectPath }).catch(() => undefined);
    return () => {
      stop?.();
      void window.braveli?.unsubscribeLiveChanges?.({ sessionId }).catch(() => undefined);
    };
  }, [sessionId, projectPath]);
  return summary;
}

function sinceLabel(since: number | undefined): string {
  if (!since) return "";
  return `since ${new Date(since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type Patch = { hunks: DiffHunk[]; ids: string[]; truncated: boolean };

interface LiveChangesProps {
  sessionId: string;
  projectPath: string;
  branch: string;
  summary: BraveliLiveChanges | null;
  /** A file to open first, e.g. one picked from the sidebar. */
  focusPath?: string;
}

/**
 * What the agent has changed in this session, as it changes — and the means
 * to keep it or put it back, one hunk at a time if need be.
 */
export function LiveChanges({ sessionId, projectPath, branch, summary, focusPath }: LiveChangesProps) {
  const [selected, setSelected] = useState("");
  const [patch, setPatch] = useState<Patch | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);
  const request = useRef(0);

  const files = summary?.ok ? summary.files : [];
  const current = files.find((file) => file.path === selected);

  useEffect(() => {
    if (focusPath) setSelected(focusPath);
  }, [focusPath]);

  useEffect(() => {
    if (!selected && files.length) setSelected(files[0].path);
    if (selected && files.length && !current) setSelected(files[0].path);
  }, [files, selected, current]);

  // Re-read the open file whenever main reports a change, so the diff stays live too.
  useEffect(() => {
    if (!current || current.binary) {
      setPatch(null);
      return;
    }
    const id = ++request.current;
    void window.braveli?.getLiveFileDiff?.({ sessionId, file: current }).then((result) => {
      if (id !== request.current) return;
      if (!result?.ok) {
        setError(result?.error || "Could not read this file's changes.");
        return;
      }
      const hunks = parseDiff(result.diff);
      let lines = 0;
      const shown = hunks.filter((hunk) => (lines += hunk.lines.length) <= LARGE_DIFF_LINES || hunk === hunks[0]);
      setPatch({ hunks: shown, ids: result.hunks, truncated: shown.length < hunks.length });
    });
  }, [summary, current, sessionId]);

  useEffect(() => {
    if (!confirmRevertAll) return;
    const timer = setTimeout(() => setConfirmRevertAll(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmRevertAll]);

  async function act(work: () => Promise<{ ok: boolean; error?: string } | undefined>) {
    setBusy(true);
    setError("");
    try {
      const result = await work();
      if (result && !result.ok) setError(result.error || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const revertAll = () => act(async () => {
    for (const file of files) {
      const result = await window.braveli?.revertLiveChange?.({ sessionId, file });
      if (result && !result.ok) return result;
    }
    return { ok: true };
  });

  if (!summary) return <p className="dk-changeset-note">Reading the worktree…</p>;
  if (!summary.ok) return <p className="dk-changeset-note">{summary.error || "Changes cannot be read here."}</p>;
  if (files.length === 0) {
    return (
      <p className="dk-changeset-note">
        No changes {sinceLabel(summary.since)}. Edits the agent makes appear here as it makes them.
      </p>
    );
  }

  return (
    <div className="dk-livechanges">
      <div className="dk-livechanges-bar">
        <span className="dk-branchdiff-total">
          {files.length} {files.length === 1 ? "file" : "files"}
          <span className="dk-add">+{summary.additions}</span>
          <span className="dk-del">−{summary.deletions}</span>
          <em className="dk-faint">{sinceLabel(summary.since)}</em>
        </span>
        <span className="dk-spacer" />
        {error ? <span className="dk-hint dk-livechanges-error" role="alert">{error}</span> : null}
        <button type="button" className="dk-btn dk-btn--sm" disabled={busy} onClick={() => void act(() => window.braveli!.keepLiveChange!({ sessionId }))}>
          <Check size={13} aria-hidden="true" /> Keep all
        </button>
        <button
          type="button"
          className={`dk-btn dk-btn--sm${confirmRevertAll ? " dk-btn--danger" : ""}`}
          disabled={busy}
          onClick={() => {
            if (!confirmRevertAll) return setConfirmRevertAll(true);
            setConfirmRevertAll(false);
            void revertAll();
          }}
        >
          <Undo2 size={13} aria-hidden="true" /> {confirmRevertAll ? `Revert ${files.length} ${files.length === 1 ? "file" : "files"}?` : "Revert all"}
        </button>
      </div>

      <div className="dk-branchdiff dk-livechanges-panes">
        <div className="dk-branchdiff-files">
          <ul>
            {files.map((file) => (
              <li key={file.path} className="dk-livechanges-row">
                <button
                  type="button"
                  className={`dk-branchdiff-file${file.path === selected ? " is-current" : ""}`}
                  onClick={() => setSelected(file.path)}
                  title={file.from ? `${file.from} → ${file.path}` : file.path}
                >
                  <em className={`dk-changeset-status is-${file.status}`}>{STATUS_LETTER[file.status]}</em>
                  <span className="dk-branchdiff-name">{file.path.split("/").pop()}</span>
                  <span className="dk-diffstat">
                    {file.binary ? <span className="dk-faint">bin</span> : null}
                    {file.additions ? <span className="dk-add">+{file.additions}</span> : null}
                    {file.deletions ? <span className="dk-del">−{file.deletions}</span> : null}
                  </span>
                  {file.path.includes("/") ? <span className="dk-branchdiff-dir">{file.path.split("/").slice(0, -1).join("/")}</span> : null}
                </button>
                <span className="dk-livechanges-actions">
                  <button type="button" className="dk-icon-btn dk-icon-btn--sm" disabled={busy} title={`Keep ${file.path}`} aria-label={`Keep ${file.path}`} onClick={() => void act(() => window.braveli!.keepLiveChange!({ sessionId, file }))}>
                    <Check size={13} />
                  </button>
                  <button type="button" className="dk-icon-btn dk-icon-btn--sm" disabled={busy} title={`Revert ${file.path}`} aria-label={`Revert ${file.path}`} onClick={() => void act(() => window.braveli!.revertLiveChange!({ sessionId, file }))}>
                    <Undo2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {summary.truncated ? <p className="dk-changeset-note">Only the first {files.length} files are listed.</p> : null}
        </div>

        <div className="dk-branchdiff-patch">
          {!current ? null : current.binary ? (
            <p className="dk-changeset-note">Binary file — no text diff to show.</p>
          ) : !patch ? (
            <p className="dk-changeset-note">Reading the patch…</p>
          ) : (
            <>
              <p className="dk-branchdiff-path">
                <button type="button" className="dk-link dk-mono" onClick={() => void window.braveli?.openFileInEditor?.({ projectPath, branch, filePath: current.path })}>
                  {current.path}
                </button>
              </p>
              <div className="dk-diff">
                {patch.hunks.map((hunk, index) => (
                  <div key={`${patch.ids[index] ?? index}`}>
                    <div className="dk-diff-hunk dk-livechanges-hunk">
                      <span>{hunk.header}</span>
                      {patch.ids[index] ? (
                        <button
                          type="button"
                          className="dk-link"
                          disabled={busy}
                          onClick={() => void act(() => window.braveli!.revertLiveChange!({ sessionId, file: current, hunk: patch.ids[index] }))}
                        >
                          Revert this change
                        </button>
                      ) : null}
                    </div>
                    {hunk.lines.map((line, lineIndex) => (
                      <div className={`dk-diff-line is-${line.kind}`} key={lineIndex}>
                        <span className="dk-diff-no">{line.before ?? ""}</span>
                        <span className="dk-diff-no">{line.after ?? ""}</span>
                        <span className="dk-diff-sign" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                        <code className="dk-diff-code">{line.text || " "}</code>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {patch.truncated ? <p className="dk-changeset-note">Showing the first {LARGE_DIFF_LINES} lines. Open the file in your editor for the rest.</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
