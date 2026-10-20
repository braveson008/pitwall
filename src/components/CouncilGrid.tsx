import type { TerminalLinesStore } from "../terminal/terminalLinesStore";
import { useAllTerminalLines } from "./LiveTerminalView";
import { ArrowRight, Boxes, MoreHorizontal, Route, Settings2 } from "lucide-react";
import { councilMemberRole } from "../lib/sessionNames";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AgentProvider, AgentSession } from "../data";
import {
  RELAY_TURN_LIMITS,
  formatCouncilActivity,
  formatCouncilDuration,
  normalizeTurnLimit,
  type CouncilActivity,
} from "../lib/councilRelay";
import type { BraveliTask } from "../domain/types";
import { AgentTerminalView } from "./AgentTerminalView";
import { CouncilThread, RoleMark, markTint } from "./CouncilThread";
import type { CouncilRelayMember, CouncilThreadMessage } from "../lib/councilRelay";
import { memberLabel, type RouteRecord } from "../lib/councilThread";
import { terminalNotices } from "../lib/terminalStream";
import { Dropdown } from "./Dropdown";
import { buildThreadNotice } from "../lib/councilNotice";
import type { MemberWork } from "../lib/councilActivity";
import { CouncilSummary, type CouncilSummaryProps } from "./CouncilSummary";
import { TerminalTypographyControls } from "./TerminalTypographyControls";
import { writeStored } from "../lib/storage";

export type RelayState = { state: "waiting" | "active" | "handed"; turn: number; canHandoff: boolean };

/** One agent a council seat can be handed to, and the models it can run. */
export type SwapOption = { agent: AgentProvider; label: string; models: string[] };

/** The conductor's latest routing decision, as shown in the council bar. */
export type RelayRouteView = {
  turn: number;
  fromMemberId: string;
  toMemberId: string;
  source: "conductor" | "addressed" | "rotation";
  reason: string;
  directive: string;
};

const ROUTE_SOURCE_LABEL: Record<RelayRouteView["source"], string> = {
  conductor: "Conductor routed",
  addressed: "Handed over directly",
  rotation: "Rotated",
};

/** One exchange in the conductor lane. */
export type ConductorNoteView = {
  id: string;
  role: "you" | "conductor" | "system";
  text: string;
};

const CONDUCTOR_ROLE_LABEL: Record<ConductorNoteView["role"], string> = {
  you: "You",
  conductor: "Conductor",
  system: "Pitwall",
};

/** The settings a council can have changed while it is still running. */
export type CouncilLiveConfig = {
  enabled: boolean;
  model: string;
  runTests: boolean;
  maxTurns: number | null;
};

const LIVE_MODEL_OPTIONS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "auto", label: "Auto" },
];

// Not the old "thread-open" flag: it was written "false" on every mount, so it
// cannot tell a choice from the old default.
const FLOOR_VIEW_KEY = "braveli-council-view";
const TERMINAL_ESCAPE_HINT_ID = "council-terminal-escape";

const LIVE_TURN_OPTIONS = [
  ...RELAY_TURN_LIMITS.map((limit) => ({ value: String(limit), label: `${limit} turns` })),
  { value: "unlimited", label: "Unlimited" },
];

/**
 * The council / compare workbench view — a grid of live agent terminals working
 * one task. All orchestration (spawn, gate, send, stop) lives in the parent;
 * this renders the grid and reports intents back through callbacks.
 */
export function CouncilGrid({
  active,
  ptySize,
  routes,
  thread,
  relayMembers,
  memberWork,
  currentMemberId,
  summary,
  onOpenMember,
  hasRun,
  mode,
  name,
  sessions,
  gateBySession,
  relayBySession,
  relayRun,
  onHandoff,
  onToggleRelayAuto,
  onExtendTurns,
  onExtendBudget,
  nextTasks = [],
  onStartAnotherTask,
  onUpdateConfig,
  onAdoptCouncil,
  linesStore,
  terminalFontFamily,
  terminalFontSize,
  onTerminalFontFamilyChange,
  onTerminalFontSizeChange,
  bootCommand,
  canStart,
  sharedMessage,
  broadcasting,
  conductorMessage,
  conductorLog,
  conductorDirectives,
  conductorBusy,
  conductorStatus,
  onConductorMessageChange,
  onAskConductor,
  onInstructConductor,
  onForceReroute,
  onSendAll,
  onSharedMessageChange,
  onBroadcast,
  onStopAll,
  onPause,
  onResume,
  onStopSession,
  onRestartSession,
  attachedBySession,
  droppedBySession,
  replayPreamble,
  swapOptions,
  onSwapMember,
  onDeleteSession,
  onSendSession,
  onSynthesize,
  onInput,
  onResize,
  onStart,
}: {
  active: boolean;
  /** Columns each session's PTY is running at, keyed by session id. */
  ptySize: Record<string, { cols: number; rows: number }>;
  hasRun: boolean;
  mode: "council" | "compare";
  name?: string;
  sessions: AgentSession[];
  gateBySession: Record<string, string>;
  relayBySession: Record<string, RelayState>;
  /** The conductor's whole decision history, not just the latest hop. */
  routes?: RouteRecord[];
  /** What the members have actually said to each other. */
  thread?: CouncilThreadMessage[];
  /** The roster, which is what turns an addressing handle into a role. */
  relayMembers?: CouncilRelayMember[];
  /** What each member is doing right now, for the thread to show while they work. */
  memberWork?: MemberWork[];
  currentMemberId?: string;
  summary?: CouncilSummaryProps;
  onOpenMember?: (sessionId: string) => void;
  relayRun?: {
    turn: number;
    auto: boolean;
    note: string;
    route?: RelayRouteView;
    testing?: boolean;
    costUsd?: number;
    /** Stopped because it ran out of turns, rather than because it finished. */
    atTurnLimit?: boolean;
    /** Stopped on the run's time budget rather than its turn count. */
    atRunBudget?: boolean;
    /** Halted by the user, with every member still alive and resumable. */
    paused?: boolean;
    /** Nobody is on the clock: the run has stopped, however it stopped. */
    stopped?: boolean;
    /** Whether the run stopped because it finished, or because something went wrong. */
    tone?: "done" | "warn" | "attention";
    finishedAt?: string;
    /** Stopped at the opening debate's outcome, waiting to be told to build it. */
    awaitingStart?: boolean;
    config?: CouncilLiveConfig;
    activity?: CouncilActivity;
    startedAt?: string;
  };
  onHandoff: (session: AgentSession) => void;
  onToggleRelayAuto: (auto: boolean) => void;
  onExtendTurns: (extraTurns: number | null) => void;
  onExtendBudget: (extraHours: number | null) => void;
  /** Tasks this council could be pointed at once it has finished one. */
  nextTasks?: BraveliTask[];
  /** Hands the finished council a new task, keeping the agents it has. */
  onStartAnotherTask?: (taskId: string) => void;
  onUpdateConfig: (patch: Partial<CouncilLiveConfig>) => void;
  onAdoptCouncil: () => void;
  /** Every session's output; read only while the grid is on screen. */
  linesStore: TerminalLinesStore;
  terminalFontFamily: string;
  terminalFontSize: number;
  onTerminalFontFamilyChange?: (fontFamily: string) => void;
  onTerminalFontSizeChange?: (fontSize: number) => void;
  bootCommand: (agent: AgentProvider, model: string) => string;
  canStart: boolean;
  sharedMessage: string;
  broadcasting: boolean;
  conductorMessage: string;
  conductorLog: ConductorNoteView[];
  /** Standing instructions, newest last — what the conductor is bound by now. */
  conductorDirectives: string[];
  conductorBusy: boolean;
  /** What the conductor is doing, while it does it. */
  conductorStatus?: string;
  onConductorMessageChange: (message: string) => void;
  onAskConductor: (question: string) => void;
  onInstructConductor: (instruction: string) => void;
  onForceReroute: () => void;
  onSendAll: () => void;
  onSharedMessageChange: (message: string) => void;
  onBroadcast: (scope: "all" | "current") => void;
  onStopAll: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStopSession: (session: AgentSession) => void;
  /** Brings a member's CLI back after it has exited. */
  onRestartSession: (session: AgentSession) => void;
  /** Which panes currently have a live terminal, so a dead one can say so. */
  attachedBySession: Record<string, boolean>;
  /**
   * Agents a seat can be handed to, already filtered to what is installed —
   * offering an agent that cannot start would swap a working member out for a
   * pane that never boots.
   */
  /** Chunks dropped off the front of each session's bounded transcript. */
  droppedBySession?: Record<string, number>;
  /** The terminal modes each member's program switched on, for replays. */
  replayPreamble?: (sessionId: string) => string;
  swapOptions: SwapOption[];
  onSwapMember: (session: AgentSession, agent: AgentProvider, model: string) => void;
  onDeleteSession: (session: AgentSession) => void;
  onSendSession: (session: AgentSession) => void;
  onSynthesize: () => void;
  onInput: (session: AgentSession, data: string) => void;
  onResize: (session: AgentSession, cols: number, rows: number) => void;
  onStart: () => void;
}) {
  const linesBySession = useAllTerminalLines(linesStore, active);
  /**
   * Thread first. The grid answers "what is each agent doing", which the rail
   * already answers; the thread answers "what did they decide, and why did the
   * work go there" — the question a Council exists to make answerable.
   */
  const [view, setView] = useState<"thread" | "agents" | "summary">("thread");
  const overflowRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (overflowRef.current?.open && !overflowRef.current.contains(event.target as Node)) overflowRef.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  /**
   * One member, given the whole width.
   *
   * Three columns of a CLI meant for eighty columns wraps every sentence twice.
   * Reading one member's output is a different job from watching all three, and
   * the grid was only good at the second.
   */
  /**
   * The one member whose terminal is open.
   *
   * Every member's terminal used to be mounted and drawn at once. Four of them
   * across a workbench is roughly 340 pixels each — narrow enough that a file
   * path wraps three times and none of the four can actually be read — and
   * four live terminals is four times the drawing, continuously, for three
   * panes nobody is looking at.
   *
   * So one is open and the rest are cards. Null means the member holding the
   * turn, which is the one worth watching by default and changes as the
   * council hands over.
   */
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  /**
   * The size the open pane fitted to.
   *
   * A member whose terminal is not mounted has no pane to measure, so its CLI
   * would keep whatever width it was spawned with and wrap its output for a
   * terminal that does not exist — the same fault as sizing every pane to a
   * fixed guess, arriving by a different route. Since exactly one member is
   * open and it takes the full width, that width is what every other member
   * will have the moment it is opened, so they are all told it now.
   */
  const [openSize, setOpenSize] = useState<{ cols: number; rows: number } | null>(null);

  /**
   * Which member is on screen: the one chosen, else whoever is speaking, else
   * the first. Resolved once here so the tab strip and the pane below it can
   * never disagree about who is open.
   */
  /* Which member, if any, has been given the whole floor. Distinct from
     openMemberId: that one always resolves to somebody, because something had
     to be shown when only one pane existed. Focus is nobody until asked. */
  const [focusedSessionId, setFocusedSessionId] = useState("");

  const openMemberId =
    openSessionId
    ?? sessions.find((session) =>
      relayMembers?.some((member) => member.sessionId === session.id && member.memberId === currentMemberId))?.id
    ?? sessions[0]?.id
    ?? "";
  // Which seat is being handed over, and to whom. Held here rather than per
  // cell so opening one picker closes the last.
  const [swapSessionId, setSwapSessionId] = useState<string | null>(null);

  /**
   * Keeps the closed members' CLIs at the width they will be read at.
   *
   * Sent whenever the open pane's size changes, so a member that produces
   * output while closed wraps for the pane it is about to appear in rather
   * than for the size it happened to be spawned with.
   */
  useEffect(() => {
    if (!openSize) return;
    for (const session of sessions) {
      if (ptySize[session.id]?.cols === openSize.cols) continue;
      onResize(session, openSize.cols, openSize.rows);
    }
    // onResize is a prop callback and stable enough; re-running on every
    // identity change would resize on every render of the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSize, sessions, ptySize]);
  const [swapAgent, setSwapAgent] = useState("");
  const [swapModel, setSwapModel] = useState("");
  /**
   * The member a notice's hand-off would move on.
   *
   * The one holding the turn, or the only one that can be handed off when the
   * run was restored and nobody holds it yet. Derived rather than assumed, so
   * the button only appears when there is something for it to do.
   */
  const handoffTarget =
    sessions.find(
      (session) =>
        currentMemberId &&
        relayMembers?.some((member) => member.memberId === currentMemberId && member.sessionId === session.id),
    ) ?? sessions.find((session) => relayBySession[session.id]?.canHandoff);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conductorOpen, setConductorOpen] = useState(false);
  const conductorLogRef = useRef<HTMLDivElement | null>(null);
  // A log that does not follow its newest entry shows the user the oldest thing
  // the conductor said, which is the one they have already read.
  useEffect(() => {
    const log = conductorLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conductorLog.length, conductorBusy, conductorOpen]);
  // Elapsed time has to advance on its own; a council can sit on one turn for
  // half an hour and a frozen clock would read as a frozen council.
  const [, setClockTick] = useState(0);
  const councilStartedAt = relayRun?.startedAt;
  useEffect(() => {
    if (!councilStartedAt) return;
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [councilStartedAt]);

  // Thread first. It lies over the panes rather than replacing them, so
  // switching between the two never refits a terminal.
  const viewRef = useRef<HTMLDivElement | null>(null);
  const threadToggleRef = useRef<HTMLButtonElement | null>(null);
  const [threadOpen, setThreadOpen] = useState(() => {
    try {
      return localStorage.getItem(FLOOR_VIEW_KEY) !== "agents";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      writeStored(FLOOR_VIEW_KEY, threadOpen ? "thread" : "agents");
    } catch {
      // A private-mode profile is not a reason to break the council.
    }
  }, [threadOpen]);
  const threadLength = thread?.length ?? 0;
  // Another council, or a thread that got shorter, starts from what is there.
  const [seenThread, setSeenThread] = useState({ run: name ?? "", length: threadLength });
  if (seenThread.run !== (name ?? "") || seenThread.length > threadLength) {
    setSeenThread({ run: name ?? "", length: threadLength });
  }
  useEffect(() => {
    if (threadOpen) setSeenThread({ run: name ?? "", length: threadLength });
  }, [threadOpen, threadLength, name]);
  const unreadThread = Math.max(0, threadLength - seenThread.length);
  const needsYou = new Set((memberWork ?? []).filter((member) => member.state === "waiting").map((member) => member.sessionId));
  // xterm keeps Tab for the CLI, so the way out is announced on its input.
  useEffect(() => {
    for (const input of viewRef.current?.querySelectorAll(".dk-council-pane-body textarea") ?? []) {
      input.setAttribute("aria-describedby", TERMINAL_ESCAPE_HINT_ID);
    }
  });

  const isRelay = sessions.some((session) => relayBySession[session.id]);

  /**
   * Who the composer is addressing.
   *
   * A conducted council hands the task to one member at a time; the rest are
   * waiting their turn. Sending a mid-run correction to all of them put the
   * message into agents that were not working — which either wakes them out of
   * turn or waits in their buffer until their turn starts, by which point the
   * correction is about work that has already moved on. So the default follows
   * the turn. A council without a conductor runs every member on the same
   * prompt at once, and there "everyone" is exactly right.
   */
  const [target, setTarget] = useState<"members" | "current" | "conductor">("members");
  // Snaps to whoever holds the turn once there is one, and stops as soon as the
  // user picks for themselves — a default that keeps reasserting itself is not
  // a default, it is a fight.
  const targetChosen = useRef(false);
  useEffect(() => {
    if (targetChosen.current) return;
    if (isRelay && currentMemberId) setTarget("current");
  }, [isRelay, currentMemberId]);
  const chooseTarget = (next: "members" | "current" | "conductor") => {
    targetChosen.current = true;
    setTarget(next);
  };
  // A run that has ended has nobody on turn, so the composer must not claim to
  // be addressing one.
  const currentTarget = target === "current" && !(isRelay && currentMemberId) ? "members" : target;
  const currentLabel = currentMemberId ? memberLabel(relayMembers ?? [], currentMemberId) : "";

  if (!hasRun) {
    return (
      <div className="dk-council-empty">
        <div className="dk-empty">
          <strong>No council running</strong>
          <span>Pick your agents and Pitwall spins each one up on the task — no session needed first.</span>
          <button type="button" className="dk-btn dk-btn--primary" onClick={onStart} disabled={!canStart}>
            <Boxes size={15} aria-hidden="true" />
            Start council
          </button>
        </div>
      </div>
    );
  }


  const config = relayRun?.config;
  const turnValue = config?.maxTurns === null ? "unlimited" : String(config?.maxTurns ?? "");
  const closeOverflow = () => { if (overflowRef.current) overflowRef.current.open = false; };

  /* One status line: what stopped the run, what the tests said, and the words
     that move it on. The same stall used to be told twice — a banner above and
     a notice at the foot of the thread — while the failing test run sat three
     clicks away in the summary. */
  const notice = isRelay ? buildThreadNotice({ ...relayRun, turn: relayRun?.turn }) : undefined;
  const tests = summary?.evidence?.tests;
  const testVerdict = tests ? (tests.timedOut ? "timed out" : tests.passed ? "passed" : "failed") : "";
  const handoffSession =
    isRelay && !relayRun?.atTurnLimit && handoffTarget &&
    (relayRun?.note || relayBySession[handoffTarget.id]?.canHandoff)
      ? handoffTarget
      : undefined;
  const offerReroute = notice?.tone === "warn" && config?.enabled !== false;
  const showStatus = isRelay && (notice || testVerdict || handoffSession);
  const threadVisible = isRelay && view !== "summary" && threadOpen;
  const agentsVisible = view !== "summary" && !threadVisible;
  const routeShown = Boolean(isRelay && agentsVisible && relayRun?.route);
  // Three or more terminals cannot all be read at once. The member holding the
  // turn gets the large pane; the rest stay in view beside it, smaller.
  const speakingSessionId = !relayRun?.stopped && currentMemberId
    ? relayMembers?.find((member) => member.memberId === currentMemberId)?.sessionId
    : undefined;
  const spotlightId = sessions.length >= 3 && !focusedSessionId
    ? (sessions.some((session) => session.id === speakingSessionId) ? speakingSessionId : sessions[0]?.id)
    : undefined;

  return (
    <div className="dk-council" ref={viewRef}>
      <div className="dk-council-bar">
        <div className="dk-council-heading">
          {/* Named for screen readers; on screen the task title is already
              in the Work header directly above. */}
          <h2 className="dk-council-title dk-visually-hidden">{name || (mode === "compare" ? "Compare responses" : "Council")}</h2>
          {/* The facts: how big the council is, how much it has done, and how
              long it has been going. */}
          <span className="dk-council-facts">
            <span>{mode === "compare" ? `${sessions.length} agents, independent` : `Council of ${sessions.length}`}</span>
            {isRelay && relayRun?.activity?.handoffs ? (
              <span title={formatCouncilActivity(relayRun.activity) || undefined}>
                {relayRun.activity.handoffs} handoff{relayRun.activity.handoffs === 1 ? "" : "s"}
              </span>
            ) : null}
            {isRelay && relayRun?.costUsd ? (
              <span title="Spent on conductor routing calls. Excludes the agents' own turns.">
                routing ${relayRun.costUsd.toFixed(2)}
              </span>
            ) : null}
            {isRelay && relayRun?.testing ? <span className="dk-council-testing">running tests</span> : null}
            {isRelay && relayRun?.startedAt ? (
              <span title={`Council started ${new Date(relayRun.startedAt).toLocaleString()}`}>
                {formatCouncilDuration(Date.now() - new Date(relayRun.startedAt).getTime())}
              </span>
            ) : null}
          </span>
        </div>
        <div className="dk-council-actions">
          {isRelay && (
            <div className="dk-segmented dk-council-view-toggle" role="group" aria-label="View">
              <button
                type="button"
                ref={threadToggleRef}
                className={[
                  threadVisible ? "is-current" : "",
                  needsYou.size ? "is-needs" : "",
                ].filter(Boolean).join(" ") || undefined}
                aria-pressed={threadVisible}
                aria-label={[
                  "Thread",
                  unreadThread ? `${unreadThread} unread` : "",
                  needsYou.size ? "a member needs you" : "",
                ].filter(Boolean).join(", ")}
                onClick={() => {
                  setThreadOpen(true);
                  if (view === "summary") setView("thread");
                }}
                title="What the members handed each other, and why the work went where it did"
              >
                Thread
                {unreadThread ? <span className="dk-council-unread"> {unreadThread}</span> : null}
              </button>
              <button
                type="button"
                className={agentsVisible ? "is-current" : undefined}
                aria-pressed={agentsVisible}
                onClick={() => {
                  setThreadOpen(false);
                  if (view === "summary") setView("agents");
                }}
                title="Every member's own terminal"
              >
                Terminals
              </button>
            </div>
          )}
          {isRelay && (
            <span className="dk-council-turn">
              Turn {relayRun?.turn ?? 1}{config?.maxTurns ? ` of ${config.maxTurns}` : ""}
            </span>
          )}
          {isRelay && (
            <div className="dk-segmented" role="group" aria-label="Hand-off">
              <button
                type="button"
                className={relayRun?.auto ? "is-current" : undefined}
                aria-pressed={relayRun?.auto ?? false}
                onClick={() => onToggleRelayAuto(true)}
                title="Advance the relay automatically whenever an agent writes its hand-off"
              >
                Auto
              </button>
              <button
                type="button"
                className={relayRun?.auto ? undefined : "is-current"}
                aria-pressed={!relayRun?.auto}
                onClick={() => onToggleRelayAuto(false)}
                title="Advance only when you hand off by hand"
              >
                Manual
              </button>
            </div>
          )}
          {isRelay && (
            relayRun?.paused ? (
              <button type="button" className="dk-btn dk-btn--sm" onClick={onResume} title="Carry on from the turn it paused on">
                Resume
              </button>
            ) : (
              <button
                type="button"
                className="dk-btn dk-btn--sm"
                onClick={onPause}
                title="Let the member on turn finish its hand-off, then wait. Nothing is lost and nothing is killed."
              >
                Pause
              </button>
            )
          )}
          {!isRelay && mode === "council" && sessions.length > 1 && (
            <button type="button" className="dk-btn dk-btn--sm" onClick={onAdoptCouncil} title="Put the conductor in charge of this council">
              Enable conductor
            </button>
          )}
          {onTerminalFontSizeChange && onTerminalFontFamilyChange && agentsVisible ? (
            <span className="dk-council-typography">
              <TerminalTypographyControls
                fontFamily={terminalFontFamily}
                fontSize={terminalFontSize}
                onFontFamilyChange={onTerminalFontFamilyChange}
                onFontSizeChange={onTerminalFontSizeChange}
              />
            </span>
          ) : null}
          <details
            className="dk-council-more"
            ref={overflowRef}
            onKeyDown={(event) => {
              if (event.key === "Escape" && overflowRef.current?.open) {
                overflowRef.current.open = false;
                overflowRef.current.querySelector("summary")?.focus();
              }
            }}
          >
            <summary className="dk-btn dk-btn--sm dk-btn--ghost" aria-label="Council options" title="Conductor, settings and other council actions">
              <Settings2 size={15} aria-hidden="true" />
              Options
              <MoreHorizontal size={15} aria-hidden="true" />
            </summary>
            <div className="dk-popover dk-council-more-menu">
              {isRelay ? (
                <button
                  type="button"
                  className={`dk-menu-item${conductorOpen ? " is-active" : ""}`}
                  aria-pressed={conductorOpen}
                  onClick={() => { closeOverflow(); setConductorOpen((current) => !current); }}
                  title="Talk to the conductor — ask why the work is going where it is, or give it an instruction it keeps"
                >
                  <span className="dk-row-label">Conductor</span>
                  {conductorDirectives.length ? <span className="dk-faint">{conductorDirectives.length} instruction{conductorDirectives.length === 1 ? "" : "s"}</span> : null}
                </button>
              ) : null}
              {isRelay && config ? (
                <button
                  type="button"
                  className={`dk-menu-item${settingsOpen ? " is-active" : ""}`}
                  aria-pressed={settingsOpen}
                  onClick={() => { closeOverflow(); setSettingsOpen((current) => !current); }}
                  title="Change how this council runs, without restarting it"
                >
                  <span className="dk-row-label">Council settings</span>
                </button>
              ) : null}
              {summary ? (
                <button
                  type="button"
                  className={`dk-menu-item${view === "summary" ? " is-active" : ""}`}
                  aria-pressed={view === "summary"}
                  onClick={() => setView(view === "summary" ? "thread" : "summary")}
                  title="Objective, decisions, verification and context delivered to the agents"
                >
                  Summary
                </button>
              ) : null}
              <button
                type="button"
                className="dk-menu-item"
                onClick={() => { closeOverflow(); onSynthesize(); }}
                title="Spawn an agent to combine the council's work into one recommendation"
              >
                Synthesize
              </button>
              <button
                type="button"
                className="dk-menu-item"
                onClick={() => { closeOverflow(); onSendAll(); }}
                title={mode === "compare" ? "Re-send the task to every agent" : "Re-send the task to the active stage only"}
              >
                {mode === "compare" ? "Send task to all" : "Send active stage"}
              </button>
              <button
                type="button"
                className="dk-menu-item dk-council-danger"
                onClick={() => { closeOverflow(); onStopAll(); }}
                title="End the run and kill every member's agent. This cannot be undone — use Pause to stop it temporarily."
              >
                Stop all
              </button>
            </div>
          </details>
        </div>
      </div>
      {/* The one channel that reaches the conductor alone. Everything else the
          user types goes to the members, who cannot route. */}
      {isRelay && conductorOpen ? (
        <section className="dk-council-conductor" aria-label="Conductor">
          <div className="dk-council-conductor-head">
            <strong>Conductor</strong>
            <span>
              What it has been told to do, and what it has said. To ask it something or add a standing instruction,
              address the composer to the conductor.
            </span>
            <button
              type="button"
              className="dk-btn dk-btn--sm"
              onClick={onForceReroute}
              disabled={conductorBusy}
              title="End the turn in flight and let the conductor route the work on from the thread as it stands"
            >
              Re-route
            </button>
          </div>
          {conductorDirectives.length ? (
            <ul className="dk-council-directives">
              {conductorDirectives.map((text, index) => (
                <li key={`${index}-${text}`}>{text}</li>
              ))}
            </ul>
          ) : null}
          {conductorLog.length ? (
            <div className="dk-council-conductor-log" ref={conductorLogRef}>
              {conductorLog.map((note) => (
                <div className={`dk-council-note is-${note.role}`} key={note.id}>
                  <span>{CONDUCTOR_ROLE_LABEL[note.role]}</span>
                  <p>{note.text}</p>
                </div>
              ))}
              {/* One word for up to four minutes made a slow conductor and a dead
                  one look the same. It says what it is doing and how long that
                  can take. */}
              {conductorBusy ? (
                <div className="dk-council-note is-pending">{conductorStatus || "Thinking…"}</div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {/* Changing these applies to the run in flight — the conversation, roster
          and routing history are untouched. */}
      {isRelay && settingsOpen && config ? (
        <div className="dk-council-config" role="group" aria-label="Council settings">
          <label className="dk-check">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => onUpdateConfig({ enabled: event.target.checked })}
            />
            <span>Conductor</span>
          </label>
          <Dropdown
            className="dk-dropdown--chip"
            value={config.model}
            onChange={(model) => onUpdateConfig({ model })}
            ariaLabel="Conductor model"
            options={LIVE_MODEL_OPTIONS}
          />
          <label className="dk-check">
            <input
              type="checkbox"
              checked={config.runTests}
              onChange={(event) => onUpdateConfig({ runTests: event.target.checked })}
            />
            <span>Run tests</span>
          </label>
          <Dropdown
            className="dk-dropdown--chip"
            value={turnValue}
            onChange={(value) =>
              onUpdateConfig({ maxTurns: value === "unlimited" ? null : normalizeTurnLimit(value) })
            }
            ariaLabel="Turn limit"
            triggerLabel={config.maxTurns === null ? "Unlimited" : `${config.maxTurns} turns`}
            options={LIVE_TURN_OPTIONS}
          />
          <span className="dk-hint">Applies to this run — the thread is kept.</span>
        </div>
      ) : null}
      {/* Only beside the terminals. In the thread every hop is in place with its
          reason, so repeating the latest one above it is noise. */}
      {showStatus || routeShown ? (
        <div className={`dk-council-status is-${notice?.tone ?? "live"}`} role="status">
          {/* Who has the turn and why, on the same line as what can be done
              about it. Beside the terminals only: the thread already shows
              every hop in place. */}
          {routeShown && relayRun?.route ? (
            <span className="dk-council-route">
              <Route size={13} aria-hidden="true" />
              <span className="dk-council-route-hop">
                {memberLabel(relayMembers ?? [], relayRun.route.fromMemberId) || "Start"}
                <ArrowRight size={11} aria-hidden="true" />
                <strong>{memberLabel(relayMembers ?? [], relayRun.route.toMemberId)}</strong>
              </span>
              <span
                className={`dk-badge dk-council-route-source is-${relayRun.route.source}${
                  relayRun.route.source === "conductor" ? " dk-badge--accent" : ""
                }`}
              >
                {ROUTE_SOURCE_LABEL[relayRun.route.source]}
              </span>
              <span className="dk-council-route-reason">{relayRun.route.directive || relayRun.route.reason}</span>
            </span>
          ) : null}
          {notice ? <strong className="dk-council-status-word">{notice.word}</strong> : null}
          {notice || !routeShown ? (
            <span className="dk-council-status-text">
              {notice ? notice.detail : currentLabel ? `${currentLabel} has the turn` : ""}
            </span>
          ) : <span className="dk-spacer" />}
          {tests ? (
            <span className={`dk-council-status-tests is-${testVerdict === "passed" ? "passed" : "failed"}`}>
              <span className="dk-mono">{tests.command}</span> {testVerdict}
            </span>
          ) : null}
          <span className="dk-council-status-actions">
            {/* A finished council is a roster that is booted, signed in and
                attached to a worktree. Closing it to build another throws that
                away, so the next task is offered here instead. */}
            {relayRun?.tone === "done" && nextTasks.length > 0 && onStartAnotherTask && (
              <Dropdown
                className="dk-dropdown--chip"
                value=""
                placeholder="Work on another task…"
                onChange={(taskId) => onStartAnotherTask(taskId)}
                ariaLabel="Give this council another task"
                options={nextTasks.map((task) => ({ value: task.id, label: task.title }))}
              />
            )}
            {/* Two different ceilings, two different remedies. Offering more
                turns to a council that ran out of time gives it nothing it needs. */}
            {relayRun?.atTurnLimit && relayRun.atRunBudget && (
              <span className="dk-council-extend" role="group" aria-label="Extend the time budget">
                <button type="button" className="dk-btn dk-btn--sm" onClick={() => onExtendBudget(2)}>+2 hours</button>
                <button type="button" className="dk-btn dk-btn--sm" onClick={() => onExtendBudget(4)}>+4</button>
                <button
                  type="button"
                  className="dk-btn dk-btn--sm"
                  onClick={() => onExtendBudget(null)}
                  title="Run on with no time limit, up to the turn ceiling"
                >
                  No time limit
                </button>
              </span>
            )}
            {relayRun?.atTurnLimit && !relayRun.atRunBudget && (
              <span className="dk-council-extend" role="group" aria-label="Extend the turn limit">
                <button type="button" className="dk-btn dk-btn--sm" onClick={() => onExtendTurns(24)}>+24 turns</button>
                <button type="button" className="dk-btn dk-btn--sm" onClick={() => onExtendTurns(96)}>+96</button>
                <button
                  type="button"
                  className="dk-btn dk-btn--sm"
                  onClick={() => onExtendTurns(null)}
                  title="Run on until the council finishes or hits the safety ceiling"
                >
                  No limit
                </button>
              </span>
            )}
            {offerReroute ? (
              <button
                type="button"
                className="dk-btn dk-btn--sm"
                onClick={onForceReroute}
                disabled={conductorBusy}
                title="Let the conductor route the work on from the thread as it stands"
              >
                Re-route
              </button>
            ) : null}
            {/* "Hand off" is the wrong word for the one press that turns an
                agreed plan into work being done. */}
            {handoffSession ? (
              <button
                type="button"
                className="dk-btn dk-btn--primary dk-btn--sm dk-council-handoff"
                onClick={() => onHandoff(handoffSession)}
                title="Mark this turn done and let the conductor route it to whoever should pick it up"
              >
                {relayRun?.awaitingStart ? "Start the work" : "Hand off"}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      <div
        className={["dk-council-floor", threadVisible ? "is-thread" : ""].filter(Boolean).join(" ")}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !threadVisible) return;
          if (!(event.target as HTMLElement).closest(".dk-council-thread")) return;
          setThreadOpen(false);
          threadToggleRef.current?.focus();
        }}
      >
      {threadVisible ? (
        <CouncilThread
          members={relayMembers ?? []}
          memberWork={memberWork ?? []}
          messages={thread ?? []}
          routes={routes ?? []}
          currentMemberId={currentMemberId}
          currentTurn={relayRun?.turn ?? 0}
          onOpenMember={(sessionId) => {
            setView("agents");
            setThreadOpen(false);
            onOpenMember?.(sessionId);
          }}
        />
      ) : null}
      {isRelay && view === "summary" && summary ? <CouncilSummary {...summary} /> : null}
      <div
        className={[
          "dk-council-grid",
          focusedSessionId ? "is-focused" : "",
          spotlightId ? "is-spotlight" : "",
          isRelay && view === "summary" ? "is-hidden" : "",
        ].filter(Boolean).join(" ")}
        style={spotlightId ? ({ "--council-side-rows": sessions.length - 1 } as CSSProperties) : undefined}
      >
        <span className="sr-only" id={TERMINAL_ESCAPE_HINT_ID}>
          Tab goes to the agent. F6 leaves the terminal for the next pane, Shift+F6 for this pane's header.
        </span>
        {/* Every member, at once, two to a row: seeing what the others are
            doing while one of them speaks is the whole point. */}
        {sessions.map((session, sessionIndex) => {
          const dotStatus =
            session.status === "running" || session.status === "starting"
              ? "connected"
              : session.status === "failed" || session.status === "disconnected"
                ? "failed"
                : "configured";
          const relay = relayBySession[session.id];
          // A stopped run has nobody speaking. `currentMemberId` is the member
          // that spoke last and is deliberately kept — it is what a manual
          // hand-off resumes from — so the badge has to check the run, not it.
          const holdsTurn = Boolean(
            !relayRun?.stopped &&
              currentMemberId &&
              relayMembers?.some((member) => member.memberId === currentMemberId && member.sessionId === session.id),
          );
          const role = councilMemberRole(session.name) || session.name;
          const seat = relayMembers?.find((member) => member.sessionId === session.id);
          const needs = needsYou.has(session.id);
          const stateTone = needs
            ? "is-needs"
            : holdsTurn || relay?.state === "active" || (!relay && dotStatus === "connected")
              ? "is-working"
              : dotStatus === "failed" && !relay
                ? "is-failed"
                : "";
          return (
            <div
              className={[
                "dk-council-pane",
                holdsTurn ? "is-turn" : "",
                session.id === spotlightId ? "is-spotlit" : "",
                focusedSessionId === session.id ? "is-focus" : "",
              ].filter(Boolean).join(" ")}
              key={session.id}
              onKeyDownCapture={(event) => {
                // The terminal keeps Tab for the CLI. F6 moves on to the next
                // pane's header, then the composer; Shift+F6 to this pane's own.
                if (event.key !== "F6") return;
                event.preventDefault();
                event.stopPropagation();
                const cell = event.currentTarget;
                const panes = [...(cell.parentElement?.children ?? [])];
                const later = panes
                  .slice(panes.indexOf(cell) + 1)
                  .map((sibling) => sibling.querySelector<HTMLElement>(".dk-council-pane-focus"))
                  .find((button) => button?.offsetParent);
                const next = event.shiftKey
                  ? cell.querySelector<HTMLElement>(".dk-council-pane-focus")
                  : later ?? viewRef.current?.querySelector<HTMLElement>(".dk-council-composer input");
                next?.focus();
              }}
            >
              {/* Who this is and what it is doing on the left; the words that
                  act on the pane on the right. Hand-off is on the status line,
                  where it is offered once for the whole council. */}
              <div className="dk-council-pane-head">
                <span className="dk-council-pane-who">
                  <RoleMark
                    label={role}
                    tint={seat && relayMembers ? markTint(relayMembers, seat.memberId) : sessionIndex % 4}
                  />
                  <strong>{role}</strong>
                  <span>{session.agent}</span>
                </span>
                <span className={`dk-status dk-council-pane-state ${stateTone}`}>
                  {stateTone === "is-working" && holdsTurn ? <span className="dk-dot is-working dk-council-pulse" aria-hidden="true" /> : null}
                  {needs
                    ? "Needs you"
                    : holdsTurn
                    ? "Speaking"
                    : relay?.state === "waiting"
                      ? "Waiting"
                      : relay?.state === "handed"
                        ? "Handed off"
                        : relay?.state === "active"
                          ? `Turn ${relay.turn}`
                          : dotStatus === "connected" ? "Working" : dotStatus === "failed" ? "Stopped" : "Idle"}
                </span>
                <span className="dk-spacer" />
                <span className="dk-council-pane-actions">
                  {/* Changing your mind about who should hold a seat used to
                      mean stopping the council and losing the thread with it. */}
                  <button
                    type="button"
                    className={`dk-btn dk-btn--ghost dk-btn--sm${swapSessionId === session.id ? " is-current" : ""}`}
                    onClick={() => {
                      const opening = swapSessionId !== session.id;
                      setSwapSessionId(opening ? session.id : null);
                      if (opening) {
                        const first = swapOptions.find((option) => option.agent !== session.agent);
                        setSwapAgent(first?.agent ?? "");
                        setSwapModel(first?.models[0] ?? "");
                      }
                    }}
                    title="Hand this seat to a different agent, keeping the thread"
                    aria-pressed={swapSessionId === session.id}
                    aria-label={`Swap the agent in ${role}`}
                  >
                    Swap
                  </button>
                  {/* A member whose CLI has exited cannot be stopped, and until
                      now could not be started either. */}
                  {attachedBySession[session.id] === false ? (
                    <button
                      type="button"
                      className="dk-btn dk-btn--ghost dk-btn--sm"
                      onClick={() => onRestartSession(session)}
                      title="Start this agent again"
                      aria-label={`Restart ${session.name}`}
                    >
                      Restart
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="dk-btn dk-btn--ghost dk-btn--sm"
                      onClick={() => onStopSession(session)}
                      title="Stop this agent"
                      aria-label={`Stop ${session.name}`}
                    >
                      Stop
                    </button>
                  )}
                  <button
                    type="button"
                    className="dk-btn dk-btn--ghost dk-btn--sm dk-btn--danger"
                    onClick={() => onDeleteSession(session)}
                    title="Delete this Council session"
                    aria-label={`Delete Council session ${session.name}`}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="dk-btn dk-btn--ghost dk-btn--sm dk-council-pane-focus"
                    onClick={() => setFocusedSessionId((current) => (current === session.id ? "" : session.id))}
                    title={focusedSessionId === session.id ? "Show every member again" : "Give this member the whole floor"}
                  >
                    {focusedSessionId === session.id ? "Unfocus" : "Focus"}
                  </button>
                </span>
              </div>
              <div className="dk-council-pane-body">
                {swapSessionId === session.id && (
                  <div className="dk-council-swap">
                    <span className="dk-council-swap-lede">Hand {role} to</span>
                    <Dropdown
                      className="dk-dropdown--chip"
                      value={swapAgent}
                      onChange={(value) => {
                        setSwapAgent(value);
                        setSwapModel(swapOptions.find((option) => option.agent === value)?.models[0] ?? "");
                      }}
                      ariaLabel="Agent to swap in"
                      options={swapOptions
                        .filter((option) => option.agent !== session.agent)
                        .map((option) => ({ value: option.agent, label: option.label }))}
                    />
                    <Dropdown
                      className="dk-dropdown--chip"
                      value={swapModel}
                      onChange={setSwapModel}
                      ariaLabel="Model for the agent being swapped in"
                      options={(swapOptions.find((option) => option.agent === swapAgent)?.models ?? ["Auto"]).map(
                        (model) => ({ value: model, label: model }),
                      )}
                    />
                    <button
                      type="button"
                      className="dk-btn dk-btn--primary dk-btn--sm"
                      disabled={!swapAgent}
                      onClick={() => {
                        onSwapMember(session, swapAgent as AgentProvider, swapModel);
                        setSwapSessionId(null);
                      }}
                    >
                      Swap in
                    </button>
                    <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setSwapSessionId(null)}>
                      Cancel
                    </button>
                    {/* The seat keeps its handle, so every "TO: qa-claude"
                        already written in the thread still points here. */}
                    <p className="dk-hint">
                      The thread, the branch and this seat's role stay as they are — only who is
                      answering changes.
                    </p>
                  </div>
                )}
                {relay?.state === "waiting" && (
                  <div className="dk-council-pane-note">This member starts when the conductor routes work to it.</div>
                )}
                {gateBySession[session.id] && (
                  <div className="dk-council-gate">
                    <span>{gateBySession[session.id]}</span>
                    <button type="button" className="dk-btn dk-btn--sm" onClick={() => onSendSession(session)}>Send task</button>
                  </div>
                )}
                <AgentTerminalView
                  sessionId={session.id}
                  active={active}
                  fontFamily={terminalFontFamily}
                  fontSize={terminalFontSize}
                  chunks={
                    linesBySession[session.id] ??
                    terminalNotices([`$ ${bootCommand(session.agent, session.model) || session.agent}`])
                  }
                  onInput={(data) => onInput(session, data)}
                  onResize={(cols, rows) => {
                    onResize(session, cols, rows);
                    setOpenSize((current) =>
                      current?.cols === cols && current?.rows === rows ? current : { cols, rows });
                  }}
                  ptySize={ptySize[session.id]}
                  dropped={droppedBySession?.[session.id] ?? 0}
                  replayPreamble={replayPreamble}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* One place to type. Who hears it is chosen under the line. */}
      <form
        className="dk-council-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (currentTarget === "conductor") onAskConductor(conductorMessage);
          else onBroadcast(currentTarget === "current" ? "current" : "all");
        }}
      >
        <input
          className="dk-council-composer-input"
          value={currentTarget === "conductor" ? conductorMessage : sharedMessage}
          onChange={(event) =>
            currentTarget === "conductor"
              ? onConductorMessageChange(event.target.value)
              : onSharedMessageChange(event.target.value)
          }
          placeholder={
            currentTarget === "conductor"
              ? "Ask why the work went where it did, or say how to route from here"
              : currentTarget === "current"
                ? `Message ${currentLabel || "the member on turn"}`
                : "Message every Council member"
          }
          aria-label={
            currentTarget === "conductor"
              ? "Message to the conductor"
              : currentTarget === "current"
                ? `Message to ${currentLabel || "the member on turn"}`
                : "Message to every member"
          }
        />
        <div className="dk-council-composer-row">
          <div className="dk-segmented" role="group" aria-label="Who to send to">
            {isRelay && currentMemberId && (
              <button
                type="button"
                className={currentTarget === "current" ? "is-current" : undefined}
                aria-pressed={currentTarget === "current"}
                onClick={() => chooseTarget("current")}
                title={`Reaches ${currentLabel || "the member on turn"} alone — the members waiting their turn do not see it`}
              >
                {currentLabel || "On turn"}
              </button>
            )}
            <button
              type="button"
              className={currentTarget === "members" ? "is-current" : undefined}
              aria-pressed={currentTarget === "members"}
              onClick={() => chooseTarget("members")}
              title={isRelay ? "Send to every member, including the ones waiting their turn" : "Send to every member"}
            >
              Everyone
            </button>
            {isRelay && (
              <button
                type="button"
                className={currentTarget === "conductor" ? "is-current" : undefined}
                aria-pressed={currentTarget === "conductor"}
                onClick={() => chooseTarget("conductor")}
                title="Reaches the conductor alone — the members do not see it"
              >
                Conductor
              </button>
            )}
          </div>
          <span className="dk-spacer" />

          {/* Only for the conductor: an instruction is binding on every routing
              decision from here, which is not a thing you can tell a member. */}
          {currentTarget === "conductor" && (
            <button
              type="button"
              className="dk-btn dk-btn--sm"
              disabled={conductorBusy || !conductorMessage.trim()}
              onClick={() => onInstructConductor(conductorMessage)}
              title="Make this binding on every routing decision from here on"
            >
              Instruct
            </button>
          )}

          <button
            type="submit"
            className="dk-btn dk-btn--primary dk-btn--sm"
            disabled={
              currentTarget === "conductor"
                ? conductorBusy || !conductorMessage.trim()
                : broadcasting || !sharedMessage.trim()
            }
            title={
              currentTarget === "conductor"
                ? "Ask the conductor — it answers, nothing moves"
                : currentTarget === "current"
                  ? `Send to ${currentLabel || "the member on turn"}`
                  : "Send to every member"
            }
          >
            {currentTarget === "conductor" ? (conductorBusy ? "Asking" : "Ask") : broadcasting ? "Sending" : "Send"}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
