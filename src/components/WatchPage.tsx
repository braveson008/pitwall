import { useEffect, useMemo, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Ticket,
  Trash2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import type { Project } from "../data";
import { parseDiff } from "../lib/diff";
import type { SwapOption } from "./CouncilGrid";
import { Dropdown } from "./Dropdown";

/**
 * Watch: what Pitwall looks for on the project's code host or tracker, and
 * what it found.
 *
 * Every watch ends in a proposal that waits here — a review, a fix, replies, a
 * task — and nothing reaches the host, the branch or the tracker until you
 * approve it.
 */

const KINDS: Array<{ kind: WatchKind; title: string; detail: (noun: string) => string; icon: typeof GitPullRequest; needsHost: boolean }> = [
  {
    kind: "review-requested",
    title: "Review requests",
    detail: (noun) => `When someone asks you to review a ${noun}, it is reviewed read-only and the review waits for you to post.`,
    icon: GitPullRequest,
    needsHost: true,
  },
  {
    kind: "ci-failed",
    title: "CI fails on my request",
    detail: (noun) => `When a pipeline fails on one of your ${noun}s, a fix is drafted from the failing jobs' logs. You read the diff, then it is committed and pushed.`,
    icon: CircleAlert,
    needsHost: true,
  },
  {
    kind: "my-request-comments",
    title: "New comments on my request",
    detail: (noun) => `When someone comments on one of your ${noun}s, the changes they ask for and a reply to each are drafted. You approve before anything is pushed or posted.`,
    icon: MessageSquare,
    needsHost: true,
  },
  {
    kind: "ticket-assigned",
    title: "Ticket assigned to me",
    detail: () => "When a ticket in your tracker is assigned to you, a plan is drafted from the code. Approving makes it a task, and can start it.",
    icon: Ticket,
    needsHost: false,
  },
  {
    kind: "custom",
    title: "Custom",
    detail: (noun) => `Describe which ${noun}s to look at and what to look for. Matching ones are reviewed with that in mind, and the review waits for you.`,
    icon: Sparkles,
    needsHost: true,
  },
];

/**
 * How often a watch may look. The host's lists are cheap; a tracker look is a
 * model call, so a ticket watch starts at five minutes.
 */
const INTERVALS: Record<"host" | "tracker", number[]> = {
  host: [60, 75, 120, 300, 900, 1800, 3600],
  tracker: [300, 600, 1800, 3600],
};
const DEFAULT_INTERVAL = { host: 75, tracker: 1800 };
const paceOf = (kind: WatchKind) => (kind === "ticket-assigned" ? "tracker" : "host");
const intervalOf = (watch: Pick<WatchRecord, "kind" | "intervalSeconds">) =>
  INTERVALS[paceOf(watch.kind)].includes(Number(watch.intervalSeconds)) ? Number(watch.intervalSeconds) : DEFAULT_INTERVAL[paceOf(watch.kind)];

function everyLabel(seconds: number) {
  if (seconds < 60) return `Every ${seconds} seconds`;
  if (seconds === 60) return "Every minute";
  if (seconds < 120) return `Every ${seconds} seconds`;
  if (seconds < 3600) return `Every ${seconds / 60} minutes`;
  return seconds === 3600 ? "Every hour" : `Every ${seconds / 3600} hours`;
}

const intervalOptions = (kind: WatchKind) =>
  INTERVALS[paceOf(kind)].map((seconds) => ({
    value: String(seconds),
    label: `${everyLabel(seconds)}${seconds === DEFAULT_INTERVAL[paceOf(kind)] ? " (default)" : ""}`,
  }));

const kindInfo = (kind: WatchKind | undefined) => KINDS.find((item) => item.kind === (kind ?? "review-requested")) ?? KINDS[0];

const VERDICTS: Array<{ value: WatchVerdict; label: string }> = [
  { value: "approve", label: "Approve" },
  { value: "comment", label: "Comment" },
  { value: "request_changes", label: "Request changes" },
];

export interface TrackerSourceOption {
  provider: string;
  name: string;
  target: string;
  label: string;
}

function ago(at: number, now: number) {
  if (!at) return "not yet";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** A multi-file patch as one entry per file. */
function splitPatch(patch: string) {
  const files: Array<{ path: string; patch: string }> = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of String(patch || "").split("\n")) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      if (current) files.push({ path: current.path, patch: current.lines.join("\n") });
      current = { path: header[2], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) files.push({ path: current.path, patch: current.lines.join("\n") });
  return files;
}

function PatchView({ patch }: { patch: string }) {
  const files = useMemo(() => splitPatch(patch), [patch]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => (files.length <= 3 ? Object.fromEntries(files.map((file) => [file.path, true])) : {}));
  if (!files.length) return null;
  return (
    <div className="dk-watch-patch">
      {files.map((file) => {
        const hunks = parseDiff(file.patch);
        const added = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === "added").length, 0);
        const removed = hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.kind === "removed").length, 0);
        const isOpen = Boolean(open[file.path]);
        return (
          <div className="dk-watch-patch-file" key={file.path}>
            <button type="button" className="dk-watch-patch-head" aria-expanded={isOpen} onClick={() => setOpen((current) => ({ ...current, [file.path]: !isOpen }))}>
              <ChevronRight size={13} className={isOpen ? "is-open" : undefined} aria-hidden="true" />
              <span className="dk-mono">{file.path}</span>
              <span className="dk-spacer" />
              <span className="dk-diffstat"><span className="dk-add">+{added}</span><span className="dk-del">−{removed}</span></span>
            </button>
            {isOpen ? (
              <div className="dk-watch-patch-body">
                {hunks.map((hunk, index) => (
                  <div key={index}>
                    {hunk.header ? <div className="dk-diff-hunk">{hunk.header}</div> : null}
                    {hunk.lines.map((line, lineIndex) => (
                      <div className={`dk-diff-line is-${line.kind}`} key={lineIndex}>
                        <span className="dk-diff-no">{line.before ?? ""}</span>
                        <span className="dk-diff-no">{line.after ?? ""}</span>
                        <span className="dk-diff-sign">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
                        <code className="dk-diff-code">{line.text || " "}</code>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CardHead({ finding, prefix, onOpen, label }: { finding: WatchFinding; prefix: string; onOpen: () => void; label: string }) {
  return (
    <header className="dk-watch-card-head">
      <span className="dk-watch-kind">{label}</span>
      <span className="dk-mono dk-faint">{prefix}{finding.number}</span>
      <button type="button" className="dk-link dk-watch-title" id={`watch-${finding.id}`} onClick={onOpen} title="Open on the host">
        {finding.title}
        <ExternalLink size={12} aria-hidden="true" />
      </button>
      <span className="dk-spacer" />
      {finding.headRef ? (
        <span className="dk-faint dk-watch-meta">
          {finding.author ? `${finding.author} · ` : ""}
          <span className="dk-mono">{finding.headRef}</span>{finding.baseRef ? <> into <span className="dk-mono">{finding.baseRef}</span></> : null}
        </span>
      ) : null}
    </header>
  );
}

type Outcome = Promise<{ ok: boolean; error?: string; warning?: string }>;
type Revise = (instruction: string, current: unknown) => Promise<{ ok: boolean; error?: string }>;

const SUGGESTIONS: Partial<Record<WatchKind, string[]>> = {
  "review-requested": ["Only keep blocking comments", "Make it shorter", "Approve if nothing is blocking"],
  custom: ["Only keep blocking comments", "Make it shorter"],
  "ci-failed": ["Make the smallest change that fixes it", "Explain why in the commit message"],
  "my-request-comments": ["Keep the replies short", "Don't change code for the optional comments"],
  "ticket-assigned": ["Make it shorter", "Add a testing step"],
};

/**
 * Talking to the agent that wrote a draft, while it waits for you.
 *
 * What you have typed into the draft goes with the request, so a change is
 * made to what you are looking at — your edits included — and not to the
 * agent's first answer.
 */
function AgentChat({ finding, current, onRevise }: { finding: WatchFinding; current: () => unknown; onRevise: Revise }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const busy = Boolean(finding.revising);
  const send = async (instruction: string) => {
    const ask = instruction.trim();
    if (!ask || busy) return;
    setError("");
    setText("");
    const result = await onRevise(ask, current());
    if (!result.ok && result.error && !/Could not make that change/.test(result.error)) setError(result.error);
  };
  const conversation = finding.conversation ?? [];
  const suggestions = SUGGESTIONS[finding.kind ?? "review-requested"] ?? [];
  return (
    <section className="dk-watch-chat" aria-label="Ask for changes">
      {conversation.length ? (
        <ol className="dk-watch-chat-log">
          {conversation.map((message, index) => (
            <li key={index} className={`dk-watch-chat-message is-${message.role}${message.failed ? " is-failed" : ""}`}>
              <span className="dk-watch-chat-who">{message.role === "you" ? "You" : "Agent"}</span>
              <span>{message.text}</span>
            </li>
          ))}
          {busy ? (
            <li className="dk-watch-chat-message is-agent is-working" role="status">
              <span className="dk-watch-chat-who">Agent</span>
              <span><LoaderCircle size={12} className="dk-spin" aria-hidden="true" /> Working on it…</span>
            </li>
          ) : null}
        </ol>
      ) : null}
      {!conversation.length && suggestions.length ? (
        <div className="dk-watch-chat-suggestions">
          {suggestions.map((suggestion) => (
            <button type="button" key={suggestion} className="dk-chip" onClick={() => void send(suggestion)} disabled={busy}>{suggestion}</button>
          ))}
        </div>
      ) : null}
      <div className="dk-watch-chat-composer">
        <textarea
          className="dk-textarea dk-watch-chat-input"
          aria-label="Ask the agent for a change"
          placeholder={busy ? "Working on your last request…" : "Ask for a change — e.g. only keep blocking comments"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(text);
            }
          }}
          rows={1}
          disabled={busy}
        />
        <button type="button" className="dk-icon-btn dk-watch-chat-send" onClick={() => void send(text)} disabled={busy || !text.trim()} aria-label="Send" title="Send (Enter)">
          {busy ? <LoaderCircle size={15} className="dk-spin" aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}
        </button>
      </div>
      {error ? <p className="dk-hint dk-watch-error">{error}</p> : null}
    </section>
  );
}

function ReviewCard({ finding, prefix, focus, onPost, onRevise, onDismiss, onOpen }: {
  finding: WatchFinding;
  prefix: string;
  focus: string;
  onPost: (review: WatchReview, approveOnly?: boolean) => Outcome;
  onRevise: Revise;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const [review, setReview] = useState<WatchReview>(() => finding.review ?? { verdict: "comment", summary: "", comments: [] });
  const [busy, setBusy] = useState<"" | "post" | "approve">("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (finding.review) setReview(finding.review);
  }, [finding.id, finding.reviewedSha, finding.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = Boolean(busy) || Boolean(finding.revising);

  const setComment = (index: number, body: string) =>
    setReview((current) => ({ ...current, comments: current.comments.map((comment, at) => (at === index ? { ...comment, body } : comment)) }));
  const dropComment = (index: number) =>
    setReview((current) => ({ ...current, comments: current.comments.filter((_, at) => at !== index) }));

  const post = async (approveOnly = false) => {
    setBusy(approveOnly ? "approve" : "post");
    setError("");
    const result = await onPost({ ...review, comments: review.comments.filter((comment) => comment.body.trim()) }, approveOnly);
    setBusy("");
    if (!result.ok) setError(result.error || (approveOnly ? "The approval could not be posted." : "The review could not be posted."));
  };

  return (
    <article className={`dk-watch-card is-ready${finding.revising ? " is-revising" : ""}`} aria-labelledby={`watch-${finding.id}`} aria-busy={finding.revising || undefined}>
      <CardHead finding={finding} prefix={prefix} onOpen={onOpen} label={focus ? "Custom watch" : "Review"} />
      {focus ? <p className="dk-faint dk-watch-reason">Matched “{focus}”</p> : null}

      <div className="dk-segmented dk-watch-verdict" role="group" aria-label="Verdict">
        {VERDICTS.map((option) => (
          <button
            type="button"
            key={option.value}
            className={review.verdict === option.value ? "is-current" : undefined}
            aria-pressed={review.verdict === option.value}
            onClick={() => setReview((current) => ({ ...current, verdict: option.value }))}
            disabled={locked}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="dk-field" htmlFor={`watch-summary-${finding.id}`}>
        <span className="dk-label">Review</span>
        <textarea
          id={`watch-summary-${finding.id}`}
          className="dk-textarea dk-watch-summary"
          value={review.summary}
          onChange={(event) => setReview((current) => ({ ...current, summary: event.target.value }))}
          rows={Math.min(8, Math.max(3, review.summary.split("\n").length + 1))}
          disabled={locked}
        />
      </label>

      {review.comments.length ? (
        <div className="dk-watch-comments">
          <span className="dk-label">Line comments · {review.comments.length}</span>
          {review.comments.map((comment, index) => (
            <div className="dk-watch-comment" key={`${comment.path}:${comment.line}:${index}`}>
              <div className="dk-watch-comment-head">
                <span className="dk-mono">{comment.path}:{comment.line}</span>
                <span className="dk-spacer" />
                <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={() => dropComment(index)} aria-label={`Remove the comment on ${comment.path} line ${comment.line}`} title="Remove this comment" disabled={locked}>
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              <textarea
                className="dk-textarea dk-watch-comment-body"
                aria-label={`Comment on ${comment.path} line ${comment.line}`}
                value={comment.body}
                onChange={(event) => setComment(index, event.target.value)}
                rows={Math.min(6, Math.max(2, comment.body.split("\n").length))}
                disabled={locked}
              />
            </div>
          ))}
        </div>
      ) : null}

      <AgentChat finding={finding} current={() => review} onRevise={onRevise} />

      {error ? <p className="dk-notice is-error" role="alert">{error}</p> : null}

      <footer className="dk-watch-card-foot">
        <button type="button" className="dk-btn dk-btn--ghost" onClick={onDismiss} disabled={locked}>
          <Trash2 size={14} aria-hidden="true" />
          Set aside
        </button>
        <span className="dk-spacer" />
        <span className="dk-faint dk-watch-hint">Nothing is posted until you press a button.</span>
        <button type="button" className="dk-btn" onClick={() => void post(true)} disabled={locked} title="Approve on its own, without the review or comments above">
          {busy === "approve" ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          {busy === "approve" ? "Approving…" : `Approve ${prefix}${finding.number}`}
        </button>
        <button type="button" className="dk-btn dk-btn--primary" onClick={() => void post()} disabled={locked || !review.summary.trim()}>
          {busy === "post" ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : null}
          {busy === "post" ? "Posting…" : `Post review on ${prefix}${finding.number}`}
        </button>
      </footer>
    </article>
  );
}

function FixCard({ finding, prefix, onApprove, onRevise, onDismiss, onOpen, onOpenUrl }: {
  finding: WatchFinding;
  prefix: string;
  onApprove: (fix: { commit: boolean; commitMessage: string; replies: WatchReply[] }) => Outcome;
  onRevise: Revise;
  onDismiss: () => void;
  onOpen: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const proposal = finding.proposal ?? {};
  const hasPatch = Boolean(proposal.patch?.trim());
  const [message, setMessage] = useState(proposal.commitMessage ?? "");
  const [replies, setReplies] = useState<WatchReply[]>(proposal.replies ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setMessage(proposal.commitMessage ?? "");
    setReplies(proposal.replies ?? []);
  }, [finding.id, finding.reviewedSha, finding.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = busy || Boolean(finding.revising);

  const ci = finding.kind === "ci-failed";
  const replying = replies.some((reply) => reply.reply.trim());
  const approve = async () => {
    setBusy(true);
    setError("");
    const result = await onApprove({ commit: hasPatch, commitMessage: message, replies });
    setBusy(false);
    if (!result.ok) setError(result.error || "That could not be done.");
  };
  const action = hasPatch && replying ? "Commit, push and reply" : hasPatch ? "Commit and push" : replying ? "Post replies" : "";

  return (
    <article className={`dk-watch-card is-ready${finding.revising ? " is-revising" : ""}`} aria-labelledby={`watch-${finding.id}`} aria-busy={finding.revising || undefined}>
      <CardHead finding={finding} prefix={prefix} onOpen={onOpen} label={ci ? "CI failed" : "New comments"} />
      {ci && proposal.failing?.length ? (
        <p className="dk-faint dk-watch-reason">
          Failed:{" "}
          {proposal.failing.map((failure, index) => (
            <span key={failure.name}>
              {index ? ", " : ""}
              {failure.url ? <button type="button" className="dk-link" onClick={() => onOpenUrl(failure.url)}>{failure.name}</button> : failure.name}
            </span>
          ))}
        </p>
      ) : null}

      {proposal.summary ? <p className="dk-watch-summary-text">{proposal.summary}</p> : null}

      {hasPatch ? (
        <>
          <PatchView patch={proposal.patch!} />
          <label className="dk-field" htmlFor={`watch-message-${finding.id}`}>
            <span className="dk-label">Commit message</span>
            <textarea
              id={`watch-message-${finding.id}`}
              className="dk-textarea dk-watch-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={Math.min(5, Math.max(2, message.split("\n").length))}
              disabled={locked}
            />
          </label>
        </>
      ) : (
        <p className="dk-notice is-needs">No code change was proposed{ci ? " — the failure may not be in the code. Check the job, or set this aside." : "."}</p>
      )}

      {replies.length ? (
        <div className="dk-watch-comments">
          <span className="dk-label">Replies · {replies.length}</span>
          {replies.map((reply, index) => (
            <div className="dk-watch-comment" key={reply.id}>
              <div className="dk-watch-comment-head">
                <strong>{reply.author}</strong>
                {reply.path ? <span className="dk-mono">{reply.path}:{reply.line}</span> : null}
              </div>
              <blockquote className="dk-watch-quote">{reply.body}</blockquote>
              <textarea
                className="dk-textarea dk-watch-comment-body"
                aria-label={`Reply to ${reply.author}`}
                placeholder="No reply"
                value={reply.reply}
                onChange={(event) => setReplies((current) => current.map((item, at) => (at === index ? { ...item, reply: event.target.value } : item)))}
                rows={Math.min(6, Math.max(2, reply.reply.split("\n").length))}
                disabled={locked}
              />
            </div>
          ))}
        </div>
      ) : null}

      <AgentChat finding={finding} current={() => ({ summary: proposal.summary, commitMessage: message, replies: replies.map(({ id, author, body, reply }) => ({ id, author, comment: body, reply })) })} onRevise={onRevise} />

      {error ? <p className="dk-notice is-error dk-request-error" role="alert">{error}</p> : null}

      <footer className="dk-watch-card-foot">
        <button type="button" className="dk-btn dk-btn--ghost" onClick={onDismiss} disabled={locked}>
          <Trash2 size={14} aria-hidden="true" />
          Set aside
        </button>
        <span className="dk-spacer" />
        {action ? (
          <>
            <span className="dk-faint dk-watch-hint">Committed as you, onto {finding.headRef}.</span>
            <button type="button" className="dk-btn dk-btn--primary" onClick={() => void approve()} disabled={locked || (hasPatch && !message.trim())}>
              {busy ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
              {busy ? "Working…" : action}
            </button>
          </>
        ) : null}
      </footer>
    </article>
  );
}

function TicketCard({ finding, agents, defaultAgent, onApprove, onRevise, onDismiss, onOpen }: {
  finding: WatchFinding;
  /** The agents that can take the ticket, and the one picked when the card opens. */
  agents: SwapOption[];
  defaultAgent: string;
  onApprove: (plan: string, start: boolean, agent: string, model: string) => Outcome;
  onRevise: Revise;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const [plan, setPlan] = useState(finding.proposal?.plan ?? "");
  const [busy, setBusy] = useState<"" | "create" | "start">("");
  const [error, setError] = useState("");
  const initial = agents.find((option) => option.agent === defaultAgent) ?? agents[0];
  const [agent, setAgent] = useState<string>(initial?.agent ?? "");
  const [model, setModel] = useState<string>(initial?.models[0] ?? "");
  const models = agents.find((option) => option.agent === agent)?.models ?? ["Auto"];
  useEffect(() => { setPlan(finding.proposal?.plan ?? ""); }, [finding.id, finding.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = Boolean(busy) || Boolean(finding.revising);

  const approve = async (start: boolean) => {
    setBusy(start ? "start" : "create");
    setError("");
    const result = await onApprove(plan, start, agent, model);
    setBusy("");
    if (!result.ok) setError(result.error || "The task could not be created.");
  };

  return (
    <article className={`dk-watch-card is-ready${finding.revising ? " is-revising" : ""}`} aria-labelledby={`watch-${finding.id}`} aria-busy={finding.revising || undefined}>
      <header className="dk-watch-card-head">
        <span className="dk-watch-kind">Assigned to you</span>
        <span className="dk-mono dk-faint">{String(finding.ref ?? "")}</span>
        <button type="button" className="dk-link dk-watch-title" id={`watch-${finding.id}`} onClick={onOpen} disabled={!finding.url}>
          {finding.title}
          {finding.url ? <ExternalLink size={12} aria-hidden="true" /> : null}
        </button>
      </header>
      <label className="dk-field" htmlFor={`watch-plan-${finding.id}`}>
        <span className="dk-label">Plan · Markdown</span>
        <textarea
          id={`watch-plan-${finding.id}`}
          className="dk-textarea dk-watch-plan"
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          rows={Math.min(16, Math.max(6, plan.split("\n").length + 1))}
          disabled={locked}
        />
      </label>
      <AgentChat finding={finding} current={() => ({ plan })} onRevise={onRevise} />
      {error ? <p className="dk-notice is-error" role="alert">{error}</p> : null}
      <footer className="dk-watch-card-foot">
        <button type="button" className="dk-btn dk-btn--ghost" onClick={onDismiss} disabled={locked}>
          <Trash2 size={14} aria-hidden="true" />
          Skip
        </button>
        <span className="dk-spacer" />
        {agents.length > 0 ? (
          <>
            <Dropdown
              className="dk-dropdown--chip"
              value={agent}
              ariaLabel="Agent to work on this ticket"
              options={agents.map((option) => ({ value: option.agent, label: option.label }))}
              onChange={(value) => {
                setAgent(value);
                setModel(agents.find((option) => option.agent === value)?.models[0] ?? "");
              }}
            />
            <Dropdown
              className="dk-dropdown--chip"
              value={model}
              ariaLabel="Model for the agent on this ticket"
              options={models.map((item) => ({ value: item, label: item }))}
              onChange={setModel}
            />
          </>
        ) : null}
        <button type="button" className="dk-btn" onClick={() => void approve(false)} disabled={locked}>
          {busy === "create" ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : null}
          Create task
        </button>
        <button type="button" className="dk-btn dk-btn--primary" onClick={() => void approve(true)} disabled={locked || !agent}>
          {busy === "start" ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
          {busy === "start" ? "Starting…" : "Create and start"}
        </button>
      </footer>
    </article>
  );
}

function AddWatch({ requestNoun, hostReady, existing, trackerSources, onAdd, onCancel }: {
  requestNoun: string;
  hostReady: boolean;
  existing: WatchRecord[];
  trackerSources: TrackerSourceOption[];
  onAdd: (kind: WatchKind, config: WatchConfig, intervalSeconds: number) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const taken = new Set(existing.filter((watch) => watch.kind !== "custom").map((watch) => watch.kind));
  const choices = KINDS.filter((item) => !taken.has(item.kind));
  const [kind, setKind] = useState<WatchKind>(choices[0]?.kind ?? "custom");
  const [condition, setCondition] = useState("");
  const [focus, setFocus] = useState("");
  const [sourceKey, setSourceKey] = useState(trackerSources[0] ? `${trackerSources[0].provider}:${trackerSources[0].name}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intervalByKind, setIntervalByKind] = useState<Record<string, number>>({});
  const chosenInterval = intervalByKind[kind] ?? DEFAULT_INTERVAL[paceOf(kind)];
  const info = kindInfo(kind);
  const source = trackerSources.find((item) => `${item.provider}:${item.name}` === sourceKey);
  const blocked = (info.needsHost && !hostReady) || (kind === "custom" && !condition.trim()) || (kind === "ticket-assigned" && !source);

  const add = async () => {
    setBusy(true);
    setError("");
    const config: WatchConfig = kind === "custom"
      ? { condition: condition.trim(), focus: focus.trim() }
      : kind === "ticket-assigned" && source
        ? { provider: source.provider, source: source.name, target: source.target }
        : {};
    const result = await onAdd(kind, config, chosenInterval);
    setBusy(false);
    if (!result.ok) setError(result.error || "The watch could not be added.");
  };

  return (
    <section className="dk-card dk-watch-add" aria-labelledby="watch-add-title">
      <div className="dk-watch-add-head">
        <h2 className="dk-section-title" id="watch-add-title">Add a watch</h2>
        <span className="dk-spacer" />
        <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={onCancel} aria-label="Close"><X size={14} /></button>
      </div>
      <div className="dk-watch-kinds" role="radiogroup" aria-label="What to watch">
        {choices.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={kind === item.kind}
              key={item.kind}
              className={`dk-watch-kind-option${kind === item.kind ? " is-current" : ""}`}
              onClick={() => setKind(item.kind)}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="dk-watch-kind-title">{item.title}</span>
              <span className="dk-watch-kind-detail">{item.detail(requestNoun)}</span>
            </button>
          );
        })}
      </div>

      {kind === "custom" ? (
        <div className="dk-watch-add-fields">
          <label className="dk-field" htmlFor="watch-condition">
            <span className="dk-label">Watch {requestNoun}s that…</span>
            <input id="watch-condition" className="dk-input" value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="touch anything under src/payments" />
          </label>
          <label className="dk-field" htmlFor="watch-focus">
            <span className="dk-label">and review them for… <span className="dk-faint">optional</span></span>
            <input id="watch-focus" className="dk-input" value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="card data handling, PCI rules, missing tests" />
          </label>
        </div>
      ) : null}

      {kind === "ticket-assigned" ? (
        trackerSources.length ? (
          <div className="dk-watch-add-fields">
            <span className="dk-label">Tracker</span>
            <Dropdown
              className="dk-dropdown--chip"
              ariaLabel="Tracker"
              value={sourceKey}
              onChange={setSourceKey}
              options={trackerSources.map((item) => ({ value: `${item.provider}:${item.name}`, label: item.label }))}
            />
            <p className="dk-hint">Each look reads the tracker through Claude, which takes a minute or so — so it cannot run more often than every five minutes.</p>
          </div>
        ) : (
          <p className="dk-notice is-needs">Import a ticket from your tracker once (Tasks → Import), and it can be watched from here.</p>
        )
      ) : null}

      <div className="dk-watch-add-fields dk-watch-pace">
        <span className="dk-label">How often</span>
        <Dropdown
          className="dk-dropdown--chip"
          ariaLabel="How often"
          value={String(chosenInterval)}
          onChange={(value) => setIntervalByKind((current) => ({ ...current, [kind]: Number(value) }))}
          options={intervalOptions(kind)}
        />
      </div>

      {info.needsHost && !hostReady ? <p className="dk-hint">This needs the project to be on GitHub or GitLab.</p> : null}
      {error ? <p className="dk-notice is-error" role="alert">{error}</p> : null}

      <footer className="dk-watch-card-foot">
        <span className="dk-spacer" />
        <button type="button" className="dk-btn dk-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="dk-btn dk-btn--primary" onClick={() => void add()} disabled={busy || blocked}>
          {busy ? <LoaderCircle size={14} className="dk-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          Add watch
        </button>
      </footer>
    </section>
  );
}

type ModelOption = { value: string; label: string };

/** Which default a watch's work falls under. */
function defaultKind(kind: WatchKind): keyof AutomationSettings["models"] {
  if (kind === "ticket-assigned") return "tracker";
  if (kind === "ci-failed" || kind === "my-request-comments") return "fix";
  return "review";
}

function modelLabel(options: ModelOption[], value: string) {
  const known = options.find((option) => option.value === value)?.label;
  if (known) return known;
  if (value === "hermes") return "Hermes · the project's model";
  if (value.startsWith("hermes:")) return `Hermes · ${value.slice(7)}`;
  return value.startsWith("codex:") ? `Codex · ${value.slice(6)}` : `Claude · ${value}`;
}

const HERMES_NOTE = "Hermes reviews on this project's own Hermes, with Pitwall's read-only guard, and learns from what it reads. It needs Hermes installed and signed in.";

/** Tracker reads go through the tracker connection set up in Claude, so only Claude can do them. */
const claudeOnly = (options: ModelOption[]) => options.filter((option) => !option.value.startsWith("codex:"));

const CODEX_SANDBOX_NOTE = "Codex reviews in its read-only sandbox: it cannot write or reach the network, but it can run commands and read files elsewhere on this Mac. Claude reviews with the shell off.";

const DEFAULT_ROWS: Array<{ kind: keyof AutomationSettings["models"]; label: string; detail: string }> = [
  { kind: "tracker", label: "Tracker reads", detail: "Ticket watches, and the board re-reading Jira, Linear or GitHub Issues" },
  { kind: "review", label: "Reviews", detail: "Review requests and custom watches" },
  { kind: "fix", label: "Fixes and replies", detail: "Failing CI and comments on your requests" },
  { kind: "writer", label: "Plans and descriptions", detail: "Ticket plans, pull request descriptions, matching custom watches" },
];

const BOARD_SYNC: Array<{ value: number; label: string }> = [
  { value: 0, label: "Only when I ask" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 120, label: "Every 2 hours" },
];

/** What every automation runs on unless a watch says otherwise, and how often the board re-reads its tracker. */
function AutomationDefaults({ settings, modelOptions, reviewOptions, onSave }: {
  settings: AutomationSettings;
  modelOptions: ModelOption[];
  /** The review list adds Hermes, which only reviews. */
  reviewOptions: ModelOption[];
  onSave: (patch: Partial<{ models: Partial<AutomationSettings["models"]>; boardSyncMinutes: number }>) => void;
}) {
  const withCurrent = (kind: keyof AutomationSettings["models"], value: string) => {
    const options = kind === "tracker" ? claudeOnly(modelOptions) : kind === "review" ? reviewOptions : modelOptions;
    return options.some((option) => option.value === value) ? options : [{ value, label: modelLabel(options, value) }, ...options];
  };
  return (
    <div className="dk-card dk-automation-defaults" role="group" aria-label="Automation defaults">
      <p className="dk-hint">Choose the agent and model for each kind of work; a watch can override it from its own row. Tracker reads stay on Claude, because they use the tracker connection set up in Claude.</p>
      {DEFAULT_ROWS.map((row) => (
        <div className="dk-automation-default" key={row.kind}>
          <span className="dk-row-main">
            <span className="dk-row-title">{row.label}</span>
            <span className="dk-row-sub">{row.detail}</span>
          </span>
          {row.kind === "review" && settings.models.review.startsWith("codex:") ? <span className="dk-hint dk-automation-note">{CODEX_SANDBOX_NOTE}</span> : null}
          {row.kind === "review" && settings.models.review.startsWith("hermes") ? <span className="dk-hint dk-automation-note">{HERMES_NOTE}</span> : null}
          <Dropdown
            className="dk-dropdown--chip"
            ariaLabel={`Model for ${row.label.toLowerCase()}`}
            value={settings.models[row.kind]}
            options={withCurrent(row.kind, settings.models[row.kind])}
            triggerLabel={modelLabel(reviewOptions, settings.models[row.kind])}
            onChange={(value) => onSave({ models: { [row.kind]: value } })}
          />
        </div>
      ))}
      <div className="dk-automation-default">
        <span className="dk-row-main">
          <span className="dk-row-title">Board re-reads its tracker</span>
          <span className="dk-row-sub">Keeps imported tasks current while Pitwall is open</span>
        </span>
        <Dropdown
          className="dk-dropdown--chip"
          ariaLabel="How often the board re-reads its tracker"
          value={String(settings.boardSyncMinutes)}
          options={BOARD_SYNC.map((option) => ({ value: String(option.value), label: option.label }))}
          onChange={(value) => onSave({ boardSyncMinutes: Number(value) })}
        />
      </div>
    </div>
  );
}

export function WatchPage({
  project,
  hostLabel,
  requestNoun,
  watches,
  findings,
  trackerSources,
  onAdd,
  onToggleWatch,
  onSetInterval,
  onRemoveWatch,
  onCheckNow,
  onRetry,
  onDismiss,
  onPost,
  onApproveFix,
  onApproveTicket,
  onRevise,
  onOpenUrl,
  agents,
  defaultAgent,
  focusFindingId = "",
  modelOptions = [],
  reviewModelOptions = modelOptions,
  automationSettings = null,
  onSetModel,
  onSaveAutomationSettings,
}: {
  project: Project;
  /** "GitHub", "GitLab" — or null where Pitwall cannot watch the host. */
  hostLabel: string | null;
  requestNoun: string;
  watches: WatchRecord[];
  findings: WatchFinding[];
  trackerSources: TrackerSourceOption[];
  onAdd: (kind: WatchKind, config: WatchConfig, intervalSeconds: number) => Promise<{ ok: boolean; error?: string }>;
  onToggleWatch: (watch: WatchRecord, enabled: boolean) => void;
  onSetInterval: (watch: WatchRecord, intervalSeconds: number) => void;
  onRemoveWatch: (watch: WatchRecord) => void;
  onCheckNow: () => Promise<void>;
  onRetry: (finding: WatchFinding) => void;
  onDismiss: (finding: WatchFinding) => void;
  onPost: (finding: WatchFinding, review: WatchReview, approveOnly?: boolean) => Outcome;
  onApproveFix: (finding: WatchFinding, fix: { commit: boolean; commitMessage: string; replies: WatchReply[] }) => Outcome;
  onApproveTicket: (finding: WatchFinding, plan: string, start: boolean, agent: string, model: string) => Outcome;
  onRevise: (finding: WatchFinding, instruction: string, current: unknown) => Promise<{ ok: boolean; error?: string }>;
  onOpenUrl: (url: string) => void;
  /** Who can be put on a ticket, and who is put on it unless the person picks otherwise. */
  agents: SwapOption[];
  defaultAgent: string;
  /** A card a notification pointed at: brought into view and marked for a moment. */
  focusFindingId?: string;
  /** Claude's and Codex's models, for the defaults and each watch's own choice. */
  modelOptions?: ModelOption[];
  /** The same, plus Hermes, for work that is a review. */
  reviewModelOptions?: ModelOption[];
  automationSettings?: AutomationSettings | null;
  /** "" puts the watch back on the default. */
  onSetModel?: (watch: WatchRecord, model: string) => void;
  onSaveAutomationSettings?: (patch: Partial<{ models: Partial<AutomationSettings["models"]>; boardSyncMinutes: number }>) => void;
}) {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  useEffect(() => {
    if (!focusFindingId) return;
    const card = document.querySelector(`[aria-labelledby="watch-${CSS.escape(focusFindingId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.classList.add("is-focused");
    const timer = window.setTimeout(() => card.classList.remove("is-focused"), 2400);
    return () => window.clearTimeout(timer);
  }, [focusFindingId]);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const prefix = requestNoun === "merge request" ? "!" : "#";
  const watchById = new Map(watches.map((watch) => [watch.id, watch]));
  const ready = findings.filter((finding) => finding.state === "ready");
  const working = findings.filter((finding) => finding.state === "queued" || finding.state === "reviewing");
  const failed = findings.filter((finding) => finding.state === "failed");
  const done = findings.filter((finding) => finding.state === "posted" || finding.state === "dismissed").slice(0, 10);
  const anyEnabled = watches.some((watch) => watch.enabled);

  const watchDetail = (watch: WatchRecord) => {
    if (watch.kind === "custom") return `${requestNoun}s that ${watch.config?.condition ?? ""}${watch.config?.focus ? ` · looking for ${watch.config.focus}` : ""}`;
    if (watch.kind === "ticket-assigned") return watch.config?.source ?? "Tracker";
    return "";
  };

  return (
    <section className="dk-page dk-watch" aria-label="Watch">
      <section className="dk-section" aria-labelledby="watch-list-title">
        <div className="dk-section-head">
          <div>
            <h2 className="dk-section-title" id="watch-list-title">Watches</h2>
            <p className="dk-section-desc">
              What Pitwall looks for {hostLabel ? `on ${hostLabel}` : "for this project"}. Whatever it finds waits here for your approval; nothing is posted, pushed or created until you say so.
            </p>
          </div>
          {anyEnabled ? (
            <button
              type="button"
              className="dk-btn dk-btn--sm dk-btn--ghost"
              onClick={async () => { setChecking(true); await onCheckNow(); setChecking(false); }}
              disabled={checking}
            >
              <RefreshCw size={13} className={checking ? "dk-spin" : undefined} aria-hidden="true" />
              Check now
            </button>
          ) : null}
          {automationSettings && onSaveAutomationSettings ? (
            <button
              type="button"
              className={`dk-btn dk-btn--sm dk-btn--ghost${defaultsOpen ? " is-current" : ""}`}
              onClick={() => setDefaultsOpen((open) => !open)}
              aria-expanded={defaultsOpen}
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              Models
            </button>
          ) : null}
          {!adding ? (
            <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" onClick={() => setAdding(true)}>
              <Plus size={13} aria-hidden="true" />
              Add watch
            </button>
          ) : null}
        </div>

        {defaultsOpen && automationSettings && onSaveAutomationSettings ? (
          <AutomationDefaults settings={automationSettings} modelOptions={modelOptions} reviewOptions={reviewModelOptions} onSave={onSaveAutomationSettings} />
        ) : null}

        {adding ? (
          <AddWatch
            requestNoun={requestNoun}
            hostReady={Boolean(hostLabel)}
            existing={watches}
            trackerSources={trackerSources}
            onAdd={async (kind, config, intervalSeconds) => {
              const result = await onAdd(kind, config, intervalSeconds);
              if (result.ok) setAdding(false);
              return result;
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        {watches.length ? (
          <div className="dk-list">
            {watches.map((watch) => {
              const info = kindInfo(watch.kind);
              const Icon = info.icon;
              return (
                <div className={`dk-list-row dk-watch-row${watch.enabled ? "" : " is-paused"}`} key={watch.id}>
                  <Icon size={16} className="dk-faint" aria-hidden="true" />
                  <span className="dk-row-main">
                    <span className="dk-row-title">{info.title}</span>
                    <span className="dk-row-sub">
                      {[watchDetail(watch), watch.enabled ? `last checked ${ago(watch.lastCheckedAt, now)}` : "paused"].filter(Boolean).join(" · ")}
                      {watch.enabled && watch.lastError ? <span className="dk-watch-error"> · {watch.lastError}</span> : null}
                    </span>
                  </span>
                  <Dropdown
                    className="dk-dropdown--chip dk-watch-pace-select"
                    ariaLabel={`How often ${info.title} looks`}
                    value={String(intervalOf(watch))}
                    onChange={(value) => onSetInterval(watch, Number(value))}
                    options={intervalOptions(watch.kind)}
                    triggerLabel={everyLabel(intervalOf(watch))}
                  />
                  {automationSettings && onSetModel ? (() => {
                    const fallback = automationSettings.models[defaultKind(watch.kind)];
                    const own = watch.config?.model || "";
                    const reviews = watch.kind === "review-requested" || watch.kind === "custom";
                    const choices = watch.kind === "ticket-assigned" ? claudeOnly(modelOptions) : reviews ? reviewModelOptions : modelOptions;
                    const options = [
                      { value: "", label: `Default · ${modelLabel(reviewModelOptions, fallback)}` },
                      ...(own && !choices.some((option) => option.value === own) ? [{ value: own, label: modelLabel(choices, own) }] : []),
                      ...choices,
                    ];
                    return (
                      <Dropdown
                        className="dk-dropdown--chip dk-watch-model-select"
                        ariaLabel={`Model ${info.title} runs on`}
                        value={own}
                        onChange={(value) => onSetModel(watch, value)}
                        options={options}
                        triggerLabel={modelLabel(reviewModelOptions, own || fallback)}
                      />
                    );
                  })() : null}
                  <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={() => onToggleWatch(watch, !watch.enabled)} aria-pressed={watch.enabled}>
                    {watch.enabled ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={() => onRemoveWatch(watch)} aria-label={`Remove the ${info.title} watch`} title="Remove this watch">
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : !adding ? (
          <p className="dk-empty dk-card">
            <strong>Nothing is being watched</strong>
            Add a watch to have Pitwall pick up review requests, failed pipelines, comments on your {requestNoun}s or newly assigned tickets in {project.name}.
          </p>
        ) : null}
      </section>

      {ready.length ? (
        <section className="dk-section" aria-labelledby="watch-ready">
          <div className="dk-section-head"><div><h2 className="dk-section-title" id="watch-ready">Waiting for you · {ready.length}</h2></div></div>
          {ready.map((finding) => {
            const kind = finding.kind ?? "review-requested";
            if (kind === "ci-failed" || kind === "my-request-comments") {
              return (
                <FixCard
                  key={finding.id}
                  finding={finding}
                  prefix={prefix}
                  onApprove={(fix) => onApproveFix(finding, fix)}
                  onRevise={(instruction, current) => onRevise(finding, instruction, current)}
                  onDismiss={() => onDismiss(finding)}
                  onOpen={() => onOpenUrl(finding.url)}
                  onOpenUrl={onOpenUrl}
                />
              );
            }
            if (kind === "ticket-assigned") {
              return (
                <TicketCard
                  key={finding.id}
                  finding={finding}
                  agents={agents}
                  defaultAgent={defaultAgent}
                  onApprove={(plan, start, agent, model) => onApproveTicket(finding, plan, start, agent, model)}
                  onRevise={(instruction, current) => onRevise(finding, instruction, current)}
                  onDismiss={() => onDismiss(finding)}
                  onOpen={() => { if (finding.url) onOpenUrl(finding.url); }}
                />
              );
            }
            return (
              <ReviewCard
                key={finding.id}
                finding={finding}
                prefix={prefix}
                focus={kind === "custom" ? watchById.get(finding.watchId)?.config?.condition ?? "" : ""}
                onPost={(review, approveOnly) => onPost(finding, review, approveOnly)}
                onRevise={(instruction, current) => onRevise(finding, instruction, current)}
                onDismiss={() => onDismiss(finding)}
                onOpen={() => onOpenUrl(finding.url)}
              />
            );
          })}
        </section>
      ) : null}

      {working.length || failed.length ? (
        <section className="dk-section" aria-labelledby="watch-working">
          <div className="dk-section-head"><div><h2 className="dk-section-title" id="watch-working">Being worked on</h2></div></div>
          <div className="dk-list">
            {working.map((finding) => (
              <div className="dk-list-row" key={finding.id}>
                <LoaderCircle size={14} className="dk-spin dk-faint" aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{finding.kind === "ticket-assigned" ? String(finding.ref ?? "") : `${prefix}${finding.number}`} {finding.title}</span>
                  <span className="dk-row-sub">
                    {finding.state === "queued" ? "Waiting its turn" : finding.kind === "ci-failed" ? "Reading the failed jobs…" : finding.kind === "my-request-comments" ? "Working through the comments…" : finding.kind === "ticket-assigned" ? "Drafting a plan…" : "Reading the change…"}
                    {` · ${kindInfo(finding.kind).title}`}
                  </span>
                </span>
              </div>
            ))}
            {failed.map((finding) => (
              <div className="dk-list-row" key={finding.id}>
                <span className="dk-dot is-failed" aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{finding.kind === "ticket-assigned" ? String(finding.ref ?? "") : `${prefix}${finding.number}`} {finding.title}</span>
                  <span className="dk-row-sub dk-watch-error">{finding.error || "This could not be worked out."}</span>
                </span>
                <button type="button" className="dk-btn dk-btn--sm" onClick={() => onRetry(finding)}>Try again</button>
                <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={() => onDismiss(finding)}>Set aside</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {anyEnabled && !ready.length && !working.length && !failed.length ? (
        <p className="dk-empty dk-card">
          <strong>Nothing waiting on you</strong>
          What the watches find appears here within a couple of minutes.
        </p>
      ) : null}

      {done.length ? (
        <section className="dk-section" aria-labelledby="watch-done">
          <div className="dk-section-head"><div><h2 className="dk-section-title" id="watch-done">Done</h2></div></div>
          <div className="dk-list">
            {done.map((finding) => (
              <button type="button" className="dk-list-row dk-watch-done" key={finding.id} onClick={() => (finding.postedUrl || finding.url) && onOpenUrl(finding.postedUrl || finding.url)}>
                <span className={`dk-dot ${finding.state === "posted" ? "is-ready" : "is-quiet"}`} aria-hidden="true" />
                <span className="dk-row-main">
                  <span className="dk-row-title">{finding.kind === "ticket-assigned" ? String(finding.ref ?? "") : `${prefix}${finding.number}`} {finding.title}</span>
                  <span className="dk-row-sub">{kindInfo(finding.kind).title} · {finding.state === "posted" ? "done" : "set aside"} {ago(finding.updatedAt, now)}</span>
                </span>
                <ExternalLink size={13} className="dk-faint" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
