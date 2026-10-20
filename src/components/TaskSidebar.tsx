import { ChevronRight, Moon, Puzzle, Repeat, Search, Settings, SquarePen, Sun, SquareTerminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Project } from "../data";
import type { SessionAttention } from "../lib/sessionAttention";
import type { SidebarGroup, SidebarRow } from "../lib/sidebarGroups";
import { Dropdown } from "./Dropdown";
import { PeekCard, SessionRow, usePeek } from "./SidebarSessions";
import { VersionFooter } from "./VersionFooter";
import { shortcutLabel } from "../lib/shortcutLabel";

const ADD_PROJECT = "__add";
const DESCRIBE_PROJECT = "__describe";
const REMOVE_PROJECT = "__remove";
const COLLAPSED_KEY = "pitwall-sidebar-collapsed";

function readCollapsed(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return Array.isArray(value) ? value.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

/** What the status bar says about the agents: counts, and the row each count opens. */
export function statusSummary(groups: SidebarGroup[], attentionBySession: Record<string, SessionAttention>) {
  const working = groups.find((group) => group.name === "Working")?.rows ?? [];
  const waiting = working.filter((row) => {
    const level = row.session ? attentionBySession[row.session.id]?.level : undefined;
    return level === "needs-you" || level === "failed";
  });
  const busy = working.filter((row) => row.session && attentionBySession[row.session.id]?.level === "working").length;
  const review = groups.find((group) => group.name === "Review")?.rows ?? [];
  return {
    working: busy,
    needsYou: waiting.length > 0 ? { count: waiting.length, row: waiting[0] } : null,
    review: review.length > 0 ? { count: review.length, row: review[0] } : null,
  };
}

interface TaskSidebarProps {
  groups: SidebarGroup[];
  selectedRowId: string;
  /** Each session's state as its glyph shows it, by session id. */
  attentionBySession: Record<string, SessionAttention>;
  projects: Project[];
  /** Finished-in-the-background counts, shown beside each project in the menu. */
  notificationCounts: Record<string, number>;
  /** "" for every project. */
  projectFilter: string;
  view: "now" | "board";
  automationsOpen: boolean;
  /** Findings waiting on the person, across every project. */
  automationsWaiting?: number;
  /** What Hermes is doing, in one line, and the way to its panel. */
  hermesStatus?: { label: string; tone: "working" | "attention" | "quiet"; open: boolean; onOpen: () => void };
  extensionsOpen: boolean;
  settingsOpen: boolean;
  agentsNeedingSetup: number;
  /** One quiet line: the plan and what is left, or the free plan. */
  theme: "light" | "dark";
  updateState: UpdateState | null;
  onProjectFilter: (projectId: string) => void;
  onAddProject: () => void;
  onRemoveProject: (project: Project) => void;
  onDescribeProject: () => void;
  onView: (view: "now" | "board") => void;
  onSelectRow: (row: SidebarRow) => void;
  onDeleteSession: (row: SidebarRow) => void;
  /** Straight to the agent's session, for work that opens on its review. */
  onOpenSession?: (row: SidebarRow) => void;
  onDeleteCouncil: (row: SidebarRow) => void;
  onNewWork: () => void;
  onSearch: () => void;
  onOpenAutomations: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
  onOpenAgents: () => void;
  onToggleTheme: () => void;
}

export function TaskSidebar({
  groups,
  selectedRowId,
  attentionBySession,
  projects,
  notificationCounts,
  projectFilter,
  view,
  automationsOpen,
  automationsWaiting = 0,
  hermesStatus,
  extensionsOpen,
  settingsOpen,
  agentsNeedingSetup,
  theme,
  updateState,
  onProjectFilter,
  onAddProject,
  onRemoveProject,
  onDescribeProject,
  onView,
  onSelectRow,
  onDeleteSession,
  onOpenSession,
  onDeleteCouncil,
  onNewWork,
  onSearch,
  onOpenAutomations,
  onOpenExtensions,
  onOpenSettings,
  onOpenAgents,
  onToggleTheme,
}: TaskSidebarProps) {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const { peek, enter, leave } = usePeek();
  // A row selected from elsewhere may be scrolled out of sight.
  useEffect(() => {
    if (!selectedRowId) return;
    document.querySelector(`[data-sidebar-row="${CSS.escape(selectedRowId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedRowId]);
  const peekRow = peek ? groups.flatMap((group) => group.rows).find((row) => row.session?.id === peek.session.id) : undefined;
  const toggleGroup = (name: string) => setCollapsed((current) => {
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* a preference, not state */ }
    return next;
  });

  const projectOptions = [
    { value: "", label: "All projects" },
    ...projects.map((project) => {
      const unread = notificationCounts[project.id] ?? 0;
      return { value: project.id, label: project.name, hint: unread > 0 ? `${unread} new` : undefined };
    }),
    { value: ADD_PROJECT, label: "Add a project folder…" },
    { value: DESCRIBE_PROJECT, label: "Describe a new project…" },
  ];
  const filtered = projects.find((project) => project.id === projectFilter);
  if (filtered) projectOptions.push({ value: REMOVE_PROJECT, label: `Remove “${filtered.name}” from Pitwall…` });

  const summary = statusSummary(groups, attentionBySession);

  return (
    <>
    <aside className="dk-sidebar dk-tsb">
      <div className="dk-tsb-titlebar">
        <button type="button" className="dk-icon-button" onClick={onSearch} aria-label="Search" title={shortcutLabel("Search  ⌘K")}>
          <Search size={17} aria-hidden="true" />
        </button>
        <button type="button" className="dk-icon-button" onClick={onNewWork} aria-label="New work" title={shortcutLabel("New work  ⌘N")}>
          <SquarePen size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="dk-tsb-controls">
        <Dropdown
          className="dk-tsb-project"
          ariaLabel="Project"
          value={projectFilter}
          options={projectOptions}
          onChange={(value) => {
            if (value === ADD_PROJECT) onAddProject();
            else if (value === DESCRIBE_PROJECT) onDescribeProject();
            else if (value === REMOVE_PROJECT) { if (filtered) onRemoveProject(filtered); }
            else onProjectFilter(value);
          }}
        />
        <div className="dk-segmented" role="tablist" aria-label="Task view">
          {(["now", "board"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              className={view === option ? "is-current" : undefined}
              onClick={() => onView(option)}
              title={option === "board" ? shortcutLabel("Board  ⌘B") : undefined}
            >
              {option === "now" ? "Now" : "Board"}
            </button>
          ))}
        </div>
      </div>

      <nav className="dk-tsb-list" aria-label="Tasks">
        {groups.length === 0 ? (
          <p className="dk-tsb-empty">{shortcutLabel("Nothing in progress. Start new work with ⌘N.")}</p>
        ) : groups.map((group) => (
          <section key={group.name} className={`dk-tsb-group${collapsed.includes(group.name) ? " is-collapsed" : ""}`} aria-label={group.name}>
            <h2 className="dk-tsb-heading">
              <button
                type="button"
                className="dk-tsb-heading-toggle"
                aria-expanded={!collapsed.includes(group.name)}
                onClick={() => toggleGroup(group.name)}
              >
                <ChevronRight size={12} className="dk-tsb-chevron" aria-hidden="true" />
                <span>{group.name}</span>
                <span className="dk-tsb-count">{group.rows.length}</span>
              </button>
            </h2>
            {collapsed.includes(group.name) ? null : group.name === "Working" ? (
              <ol className="dk-session-rows" aria-label="Sessions">
                {group.rows.map((row) => row.kind === "starting" ? (
                  <li key={row.id} className="dk-session-item" aria-busy="true">
                    <div
                      className="dk-row dk-session dk-session-starting"
                      data-sidebar-row={row.id}
                      role="status"
                      title={`${row.status} is starting${projectFilter ? "" : ` in ${row.key}`}`}
                    >
                      <span className="dk-glyph is-working" aria-hidden="true" />
                      <span className="dk-row-label">{row.title}</span>
                      <span className="dk-session-meta">starting</span>
                    </div>
                  </li>
                ) : row.session && attentionBySession[row.session.id] ? (
                  <SessionRow
                    key={row.id}
                    rowId={row.id}
                    session={row.session}
                    name={row.title}
                    attention={attentionBySession[row.session.id]}
                    selected={row.id === selectedRowId}
                    onSelect={() => onSelectRow(row)}
                    onDelete={() => (row.councilRunId ? onDeleteCouncil(row) : onDeleteSession(row))}
                    deleteLabel={row.councilRunId ? { label: `Delete Council ${row.councilName}`, title: "Remove this Council and its sessions" } : undefined}
                    onPeek={enter}
                    onUnpeek={leave}
                  />
                ) : null)}
              </ol>
            ) : group.rows.map((row) => {
              const selected = row.id === selectedRowId;
              return (
                <div key={row.id} className="dk-tsb-item">
                  <button
                    type="button"
                    className={`dk-tsb-row${selected ? " is-current" : ""}${row.needsYou ? " is-needs-you" : ""}`}
                    aria-current={selected ? "true" : undefined}
                    data-sidebar-row={row.id}
                    onClick={() => onSelectRow(row)}
                  >
                    <span className="dk-tsb-line">
                      <span className="dk-tsb-title">{row.title}</span>
                      <span className="dk-tsb-when">{row.when}</span>
                    </span>
                    <span className="dk-tsb-meta">
                      {row.key ? <>{row.key} · </> : null}
                      <span className="dk-tsb-status">{row.status}</span>
                    </span>
                  </button>
                  {onOpenSession && row.needsYou && row.kind === "task" && row.sessionId ? (
                    <button
                      type="button"
                      className={`dk-icon-button dk-tsb-open${selected ? " is-on-selection" : ""}`}
                      aria-label={`Open session for ${row.title}`}
                      title="Open session"
                      onClick={() => onOpenSession(row)}
                    >
                      <SquareTerminal size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  {row.councilRunId ? (
                    <button
                      type="button"
                      className={`dk-icon-button dk-tsb-delete${selected ? " is-on-selection" : ""}`}
                      aria-label={`Delete Council ${row.councilName}`}
                      title="Remove this Council and its sessions"
                      onClick={() => onDeleteCouncil(row)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : row.sessionId ? (
                    <button
                      type="button"
                      className={`dk-icon-button dk-tsb-delete${selected ? " is-on-selection" : ""}`}
                      aria-label="Delete session"
                      title="Remove this session"
                      onClick={() => onDeleteSession(row)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </nav>
      {peek ? <PeekCard peek={peek} detail={peekRow?.councilRunId ? peekRow.status : projectFilter ? undefined : peekRow?.key} /> : null}

    </aside>
    <footer className="dk-statusbar" aria-label="Status">
      <div className="dk-statusbar-group">
        {summary.working > 0 ? (
          <span className="dk-status-item is-working" title="Agents producing output right now">
            <span className="dk-glyph is-working" aria-hidden="true" />{summary.working} working
          </span>
        ) : null}
        {summary.needsYou ? (
          <button type="button" className="dk-status-item is-needs" onClick={() => onSelectRow(summary.needsYou!.row)} title="Open the first session waiting on you">
            <span className="dk-glyph is-needs" aria-hidden="true" />{summary.needsYou.count} {summary.needsYou.count === 1 ? "needs" : "need"} you
          </button>
        ) : null}
        {summary.review ? (
          <button type="button" className="dk-status-item" onClick={() => onSelectRow(summary.review!.row)} title="Open the newest finished work">
            {summary.review.count} to review
          </button>
        ) : null}
        {summary.working === 0 && !summary.needsYou && !summary.review ? <span className="dk-status-item is-quiet">No agents running</span> : null}
        <span className="dk-statusbar-divider" aria-hidden="true" />
        <button type="button" className={`dk-status-item${automationsOpen ? " is-current" : ""}`} onClick={onOpenAutomations}>
          <Repeat size={13} aria-hidden="true" />Automations
          {automationsWaiting > 0 ? <span className="dk-status-count" aria-label={`${automationsWaiting} waiting`}>{automationsWaiting}</span> : null}
        </button>
        {hermesStatus ? (
          <button
            type="button"
            className={`dk-status-item dk-tsb-hermes is-${hermesStatus.tone}${hermesStatus.open ? " is-current" : ""}`}
            onClick={hermesStatus.onOpen}
            title="What Hermes is doing, what it reviewed and what it learned"
          >
            <span className="dk-tsb-seal" aria-hidden="true">R</span>
            <span className="dk-tsb-hermes-label">{hermesStatus.label}</span>
          </button>
        ) : null}
        <button type="button" className={`dk-status-item${extensionsOpen ? " is-current" : ""}`} onClick={onOpenExtensions}>
          <Puzzle size={13} aria-hidden="true" />Extensions
        </button>
      </div>
      <div className="dk-statusbar-group">
        {agentsNeedingSetup > 0 ? (
          <button type="button" className="dk-status-item is-needs" onClick={onOpenAgents}>
            {agentsNeedingSetup} {agentsNeedingSetup === 1 ? "agent needs" : "agents need"} setup
          </button>
        ) : null}
        <VersionFooter updateState={updateState} />
        <button
          type="button"
          className="dk-icon-button dk-icon-btn--sm"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
          title={theme === "dark" ? "Light appearance" : "Dark appearance"}
        >
          {theme === "dark" ? <Sun size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`dk-icon-button dk-icon-btn--sm${settingsOpen ? " is-current" : ""}`}
          onClick={onOpenSettings}
          aria-label="Settings"
          title={shortcutLabel("Settings  ⌘,")}
        >
          <Settings size={13} aria-hidden="true" />
        </button>
      </div>
    </footer>
    </>
  );
}
