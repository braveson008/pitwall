import { AlertTriangle, ArrowDown, ArrowRight, CheckCircle2, PauseCircle, Pin, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ThreadMessage } from "./ThreadMessage";
import type { CouncilRelayMember, CouncilThreadMessage } from "../lib/councilRelay";
import {
  buildThread,
  buildTurnStrip,
  memberAgent,
  memberLabel,
  type RouteRecord,
  type ThreadEntry,
} from "../lib/councilThread";
import {
  hasLiveWork,
  orderForDisplay,
  stateLabel,
  type MemberWork,
} from "../lib/councilActivity";
import { formatDuration } from "../lib/sessionAttention";

/**
 * The council as a discussion.
 *
 * The grid of terminals shows each member working; it cannot show them working
 * *together*, because the argument between them and the conductor's reasons for
 * routing it are spread across three scrollbacks. This is the same run read as
 * one conversation, which is the only form in which "a conductor decided who
 * speaks next, and here is why" is a thing you can actually check.
 */

/**
 * A thing that happened to the run, rather than a thing a member said.
 *
 * Three tones and no more. "The work is done", "something needs you" and
 * "something went wrong" are the three states a person acts on differently; a
 * fourth would be a shade of one of them and would only make the first three
 * harder to tell apart at a glance.
 */
export type ThreadNotice = {
  tone: "done" | "attention" | "warn";
  title: string;
  /** The title as one word, for the status line where the note follows it. */
  word: string;
  detail?: string;
  /** Turn count, elapsed — the sort of thing that reads as a caption. */
  meta?: string;
};

function NoticeIcon({ tone }: { tone: ThreadNotice["tone"] }) {
  const Icon = tone === "done" ? CheckCircle2 : tone === "attention" ? PauseCircle : AlertTriangle;
  return <Icon size={15} aria-hidden="true" />;
}

const SOURCE_LABEL: Record<string, string> = {
  conductor: "Conductor",
  addressed: "Handed over",
  rotation: "Rotation",
};

const MARK_TINTS = 4;

/** Which role tint a member wears: its seat in the roster, so it never changes mid-run. */
export function markTint(members: readonly CouncilRelayMember[], memberId: string | null | undefined): number {
  const index = members.findIndex((member) => member.memberId === memberId);
  return index < 0 ? MARK_TINTS : index % MARK_TINTS;
}

/** The letter tile that says who is speaking before the name does. */
export function RoleMark({ label, tint }: { label: string; tint: number }) {
  return (
    <span className={`dk-council-mark is-tint-${tint}`} aria-hidden="true">
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function CouncilThread({
  members,
  memberWork = [],
  notice,
  messages,
  routes,
  currentMemberId,
  currentTurn,
  onOpenMember,
}: {
  members: CouncilRelayMember[];
  /** What each member is doing right now, while they are doing it. */
  memberWork?: MemberWork[];
  /**
   * What just happened to the run, said in the thread rather than only in the
   * bar above it. The bar carries the controls and stays put; this is the same
   * news in the place you are actually reading, and it stays in the transcript
   * afterwards instead of vanishing when the next thing happens.
   */
  notice?: ThreadNotice;
  messages: CouncilThreadMessage[];
  routes: RouteRecord[];
  currentMemberId?: string;
  currentTurn: number;
  /** Jumps to a member's own terminal, for anyone who wants the raw output. */
  onOpenMember: (sessionId: string) => void;
}) {
  const entries = buildThread(messages, routes);
  const stops = buildTurnStrip(routes, currentMemberId, currentTurn);
  const logRef = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const [newActivity, setNewActivity] = useState(false);
  // Whatever was said last is what the reader came for, so it is the one card
  // that starts open. Everything above it is history they can unfold.
  const lastSaidKey = [...entries].reverse().find((entry) => entry.kind === "said")?.key;

  // Who is mid-thought. Ordered so the member whose turn it is leads, then
  // whoever has been going longest.
  const live = hasLiveWork(memberWork)
    ? orderForDisplay(memberWork).filter((member) => member.state === "working" || member.state === "waiting")
    : [];

  // Only follow while the reader is at the end. Scroll the log itself so a
  // new handoff never moves the surrounding workspace or interrupts history.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (following.current) {
      log.scrollTop = log.scrollHeight;
      setNewActivity(false);
    } else {
      setNewActivity(true);
    }
  }, [entries.length, live.length, notice?.title]);

  const sessionFor = (memberId: string) => members.find((member) => member.memberId === memberId)?.sessionId;
  const routedTo = (memberId: string) =>
    [memberLabel(members, memberId), memberAgent(members, memberId)].filter(Boolean).join(" · ");

  return (
    <div className="dk-council-thread-wrap">
    {/* Who sits on the council and what each is doing; one click to its terminal. */}
    <aside className="dk-council-members" aria-label="Members">
      {members.map((member) => {
        const work = memberWork.find((item) => item.memberId === member.memberId);
        const turn = member.memberId === currentMemberId;
        const state = work?.state === "waiting" ? "Needs you" : turn ? "Has the turn" : work ? stateLabel(work.state) : "Idle";
        return (
          <button
            type="button"
            key={member.memberId}
            className={`dk-council-member${turn ? " is-turn" : ""}${work?.state === "waiting" ? " is-needs" : ""}`}
            onClick={() => onOpenMember(member.sessionId)}
            title={`Open ${member.roleLabel}'s terminal`}
          >
            <RoleMark label={member.roleLabel} tint={markTint(members, member.memberId)} />
            <span className="dk-council-member-text">
              <span className="dk-council-member-role">{member.roleLabel}</span>
              <span className="dk-council-member-meta">{member.agentLabel} · {state}</span>
            </span>
          </button>
        );
      })}
    </aside>
    <div className="dk-council-thread">
      {stops.length > 0 ? (
        <ol className="dk-council-turns" aria-label="How the work has moved">
          {stops.map((stop, index) => (
            <li
              key={`${stop.turn}-${stop.memberId}-${index}`}
              className={stop.current ? "is-current" : undefined}
              title={`Turn ${stop.turn} · ${memberLabel(members, stop.memberId)}`}
            >
              <span className="sr-only">
                Turn {stop.turn}, {memberLabel(members, stop.memberId)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <div
        className="dk-council-thread-log"
        ref={logRef}
        tabIndex={0}
        aria-label="Council conversation"
        onScroll={() => {
          const log = logRef.current;
          if (!log) return;
          following.current = log.scrollHeight - log.scrollTop - log.clientHeight <= 64;
          if (following.current) setNewActivity(false);
        }}
      >
        {entries.length === 0 && live.length === 0 ? (
          <p className="dk-council-thread-empty">
            Nothing has been said yet. The first member's opening position appears here.
          </p>
        ) : null}

        {entries.map((entry) =>
          entry.kind === "said" ? (
            <Said
              key={entry.key}
              entry={entry}
              members={members}
              sessionId={sessionFor(entry.from)}
              onOpenMember={onOpenMember}
              openByDefault={entry.key === lastSaidKey}
            />
          ) : (
            /* The decision between turns. This is the conductor's entire
               contribution, and it used to exist only as the latest hop in a
               one-line strip that the next hop overwrote. */
            <div
              className="dk-council-routed"
              key={entry.key}
              title={`Turn ${entry.turn}: ${memberLabel(members, entry.from) || "start"} to ${memberLabel(members, entry.to)}`}
            >
              <span className="dk-council-routed-text">
                <span>
                  <span className={`dk-council-routed-source is-${entry.source}`}>
                    {SOURCE_LABEL[entry.source] ?? entry.source}
                  </span>
                  {" → "}
                  {routedTo(entry.to)}
                  {entry.reason ? ` — ${entry.reason}` : null}
                </span>
              </span>
              {entry.directive ? (
                <span className="dk-council-routed-directive">
                  <Pin size={11} aria-hidden="true" />
                  {entry.directive}
                </span>
              ) : null}
            </div>
          ),
        )}

        {live.map((member) => (
          <Pending
            key={member.memberId}
            member={member}
            tint={markTint(members, member.memberId)}
            turn={currentTurn}
            onOpenMember={onOpenMember}
          />
        ))}

        {/* The council reaching the end of the work is the outcome the whole
            screen exists for, and it used to be indistinguishable from the
            council falling over: the same amber bar, the same warning triangle,
            and nothing at all in the thread you were reading. */}
        {notice ? (
          <div className={`dk-council-notice is-${notice.tone}`} role="status">
            <NoticeIcon tone={notice.tone} />
            <span className="dk-council-notice-text">
              <strong>{notice.title}</strong>
              {notice.detail ? <span>{notice.detail}</span> : null}
            </span>
            {notice.meta ? <span className="dk-council-notice-meta">{notice.meta}</span> : null}
          </div>
        ) : null}
      </div>
      {newActivity ? (
        <button
          type="button"
          className="dk-btn dk-btn--sm dk-council-new-activity"
          onClick={() => {
            const log = logRef.current;
            if (log) log.scrollTop = log.scrollHeight;
            following.current = true;
            setNewActivity(false);
          }}
        >
          <ArrowDown size={14} aria-hidden="true" /> New activity
        </button>
      ) : null}
    </div>
    </div>
  );
}

/**
 * A member mid-thought.
 *
 * Shaped like the message it is about to become and sitting where that message
 * will sit, so the thread grows into the answer rather than jumping from empty
 * to full. What it shows is the agent's own last few output lines: not a
 * spinner, which only says the app has not frozen, but the actual work — the
 * file it just read, the command it just ran.
 */
function Pending({
  member,
  tint,
  turn,
  onOpenMember,
}: {
  member: MemberWork;
  tint: number;
  turn: number;
  onOpenMember: (sessionId: string) => void;
}) {
  const waiting = member.state === "waiting";

  return (
    <article className={`dk-council-live${waiting ? " is-needs" : ""}`} aria-live="polite">
      <div className="dk-council-live-row">
        <RoleMark label={member.roleLabel} tint={tint} />
        <span className="dk-council-live-who">
          <strong>{member.roleLabel}</strong> · {member.agentLabel} · turn {turn}
        </span>
        <span className={`dk-dot ${waiting ? "is-needs" : "is-working dk-council-pulse"}`} aria-hidden="true" />
        <span className="dk-council-live-state">
          {stateLabel(member.state)}
          {member.forMs ? ` · ${formatDuration(member.forMs)}` : ""}
        </span>
        <span className="dk-spacer" />
        {/* A member that needs an answer is holding up everyone else, so its
            button is the thing to press rather than one more way to look. */}
        <button
          type="button"
          className={waiting ? "dk-btn dk-btn--attention dk-btn--sm" : "dk-btn dk-btn--ghost dk-btn--sm"}
          onClick={() => onOpenMember(member.sessionId)}
          title={waiting ? "Open the terminal and answer it" : "Open this member's terminal"}
        >
          {waiting ? "Answer it" : "View terminal"}
        </button>
      </div>

      {member.steps.length > 0 ? (
        <ol className="dk-council-live-steps">
          {member.steps.map((step, index) => (
            <li key={`${index}-${step}`} className={index === member.steps.length - 1 ? "is-current" : undefined}>
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <p className="dk-council-live-quiet">
          {waiting ? "It is asking for something. Open the terminal to answer." : "Starting up…"}
        </p>
      )}
    </article>
  );
}

/**
 * One thing a member, the council or the operator said.
 *
 * Folded unless it is the newest, because a handoff is a document: a heading, a
 * ticket reference, numbered acceptance criteria and several hundred lines of
 * reasoning. Shown in full, four of them make the thread longer than the
 * terminals it replaced, and the thing that made it worth reading — who said
 * what to whom — scrolls off the top.
 */
function Said({
  entry,
  members,
  sessionId,
  onOpenMember,
  openByDefault,
}: {
  entry: Extract<ThreadEntry, { kind: "said" }>;
  members: CouncilRelayMember[];
  sessionId?: string;
  onOpenMember: (sessionId: string) => void;
  openByDefault: boolean;
}) {
  const who =
    entry.author === "user" ? "You" : entry.author === "council" ? "The council" : memberLabel(members, entry.from);

  return (
    <div className={`dk-council-msg is-${entry.author}`}>
      <RoleMark label={who} tint={entry.author === "member" ? markTint(members, entry.from) : MARK_TINTS} />
      <ThreadMessage
        tone={entry.author === "user" ? "user" : entry.author === "council" ? "council" : "member"}
        who={who}
        agent={entry.author === "member" ? memberAgent(members, entry.from) : undefined}
        eyebrow={`Turn ${entry.turn}`}
        content={entry.content}
        openByDefault={openByDefault}
        foldLabel="the full handoff"
        meta={
          <>
            {entry.contributors && entry.contributors.length > 1 ? (
              <span
                className="dk-council-msg-meta"
                title={entry.contributors.map((id) => memberLabel(members, id)).join(", ")}
              >
                <Users size={11} aria-hidden="true" />
                {entry.contributors.length} answered together
              </span>
            ) : null}
            {entry.to ? (
              <span className="dk-council-msg-meta">
                <ArrowRight size={11} aria-hidden="true" />
                {memberLabel(members, entry.to)}
              </span>
            ) : null}
          </>
        }
        action={
          entry.author === "member" && sessionId ? (
            <button
              type="button"
              className="dk-btn dk-btn--ghost dk-btn--sm dk-council-msg-action"
              onClick={() => onOpenMember(sessionId)}
              title="Open this member's terminal"
            >
              View terminal
            </button>
          ) : null
        }
      />
    </div>
  );
}
