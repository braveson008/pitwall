import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { AgentSession } from "../data";
import {
  attentionDuration,
  formatDuration,
  readSessionAttention,
  type SessionAttention,
  type SessionActivity,
} from "../lib/sessionAttention";
import { moveSessionTo, nudgeSession } from "../lib/sessionOrder";

/**
 * The open project's sessions, nested under it in the sidebar.
 *
 * This used to be a second list beside the terminal, repeating what the sidebar
 * already showed and costing the terminal 220px. Living here alone, each row
 * carries what that list was for — which one needs you, and for how long — and
 * rows stay where they are put: selecting a session changes the state it
 * reports, so sorting on state would move the row out from under the cursor.
 */

export type CouncilRail = {
  /** What the group is called on screen: the run's name, or a count. */
  label: string;
  /** Named for the delete control, which acts on the whole run. */
  runName: string | null;
  sessions: AgentSession[];
  /** Absent until a run is selected — there is nothing to delete before that. */
  onDeleteRun: (() => void) | null;
  /** Switches the workbench to the Council tab, where the debate is readable. */
  onOpenCouncil: () => void;
};

/** Sessions shown before the rest go behind "Show all". */
const SESSION_LIMIT = 8;

const GLYPH_BY_LEVEL: Record<SessionAttention["level"], string> = {
  working: "is-working",
  "needs-you": "is-needs",
  failed: "is-failed",
  done: "is-done",
  quiet: "is-quiet",
  idle: "is-idle",
};

/** How long the pointer rests on a row before its full name shows. */
const PEEK_DELAY_MS = 350;

type Peek = { session: AgentSession; name: string; attention: SessionAttention; top: number; left: number };

/**
 * The full name, beside a row the sidebar had to cut short.
 *
 * The native tooltip took over a second to appear and looked like nothing else
 * in the app. Once one is showing, moving to the next row swaps it at once, so
 * running the pointer down the list reads every name.
 */
export function usePeek() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const showing = useRef(false);
  showing.current = peek !== null;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A card left behind by a scroll would point at the wrong row.
  useEffect(() => {
    if (!peek) return;
    const hide = () => setPeek(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [peek]);

  const enter = (element: HTMLElement, session: AgentSession, attention: SessionAttention, name: string) => {
    window.clearTimeout(timer.current);
    const show = () => {
      const box = element.getBoundingClientRect();
      setPeek({ session, name, attention, top: box.top + box.height / 2, left: box.right + 8 });
    };
    if (showing.current) show();
    else timer.current = window.setTimeout(show, PEEK_DELAY_MS);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    setPeek(null);
  };
  return { peek, enter, leave };
}

export function PeekCard({ peek, detail }: { peek: Peek; detail?: string }) {
  return createPortal(
    <div className="dk-peek" role="tooltip" style={{ top: peek.top, left: peek.left }}>
      <span className="dk-peek-title">{peek.name}</span>
      <span className="dk-peek-meta">
        {[detail, peek.session.agent, peek.attention.label, durationText(peek.attention)].filter(Boolean).join(" · ")}
      </span>
    </div>,
    document.body,
  );
}

/** A drag in flight, and the gap it is currently pointing at. */
type DragState = { id: string; slot: number };

type RowDrag = {
  index: number;
  state: DragState | null;
  onStart: () => void;
  onHover: (slot: number) => void;
  onEnd: () => void;
  onNudge: (delta: number) => void;
};

function durationText(attention: SessionAttention) {
  const duration = attentionDuration(attention);
  return duration !== null ? formatDuration(duration) : "";
}

function meta(attention: SessionAttention) {
  if (attention.level === "needs-you") return { text: "needs you", tone: " is-needs" };
  if (attention.level === "failed") return { text: "failed", tone: " is-failed" };
  return { text: durationText(attention), tone: "" };
}

export function SessionRow({
  session,
  name,
  attention,
  selected,
  drag,
  onSelect,
  onDelete,
  onPeek,
  onUnpeek,
  rowId,
  deleteLabel,
}: {
  session: AgentSession;
  /** The whole name, even where the saved one was cut. */
  name: string;
  attention: SessionAttention;
  selected: boolean;
  drag?: RowDrag;
  onSelect: () => void;
  onDelete?: () => void;
  onPeek: (element: HTMLElement, session: AgentSession, attention: SessionAttention, name: string) => void;
  onUnpeek: () => void;
  /** Marks the row for whoever drives the sidebar from outside, tests included. */
  rowId?: string;
  /** What the delete control says it removes, when that is more than this session. */
  deleteLabel?: { label: string; title: string };
}) {
  const active = drag?.state ?? null;
  const elsewhere = active !== null && active.id !== session.id;
  const { text, tone } = meta(attention);

  const classes = [
    "dk-session-item",
    active?.id === session.id ? "is-dragging" : "",
    elsewhere && active.slot === drag!.index ? "is-drop-before" : "",
    elsewhere && active.slot === drag!.index + 1 ? "is-drop-after" : "",
  ].filter(Boolean).join(" ");

  return (
    <li
      className={classes}
      // The whole row drags. A click that slips a few pixels stays over its own
      // row, and dropping a row on itself is no move, so nothing reorders by accident.
      draggable={Boolean(drag)}
      onDragStart={
        drag &&
        ((event) => {
          event.dataTransfer.effectAllowed = "move";
          // Chromium refuses to start a drag with no payload, even one nothing reads.
          event.dataTransfer.setData("text/plain", session.id);
          drag.onStart();
        })
      }
      onDragOver={
        drag &&
        ((event) => {
          if (!drag.state) return;
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          drag.onHover(drag.index + (event.clientY > box.top + box.height / 2 ? 1 : 0));
        })
      }
      // Only clears: dragend always follows a successful drop, so committing
      // here as well would apply the move twice.
      onDragEnd={drag && (() => drag.onEnd())}
    >
      <button
        type="button"
        className={`dk-row dk-session${selected ? " is-current" : ""}`}
        aria-current={selected ? "page" : undefined}
        data-sidebar-row={rowId}
        onMouseEnter={(event) => onPeek(event.currentTarget, session, attention, name)}
        onMouseLeave={onUnpeek}
        onFocus={(event) => onPeek(event.currentTarget, session, attention, name)}
        onBlur={onUnpeek}
        onClick={() => { onUnpeek(); onSelect(); }}
        onKeyDown={
          drag &&
          ((event) => {
            // Alt, so the bare arrows stay free for moving between rows.
            if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            event.preventDefault();
            drag.onNudge(event.key === "ArrowUp" ? -1 : 1);
          })
        }
      >
        <span className={`dk-glyph ${GLYPH_BY_LEVEL[attention.level]}`} aria-hidden="true" />
        <span className="dk-row-label">{name}</span>
        <span className={`dk-session-meta${tone}`} aria-label={attention.label}>{text}</span>
      </button>
      {onDelete ? (
        <button
          className="dk-icon-button dk-session-delete"
          type="button"
          aria-label={deleteLabel?.label ?? `Delete session ${session.name}`}
          title={deleteLabel?.title ?? "Delete session"}
          onClick={onDelete}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

export const SidebarSessions = memo(function SidebarSessions({
  sessions,
  selectedId,
  attachedBySession,
  activity,
  waitingIds,
  fullNames = {},
  busyById,
  now,
  council,
  onSelect,
  onDelete,
  onReorder,
  onShowAll,
}: {
  /** Already in the arranged order; the list presents them, it does not sort. */
  sessions: AgentSession[];
  /** Empty while no session is on screen, so nothing reads as selected. */
  selectedId: string;
  attachedBySession: Record<string, boolean>;
  activity: Record<string, SessionActivity>;
  /** Sessions known to be waiting on an answer. */
  waitingIds: string[];
  /** Full names for sessions whose saved name was cut short, by id. */
  fullNames?: Record<string, string>;
  /** Read off each pane: busy, at its prompt, or unknown. */
  busyById: Record<string, boolean | null>;
  now: number;
  council?: CouncilRail | null;
  onSelect: (session: AgentSession) => void;
  onDelete: (session: AgentSession) => void;
  /** Receives the whole new order once a drag or a nudge settles. */
  onReorder: (orderedIds: string[]) => void;
  onShowAll: () => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const { peek, enter, leave } = usePeek();
  const waiting = new Set(waitingIds);
  const read = (session: AgentSession) =>
    readSessionAttention(session, activity[session.id], now, {
      // A session can say it is waiting before its menu is on a mounted screen.
      waiting: waiting.has(session.id) || session.status === "waiting",
      attached: attachedBySession[session.id],
      busy: busyById[session.id] ?? null,
    });

  const orderedIds = sessions.map((session) => session.id);
  // The selected session stays visible even when it sits past the limit.
  const selectedIndex = orderedIds.indexOf(selectedId);
  const shown = sessions.slice(0, Math.max(SESSION_LIMIT, selectedIndex + 1));
  const hidden = sessions.length - shown.length;

  const commit = () => {
    if (drag) onReorder(moveSessionTo(orderedIds, drag.id, drag.slot));
    setDrag(null);
  };

  if (sessions.length === 0 && !council?.sessions.length) return null;

  return (
    <div className="dk-session-list">
      {shown.length > 0 ? (
        <ol
          className="dk-session-rows"
          aria-label="Sessions"
          aria-describedby="sidebar-sessions-reorder-hint"
          onDragOver={(event) => {
            if (!drag) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          {shown.map((session, index) => (
            <SessionRow
              key={session.id}
              session={session}
              name={fullNames[session.id] || session.name || session.branch}
              attention={read(session)}
              selected={session.id === selectedId}
              drag={{
                index,
                state: drag,
                onStart: () => setDrag({ id: session.id, slot: index }),
                onHover: (slot) => setDrag((current) => (current && current.slot !== slot ? { ...current, slot } : current)),
                onEnd: () => setDrag(null),
                onNudge: (delta) => onReorder(nudgeSession(orderedIds, session.id, delta)),
              }}
              onSelect={() => onSelect(session)}
              onDelete={() => onDelete(session)}
              onPeek={enter}
              onUnpeek={leave}
            />
          ))}
        </ol>
      ) : null}
      <p id="sidebar-sessions-reorder-hint" className="sr-only">
        To reorder a session, drag it, or hold Option and press the up or down arrow.
      </p>
      {hidden > 0 ? (
        <button type="button" className="dk-row dk-session dk-show-all" onClick={onShowAll}>
          <span className="dk-row-label">Show all {sessions.length}</span>
        </button>
      ) : null}
      {council && council.sessions.length > 0 ? (
        // One piece of work carried out by several sessions, so it reads as a
        // group with its own delete. Members keep the order the debate ran in.
        <div className="dk-session-group">
          <div className="dk-session-group-head">
            <button type="button" className="dk-row dk-session dk-session-group-title" onClick={council.onOpenCouncil} title="Open this Council's thread">
              <span className="dk-row-label">{council.label}</span>
            </button>
            {council.onDeleteRun ? (
              <button
                type="button"
                className="dk-icon-button dk-session-delete"
                aria-label={`Delete Council ${council.runName ?? "run"}`}
                title="Delete this Council and all of its agent sessions"
                onClick={council.onDeleteRun}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <ol className="dk-session-rows" aria-label="Council members">
            {council.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                name={fullNames[session.id] || session.name || session.branch}
                attention={read(session)}
                selected={session.id === selectedId}
                onSelect={() => onSelect(session)}
                onPeek={enter}
                onUnpeek={leave}
              />
            ))}
          </ol>
        </div>
      ) : null}
      {peek && !drag ? <PeekCard peek={peek} /> : null}
    </div>
  );
});
