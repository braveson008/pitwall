import { useEffect, useState } from "react";
import { GitCommitHorizontal, GitPullRequest, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

export interface CreateRequestDraft {
  taskTitle: string;
  /** "merge request" or "pull request". */
  noun: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  /** Changed files not yet committed, which will not be in the request unless committed here. */
  uncommitted: number;
  uncommittedFiles: Array<{ path: string; state: string }>;
  /** The commit message proposed for them. */
  commitMessage: string;
  /** The host has no CLI Pitwall can use: the branch is pushed and its web page opened. */
  manual: boolean;
  usedTemplate: boolean;
}

/**
 * The request, written out before anything leaves the machine.
 *
 * Pitwall drafts it from what it knows; the person reads and edits it, because
 * a request goes out under their name and their team reads it.
 */
/** The description and commit message written from the change, arriving after the dialog opens. */
export interface WrittenDraft {
  body: string;
  commitMessage: string;
}

export function CreateRequestModal({
  draft,
  busy,
  error,
  writing,
  written,
  writeError,
  onRewrite,
  onStopWriting,
  onCreate,
  onClose,
}: {
  draft: CreateRequestDraft | null;
  busy: boolean;
  error: string;
  /** The description is being written from the change. */
  writing: boolean;
  written: WrittenDraft | null;
  writeError: string;
  onRewrite: () => void;
  /** Stops waiting for the written description; the draft stays. */
  onStopWriting: () => void;
  onCreate: (input: { title: string; body: string; baseBranch: string; draft: boolean; commit?: { message: string; paths: string[] } }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [asDraft, setAsDraft] = useState(false);
  const [commitFirst, setCommitFirst] = useState(true);
  const [message, setMessage] = useState("");
  // What the person typed is theirs: a description that arrives late never
  // replaces an edit.
  const [bodyEdited, setBodyEdited] = useState(false);
  const [messageEdited, setMessageEdited] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    setBaseBranch(draft.baseBranch);
    setAsDraft(false);
    setCommitFirst(draft.uncommitted > 0);
    setMessage(draft.commitMessage);
    setBodyEdited(false);
    setMessageEdited(false);
  }, [draft]);

  useEffect(() => {
    if (!written) return;
    if (!bodyEdited) setBody(written.body);
    if (!messageEdited && written.commitMessage) setMessage(written.commitMessage);
    // Only a new arrival applies; edits are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [written]);

  const dialogRef = useModalFocus<HTMLDivElement>(Boolean(draft), () => { if (!busy) onClose(); });
  // Waiting only shows where the text is still Pitwall's to replace.
  const bodyWaiting = writing && !bodyEdited;
  const messageWaiting = writing && !messageEdited;
  if (!draft) return null;
  const noun = draft.noun;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);

  return (
    <div className="dk-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={dialogRef}
        className="dk-dialog dk-dialog--wide dk-request-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-request-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title" id="create-request-title">Create {noun}</h2>
            <p className="dk-dialog-desc">
              <span className="dk-mono">{draft.branch}</span> into{" "}
              <input
                id="create-request-base"
                className="dk-request-base dk-mono"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                aria-label="Target branch"
                spellCheck={false}
                disabled={busy}
              />
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body dk-mr-dialog-body">
          {draft.uncommitted > 0 ? (
            <section className={`dk-request-commit${commitFirst ? " is-on" : ""}`} aria-labelledby="create-request-commit-label">
              <label className="dk-check" htmlFor="create-request-commit">
                <input
                  id="create-request-commit"
                  type="checkbox"
                  checked={commitFirst}
                  onChange={(event) => setCommitFirst(event.target.checked)}
                  disabled={busy}
                />
                <span id="create-request-commit-label">
                  Commit {draft.uncommitted === 1 ? "the 1 uncommitted file" : `the ${draft.uncommitted} uncommitted files`} first
                </span>
              </label>
              <p className="dk-hint dk-request-files" title={draft.uncommittedFiles.map((file) => file.path).join("\n")}>
                {draft.uncommittedFiles.slice(0, 4).map((file) => file.path.split("/").pop()).join(", ")}
                {draft.uncommittedFiles.length > 4 ? `, and ${draft.uncommittedFiles.length - 4} more` : ""}
              </p>
              {commitFirst ? (
                <textarea
                  id="create-request-commit-message"
                  className={`dk-textarea dk-request-message${messageWaiting ? " is-waiting" : ""}`}
                  aria-busy={messageWaiting || undefined}
                  aria-label="Commit message"
                  value={message}
                  onChange={(event) => { setMessage(event.target.value); setMessageEdited(true); }}
                  rows={Math.min(5, Math.max(2, message.split("\n").length))}
                  spellCheck
                  disabled={busy}
                />
              ) : (
                <p className="dk-hint">Left uncommitted, {draft.uncommitted === 1 ? "it" : "they"} will not be in the {noun}.</p>
              )}
            </section>
          ) : null}

          <label className="dk-field" htmlFor="create-request-title-input">
            <span className="dk-label">Title</span>
            <input
              id="create-request-title-input"
              className="dk-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="dk-field" htmlFor="create-request-description">
            <span className="dk-label dk-request-label">
              Description
              <span className="dk-faint"> · Markdown{draft.usedTemplate ? " · from the repository's template" : ""}</span>
              <span className="dk-spacer" />
              {writing && !bodyWaiting ? (
                <span className="dk-faint dk-request-writing" role="status">
                  <LoaderCircle size={12} className="dk-spin" aria-hidden="true" /> Writing from the changes…
                </span>
              ) : writing ? null : (
                <button
                  type="button"
                  className="dk-link dk-request-rewrite"
                  onClick={() => { setBodyEdited(false); setMessageEdited(false); onRewrite(); }}
                  disabled={busy}
                >
                  <RefreshCw size={12} aria-hidden="true" /> Write from the changes
                </button>
              )}
            </span>
            <span className="dk-request-description-wrap">
              <textarea
                id="create-request-description"
                className={`dk-textarea dk-request-description${bodyWaiting ? " is-waiting" : ""}`}
                aria-busy={bodyWaiting || undefined}
                value={body}
                onChange={(event) => { setBody(event.target.value); setBodyEdited(true); }}
                rows={16}
                spellCheck
                disabled={busy || bodyWaiting}
              />
              {bodyWaiting ? (
                <span className="dk-request-loading" role="status">
                  <LoaderCircle size={20} className="dk-spin" aria-hidden="true" />
                  <span className="dk-request-loading-title">Writing the description from the changes…</span>
                  <span className="dk-faint">Reading the diff. Usually 15–40 seconds.</span>
                  <button
                    type="button"
                    className="dk-btn dk-btn--sm"
                    onClick={(event) => { event.preventDefault(); onStopWriting(); }}
                  >
                    Write it myself
                  </button>
                </span>
              ) : null}
            </span>
          </label>

          {draft.manual ? (
            <p className="dk-hint">
              Pitwall will push the branch, copy this description and open the host's page for a new {noun}. Paste it there.
            </p>
          ) : (
            <label className="dk-check" htmlFor="create-request-draft">
              <input
                id="create-request-draft"
                type="checkbox"
                checked={asDraft}
                onChange={(event) => setAsDraft(event.target.checked)}
                disabled={busy}
              />
              Open as a draft
            </label>
          )}

          {writeError && !writing ? <p className="dk-hint">{writeError} The draft above is built from the ticket and the files.</p> : null}
          {error ? <p className="dk-notice is-error dk-request-error" role="alert">{error}</p> : null}
        </div>

        <div className="dk-dialog-footer">
          <span className="dk-faint dk-request-task">{draft.taskTitle}</span>
          <span className="dk-spacer" />
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="dk-btn dk-btn--primary"
            onClick={() => onCreate({
              title: title.trim(),
              body,
              baseBranch: baseBranch.trim(),
              draft: asDraft,
              ...(commitFirst && draft.uncommitted > 0 && message.trim()
                ? { commit: { message: message.trim(), paths: draft.uncommittedFiles.map((file) => file.path) } }
                : {}),
            })}
            // Sending now would send the placeholder draft; "Write it myself" ends the wait.
            disabled={busy || bodyWaiting || !title.trim() || (commitFirst && draft.uncommitted > 0 && !message.trim())}
            title={bodyWaiting ? "Waiting for the description" : undefined}
          >
            {busy ? (
              <LoaderCircle size={14} className="dk-spin" aria-hidden="true" />
            ) : commitFirst && draft.uncommitted > 0 ? (
              <GitCommitHorizontal size={14} aria-hidden="true" />
            ) : (
              <GitPullRequest size={14} aria-hidden="true" />
            )}
            {busy
              ? commitFirst && draft.uncommitted > 0 ? "Committing and pushing…" : "Pushing…"
              : draft.manual
                ? `${commitFirst && draft.uncommitted > 0 ? "Commit, push" : "Push"} and open ${noun} page`
                : commitFirst && draft.uncommitted > 0
                  ? `Commit and create ${noun}`
                  : `Create ${noun}`}
          </button>
        </div>
      </div>
    </div>
  );
}
