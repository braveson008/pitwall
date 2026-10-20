import { Blocks, Folder, Home, Moon, Plus, Search, Settings, Sparkles, Sun, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Project } from "../data";
import { VersionFooter } from "./VersionFooter";
import { shortcutLabel } from "../lib/shortcutLabel";

export interface SidebarAgent {
  name: string;
  working: boolean;
}

interface AppSidebarProps {
  projects: Project[];
  activeProjectId: string;
  /** The project row reads as selected only while a project page is showing. */
  projectPageOpen: boolean;
  /** Rendered under the open project: its sessions, which App owns the state for. */
  openProjectSessions: ReactNode;
  notificationCounts: Record<string, number>;
  agents: SidebarAgent[];
  agentsNeedingSetup: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  homeOpen: boolean;
  /** Things across every project waiting on the person. */
  needsYouCount: number;
  settingsOpen: boolean;
  extensionsOpen: boolean;
  updateState: UpdateState | null;
  onNewSession: () => void;
  onOpenHome: () => void;
  onSearch: () => void;
  onSelectProject: (project: Project) => void;
  onRemoveProject: (project: Project) => void;
  onAddProject: () => void;
  onDescribeProject: () => void;
  onOpenAgents: () => void;
  onOpenExtensions: () => void;
  onOpenSettings: () => void;
}

export function AppSidebar({
  projects,
  activeProjectId,
  projectPageOpen,
  openProjectSessions,
  notificationCounts,
  agents,
  agentsNeedingSetup,
  theme,
  onToggleTheme,
  homeOpen,
  needsYouCount,
  settingsOpen,
  extensionsOpen,
  updateState,
  onNewSession,
  onOpenHome,
  onSearch,
  onSelectProject,
  onRemoveProject,
  onAddProject,
  onDescribeProject,
  onOpenAgents,
  onOpenExtensions,
  onOpenSettings,
}: AppSidebarProps) {
  return (
    <aside className="dk-sidebar">
      {/* The window's own controls sit here; the strip is where it is dragged. */}
      <div className="dk-sidebar-drag" />

      <nav className="dk-sidebar-actions" aria-label="Pitwall">
        <button type="button" className="dk-row dk-row-strong" onClick={onNewSession}>
          <Plus size={16} aria-hidden="true" />
          <span className="dk-row-label">New session</span>
          <kbd>{shortcutLabel("⌘N")}</kbd>
        </button>
        <button
          type="button"
          className={`dk-row${homeOpen ? " is-current" : ""}`}
          aria-current={homeOpen ? "page" : undefined}
          onClick={onOpenHome}
        >
          <Home size={16} aria-hidden="true" />
          <span className="dk-row-label">Home</span>
          {needsYouCount > 0 ? <span className="dk-count" aria-label={`${needsYouCount} need you`}>{needsYouCount}</span> : null}
        </button>
        <button type="button" className="dk-row" onClick={onSearch}>
          <Search size={16} aria-hidden="true" />
          <span className="dk-row-label">Search</span>
          <kbd>{shortcutLabel("⌘K")}</kbd>
        </button>
      </nav>

      <div className="dk-sidebar-heading">
        <span>Projects</span>
        <button type="button" className="dk-icon-button" onClick={onAddProject} aria-label="Add a project folder" title="Add a project folder">
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      <nav className="dk-project-list" aria-label="Projects">
        {projects.length === 0 ? <p className="dk-sidebar-empty">No projects open</p> : null}
        {projects.map((project) => {
          const open = project.id === activeProjectId;
          const unread = notificationCounts[project.id] ?? 0;
          return (
            <div className={`dk-project${open ? " is-open" : ""}`} key={project.id}>
              <div className="dk-project-line">
                <button
                  type="button"
                  className={`dk-row${open && projectPageOpen ? " is-current" : ""}`}
                  aria-current={open && projectPageOpen ? "page" : undefined}
                  onClick={() => onSelectProject(project)}
                >
                  <Folder size={16} aria-hidden="true" className="dk-row-icon" />
                  <span className="dk-row-label">{project.name}</span>
                  {unread > 0 ? (
                    <span className="dk-count" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="dk-icon-button dk-project-remove"
                  onClick={() => onRemoveProject(project)}
                  aria-label={`Remove ${project.name} from Pitwall`}
                  title={`Remove ${project.name} from Pitwall`}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
              {open ? openProjectSessions : null}
            </div>
          );
        })}
        <button type="button" className="dk-row dk-row-quiet" onClick={onDescribeProject}>
          <Sparkles size={15} aria-hidden="true" />
          <span className="dk-row-label">Describe a new project</span>
        </button>
      </nav>

      <div className="dk-sidebar-footer">
        <button type="button" className="dk-agents" onClick={onOpenAgents} title="Agents and how they are signed in">
          {agents.map((agent) => (
            <span key={agent.name} className="dk-agent">
              <span className={`dk-dot ${agent.working ? "is-working" : "is-ready"}`} aria-hidden="true" />
              {agent.name}
            </span>
          ))}
          {agentsNeedingSetup > 0 ? <span className="dk-agent is-needs">{agentsNeedingSetup} need setup</span> : null}
        </button>
        <button
          type="button"
          className="dk-icon-button"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`dk-icon-button${extensionsOpen ? " is-current" : ""}`}
          onClick={onOpenExtensions}
          aria-label="Extensions"
          title="Extensions"
        >
          <Blocks size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`dk-icon-button${settingsOpen ? " is-current" : ""}`}
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={16} aria-hidden="true" />
        </button>
      </div>
      <VersionFooter updateState={updateState} />
    </aside>
  );
}
