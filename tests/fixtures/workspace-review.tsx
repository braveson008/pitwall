import React from "react";
import { createRoot } from "react-dom/client";
import { BranchChanges } from "../../src/components/BranchChanges";
import { TaskChangeset } from "../../src/components/TaskChangeset";
import { ProjectHub } from "../../src/components/ProjectHub";
import { OnboardingModal } from "../../src/components/OnboardingModal";
import { BulkTaskStartModal } from "../../src/components/BulkTaskStartModal";
import { CreateSessionModal } from "../../src/components/CreateSessionModal";
import { McpAuthModal } from "../../src/components/McpAuthModal";
import "../../src/styles.css";
import "../../src/styles/workspace.css";
import "../../src/styles/desktop.css";
import "../../src/styles/desktop/session.css";
import "../../src/styles/desktop/projects.css";
import "../../src/styles/desktop/settings.css";

const root = createRoot(document.getElementById("root")!);
const components = { BranchChanges, TaskChangeset, ProjectHub, OnboardingModal, BulkTaskStartModal, CreateSessionModal, McpAuthModal };
const noop = () => {};
const task = { id: "task-a", identifier: "TASK-1", projectId: "project", title: "Fix billing totals", description: "Check the total.", status: "review", priority: "high", assignedAgent: "claude", worktree: "branch-a", relatedFiles: [], createdAt: "2026-09-06T10:00:00Z", updatedAt: "2026-09-06T10:00:00Z" };
const sessions = [
  { id: "session-a", name: "Failed billing agent", agent: "Claude", branch: "branch-a", status: "failed", task: task.title },
  { id: "session-b", name: "Waiting webhook agent", agent: "Codex", branch: "branch-b", status: "waiting", task: "Retry webhook" },
];
const hubProps = {
  section: "overview", project: { id: "project", name: "Review fixture", branch: "main", path: "/tmp/review-fixture", sessions },
  tasks: [task, { ...task, id: "task-b", identifier: "TASK-2", title: "Retry webhook", status: "ready", assignedAgent: "codex" }],
  sessions, contextEntries: [], selectedContextIds: [], activity: [], runCountByTask: {}, attentionTaskIds: ["task-b"],
  providerLabel: (provider: string) => provider, onNewTask: noop, onImportTasks: noop, onSyncTasks: noop, syncingTasks: false, onSelectTask: noop, onOpenTask: noop, onStartTask: noop,
  onStartTasks: noop, onDeleteTasks: noop, onMoveTask: noop, onClearColumn: noop, onCompleteTask: noop, onRequestChanges: async () => true,
  onOpenWork: noop, onNewContext: noop, onToggleContext: noop, onOpenConnections: noop, onOpenGitHub: noop, githubLogin: null,
  onOpenProject: noop, editorLabel: "Editor", previewByTask: {}, onOpenTaskEditor: async () => {}, onOpenTaskPullRequest: async () => {}, onOpenTaskPreview: async () => {},
  onRunValidation: noop, onSelectSession: noop,
  reviewFacts: null, pullRequestsAvailable: true, onRefreshReview: noop,
  scheduleJobs: [], onSaveScheduleJob: noop, onDeleteScheduleJob: noop, onRunScheduleJobNow: noop,
  onCreateScheduleJob: async () => "", scheduleAgents: ["Codex", "Claude"],
};

const calls: string[] = [];
// Exposed so a test can build a child element for a render prop.
Object.assign(window, { React });

Object.assign(window, { reviewTest: {
  calls,
  record(name: string) { calls.push(name); },
  render(name: keyof typeof components, props: object) {
    root.render(React.createElement(components[name] as React.ComponentType<object>, name === "ProjectHub" ? { ...hubProps, ...props } : props));
  },
  clear() { root.render(null); },
} });
