import {
  AlertTriangle,
  BellOff,
  BellRing,
  BookOpen,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  ExternalLink,
  FolderOpen,
  FolderTree,
  GitPullRequest,
  Github,
  LayoutGrid,
  Pause,
  Play,
  Plus,
  Search,
  ScrollText,
  Send,
  Settings2,
  Download,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
  GitBranch,
  FileDiff,
} from "lucide-react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddAgentModal, type AddAgentInput } from "./components/AddAgentModal";
import {
  buildRemediationDirective,
  buildVerificationPrompt,
  chooseVerifier,
  parseVerificationVerdict,
  summariseVerification,
  MAX_VERIFICATION_ROUNDS,
  type VerificationVerdict,
} from "./lib/councilVerify";
import {
  extractLessons,
  formatLessonsPrompt,
  getCouncilLessonsPath,
  getCouncilLessonsPaths,
  mergeLessons,
  parseLessonsFile,
} from "./lib/councilMemory";
import {
  abandonDebate,
  advanceDebate,
  buildDebateRoundPrompt,
  buildOpeningDebatePrompt,
  buildOpeningDirective,
  openOpeningDebate,
  isRestorableDebate,
  debateSuppressesStallGuard,
  summariseDebate,
  type Debate,
} from "./lib/councilDebate";
import { AddMcpModal } from "./components/AddMcpModal";
import type { AgentTerminalHandle } from "./components/AgentTerminalView";
import { TerminalComposer } from "./components/TerminalComposer";
import { ALPHA_FEATURES, VOICE_ENABLED } from "./lib/features";
import { searchPalette, type PaletteItem } from "./lib/commandPalette";
import { emptyPreviewWatch, seedPreviewWatch, watchPreview, type PreviewWatch } from "./lib/previewWatch";
import { QUIET_AFTER_MS, type SessionActivity, type SessionAttention } from "./lib/sessionAttention";
import { applySessionOrder, pruneSessionOrder } from "./lib/sessionOrder";
import { settleSessions, statusAfterAttach, statusAfterTerminalClosed, statusWithoutTerminal, type TerminalClosure } from "./lib/sessionSettlement";
import { shouldMoveToReview } from "./lib/taskProgression";
import { createScreenMirror } from "./terminal/screenMirror";
import {
  menuChoiceKey,
  readTerminalBusy,
  readTerminalMenu,
  type MenuOption,
  type TerminalMenu,
} from "./lib/terminalMenu";
import { CouncilGrid, type RelayState } from "./components/CouncilGrid";
import { CouncilSetupModal, type CouncilMember } from "./components/CouncilSetupModal";
import { applySwap, planSwap, swapMessage, swapNotice } from "./lib/councilSwap";
import { handoffDivider, handoffPrompt, swapRefusal, swappedSessionName } from "./lib/sessionSwap";
import { claudeModelIdFromLabel } from "./lib/modelLabels";
import { addNotification, alreadyOnScreen, automationsTarget, jumpLabel, readNotifications, type AppNotification, type NotificationTarget } from "./lib/notifications";
import { NotificationsMenu } from "./components/NotificationsMenu";
import { summariseNote } from "./lib/councilNotice";
import { splitByAutoApprove, supportsAutoApprove, withAutoApprove } from "./domain/autoApprove";
import { applyBatch, appendCapped } from "./lib/transcriptBuffer";
import {
  emptyWorkingSet,
  mergeWorkingSet,
  parseWorkingSet,
  renderWorkingSet,
  type WorkingSet,
} from "./lib/councilBriefing";
import { CreateProjectFlowModal, type DescribedProjectDraft } from "./components/CreateProjectFlowModal";
import { CreateSessionModal } from "./components/CreateSessionModal";
import { BulkTaskStartModal } from "./components/BulkTaskStartModal";
import { TaskImageAttachments } from "./components/TaskImageAttachments";
import { BroadcastMessageModal } from "./components/BroadcastMessageModal";
import { UnfinishedWorktreesModal } from "./components/UnfinishedWorktreesModal";
import { ConnectionsModal, ConnectionsPanel, GITHUB_WORDS, type RepositoryHostWords } from "./components/ConnectionsModal";
import { ExtensionsPanel } from "./components/ExtensionsPanel";

/**
 * The two ways one session can be read.
 *
 * There was a third: a chat drawn live from Claude's streaming protocol, which
 * resumed the session in a *second* headless process beside the terminal's. Two
 * processes on one conversation can disagree about it, which is why it never
 * shipped — and why the thread reads the CLI's own session file instead, where
 * there is nothing to disagree with and every agent keeps one.
 */
type SessionSurface = "terminal" | "conversation";
import { SessionConversation } from "./components/SessionConversation";
import { DeleteCouncilModal } from "./components/DeleteCouncilModal";
import { DeleteSessionModal } from "./components/DeleteSessionModal";
import { DeleteTaskModal } from "./components/DeleteTaskModal";
import { GitHubAuthModal } from "./components/GitHubAuthModal";
import { CreateRequestModal, type CreateRequestDraft, type WrittenDraft } from "./components/CreateRequestModal";
import { WatchPage } from "./components/WatchPage";
import { commitMessage, composeRequest } from "./lib/requestDraft";

/** "merge request" → "Merge request", at the start of a sentence. */
const sentenceNoun = (noun: string) => noun.charAt(0).toUpperCase() + noun.slice(1);
import { McpPanel } from "./components/McpPanel";
import { McpAuthModal } from "./components/McpAuthModal";
import { McpTaskImportModal } from "./components/McpTaskImportModal";
import { LicenceModal } from "./components/LicenceModal";
import { VersionFooter } from "./components/VersionFooter";
import { OnboardingModal } from "./components/OnboardingModal";
import { SessionTranscriptModal } from "./components/SessionTranscriptModal";
import { AllSessionsModal, type SessionGroup } from "./components/AllSessionsModal";
import { Dropdown } from "./components/Dropdown";
import { TerminalTypographyControls } from "./components/TerminalTypographyControls";
import { TaskStartModal, type TaskStartDestination } from "./components/TaskStartModal";
import { TaskDetailModal } from "./components/TaskDetailModal";
import { VoiceHud } from "./components/VoiceHud";
import { ProjectHub } from "./components/ProjectHub";
import { BranchChanges } from "./components/BranchChanges";
import { WorkspaceInspector } from "./components/WorkspaceInspector";
import { LiveChanges, useLiveChanges } from "./components/LiveChanges";
import FilesPanel, { type FilesOpenRequest } from "./components/FilesPanel";
import { LiveTerminalView } from "./components/LiveTerminalView";
import { isTerminalReply } from "./lib/terminalReplies";
import { UpdateBanner } from "./components/UpdateBanner";
import { PairReviewerPane } from "./components/PairReviewerPane";
import { createTerminalLinesStore } from "./terminal/terminalLinesStore";
import { PanelResizer } from "./components/PanelResizer";
import { CompleteTaskModal } from "./components/CompleteTaskModal";
import { useModalFocus } from "./hooks/useModalFocus";
import type { WorkspaceSection } from "./components/WorkspaceNavigation";
import type { RoleRun } from "./lib/taskRoles";
import { useVoice, type VoiceHandlers } from "./hooks/useVoice";
import { bestMatch } from "./lib/voiceMatch";
import { SessionSwap } from "./components/SessionSwap";
import { SessionReviewer } from "./components/SessionReviewer";
import { TaskSidebar } from "./components/TaskSidebar";
import { buildSidebarGroups, type SidebarRow, type StartingSession } from "./lib/sidebarGroups";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { Sheet } from "./components/Sheet";
import { HermesPanel, hermesStatusLine, type HermesState } from "./components/HermesPanel";
import { reviewerScorecard } from "./lib/reviewerScorecard";
import { HomePage } from "./components/HomePage";
import { InstallAgentModal } from "./components/InstallAgentModal";
import { localCatalogue as agentCatalogue, type CatalogueEntry } from "./domain/agentCatalogue";
import type { LiveModels } from "./components/AgentMarketplace";
import { AgentProvider, AgentSession, Project, projectsSeed, SessionStatus } from "./data";
import { type AgentOption, type ModelOption, resolveAgentLaunch } from "./domain/agents";
import { pairReviewerLabel, toPairReviewer, type PairReviewer } from "./domain/pairReviewer";
import { agentFromProviderId, getProviderById, providerIdFromAgent, providerRegistry, canImplement } from "./domain/providers";
import { reviewStateFor } from "./domain/reviewState";
import { bookingTimes, isScheduledRunTask, parseClock, scheduleOverlap, scheduleRunBranch, scheduledRunEnded, settlingJob } from "./domain/schedule";
import { getRole, roleKeys, roleOrder, roleWritesCode, roles } from "./domain/roles";
import { CustomAgentDefinition, readCustomAgents, writeCustomAgents } from "./domain/customAgents";
import type { TaskRun, ValidationResult } from "./domain/contracts";
import { readUsage, totalUsage, formatTokens, type SessionUsage } from "./lib/tokenUsage";
import { readTaskRuns, writeTaskRuns, upsertRun, readOutcomes, writeOutcomes, outcomeFor } from "./domain/taskRuns";
import {
  decide,
  startRun,
  withAttempt,
  withAttemptFinished,
  withBlocked,
  withContract,
  withReport,
  withValidation,
} from "./lib/taskRunner";
import { parseContract } from "./lib/contractDraft";
import { parseVerdict, reconcile, toReport, toFixContract } from "./lib/qaVerdict";
import { summarise, type AttemptOutcome } from "./lib/modelHistory";
import { classifyRequest, type Candidate, type ImplementerPolicy } from "./lib/routing";

/** What each stage is called where a person can see it. */
const stagedStageLabel: Record<string, string> = {
  architect: "Architect",
  implement: "Implementer",
  review: "Review",
  fix: "Fix",
};

/** A local model offered as an agent, derived from what Ollama has pulled. */
type LocalAgentOption = {
  id: string;
  name: string;
  command: string;
  args: string;
  bridgeId: string;
  models: Array<{ label: string; value: string }>;
  needsConfig: boolean;
};
import { getTaskStatusLabel, nowIso, splitArgs, splitLines } from "./lib/format";
import {
  COUNCIL_USER_ID,
  MAX_RELAY_TURNS,
  RELAY_TURN_CEILING,
  addConductorDirective,
  buildConductorAnswerPrompt,
  buildConductorPrompt,
  buildCouncilEvidence,
  buildCouncilRelayTurn,
  buildRelayNudge,
  planCouncilPromptDelivery,
  DEFAULT_RUN_BUDGET_MS,
  isWithinRunBudget,
  normalizeRunBudget,
  relayProgressMark,
  resolveStallAction,
  chooseNextMember,
  getCouncilConductorLogFile,
  getCouncilStageFile,
  getCouncilThreadFile,
  getCouncilWorkingSetFile,
  getTurnStageFile,
  isRelayComplete,
  formatCouncilDuration,
  formatTurnLimitNote,
  isRestorableRelayState,
  isStuckOn,
  detectTreeOscillation,
  fingerprintTree,
  isWithinTurnLimit,
  makeCouncilMemberId,
  normalizeTurnLimit,
  carryCouncilToNextTask,
  mergePanelHandoffs,
  parseConductorDecision,
  parseHandoffAddress,
  rebuildThreadFromStages,
  restoreCouncilWorkingSet,
  restoreCouncilPanel,
  relayMayAutoAdvance,
  relayMayStartTurn,
  relayMemberForTurn,
  renderConductorLog,
  renderCouncilThread,
  resolveMemberRef,
  snapshotRepoChanges,
  summariseCouncilActivity,
  toPersistedRelayState,
  type ConductorDecision,
  type ConductorDirective,
  type CouncilActivity,
  type CouncilEvidence,
  type CouncilRelayMember,
  type CouncilThreadMessage,
  type RelayRoute,
  type RelayRouteSource,
  buildCouncilTaskBrief,
  formatCouncilTaskFilePrompt,
  getCouncilTaskBriefPath,
} from "./lib/councilRelay";
import { formatTaskLaunchPrompt, type TaskRuntimePlan } from "./lib/taskLaunch";
import { contextForAgent, KNOWLEDGE_CAPTURE_PROMPT, parseKnowledgeObservations, withManualContext } from "./lib/projectContext";
import type { DeliveryReceipt, KnowledgeObservation, PrepareKnowledgeInput } from "./domain/projectKnowledge";
import { mergeTaskSummaryComponents, parseTaskSummary } from "./lib/taskSummary";
import { findLatestDevPreview } from "./lib/devPreview";
import { actionableError } from "./lib/actionableErrors";
import { CODEX_UPDATE_SKIP_KEY, codexUpdatePromptShowing, looksLikeAgentGate } from "./lib/agentGate";
import {
  buildProjectBrief,
  buildProjectTaskDraft,
  buildScopingPipeline,
  slugifyProjectName,
  validateProjectDescription,
  validateProjectName,
} from "./lib/projectScaffold";
import { normalizeTaskIdentifier, taskBranchName, validateTaskIdentifier } from "./lib/taskIdentity";
import { allocateImportedTaskIdentifier, flattenMcpTaskSources, importedTaskIdentity, mapExternalTaskStatus, mcpTaskSourceKey, mcpTaskSourceLabel, planTrackerSync, summariseTrackerSync } from "./lib/taskImport";
import {
  councilMemberLabel,
  formatCouncilMemberName,
  uniqueSessionName,
  formatCouncilRunName,
  formatInstructionSessionName,
  expandSessionName,
  formatTaskSessionName,
  formatUntaskedSessionName,
} from "./lib/sessionNames";
import { submitTerminalPrompt } from "./lib/terminalSubmit";
import { broadcastEligibleSessions, councilRecipients } from "./lib/sessionBroadcast";
import { selectTaskWorkspace } from "./lib/taskWorkspace";
import { readTerminalHistory, writeTerminalHistory } from "./lib/terminalHistory";
import { createModeTracker, splitAtEscapeBoundary, terminalNotice, terminalNotices, type TerminalModeTracker } from "./lib/terminalStream";
import {
  clearProjectNotification,
  recordProjectNotification,
  type ProjectNotifications,
} from "./lib/projectNotifications";
import {
  clearStaleTerminalRendererOptions,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  initialTerminalFontSize,
  normalizeTerminalFontFamily,
  normalizeTerminalFontSize,
  TERMINAL_FONT_SIZE_MIGRATION,
  TERMINAL_FONT_FAMILY_MIGRATION,
  initialTerminalFontFamily,
} from "./lib/terminalOptions";
import type {
  PitwallActivityEvent,
  PitwallContextEntry,
  PitwallContextSnapshot,
  PitwallCouncilRun,
  PitwallProviderId,
  PitwallSession,
  PitwallSessionType,
  PitwallTask,
  PitwallTaskPair,
  PitwallProjectOverseer,
  PitwallProjectRecord,
  PitwallTaskPriority,
  PitwallWorkspaceState,
} from "./domain/types";
import { DEFAULT_OVERSEER } from "./domain/types";
import { createEmptyProjectState, makeId, normalizeSessionStatus, readPitwallState, writePitwallState } from "./storage/pitwallStore";
import { licenceChipLabel } from "./lib/licence";
import { currentStep, pushStep, type MemberWork } from "./lib/councilActivity";
import { readSessionAttention } from "./lib/sessionAttention";
import {
  formatChangeRequestPrompt,
  isUsableRequest,
  makeChangeRequest,
  pendingRequests,
  markDelivered,
  statusAfterRequest,
} from "./lib/changeRequests";
import { useLicence } from "./hooks/useLicence";
import { useMcp } from "./hooks/useMcp";
import { writeStored, writeStoredJson } from "./lib/storage";
import { createKeyedThrottle } from "./lib/keyedThrottle";
import { trackerHtmlToMarkdown } from "./lib/markdown";
import { shortcutLabel, filesShortcutLabel, isFilesShortcut } from "./lib/shortcutLabel";

const statusLabel: Record<SessionStatus, string> = {
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  disconnected: "Disconnected",
};

type CreatableAgentProvider = Extract<AgentProvider, "Claude" | "Grok" | "Codex" | "Gemini" | "Kimi" | "Hermes">;
type AgentCheck = Awaited<ReturnType<NonNullable<Window["pitwall"]>["checkAgent"]>>;
type WorkbenchTab = "terminal" | "changes" | "editor" | "council";
type PaletteMode = "files" | "commands";

const noisyExplorerSegments = new Set([
  ".bundle",
  ".claude",
  ".cursor",
  ".expo",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);


function createNativeSessionId(agent: AgentProvider) {
  return agent === "Claude" ? window.crypto.randomUUID() : undefined;
}

const emptySession: AgentSession = {
  id: "",
  name: "No session",
  agent: "Codex",
  status: "completed",
  model: "gpt-5-codex",
  branch: "",
  task: "Create an agent session to start work",
  progress: 0,
  tokens: "0",
  approvals: 0,
  risk: "low",
  files: 0,
  started: "",
  logs: [],
};

const emptyProject: Project = {
  id: "",
  name: "No project",
  path: "",
  branch: "",
  status: "quiet",
  accent: "#9db7ff",
  health: 0,
  openSessions: 0,
  queuedTasks: 0,
  lastCommit: "",
  ci: "pending",
  sessions: [],
  queue: [],
  timeline: [],
};



type RuntimeProviderProfile = {
  id: string;
  supportedModels: ModelOption[];
  modelSource: string;
  modelsDiscoveredAt: string | null;
  modelError: string | null;
  installed: boolean;
  version: string | null;
  completionMode: "native" | "fallback" | "unavailable";
  completionEvent: string | null;
  completionMessage: string;
  mcpSupport: boolean;
  projectMcpAuth: "isolated" | "provider-managed" | "none";
};

type RuntimeCustomModelProfile = {
  supportedModels: ModelOption[];
  modelSource: string;
  modelError: string | null;
};

/** How many session panes stay mounted at once, most recently used first. */
// Hidden panes are moved out of view, where xterm stops drawing them, and hold
// no GPU context; what they cost is their buffer. Enough that moving between
// the sessions of a couple of projects never rebuilds one and replays it.
const MOUNTED_SESSION_LIMIT = 16;

/** One identity for "nobody is waiting", so the rail's memo holds. */
const EMPTY_IDS: string[] = [];

const fallbackProviderOptions: AgentOption[] = providerRegistry.map((provider) => ({
  agent: provider.agent,
  command: provider.command,
  loginCommand: provider.loginCommand,
  models: provider.supportedModels,
}));

const PROJECTS_STORAGE_KEY = "pitwall-projects";
const ACTIVE_PROJECT_STORAGE_KEY = "pitwall-active-project";
const SELECTED_SESSION_STORAGE_KEY = "pitwall-selected-session";
const PREVIEW_URLS_STORAGE_KEY = "pitwall-preview-urls";
const TERMINAL_FONT_SIZE_STORAGE_KEY = "pitwall-terminal-font-size";
const REVIEW_REPAIR_STORAGE_KEY = "pitwall-review-repair-v1";
const TERMINAL_FONT_SIZE_MIGRATION_KEY = "pitwall-terminal-font-size-migration";
const TERMINAL_FONT_FAMILY_STORAGE_KEY = "pitwall-terminal-font-family";
const TERMINAL_FONT_FAMILY_MIGRATION_KEY = "pitwall-terminal-font-family-migration";
const PROJECT_NOTIFICATIONS_STORAGE_KEY = "pitwall-project-notifications";
const NOTIFICATION_SOUND_STORAGE_KEY = "pitwall-notification-sound";
const SESSION_ORDER_STORAGE_KEY = "pitwall-session-order";
/** Shared so an unarranged project does not hand the rail a new array each render. */
const EMPTY_ORDER: string[] = [];

/** Session ids per project, in the order the operator dragged them into. */
type StoredSessionOrder = Record<string, string[]>;

function readStoredSessionOrder(): StoredSessionOrder {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_ORDER_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: StoredSessionOrder = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      next[projectId] = value.filter((id): id is string => typeof id === "string");
    }
    return next;
  } catch {
    return {};
  }
}

function readProjectNotifications(): ProjectNotifications {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECT_NOTIFICATIONS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const item = value as Partial<ProjectNotifications[string]>;
        return typeof item.count === "number" && item.count > 0;
      }),
    ) as ProjectNotifications;
  } catch {
    return {};
  }
}

type StoredTaskPreview = { url: string; label: string; updatedAt: string };
type StoredTaskPreviews = Record<string, Record<string, StoredTaskPreview>>;

function readStoredPreviewUrls(): StoredTaskPreviews {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREVIEW_URLS_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: StoredTaskPreviews = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        next[projectId] = { project: { url: value, label: "Project preview", updatedAt: "" } };
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const records = Object.fromEntries(Object.entries(value).flatMap(([taskId, record]) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) return [];
        const candidate = record as Partial<StoredTaskPreview>;
        if (typeof candidate.url !== "string") return [];
        return [[taskId, {
          url: candidate.url,
          label: typeof candidate.label === "string" ? candidate.label : "Task preview",
          updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
        }]];
      }));
      if (Object.keys(records).length) next[projectId] = records;
    }
    return next;
  } catch {
    return {};
  }
}

/** `http://localhost:5173/` reads as `localhost:5173` on a chip. */
function formatServerLabel(rawUrl: string) {
  try {
    const url = new URL(rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return rawUrl;
  }
}

function readStoredProjects() {
  try {
    const stored =
      window.localStorage.getItem(PROJECTS_STORAGE_KEY) ??
      window.localStorage.getItem("agent-studio-projects");
    if (!stored) return projectsSeed;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return projectsSeed;
    return parsed.filter((project): project is Project => {
      if (!project || typeof project !== "object") return false;
      const candidate = project as Project;
      return Boolean(candidate.id && candidate.name && candidate.path);
    }).map((project) => ({
      ...project,
      sessions: (project.sessions ?? []).map((session) => ({
        ...session,
        status: normalizeSessionStatus(session.status),
      })),
    }));
  } catch {
    return projectsSeed;
  }
}

/**
 * Every theme, and what it looks like.
 *
 * The swatch is the ground, the accent and the text — because a list of
 * twenty names tells you nothing about what you are choosing between, and
 * picking each one to find out is not a way to choose a theme.
 *
 * The five Pitwall grew itself lead; the rest are its reading of the
 * editor themes they are named after — each one's identity colour kept
 * exactly (Dracula's #bd93f9, Nord's #88c0d0, Gruvbox's #fabd2f) with the
 * text ramp tuned, because a palette built for one background under a
 * wall of syntax is not one built for cards on panels on a page.
 */
/**
 * One theme, in two lights.
 *
 * There were seventeen — five of Pitwall's own and a dozen borrowed from
 * editors — and none of them was a palette this interface had been tuned
 * against. A design that says "three greys, one blue, and colour only where it
 * is a status report" cannot mean anything if the greys and the blue are
 * whatever you last picked from a list. Pitwall dark and Pitwall light are the
 * two the canvas specifies; light or dark is the choice that remains, and it
 * is a real one.
 */
const THEME_OPTIONS = [
  { value: "pitwall", label: "Pitwall", hint: "light, dark or system", swatch: ["#171b22", "#88c0d0", "#eceff4"] },
  { value: "vt220", label: "VT220", hint: "amber phosphor", swatch: ["#0a0a08", "#e8a33c", "#6fd3e8"] },
  { value: "acme", label: "Acme", hint: "Plan 9 paper", swatch: ["#ffffea", "#1a1a1a", "#1d3fa0"] },
  { value: "night-city", label: "Night City", hint: "neon", swatch: ["#07080b", "#fcee0a", "#05d9e8"] },
  { value: "green-screen", label: "Green Screen", hint: "green phosphor", swatch: ["#040a05", "#4af07a", "#7fe8e0"] },
  { value: "daylight", label: "Daylight", hint: "bright paper", swatch: ["#fafafa", "#24292f", "#0969da"] },
  { value: "synthwave", label: "Synthwave", hint: "neon dusk", swatch: ["#1a1033", "#ff7edb", "#36f9f6"] },
  { value: "midnight", label: "Midnight", hint: "deep blue", swatch: ["#0e1320", "#7aa2f7", "#bb9af7"] },
] as const;

// The terminal themes each have one ground; Light/Dark/System only applies to Pitwall's own.
const THEME_BASE: Partial<Record<string, "light" | "dark">> = { vt220: "dark", acme: "light", "night-city": "dark", "green-screen": "dark", daylight: "light", synthwave: "dark", midnight: "dark" };

/**
 * The faces the interface can be set in.
 *
 * Bundled rather than fetched: this is a desktop app, and a typeface that
 * arrives over the network is one that sometimes does not. Each is a different
 * answer to the same question — how hard should an app that drives terminal
 * programs feel — so the hint says what the answer is rather than naming a
 * foundry.
 */
const FONT_OPTIONS = [
  { value: "plex", label: "IBM Plex Sans", hint: "Zed's face · technical, squared off" },
  { value: "system", label: "System", hint: "macOS's own face · nothing to load" },
  { value: "dm", label: "DM Sans", hint: "rounded · the softest of these" },
  { value: "open", label: "Open Sans", hint: "humanist · built for long reading" },
] as const;

const FONT_STACKS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  plex: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  dm: '"DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  open: '"Open Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
};

const APP_FONTS = FONT_OPTIONS.map((option) => option.value);
type AppFont = (typeof FONT_OPTIONS)[number]["value"];

const COLOR_THEMES = THEME_OPTIONS.map((option) => option.value);
type ColorTheme = (typeof THEME_OPTIONS)[number]["value"];

function readStoredValue(key: string, fallback: string, legacyKeys: string[] = []) {
  try {
    const current = window.localStorage.getItem(key);
    if (current) return current;
    for (const legacyKey of legacyKeys) {
      const legacy = window.localStorage.getItem(legacyKey);
      if (legacy) return legacy;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function getProviderLabel(providerId: PitwallProviderId | "") {
  if (!providerId) return "Unassigned";
  return getProviderById(providerId)?.displayName ?? providerId;
}

// A council agent should never be auto-fed a task while its terminal is sitting
// on a trust / sign-in / approval prompt. This matches those interactive gates.
/**
 * How long to keep watching a pane that is waiting on a person before giving
 * up. Sign-ins happen at human speed — often in a browser — so this is patient.
 */
const COUNCIL_GATE_WATCH_MS = 30 * 60 * 1000;

/** An editor found on this machine, as reported by the main process. */
type InstalledEditor = { id: string; name: string; viaCli: boolean };

/**
 * The editor choice, remembered across restarts. It is a preference about this
 * machine rather than anything to do with a project, so it lives beside the
 * theme rather than in the workspace state.
 */
const EDITOR_CHOICE_KEY = "bravely-editor";

/**
 * Chosen when the user would rather have the folder than an editor. Kept
 * distinct from "no editor installed": one is a preference, the other is a gap,
 * and they want different copy on the button.
 */
const REVEAL_IN_FINDER = "reveal-in-finder";

/**
 * How long a turn's panes may print nothing before the relay asks the member
 * whether it is finished.
 *
 * The relay advances on a handoff file appearing and waits up to two hours for
 * one. The rescue for a member that stopped without writing it hangs off the
 * CLI reporting that it finished — a signal that depends on each provider's
 * notification hooks and does not always arrive. When it does not, nothing
 * notices, and the council sits dead for the rest of that window.
 *
 * Measured from the last output rather than from the start of the turn: turns
 * legitimately run long, but they print as they go, so silence is the thing
 * worth acting on. Long enough that a member thinking hard is not interrupted.
 */
const RELAY_IDLE_NUDGE_MS = 10 * 60 * 1000;

const KNOWLEDGE_TAIL = 128_000;

function createDefaultTask(projectId: string, title = "Implement next task"): PitwallTask {
  const timestamp = nowIso();
  return {
    id: makeId("task"),
    projectId,
    title,
    description: "Define the implementation scope, assign an agent, and start from shared project context.",
    status: "ready",
    priority: "medium",
    assignedAgent: "codex",
    relatedFiles: [],
    worktree: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function contextForProvider(entries: PitwallContextEntry[], providerId: PitwallProviderId) {
  return entries
    .filter((entry) => entry.visibility === "all-agents" || (entry.visibility === "selected-agents" && entry.providerIds.includes(providerId)))
    .sort((a, b) => b.priority - a.priority);
}

function makeContextSnapshot(payload: {
  projectId: string;
  task: PitwallTask;
  sessionId: string;
  provider: PitwallProviderId;
  model: string;
  contextEntries: PitwallContextEntry[];
}): PitwallContextSnapshot {
  return {
    id: makeId("snapshot"),
    projectId: payload.projectId,
    taskId: payload.task.id,
    sessionId: payload.sessionId,
    provider: payload.provider,
    model: payload.model,
    files: payload.task.relatedFiles,
    task: {
      id: payload.task.id,
      title: payload.task.title,
      description: payload.task.description,
      status: payload.task.status,
      priority: payload.task.priority,
      relatedFiles: payload.task.relatedFiles,
      worktree: payload.task.worktree,
    },
    contextEntries: payload.contextEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      content: entry.content,
      priority: entry.priority,
    })),
    createdAt: nowIso(),
  };
}

function getModelsForAgent(options: AgentOption[], agent: AgentProvider, currentModel: string) {
  const provider = options.find((option) => option.agent === agent);
  if (!provider) return [{ label: currentModel, value: currentModel }];
  if (provider.models.some((model) => model.label === currentModel)) return provider.models;
  return [{ label: currentModel, value: currentModel }, ...provider.models];
}

function getModelCommandValue(options: AgentOption[], agent: AgentProvider, modelLabel: string) {
  const known = options.find((option) => option.agent === agent)?.models.find((item) => item.label === modelLabel);
  if (known) return known.value;
  // A shown name the list does not have is never a model id the CLI accepts.
  return (agent === "Claude" ? claudeModelIdFromLabel(modelLabel) : null) ?? modelLabel;
}

function getBootCommand(options: AgentOption[], agent: AgentProvider, modelLabel: string) {
  const provider = options.find((option) => option.agent === agent);
  if (!provider) return "";
  const modelValue = getModelCommandValue(options, agent, modelLabel);
  // "Auto" (or empty) means: launch the bare CLI and let it pick the model its
  // own auth supports — passing --model can 400 (e.g. codex-max on a ChatGPT plan).
  if (!modelValue || modelValue === "auto" || modelValue === "default") return provider.command;
  return `${provider.command} --model ${modelValue}`;
}

function isExplorerVisible(filePath: string, showTooling = false) {
  return showTooling || !filePath.split("/").some((segment) => noisyExplorerSegments.has(segment));
}



function normalizeProjectPath(filePath: string) {
  const parts: string[] = [];

  for (const part of filePath.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}


function basename(filePath: string) {
  const normalized = normalizeProjectPath(filePath);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function scoreFileMatch(filePath: string, query: string) {
  const normalizedFile = filePath.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 1;
  if (basename(normalizedFile) === normalizedQuery) return 100;
  if (basename(normalizedFile).startsWith(normalizedQuery)) return 80;
  if (normalizedFile.includes(`/${normalizedQuery}`)) return 60;
  if (normalizedFile.includes(normalizedQuery)) return 40;

  let queryIndex = 0;
  for (const character of normalizedFile) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return 20;
  }

  return 0;
}




function nextStatus(action: string, current: SessionStatus): SessionStatus {
  if (action === "start" || action === "retry" || action === "unblock") return "starting";
  if (action === "pause") return "waiting";
  if (action === "stop") return "completed";
  return current;
}

/**
 * A council relay in flight. `turn` is the monotonic cursor that also names each
 * handoff file. Who takes each turn is decided per handoff by the conductor —
 * `members` is the roster, not a running order.
 */
interface RelayRun {
  runId: string;
  projectPath: string;
  taskPrompt: string;
  task: { title: string; description?: string };
  members: CouncilRelayMember[];
  turn: number;
  auto: boolean;
  stopped: boolean;
  /**
   * Halted by the user, with every member still alive.
   *
   * Distinct from `stopped`, which the relay also sets when it runs out of
   * turns or finishes — those are the council's own reasons for not advancing
   * and clear themselves. A pause is the user's, and only the user lifts it, so
   * every path that would otherwise pick the relay back up has to check it.
   */
  paused?: boolean;
  currentPrompt?: string;
  /** Conductor config. Disabled falls the relay back to plain rotation. */
  conductor: { enabled: boolean; agent: string; model: string; runTests?: boolean; openingDebate?: boolean; autoApprove?: boolean };
  /**
   * Standing instructions the user gave the conductor directly. Held apart from
   * the thread because the conductor only reads the tail of that — an
   * instruction given ten turns ago is out of its view while still being what
   * the user expects it to route by.
   */
  directives: ConductorDirective[];
  /** Turns of automatic advancement this run may take. null is unlimited. */
  maxTurns: number | null;
  /** How long the whole run may take. null is unlimited. */
  runBudgetMs?: number | null;
  /**
   * The hop the turn limit blocked. Held so raising the limit resumes the
   * conductor's actual decision rather than re-deriving one, or worse, doing
   * nothing because the blocked turn's handoff is already recorded.
   */
  pending?: { turn: number; route?: RelayRoute; from?: CouncilRelayMember };
  /** The whole conversation, mirrored to thread.md for the agents to read. */
  messages: CouncilThreadMessage[];
  /** Member ids in turn order — feeds the anti-stall guard. */
  history: string[];
  /** Member id that owns the turn currently in flight. */
  currentMemberId?: string;
  routes: RelayRouteLogEntry[];
  /** Working-tree fingerprint taken when the current turn began. */
  repoSnapshot: Record<string, string>;
  /** What the repository said about the turn that just finished. */
  evidence: CouncilEvidence | null;
  /**
   * Who has already been asked for a missing handoff, as `turn:memberId`, so
   * nobody is asked twice. Keyed by member and not by turn alone: a panel's
   * members stop independently, and one key for the whole turn would let the
   * first member's silence end the run for all of them.
   */
  nudgedTurns: string[];
  /** Turns already moved on automatically, so a stuck council cannot cycle between rescues. */
  reroutedTurns?: string[];
  /** Everyone taking the current turn — more than one only for a panel. */
  currentPanel: CouncilRelayMember[];
  /** The project's test command, resolved once per run. null means none. */
  testCommand?: string | null;
  /** What the conductor has cost so far. Agent turns are not counted. */
  conductorCostUsd: number;
  /**
   * The independent check standing between the council and stopping. Both the
   * completion marker and the conductor's `done` are opinions from inside the
   * work, so neither ends a run on its own any more.
   */
  verification?: { attempts: number; pending: boolean; verdict: VerificationVerdict | null };
  /** One working-tree fingerprint per finished turn, for oscillation detection. */
  treeHistory: string[];
  /** What earlier councils on this project learned. Read once per run. */
  lessons: string[];
  /**
   * The map of the repository this council has built up: which files matter,
   * what the commands are, what conventions it actually follows. Handed to
   * every turn so a member does not re-explore what an earlier one already read.
   */
  workingSet: WorkingSet;
  projectRoot?: string;
  taskId?: string;
  currentAssignment?: string;
  contextEntryIds?: string[];
  knowledgeHydrated?: boolean;
  /**
   * The argument currently in progress, if any. While this is open the relay's
   * anti-stall guard stands down — two members exchanging on one point is
   * exactly the shape that guard reads as a stalled council.
   */
  debate?: Debate | null;
  /**
   * What the opening debate settled on, carried to the first turn that is
   * allowed to write code. Without it the outcome is only available in the
   * thread rather than binding, and a council can quietly build something other
   * than what it just agreed.
   */
  openingDirective?: string;
  /** True for a council rebuilt from storage whose agent processes are gone. */
  restored?: boolean;
  /** When the council first started, so elapsed time survives a restart. */
  startedAt: string;
}

/**
 * The conductor is a strong reasoning model rather than a cheap one: routing a
 * council badly wastes far more tokens downstream — a whole misdirected agent
 * turn — than it saves on the routing call itself.
 */
const DEFAULT_COUNCIL_CONDUCTOR: {
  enabled: boolean;
  agent: string;
  model: string;
  runTests: boolean;
  openingDebate: boolean;
  autoApprove: boolean;
  maxTurns: number | null;
  /** How long the whole run may take. null is unlimited. */
  runBudgetMs?: number | null;
} = {
  enabled: true,
  agent: "Claude",
  model: "opus",
  runTests: true,
  // On by default: the cost is a round of positions before any code, and the
  // thing it prevents — the whole council building on an approach nobody chose
  // — is far more expensive to unwind later.
  openingDebate: true,
  // Off by default. It removes the approval gate on agents that can run
  // arbitrary commands, so it is a thing the user turns on, not a thing they
  // discover has been on.
  autoApprove: false,
  maxTurns: MAX_RELAY_TURNS,
};

/**
 * Whether this turn has already been closed out — by a member's handoff, or by
 * the council itself recording that the turn ended some other way. Both mean the
 * relay has moved on and must not advance the same turn twice.
 *
 * User instructions carry the current turn number too, and are excluded: they
 * are not the handoff the relay is waiting on, and counting them would stall the
 * council the moment anyone typed into it.
 */
function hasMemberHandoff(messages: CouncilThreadMessage[], turn: number) {
  return messages.some((message) => message.turn === turn && message.author !== "user");
}

/**
 * One line of the conductor lane. `system` is Pitwall speaking about the
 * council — kept distinct from `conductor` so a note the app wrote is never
 * read as something the model said.
 */
export type ConductorNote = {
  id: string;
  role: "you" | "conductor" | "system";
  text: string;
  at: string;
};

/** One routing decision, kept for the council bar and the conductor log file. */
interface RelayRouteLogEntry {
  turn: number;
  fromMemberId: string;
  toMemberId: string;
  source: RelayRouteSource;
  reason: string;
  directive: string;
}

function makeProjectFromPath(path: string, count: number): Project {
  // Either separator: a Windows path arrives as C:\Users\me\project.
  const name = path.split(/[\\/]/).filter(Boolean).pop() || `Project ${count + 1}`;

  return {
    id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    name,
    path,
    branch: "main",
    status: "watching",
    accent: "#9db7ff",
    health: 0,
    openSessions: 0,
    queuedTasks: 0,
    lastCommit: "just added",
    ci: "pending",
    queue: [],
    timeline: ["Project added"],
    sessions: [],
  };
}

/** Views that slide over the work rather than replace it. */
const SHEET_SECTIONS = new Set<WorkspaceSection>(["context", "schedule", "watch", "extensions", "connections", "hermes"]);

export function App() {
  const [storedProjects] = useState(readStoredProjects);
  const initialProjectsRef = useRef<Project[]>(storedProjects);
  const [projects, setProjects] = useState<Project[]>(() => initialProjectsRef.current);
  const projectsRef = useRef<Project[]>(initialProjectsRef.current);
  const [projectNotifications, setProjectNotifications] = useState<ProjectNotifications>(readProjectNotifications);
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(
    () => readStoredValue(NOTIFICATION_SOUND_STORAGE_KEY, "true") !== "false",
  );
  const activeProjectIdRef = useRef("");
  /** When each project's trackers were last re-read, so switching projects does not reset the clock. */
  const lastTrackerSyncRef = useRef<Record<string, number>>({});
  /**
   * The same instant as the ref, in state.
   *
   * The ref is what the timer reads and must not cause a render; this is what
   * the board counts down from, and must. Kept together so the number on
   * screen is the one the timer will actually act on.
   */
  const [trackerSyncedAt, setTrackerSyncedAt] = useState<Record<string, number>>({});
  const [trackerNow, setTrackerNow] = useState(() => Date.now());
  const [trackerSyncing, setTrackerSyncing] = useState(false);
  const notificationSoundEnabledRef = useRef(notificationSoundEnabled);
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try { return readNotifications(localStorage.getItem("pitwall-notifications")); } catch { return []; }
  });
  const projectPathsKey = projects.map((project) => project.path).join("\n");
  // Main repairs these projects' worktree links when it maintains worktrees; it has no project list of its own.
  useEffect(() => {
    void window.pitwall?.setKnownProjects?.({ projectPaths: projectPathsKey.split("\n").filter(Boolean) }).catch(() => undefined);
  }, [projectPathsKey]);
  useEffect(() => {
    try { localStorage.setItem("pitwall-notifications", JSON.stringify(notifications)); } catch { /* the list is a convenience */ }
  }, [notifications]);
  /** What is on screen, for deciding whether news is news. Kept current every render. */
  const viewRef = useRef({ projectId: "", section: "", sessionId: "" });
  const completionAudioContextRef = useRef<AudioContext | null>(null);
  const [pitwall, setPitwall] = useState<PitwallWorkspaceState>(() => readPitwallState(initialProjectsRef.current));
  const pitwallRef = useRef(pitwall);
  const [activeProjectId, setActiveProjectId] = useState(() =>
    readStoredValue(ACTIVE_PROJECT_STORAGE_KEY, initialProjectsRef.current[0]?.id ?? "", [
      "agent-studio-active-project",
    ]),
  );
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Read from the main process, which owns the setting: the checkbox reflects
  // what is actually stored rather than a copy that can drift from it.
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  useEffect(() => {
    void window.pitwall?.analyticsState?.().then((state) => {
      if (state?.ok) setAnalyticsEnabled(state.enabled);
    });
  }, []);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("files");
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  /**
   * A session is being made right now.
   *
   * Making one is a worktree, a branch, a PTY and a CLI booting into it —
   * twenty seconds on a large repository. Unmarked, the button looked broken
   * and got pressed a second time, which is how you end up with two.
   */
  const [creatingSession, setCreatingSession] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [mcpTaskImportOpen, setMcpTaskImportOpen] = useState(false);
  const [startTaskOpen, setStartTaskOpen] = useState(false);
  const [startingTaskId, setStartingTaskId] = useState("");
  const [taskDetail, setTaskDetail] = useState<PitwallTask | null>(null);
  const [bulkStartTasks, setBulkStartTasks] = useState<PitwallTask[]>([]);
  const [bulkStartingCount, setBulkStartingCount] = useState(0);
  const [bulkStarting, setBulkStarting] = useState(false);
  /** Asked to stop. A ref because the loop in flight reads it, not a render. */
  const bulkCancelRef = useRef(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [createContextOpen, setCreateContextOpen] = useState(false);
  const [mcpManagerOpen, setMcpManagerOpen] = useState(false);
  const mcpManagerRef = useModalFocus<HTMLDivElement>(mcpManagerOpen, () => setMcpManagerOpen(false));
  const [draftAgent, setDraftAgent] = useState<AgentProvider>("Codex");
  /** A reviewer to pair with the next session's implementer, as "<cli>:<rounds>". */
  const [draftPair, setDraftPair] = useState("");
  const [draftModel, setDraftModel] = useState(
    () => fallbackProviderOptions.find((option) => option.agent === "Codex")?.models[0].label ?? "Auto",
  );
  const [draftSessionType, setDraftSessionType] = useState<PitwallSessionType>("implementation");
  /**
   * Whether the next session is launched in its CLI's no-prompts mode.
   *
   * Remembered for the rest of the run rather than reset per session: someone
   * who works this way was setting it again on every Codex session, which is
   * the switching this replaces.
   */
  const [draftAutoApprove, setDraftAutoApprove] = useState(false);
  /** Hermes's background learning runs in flight, so the sidebar can say so while it happens. */
  const [hermesLearning, setHermesLearning] = useState<Array<{ id: string; key: string }>>([]);
  /** Hermes reported it is signed out; cleared when a sign-in completes. */
  const [hermesSignedOut, setHermesSignedOut] = useState(false);
  const hermesReadyRef = useRef(false);
  const [draftTaskId, setDraftTaskId] = useState("");
  /** Empty means "use the generated default", which the field shows as its placeholder. */
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftTaskIdentifier, setDraftTaskIdentifier] = useState("");
  const [draftTaskTitle, setDraftTaskTitle] = useState("Implement next task");
  const [draftTaskDescription, setDraftTaskDescription] = useState("");
  const [draftTaskImages, setDraftTaskImages] = useState<string[]>([]);
  /** Stable for the life of one draft, so its images stage into one directory. */
  const draftTaskAttachmentId = useRef(makeId("task-draft"));
  const [taskFormError, setTaskFormError] = useState("");
  const [draftTaskPriority, setDraftTaskPriority] = useState<PitwallTaskPriority>("medium");
  const [draftTaskAgent, setDraftTaskAgent] = useState<PitwallProviderId | "council">("codex");
  const [draftContextTitle, setDraftContextTitle] = useState("Architecture note");
  const [draftContextCategory, setDraftContextCategory] = useState<PitwallContextEntry["category"]>("decision");
  const [draftContextContent, setDraftContextContent] = useState("");
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const pendingTaskStartRef = useRef<string | null>(null);
  const [agentChecks, setAgentChecks] = useState<Partial<Record<string, AgentCheck>>>({});
  hermesReadyRef.current = agentChecks.Hermes?.status === "ready";
  const [checkingAgents, setCheckingAgents] = useState(false);
  const [runtimeProviderProfiles, setRuntimeProviderProfiles] = useState<RuntimeProviderProfile[]>([]);
  const [refreshingProviderModels, setRefreshingProviderModels] = useState(false);
  /** The session last open in each project, so coming back to a project comes back to it. */
  const [lastSessionByProject, setLastSessionByProject] = useState<Record<string, string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pitwall-last-session-by-project") || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch {
      return {};
    }
  });
  const [selectedSessionId, setSelectedSessionId] = useState(() =>
    readStoredValue(SELECTED_SESSION_STORAGE_KEY, initialProjectsRef.current[0]?.sessions[0]?.id ?? "", [
      "agent-studio-selected-session",
    ]),
  );
  const [missionOpen, setMissionOpen] = useState(
    () => !window.matchMedia("(max-width: 1180px)").matches && readStoredValue("pitwall-mission-open", "true", ["bravely-mission-open"]) !== "false",
  );
  const [storedMissionOpen] = useState(() => readStoredValue("pitwall-mission-open", "true", ["bravely-mission-open"]) !== "false");
  const wideMissionOpen = useRef(storedMissionOpen);
  useEffect(() => {
    const compactWindow = window.matchMedia("(max-width: 1180px)");
    const collapse = () => setMissionOpen((current) => {
      if (compactWindow.matches) {
        wideMissionOpen.current = current;
        return false;
      }
      return wideMissionOpen.current;
    });
    compactWindow.addEventListener("change", collapse);
    return () => compactWindow.removeEventListener("change", collapse);
  }, []);
  // Light, dark, or whatever macOS is set to.
  const [themePreference, setThemePreference] = useState<"light" | "dark" | "system">(() => {
    const stored = readStoredValue("pitwall-theme", "light", ["bravely-theme"]);
    return stored === "dark" || stored === "system" ? stored : "light";
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const follow = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  /* Whatever anyone had chosen before — dracula, gruvbox, indigo — lands on
     the default theme, rather than on a name nothing answers to. */
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    const stored = readStoredValue("pitwall-color-theme", "pitwall");
    return (COLOR_THEMES as readonly string[]).includes(stored) ? (stored as ColorTheme) : "pitwall";
  });
  const theme: "light" | "dark" = THEME_BASE[colorTheme] ?? (themePreference === "system" ? (systemDark ? "dark" : "light") : themePreference);
  const [appFont, setAppFont] = useState<AppFont>(() => {
    // Every launch wrote the font back, so a stored "system" from before Zed's face was the default is not a choice.
    const stored = readStoredValue("pitwall-app-font", "plex");
    if (stored === "system" && readStoredValue("pitwall-app-font-migration", "") !== "zed") return "plex";
    return (APP_FONTS as readonly string[]).includes(stored) ? (stored as AppFont) : "plex";
  });
  const [terminalFontSize, setTerminalFontSize] = useState(() =>
    initialTerminalFontSize(
      readStoredValue(TERMINAL_FONT_SIZE_STORAGE_KEY, String(DEFAULT_TERMINAL_FONT_SIZE)),
      readStoredValue(TERMINAL_FONT_SIZE_MIGRATION_KEY, ""),
    ),
  );
  const [terminalFontFamily, setTerminalFontFamily] = useState(() =>
    initialTerminalFontFamily(
      readStoredValue(TERMINAL_FONT_FAMILY_STORAGE_KEY, "") || null,
      readStoredValue(TERMINAL_FONT_FAMILY_MIGRATION_KEY, "") || null,
    ),
  );
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("terminal");
  /**
   * Branches opened as tabs on the review screen, in the order opened.
   *
   * Held here rather than in the page so they survive navigating away and
   * back: a diff you were halfway through reading should still be open when
   * you return to it.
   */
  /** Which of them is showing; empty means the review queue itself. */
  /** What the project's own checks said about each session's work. */
  const [sessionChecks, setSessionChecks] = useState<Record<string, ValidationResult>>({});
  const [checkingSessions, setCheckingSessions] = useState<Record<string, boolean>>({});
  const [taskChecks, setTaskChecks] = useState<Record<string, ValidationResult>>({});
  const [checkingTasks, setCheckingTasks] = useState<Record<string, boolean>>({});
  const taskCheckInFlight = useRef(new Set<string>());
  const [taskPendingCompletion, setTaskPendingCompletion] = useState<PitwallTask | null>(null);
  /**
   * The agent list and their checks, readable from an event handler.
   *
   * The completion listener is registered once, so anything it calls closes
   * over the first render — where no check had returned yet and every agent
   * looked uninstalled. A staged run's architect therefore worked, and the
   * implementer that followed it was told no agent could be driven.
   */
  const agentChecksRef = useRef<typeof agentChecks>({});
  const agentOptionsRef = useRef<AgentOption[]>([]);
  /** What each session's CLI said it spent. Absent means it said nothing. */
  const [sessionUsage, setSessionUsage] = useState<Record<string, SessionUsage>>({});
  /** The sidebar's project filter; "" shows every project. Remembered across launches. */
  const [sidebarProjectFilter, setSidebarProjectFilter] = useState(() => {
    try { return localStorage.getItem("pitwall-sidebar-project") ?? ""; } catch { return ""; }
  });
  const [sidebarSelection, setSidebarSelection] = useState("");
  /** The models automations run on, and how often the board re-reads its tracker. */
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings | null>(null);
  const boardSyncMsRef = useRef(15 * 60_000);
  boardSyncMsRef.current = (automationSettings?.boardSyncMinutes ?? 15) * 60_000;
  useEffect(() => {
    void window.pitwall?.getAutomationSettings?.().then((result) => { if (result?.settings) setAutomationSettings(result.settings); });
  }, []);
  /** A Watches card to bring into view, when a notification asked for it. */
  const [focusFindingId, setFocusFindingId] = useState("");
  /** The Review page's selection, when the sidebar asked for a specific task. */
  const [reviewFocusTaskId, setReviewFocusTaskId] = useState("");
  /** A row in another project, opened once that project has rendered. */
  const pendingSidebarRowRef = useRef<SidebarRow | null>(null);
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>(() =>
    initialProjectsRef.current[0]?.sessions.length ? "work" : "overview",
  );
  // What a sheet slides over, and what closing it returns to.
  const [sheetBase, setSheetBase] = useState<WorkspaceSection>(() =>
    initialProjectsRef.current[0]?.sessions.length ? "work" : "overview",
  );
  useEffect(() => {
    if (!SHEET_SECTIONS.has(workspaceSection)) setSheetBase(workspaceSection);
  }, [workspaceSection]);
  const sheetOpen = SHEET_SECTIONS.has(workspaceSection);
  const baseSection = sheetOpen ? sheetBase : workspaceSection;
  // What the repository says about the branches behind review cards. Derived
  // on every refresh and never persisted — a stored review status reconciled
  // by nothing is exactly what left cards standing for work merged last week.
  // Null until a read succeeds. An empty object is a real answer — a project
  // with no branches — and must not be confused with not having asked yet,
  // or every card would vanish for the moment before the first refresh lands.
  const [reviewFacts, setReviewFacts] = useState<Record<string, ReviewBranchFacts> | null>(null);
  const [pullRequestsAvailable, setPullRequestsAvailable] = useState(false);
  const [pullRequestError, setPullRequestError] = useState("");
  // Why the last read failed, if it did. Dropping this made the refresh
  // control look inert: it ran, it failed, and the screen said nothing.
  const [reviewError, setReviewError] = useState("");
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  // Jobs Pitwall starts by itself. Held in userData by the main process; this
  // is the renderer's copy, refreshed after every change.
  const [scheduleJobs, setScheduleJobs] = useState<ScheduleJob[]>([]);
  const scheduleJobsRef = useRef<ScheduleJob[]>([]);
  scheduleJobsRef.current = scheduleJobs;
  const lastReviewRefresh = useRef(0);
  const [previewUrlsByProject, setPreviewUrlsByProject] = useState<StoredTaskPreviews>(() => readStoredPreviewUrls());
  const [sessionOrderByProject, setSessionOrderByProject] = useState<StoredSessionOrder>(() => readStoredSessionOrder());
  // Tooling files stay out of the palette's file search, as they did in the
  // explorer that used to own this setting.
  const showToolingFiles = false;
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  // The editors installed on this machine, and which one the user picked. The
  // choice is remembered because it is a preference, not a per-project decision.
  const [installedEditors, setInstalledEditors] = useState<InstalledEditor[]>([]);
  const [editorChoice, setEditorChoice] = useState(() => localStorage.getItem(EDITOR_CHOICE_KEY) ?? "");
  // The session's files, in the column task details otherwise use. Off in
  // releases while it is finished; `pitwall-files-panel` = "on" turns it on.
  const [filesPanelEnabled] = useState(() => readStoredValue("pitwall-files-panel", "off") === "on");
  const [filesOpen, setFilesOpen] = useState(() => readStoredValue("pitwall-files-open", "false") === "true");
  const [filesWidth, setFilesWidth] = useState(() => Math.min(900, Math.max(300, Number(readStoredValue("pitwall-files-width", "440")) || 440)));
  const [filesRequest, setFilesRequest] = useState<FilesOpenRequest | null>(null);
  const [editorStatus, setEditorStatus] = useState("");
  const [openingEditor, setOpeningEditor] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [worktreeAudit, setWorktreeAudit] = useState<{
    open: boolean; worktrees: WorktreeAudit[] | null; error: string; busyPath: string;
  }>({ open: false, worktrees: null, error: "", busyPath: "" });
  const [editingSessionId, setEditingSessionId] = useState("");
  const [sessionPendingDelete, setSessionPendingDelete] = useState<AgentSession | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [councilPendingDelete, setCouncilPendingDelete] = useState<PitwallCouncilRun | null>(null);
  const [deletingCouncilRunId, setDeletingCouncilRunId] = useState("");
  // One confirmation at a time: the dialog describes a single task's sessions.
  const [tasksPendingDelete, setTasksPendingDelete] = useState<PitwallTask[]>([]);
  const taskPendingDelete = tasksPendingDelete[0] ?? null;
  const [columnPendingClear, setColumnPendingClear] = useState<{ column: string; tasks: PitwallTask[] } | null>(null);
  const clearColumnDialogRef = useModalFocus<HTMLElement>(Boolean(columnPendingClear), () => setColumnPendingClear(null));
  const [deletingTaskId, setDeletingTaskId] = useState("");
  const [restoredTerminalLinesBySession] = useState<Record<string, string[]>>(readTerminalHistory);
  // Output lives outside React state: a pane renders when its session prints, the app does not.
  const [terminalLinesStore] = useState(() => createTerminalLinesStore(restoredTerminalLinesBySession));
  const [transcriptSession, setTranscriptSession] = useState<AgentSession | null>(null);
  const [terminalAttachedBySession, setTerminalAttachedBySession] = useState<Record<string, boolean>>({});
  const terminalAttachedRef = useRef<Record<string, boolean>>({});
  const attachingTerminalRef = useRef<Record<string, boolean>>({});
  const terminalInitialPromptRef = useRef<Record<string, string>>({});
  const taskRuntimeBySessionRef = useRef<Record<string, TaskRuntimePlan>>({});
  // Why a session's worktree could not be made here, for the start error to say.
  const workspaceProblemRef = useRef<Record<string, string>>({});
  const taskBySessionRef = useRef<Record<string, PitwallTask>>({});
  const terminalLinesRef = useRef<Record<string, string[]>>(restoredTerminalLinesBySession);
  /**
   * Dev-server URLs, kept up to date as output arrives.
   *
   * Previously derived by re-reading every session's whole buffer inside a memo
   * keyed on that buffer, so it ran for every session on every frame carrying
   * terminal output. Measured at six sessions with a few megabytes each, that
   * one derivation cost more than a frame's entire budget — which is what made
   * the app crawl the longer it was left running.
   */
  // Seeded once. As a plain `useRef` argument this rescanned every restored
  // transcript on every render of the app and threw the answer away.
  const [seededPreviewWatches] = useState<Record<string, PreviewWatch>>(() =>
    Object.fromEntries(
      Object.entries(restoredTerminalLinesBySession).map(([id, chunks]) => [id, seedPreviewWatch(chunks)]),
    ),
  );
  const previewWatchRef = useRef<Record<string, PreviewWatch>>(seededPreviewWatches);
  /** Mirrors the state so the arrival handler can compare without re-rendering. */
  const [seededPreviewUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(seededPreviewWatches)
        .filter(([, watch]) => watch.preview)
        .map(([id, watch]) => [id, watch.preview!.url]),
    ),
  );
  const previewUrlRef = useRef<Record<string, string>>(seededPreviewUrls);
  const [previewUrlBySession, setPreviewUrlBySession] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(previewWatchRef.current)
        .filter(([, watch]) => watch.preview)
        .map(([id, watch]) => [id, watch.preview!.url]),
    ),
  );
  /**
   * Drains PTY output that is still sitting in the current animation frame.
   *
   * Terminal chunks are batched per frame so ten busy sessions cost one
   * render instead of hundreds. That batching is invisible except at the
   * moment a session exits: an agent prints its summary line and exits in the
   * same breath, so the exit event can beat the frame carrying the line it
   * needs to be read from.
   */
  const flushTerminalDataRef = useRef<() => void>(() => {});
  /**
   * A headless copy of every session's screen.
   *
   * Menu and busy state are read off a rendered terminal, and one only exists
   * for a mounted pane — which only ever happens for sessions you have
   * selected. This gives every session a screen to read whether or not it has
   * been visited.
   */
  const [screenMirror] = useState(createScreenMirror);
  const screenMirrorRef = useRef(screenMirror);
  /**
   * Chunks the bounded transcript has dropped off the front, per session.
   *
   * A pane tracks its place in that buffer by index, which only means anything
   * while nothing is removed from the start. Once the cap engages, this is what
   * lets it find its place instead of concluding the buffer was replaced and
   * resetting the terminal on every frame.
   */
  const droppedChunksRef = useRef<Record<string, number>>({});
  /** An escape sequence a PTY read cut in two, waiting for its other half. */
  const escapeCarryRef = useRef<Record<string, string>>({});
  /** The terminal modes each session's program has switched on, for replays. */
  const terminalModesRef = useRef<Record<string, TerminalModeTracker>>({});
  const droppedForSession = useCallback((sessionId: string) => droppedChunksRef.current[sessionId] ?? 0, []);
  const replayPreambleFor = useCallback((sessionId: string) => terminalModesRef.current[sessionId]?.preamble() ?? "", []);
  const terminalHandlesRef = useRef<Record<string, AgentTerminalHandle | null>>({});
  // One ref callback per session for the life of the app: a new function each
  // render made React detach and re-attach every pane's handle on every render.
  const terminalRefCallbacks = useRef<Record<string, (handle: AgentTerminalHandle | null) => void>>({});
  const terminalRefFor = (sessionId: string) => (terminalRefCallbacks.current[sessionId] ??= (handle) => {
    terminalHandlesRef.current[sessionId] = handle;
  });
  // Which surface a session is showing. The terminal is the default and never
  // goes away: the native view only models what the protocol describes, so
  // anything it cannot draw has to remain reachable.
  /**
   * Which surface a session is being read on.
   *
   * `chat` is the protocol reader, behind a flag. `conversation` reads the
   * CLI's own session file and is always available — it starts nothing.
   */
  const [agentViewBySession, setAgentViewBySession] = useState<Record<string, SessionSurface>>({});
  // A menu appears and then nothing else happens — the agent is waiting. There
  // is no event for that: xterm applies writes asynchronously, so the render
  // triggered by the chunk that drew the menu runs before the menu is in the
  // buffer, and no further chunk arrives to trigger another. A slow tick is
  // what makes a waiting screen visible.
  const [screenTick, setScreenTick] = useState(0);
  const runningSessionCountRef = useRef(0);
  // Publishes the activity snapshot and moves the quiet clocks along. One timer
  // for the whole rail rather than one per session.
  // Each tick renders the app only when there is something new to show:
  // output since the last one, or a session still running whose clock moves.
  // A quiet window, or a hidden one, costs nothing.
  useEffect(() => {
    let published: Record<string, SessionActivity> = {};
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const live = terminalPtyActivityRef.current;
      const ids = Object.keys(live);
      const moved = ids.length !== Object.keys(published).length
        || ids.some((id) => published[id]?.lastAt !== live[id].lastAt || published[id]?.chunks !== live[id].chunks);
      if (moved) {
        published = { ...live };
        setSessionActivity(published);
      }
      if (moved || runningSessionCountRef.current > 0) setActivityNow(Date.now());
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  // The screens are read on a tick, and the app renders only when what they
  // say — working, or waiting on a menu — has changed.
  const screenSignatureRef = useRef<() => string>(() => "");
  useEffect(() => {
    let last = "";
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const signature = screenSignatureRef.current();
      if (signature === last) return;
      last = signature;
      setScreenTick((tick) => tick + 1);
    }, 700);
    return () => window.clearInterval(timer);
  }, []);
  const openedCompletionPreviewsRef = useRef<Set<string>>(new Set());
  const terminalPtyActivityRef = useRef<Record<string, SessionActivity>>({});
  // A snapshot of that ref, taken on a slow tick. The ref itself changes on
  // every chunk and must not drive rendering, but "how long has this been
  // quiet" is only useful if it is on screen.
  const [sessionActivity, setSessionActivity] = useState<Record<string, SessionActivity>>({});
  /** Sessions being created: worktree, context and launch take a while, and the sidebar shows them meanwhile. */
  const [startingSessions, setStartingSessions] = useState<StartingSession[]>([]);
  // Read on the same tick. Taking Date.now() inline at the call site would give
  // the rail a new prop on every render of the app, which is every keystroke in
  // the composer, and the rail sorts every session it is given.
  const [activityNow, setActivityNow] = useState(() => Date.now());
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  /** Which agent the Extensions catalogue opens on, when something sends you there. */
  const [extensionsProvider, setExtensionsProvider] = useState<string>("claude");
  const [mcpAuthServer, setMcpAuthServer] = useState<McpServerInfo | null>(null);
  const [activeCouncilRunId, setActiveCouncilRunId] = useState("");
  const [councilGateBySession, setCouncilGateBySession] = useState<Record<string, string>>({});
  const [councilSharedMessage, setCouncilSharedMessage] = useState("");
  const [councilBroadcasting, setCouncilBroadcasting] = useState(false);
  // The conductor lane: what the user has said to the conductor and what it said
  // back. Kept per run and in memory only — the instructions that have to
  // survive a restart are on the run itself, and a transcript of questions is
  // not something a resumed council needs in order to route.
  const [conductorMessage, setConductorMessage] = useState("");
  const [conductorBusy, setConductorBusy] = useState(false);
  /**
   * What the conductor is doing, while it does it.
   *
   * The lane showed one word for as long as this took — and it can take two
   * minutes per question, asked twice — so a slow answer and a dead one looked
   * the same, and a failure left nothing behind in the lane at all.
   */
  const [conductorStatus, setConductorStatus] = useState("");
  const [conductorLogByRun, setConductorLogByRun] = useState<Record<string, ConductorNote[]>>({});
  // Manual relay: council stages hand work to the next via a file handoff, gated
  // by a button. `relayBySession` drives the pane UI; the ref holds each stage's
  // prompt + who it advances to (a ref so the handoff closure never goes stale).
  const [relayBySession, setRelayBySession] = useState<Record<string, RelayState>>({});
  // Per-run relay cursor. `projectPath` lives here because the watcher polls the
  // stage file long after the run started — and for a freshly created project
  // the `activeProject` in its closure would still be the previous selection.
  const relayRunRef = useRef<Record<string, RelayRun>>({});
  const preparedContextRef = useRef<Record<string, { prompt: string; projectPath: string; receipt?: DeliveryReceipt; providerRestricted: boolean }>>({});
  const capturedKnowledgeRef = useRef<Record<string, string>>({});
  /** What each session last said it did, for Hermes to learn from once the task is settled. */
  const lastSummaryRef = useRef<Record<string, string>>({});
  // The last 128k of each session's output, kept as chunks: joining a string
  // per chunk copied the whole tail on every one, for every session streaming.
  const knowledgeOutputRef = useRef<Record<string, { parts: string[]; size: number }>>({});
  const [contextReceipts, setContextReceipts] = useState<Record<string, DeliveryReceipt>>({});
  const [knowledgeRefresh, setKnowledgeRefresh] = useState(0);
  const contextSelectionScopeRef = useRef("");
  const relayRunIdBySessionRef = useRef<Record<string, string>>({});
  const handoffInFlightRef = useRef<Record<string, boolean>>({});
  // Mirrors the run cursor for rendering (turn counter, auto toggle, notices,
  // and the conductor's latest routing decision).
  const [relayRunState, setRelayRunState] = useState<
    Record<
      string,
      {
        turn: number;
        auto: boolean;
        note: string;
        route?: RelayRouteLogEntry;
        testing?: boolean;
        costUsd?: number;
        atTurnLimit?: boolean;
        /** Stopped because the run outlived its time budget rather than its turns. */
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
        config?: { enabled: boolean; model: string; runTests: boolean; maxTurns: number | null };
        activity?: CouncilActivity;
        startedAt?: string;
        /**
         * The standing instructions, mirrored out of the run so the lane
         * re-renders when one is added. The run itself lives in a ref, and a ref
         * changing is invisible to React.
         */
        directives?: string[];
      }
    >
  >({});
  /**
   * The size each pane's xterm has actually fitted to. The PTY must be spawned
   * at these dimensions: a CLI started at some other width wraps its output for
   * a terminal that does not exist, and the pane renders the result as
   * overlapping, mid-word garbage until something forces a full repaint.
   */
  const terminalSizeRef = useRef<Record<string, { cols: number; rows: number }>>({});
  /** Panes currently being watched for a sign-in prompt to clear. */
  const relayGateWatchRef = useRef<Record<string, boolean>>({});
  /** When a turn first found every owing member blocked, keyed by run and turn. */
  const relayGateSinceRef = useRef<Record<string, number>>({});
  const relaySessionRef = useRef<Record<string, AgentSession>>({});
  /** Which panes are currently blocked, so a gate is counted once per stall. */
  const councilGatedRef = useRef<Record<string, boolean>>({});
  /** Codex panes whose current update menu has already been answered. */
  const codexUpdateAnsweredRef = useRef<Record<string, boolean>>({});
  const answerCodexUpdatePromptRef = useRef(answerCodexUpdatePrompt);
  answerCodexUpdatePromptRef.current = answerCodexUpdatePrompt;
  // Records which project a spawned session belongs to. `projects` state lags a
  // council start by a render, so without this a session booted for a
  // just-created project would resolve its cwd to the previous selection.
  const sessionProjectRef = useRef<Record<string, Project>>({});
  // Keyed by runId, not session: one watch is in flight per relay at a time, and
  // bumping the token is how any path (stop, toggle, manual handoff) cancels it.
  const relayWatchTokenRef = useRef<Record<string, number>>({});
  // When a "start work" action fires on a project with no task yet, we route to
  // task creation first and remember what to open once the task exists.
  const pendingActionRef = useRef<"council" | "compare" | "session" | null>(null);
  const [createProjectFlowOpen, setCreateProjectFlowOpen] = useState(false);
  const [createProjectFlowBusy, setCreateProjectFlowBusy] = useState(false);
  const [createProjectFlowError, setCreateProjectFlowError] = useState("");
  const [councilSetupOpen, setCouncilSetupOpen] = useState(false);
  const [councilSetupMode, setCouncilSetupMode] = useState<"council" | "compare">("council");
  const [activeCouncilMode, setActiveCouncilMode] = useState<"council" | "compare">("council");
  const [customAgents, setCustomAgents] = useState<CustomAgentDefinition[]>(() => readCustomAgents());
  /**
   * Local models, discovered rather than configured.
   *
   * Pitwall used to know about a pulled Ollama model only if somebody went to
   * the marketplace and pressed a button, which meant the common case — the
   * model is there, the agent that can drive it is there — still showed an
   * empty list. This asks on load and after an install, and the answer is the
   * current truth rather than something saved earlier.
   */
  const [localAgent, setLocalAgent] = useState<LocalAgentOption | null>(null);
  /** Pulled models, counted even when nothing can drive them yet. */
  const [localModelCount, setLocalModelCount] = useState(0);

  /* The staged workflow's own state. Runs are the index over work in flight;
     outcomes are the evidence that outlives them. */
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>(() => readTaskRuns());
  const [modelOutcomes, setModelOutcomes] = useState<AttemptOutcome[]>(() => readOutcomes());
  /** What the user is willing to spend, and where their code may go. */
  const [stagedPolicy] = useState<ImplementerPolicy>("cheapest");
  const taskRunsRef = useRef<TaskRun[]>(taskRuns);
  /** Which run a session belongs to, and what it was asked to write. */
  const stagedBySessionRef = useRef<Record<string, { runId: string; stage: string; outputFile: string; cwd: string }>>({});
  const stagedRequestRef = useRef<Record<string, string>>({});
  const stagedDiffRef = useRef<Record<string, string>>({});
  /** Where a run's work is happening, so checks and diffs look in the right place. */
  const stagedCwdRef = useRef<Record<string, string>>({});
  /** Guards against counting one run's evidence twice. */
  const recordedOutcomeRef = useRef<Record<string, boolean>>({});
  const [runtimeCustomModels, setRuntimeCustomModels] = useState<Record<string, RuntimeCustomModelProfile>>({});
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  /** Add agent opened from New work returns there when it closes; from Settings it does not. */
  const [addAgentFromSession, setAddAgentFromSession] = useState(false);
  const [installProviderId, setInstallProviderId] = useState("");
  /** A catalogue entry being installed, when it is not a first-class provider. */
  const [installEntry, setInstallEntry] = useState<CatalogueEntry | null>(null);
  const [catalogueInstalled, setCatalogueInstalled] = useState<Record<string, boolean>>({});
  const [allSessionsOpen, setAllSessionsOpen] = useState(false);
  const chipStripRef = useRef<HTMLDivElement>(null);
  const [chipEdges, setChipEdges] = useState({ left: false, right: false });
  // Someone with projects open is past the first run, whatever the flag says.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () =>
      initialProjectsRef.current.length === 0 &&
      readStoredValue("pitwall-onboarded", "", ["bravely-onboarded"]) !== "yes",
  );
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [githubAuthOpen, setGitHubAuthOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [licenceOpen, setLicenceOpen] = useState(false);
  const { licence, checkoutUrl, hasKey, activate: activateLicence, clear: clearLicence } = useLicence();
  const [connectionsProvider, setConnectionsProvider] = useState<PitwallProviderId | null>(null);
  const [githubAuthStatus, setGitHubAuthStatus] = useState<GitHubAuthResult | null>(null);
  const [githubAuthBusy, setGitHubAuthBusy] = useState(false);
  const [githubAccountsLoading, setGitHubAccountsLoading] = useState(false);
  const [githubAccounts, setGitHubAccounts] = useState<GitHubAccountsResult | null>(null);
  const [githubAuthNotice, setGitHubAuthNotice] = useState("");
  /** Project id whose GitHub account Pitwall could not choose, because it has no credential. */
  const [githubActivationPrompt, setGitHubActivationPrompt] = useState("");
  /** Which service the active project's code lives on, for words and offers. */
  const [codeHost, setCodeHost] = useState<CodeHostInfo | null>(null);
  /** What Pitwall watches for on each project's host, and what it found. */
  const [watchState, setWatchState] = useState<WatchState>({ watches: [], findings: [] });
  useEffect(() => {
    void window.pitwall?.listWatches?.().then((state) => { if (state?.ok) setWatchState({ watches: state.watches, findings: state.findings }); });
    return window.pitwall?.onWatchChanged?.((state) => setWatchState(state));
  }, []);
  /** A request being written for a task, before it is sent. */
  const [requestDraft, setRequestDraft] = useState<(CreateRequestDraft & {
    task: PitwallTask;
    worktreePath: string;
    commits: string[];
    files: string[];
    template?: string;
  }) | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestWriting, setRequestWriting] = useState(false);
  const [requestWritten, setRequestWritten] = useState<WrittenDraft | null>(null);
  const [requestWriteError, setRequestWriteError] = useState("");
  /** Which dialog a written description belongs to, so a late one cannot land in the next. */
  const requestWriteToken = useRef(0);
  type SystemNotice = { tone: "info" | "warn" | "error"; title: string; message: string; action?: "hermes-sign-in"; target?: NotificationTarget };
  const [systemNotice, setSystemNoticeNow] = useState<SystemNotice | null>(null);
  // An error is asking for a decision; a passing info toast must not cover it.
  const setSystemNotice = useCallback((next: SystemNotice | null) => {
    setSystemNoticeNow((current) => (current?.tone === "error" && next && next.tone !== "error" ? current : next));
  }, []);
  // An info toast that told you something already did its job; an error waits
  // until it is dismissed, because it is asking for a decision.
  useEffect(() => {
    // Only news fades on its own; a warning or an error waits to be read.
    if (!systemNotice || systemNotice.tone !== "info") return;
    // One you can act on stays long enough to reach for its button.
    const timer = window.setTimeout(() => setSystemNoticeNow(null), systemNotice.target ? 12000 : 7000);
    return () => window.clearTimeout(timer);
  }, [systemNotice]);


  const providerOptions = useMemo<AgentOption[]>(() => {
    const runtimeById = new Map(runtimeProviderProfiles.map((profile) => [profile.id, profile]));
    return fallbackProviderOptions.map((option) => {
      const definition = providerRegistry.find((provider) => provider.agent === option.agent);
      const runtime = definition ? runtimeById.get(definition.id) : undefined;
      return {
        ...option,
        models: runtime?.supportedModels.length ? runtime.supportedModels : option.models,
        modelSource: runtime?.modelSource,
        modelError: runtime?.modelError ?? undefined,
        modelsDiscoveredAt: runtime?.modelsDiscoveredAt ?? undefined,
      };
    });
  }, [runtimeProviderProfiles]);

  const refreshProviderModels = useCallback(async (refresh = true) => {
    if (!window.pitwall?.listProviders) return;
    setRefreshingProviderModels(true);
    try {
      const result = await window.pitwall.listProviders({ refresh });
      if (result.ok) setRuntimeProviderProfiles(result.providers);
    } finally {
      setRefreshingProviderModels(false);
    }
  }, []);

  const refreshAgentChecks = useCallback(async () => {
    if (!window.pitwall?.checkAgent) return;
    setCheckingAgents(true);
    try {
      const entries = await Promise.all(
        providerRegistry.map(async (provider) => [provider.agent, await window.pitwall?.checkAgent(provider.agent)] as const),
      );
      setAgentChecks(
        Object.fromEntries(entries.filter((entry): entry is [CreatableAgentProvider, AgentCheck] => Boolean(entry[1]))),
      );
    } finally {
      setCheckingAgents(false);
    }
  }, []);

  const refreshCustomAgentModels = useCallback(async () => {
    const discoverModels = window.pitwall?.discoverCustomAgentModels;
    if (!discoverModels || !customAgents.length) return;
    const entries = await Promise.all(
      customAgents.map(async (agent) => {
        const result = await discoverModels({
          command: agent.command,
          discoveryArgs: agent.modelDiscoveryCommand ? splitArgs(agent.modelDiscoveryCommand) : undefined,
        });
        return [agent.id, result] as const;
      }),
    );
    setRuntimeCustomModels(Object.fromEntries(entries));
  }, [customAgents]);

  useEffect(() => {
    taskRunsRef.current = taskRuns;
  }, [taskRuns]);



  /**
   * Discovery is asked again whenever the answer could have changed.
   *
   * It used to run once at mount and then only if `catalogueInstalled`
   * changed, which happens only on the Connections screen. That made a cold
   * start authoritative: if the first attempt came back empty — the app still
   * waking up, a login shell still warming, Ollama not yet answering inside
   * the timeout — the model stayed missing for the life of the window, and
   * nothing the user did in the session dialog would ask again.
   */
  useEffect(() => {
    let cancelled = false;
    const ask = async () => {
      const result = await window.pitwall?.ollamaLocalAgent?.();
      if (cancelled) return;
      // The same answer as last time is not a reason to render the app.
      const next = result?.option ?? null;
      setLocalAgent((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setLocalModelCount(result?.pulled ?? 0);
    };
    void ask();

    // Naming the surfaces that should re-ask was the wrong shape: it was
    // right for the session picker and wrong for the council, which listed
    // no local model because nothing had asked since the window opened.
    // Anything that changes the answer happens outside this window — a model
    // pulled, a CLI installed, `ollama serve` started in a terminal — and all
    // of them end with the user coming back to Pitwall.
    const onFocus = () => void ask();
    window.addEventListener("focus", onFocus);
    // A slow poll as well, for the case where the window never lost focus:
    // pulling a model from inside Pitwall does not change which window is
    // frontmost. Cheap enough at this interval to be invisible.
    const timer = window.setInterval(() => {
      if (!document.hidden) void ask();
    }, 45_000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
    // Installing a CLI is the one in-window event that certainly changes it.
  }, [catalogueInstalled]);

  const refreshAllModels = useCallback(async () => {
    setRefreshingProviderModels(true);
    try {
      await Promise.all([refreshProviderModels(true), refreshCustomAgentModels()]);
    } finally {
      setRefreshingProviderModels(false);
    }
  }, [refreshCustomAgentModels, refreshProviderModels]);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? emptyProject;
  const sidebarGroups = useMemo(
    () => buildSidebarGroups({ tasks: pitwall.tasks, projects, projectFilter: sidebarProjectFilter, now: activityNow, links: pitwall.sessions, councilRuns: pitwall.councilRuns, sessionOrder: sessionOrderByProject, starting: startingSessions }),
    [pitwall.tasks, pitwall.sessions, pitwall.councilRuns, projects, sidebarProjectFilter, activityNow, sessionOrderByProject, startingSessions],
  );
  useEffect(() => {
    try { localStorage.setItem("pitwall-sidebar-project", sidebarProjectFilter); } catch { /* A preference, not state. */ }
  }, [sidebarProjectFilter]);
  // A filter on a project that was removed would hide every row behind a blank menu.
  useEffect(() => {
    if (sidebarProjectFilter && !projects.some((project) => project.id === sidebarProjectFilter)) setSidebarProjectFilter("");
  }, [projects, sidebarProjectFilter]);
  useEffect(() => {
    const row = pendingSidebarRowRef.current;
    if (!row || row.projectId !== activeProject.id) return;
    pendingSidebarRowRef.current = null;
    openSidebarRowInProject(row);
    // Runs on the project switch the row asked for, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject.id]);
  activeProjectIdRef.current = activeProject.id;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const jumpToRef = useRef(jumpTo);
  jumpToRef.current = jumpTo;
  notificationSoundEnabledRef.current = notificationSoundEnabled;
  const projectIdentity = { projectId: activeProject.id, projectPath: activeProject.path };

  // Only while the board is on screen: a countdown nobody is looking at is a
  // render a minute for nothing.
  useEffect(() => {
    if (workspaceSection !== "tasks") return;
    setTrackerNow(Date.now());
    const tick = window.setInterval(() => setTrackerNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, [workspaceSection]);

  const refreshSchedule = useCallback(async () => {
    const result = await window.pitwall?.listSchedule?.();
    if (result?.ok) setScheduleJobs(result.jobs);
  }, []);

  useEffect(() => { void refreshSchedule(); }, [refreshSchedule]);

  /**
   * Through a ref, because the listener is registered once and `runScheduledJob`
   * reads live state.
   *
   * Registered with the closure itself, every fire for the rest of the run used
   * the function built on the first render — where `pitwall.sessions` is
   * whatever was restored at startup and nothing created since exists. The
   * lookup that finds the last run's session to carry on in therefore never
   * matched, and an hourly booking made a new session, branch and worktree
   * every hour no matter what it had left behind.
   */
  const runScheduledJobRef = useRef(runScheduledJob);
  runScheduledJobRef.current = runScheduledJob;

  // A fire that arrives before this runs is held by the main process, not
  // dropped — a cold start from launchd races its own window otherwise.
  useEffect(() => {
    const stop = window.pitwall?.onScheduleFire?.(({ job }) => { void runScheduledJobRef.current(job); });
    void window.pitwall?.scheduleReady?.();
    return () => stop?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshReviewState = useCallback(async (force = false) => {
    if (!activeProject.path) return;
    // Focus fires on every window activation; a GitHub read per alt-tab is a
    // cost with no new information behind it.
    if (!force && Date.now() - lastReviewRefresh.current < 60_000) return;
    lastReviewRefresh.current = Date.now();
    setReviewRefreshing(true);
    try {
      const projectTasks = pitwallRef.current.tasks.filter((task) => task.projectId === activeProject.id && task.worktree);
      const repairing = readStoredValue(`${REVIEW_REPAIR_STORAGE_KEY}:${activeProject.id}`, "") !== "done";
      const branches = projectTasks
        .filter((task) => task.status === "review" || (repairing && task.status === "completed"))
        .map((task) => task.worktree as string);
      const result = await window.pitwall?.reviewState?.({
        projectId: activeProject.id,
        projectPath: activeProject.path,
        baseBranch: activeProject.branch,
        branches,
        // An agent's own branch and request still belong to the task.
        tickets: Object.fromEntries(projectTasks.filter((task) => task.identifier && branches.includes(task.worktree as string)).map((task) => [task.worktree as string, task.identifier as string])),
      });
      if (!result?.ok) {
        setReviewError(result?.error || "The repository could not be read");
        return;
      }
      setReviewError("");
      if (repairing) {
        repairWronglySettledReviews(activeProject.id, result.facts);
        writeStored(`${REVIEW_REPAIR_STORAGE_KEY}:${activeProject.id}`, "done");
      }
      setReviewFacts(result.facts);
      setPullRequestsAvailable(result.pullRequestsAvailable);
      setPullRequestError(result.pullRequestError || "");
    } finally {
      setReviewRefreshing(false);
    }
  }, [activeProject.path, activeProject.branch]);

  useEffect(() => {
    if (workspaceSection !== "review") return;
    void refreshReviewState(true);
    const onFocus = () => void refreshReviewState();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [workspaceSection, refreshReviewState]);

  // Bookkeeping, not the source. The list already renders from the derived
  // value; this keeps the task board and history agreeing with it. It only
  // writes tasks that are not already settled, so running it twice over the
  // same facts writes nothing.
  useEffect(() => {
    if (!reviewFacts) return;
    settleReviewedTasks(activeProject.id, reviewFacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewFacts]);

  /**
   * Tasks in review whose work has landed: the request merged, or the branch
   * merged or was deleted. They become done, with a line in Activity saying
   * which, and their checkouts are retired if nothing in them is unpushed.
   *
   * Scoped to one project. Facts are keyed by branch name, and two projects
   * can both have a `shop-1936`; settling by name alone once closed tasks in a
   * project nobody had looked at.
   */
  function settleReviewedTasks(projectId: string, facts: Record<string, ReviewBranchFacts>) {
    const settled = pitwallRef.current.tasks.filter((task) =>
      task.projectId === projectId && task.status === "review" && reviewStateFor(task.worktree, facts) === "done");
    if (!settled.length) return;
    for (const task of settled) learnWithHermes(task, { kind: "decision", decision: { action: "merged" } });
    const ids = new Set(settled.map((task) => task.id));
    const timestamp = nowIso();
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        ids.has(task.id) && task.status === "review" ? { ...task, status: "completed" as const, updatedAt: timestamp } : task),
      activity: [
        ...settled.map((task) => {
          const fact = facts[task.worktree || ""];
          const request = fact?.pullRequest;
          const mergeRequest = /merge_requests/.test(request?.url || "");
          const how = request?.state === "merged"
            ? `${mergeRequest ? "merge request" : "pull request"} ${request.number ? `${mergeRequest ? "!" : "#"}${request.number} ` : ""}merged`
            : fact && !fact.exists ? "its branch was deleted" : "its branch merged";
          return {
            id: makeId("activity"),
            projectId,
            taskId: task.id,
            type: "system" as const,
            message: `Done: ${task.identifier ? `${task.identifier.toUpperCase()} ` : ""}${task.title} — ${how}`,
            createdAt: timestamp,
          };
        }),
        ...current.activity,
      ],
    }));
    for (const task of settled) void retireTaskWorktrees(projectId, task.id);
  }

  /**
   * Every project's review queue, checked in the background.
   *
   * Review used to be read only while it was on screen, for the open project,
   * so a request merged on the host left its task "in review" — on the board,
   * on Home and in every count — until someone happened to open that project's
   * Review tab. One project at a time, and never two sweeps at once.
   */
  const reviewSweepRunning = useRef(false);
  const lastReviewSweep = useRef(0);
  const sweepReviewQueues = useCallback(async (force = false) => {
    if (reviewSweepRunning.current || !window.pitwall?.reviewState) return;
    if (!force && Date.now() - lastReviewSweep.current < 120_000) return;
    reviewSweepRunning.current = true;
    lastReviewSweep.current = Date.now();
    try {
      for (const project of projectsRef.current) {
        const branches = pitwallRef.current.tasks
          .filter((task) => task.projectId === project.id && task.status === "review" && task.worktree)
          .map((task) => task.worktree as string);
        if (!branches.length || !project.path) continue;
        const result = await window.pitwall.reviewState({
          projectId: project.id,
          projectPath: project.path,
          baseBranch: project.branch,
          branches,
        }).catch(() => null);
        if (result?.ok) settleReviewedTasks(project.id, result.facts);
      }
    } finally {
      reviewSweepRunning.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void sweepReviewQueues(true), 15_000);
    // A hidden window skips the sweep; focusing it again catches up.
    const every = window.setInterval(() => {
      if (!document.hidden) void sweepReviewQueues(true);
    }, 5 * 60_000);
    const onFocus = () => void sweepReviewQueues();
    // Asked for by name, so a test (or anything that has just changed a host's
    // state) need not wait five minutes for the next look.
    const onAsked = () => void sweepReviewQueues(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pitwall:check-reviews", onAsked);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pitwall:check-reviews", onAsked);
    };
  }, [sweepReviewQueues]);

  /**
   * Once per project: tasks the old rule settled while their work was still
   * on disk. It counted a branch nobody had committed to as merged, and any
   * branch past the fortieth as deleted, so finished-but-unreviewed work was
   * marked complete within minutes. Only work with evidence goes back —
   * uncommitted files, or commits of its own not in the trunk. A scheduled
   * run that changed nothing was rightly done and stays so.
   */
  function repairWronglySettledReviews(projectId: string, facts: Record<string, ReviewBranchFacts>) {
    setPitwall((current) => {
      const reopened = current.tasks.filter((task) => {
        if (task.projectId !== projectId || task.status !== "completed" || !task.worktree) return false;
        if (task.worktree.startsWith("sched-")) return false;
        const fact = facts[task.worktree];
        return Boolean(fact?.exists) && (fact.dirty > 0 || (fact.hasOwnCommits && !fact.merged));
      });
      if (!reopened.length) return current;
      const ids = new Set(reopened.map((task) => task.id));
      const timestamp = nowIso();
      return {
        ...current,
        tasks: current.tasks.map((task) => ids.has(task.id) ? { ...task, status: "review" as const, updatedAt: timestamp } : task),
        activity: [
          ...reopened.map((task) => ({
            id: makeId("activity"),
            projectId,
            taskId: task.id,
            type: "system" as const,
            message: `Back in review: ${task.title} — its work was still on its branch`,
            createdAt: timestamp,
          })),
          ...current.activity,
        ],
      };
    });
  }

  function getCompletionAudioContext() {
    if (!completionAudioContextRef.current) {
      completionAudioContextRef.current = new AudioContext();
    }
    return completionAudioContextRef.current;
  }

  function playCompletionSound() {
    if (!notificationSoundEnabledRef.current) return;
    const context = getCompletionAudioContext();
    const schedule = () => {
      const startedAt = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(0.035, startedAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.34);
      gain.connect(context.destination);

      const first = context.createOscillator();
      first.type = "sine";
      first.frequency.setValueAtTime(659.25, startedAt);
      first.connect(gain);
      first.start(startedAt);
      first.stop(startedAt + 0.16);

      const second = context.createOscillator();
      second.type = "sine";
      second.frequency.setValueAtTime(880, startedAt + 0.12);
      second.connect(gain);
      second.start(startedAt + 0.12);
      second.stop(startedAt + 0.34);
    };

    if (context.state === "suspended") {
      void context.resume().then(schedule).catch(() => undefined);
    } else {
      schedule();
    }
  }

  useEffect(() => {
    let active = true;
    if (!activeProject.id || !window.pitwall?.getGitHubAuth) {
      setGitHubAuthStatus(null);
      return;
    }
    void window.pitwall.getGitHubAuth(projectIdentity).then((status) => {
      if (active) setGitHubAuthStatus(status);
    });
    return () => {
      active = false;
    };
  }, [activeProject.id, activeProject.path]);

  /**
   * Re-read the project's trackers on a timer, and when it is opened.
   *
   * A board moves while you are working: someone files a ticket, someone
   * renames one. Importing was a manual trip through a modal, so the board and
   * Pitwall drifted apart until you went and looked. The interval is deliberately
   * unhurried — this is about not going stale, not about being live.
   */
  useEffect(() => {
    let live = true;
    // Due-time per project rather than a timer per project. The first version
    // rebuilt its interval every time the active project changed, so switching
    // projects more often than the interval meant the periodic run never fired
    // at all and the only sync that ever happened was the one on open.
    const tick = () => {
      if (!live || document.hidden) return;
      const projectId = activeProjectIdRef.current;
      if (!projectId) return;
      const last = lastTrackerSyncRef.current[projectId] ?? 0;
      // Zero is "only when I ask"; the sync on opening a project still runs.
      if (!boardSyncMsRef.current && last) return;
      if (Date.now() - last < (boardSyncMsRef.current || Infinity)) return;
      void syncTrackerSources(projectId);
    };
    // A moment after mounting, so it does not compete with the project loading.
    const first = window.setTimeout(tick, 4000);
    const timer = window.setInterval(tick, 60_000);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  // Unknown until asked, and GitHub's words until then: most projects are there.
  const repositoryHost: RepositoryHostWords | null =
    !codeHost || codeHost.kind === "github"
      ? GITHUB_WORDS
      : codeHost.kind === "gitlab"
        ? { kind: "gitlab", label: "GitLab", requestNoun: "merge request" }
        : null;
  const requestNoun = codeHost?.requestNoun || "pull request";

  useEffect(() => {
    let live = true;
    setCodeHost(null);
    if (!activeProject.path || !window.pitwall?.getCodeHost) return;
    void window.pitwall.getCodeHost({ projectPath: activeProject.path }).then((result) => {
      if (live && result?.ok) setCodeHost(result);
    }).catch(() => { /* The words fall back to GitHub's; nothing breaks. */ });
    return () => { live = false; };
  }, [activeProject.path]);

  /**
   * Point `gh` at the account this project belongs to when it is opened.
   *
   * Agents Pitwall launches already carry their project's token, so this is not
   * what makes them work. It is for the user's own terminal and for any project
   * with no credential, which otherwise inherit whichever account the last
   * project left active. Opening a project is not allowed to fail on this, so
   * every outcome except an unconfigured project is silent.
   */
  useEffect(() => {
    let live = true;
    if (!activeProject.id || !window.pitwall?.activateGitHubAccount) return;
    void window.pitwall
      .activateGitHubAccount(projectIdentity)
      .then((result) => {
        if (!live || !result) return;
        if (result.action === "prompt") {
          setGitHubActivationPrompt(activeProject.id);
          return;
        }
        setGitHubActivationPrompt("");
        if (result.ok && (result.action === "scoped" || result.action === "logged-in") && result.login) {
          appendActivity({
            projectId: activeProject.id,
            type: "system",
            // "for this project" is now literally true: the account is supplied
            // per command, so opening this project changes nothing for any
            // other project, or for any terminal outside Pitwall.
            message: `${result.kind === "gitlab" ? "GitLab" : "GitHub"} account for this project is ${result.login}.`,
          });
        }
      })
      .catch(() => {
        // A machine without gh, or a gh that refused. The project still opens.
      });
    return () => {
      live = false;
    };
  }, [activeProject.id, activeProject.path]);

  useEffect(() => {
    let active = true;
    if (!githubAuthOpen || !activeProject.id || !window.pitwall?.listGitHubAccounts) return;
    setGitHubAccounts(null);
    setGitHubAccountsLoading(true);
    void window.pitwall.listGitHubAccounts(projectIdentity)
      .then((result) => {
        if (active) setGitHubAccounts(result);
      })
      .catch((error) => {
        if (active) setGitHubAccounts({ ok: false, accounts: [], error: actionableError(error, "oauth") });
      })
      .finally(() => {
        if (active) setGitHubAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [githubAuthOpen, activeProject.id, activeProject.path]);

  async function rememberGitHubAuth(
    input: { login?: string; token?: string; source?: "gh" | "remote" } = {},
  ) {
    if (!activeProject.id) return;
    setGitHubAuthBusy(true);
    setGitHubAuthNotice("");
    try {
      const result = await window.pitwall?.rememberGitHubAuth?.({ ...projectIdentity, ...input });
      if (result?.ok) {
        setGitHubAuthStatus(result);
        setGitHubAuthNotice(
          `@${result.login} is now selected for ${activeProject.name}${result.repositoryAccess ? " and can access its origin repository" : ""}.`,
        );
      } else {
        setGitHubAuthNotice(actionableError(result?.error ?? "Unable to save this GitHub account.", "oauth"));
      }
    } catch (error) {
      setGitHubAuthNotice(actionableError(error, "oauth"));
    } finally {
      setGitHubAuthBusy(false);
    }
  }

  async function forgetGitHubAuth() {
    if (!activeProject.id) return;
    setGitHubAuthBusy(true);
    setGitHubAuthNotice("");
    try {
      const result = await window.pitwall?.forgetGitHubAuth?.(projectIdentity);
      if (result?.ok) {
        setGitHubAuthStatus(result);
        setGitHubAuthNotice("Project GitHub account removed.");
      } else {
        setGitHubAuthNotice(actionableError(result?.error ?? "Unable to remove the project GitHub account.", "oauth"));
      }
    } catch (error) {
      setGitHubAuthNotice(actionableError(error, "oauth"));
    } finally {
      setGitHubAuthBusy(false);
    }
  }
  const {
    mcpProvider,
    setMcpProvider,
    mcpByProvider,
    mcpLoading,
    mcpBusy,
    mcpAuthBusy,
    mcpNotice,
    mcpNoticeTone,
    clearMcpNotice,
    refreshMcp,
    addMcp,
    removeMcp,
    connectMcpAuth,
    cancelMcpAuth,
    mcpAuthUrl,
    forgetMcpAuth,
  } = useMcp({
    projectPath: activeProject.path,
    projectId: activeProject.id,
    onActivity: (message) => appendActivity({ projectId: activeProject.id, type: "system", message }),
  });

  /**
   * One line standing in for the whole MCP panel. It answers the only question
   * worth permanent rail space — is anything asking for my attention? — and
   * says nothing when the answer is no.
   */
  const mcpAttention = useMemo(
    () =>
      Object.values(mcpByProvider)
        .flatMap((entry) => entry?.servers ?? [])
        .filter((server) => server.status === "needs-auth" || server.status === "failed").length,
    [mcpByProvider],
  );

  const mcpSummary = useMemo(() => {
    const servers = Object.values(mcpByProvider).flatMap((entry) => entry?.servers ?? []);
    if (!servers.length) return "None configured";
    const attention = servers.filter(
      (server) => server.status === "needs-auth" || server.status === "failed",
    ).length;
    const plural = servers.length === 1 ? "server" : "servers";
    return attention ? `${servers.length} ${plural} · ${attention} need attention` : `${servers.length} ${plural}`;
  }, [mcpByProvider]);
  const selectedSession =
    activeProject.sessions.find((session) => session.id === selectedSessionId) ??
    activeProject.sessions.find((session) => session.id === lastSessionByProject[activeProject.id]) ??
    activeProject.sessions[0] ??
    emptySession;
  const hasSelectedSession = Boolean(selectedSession.id);
  viewRef.current = { projectId: activeProject.id, section: workspaceSection, sessionId: selectedSession.id };
  const editorWorkspacePath = selectedSession.worktreePath || activeProject.path;
  const liveChanges = useLiveChanges(hasSelectedSession ? selectedSession.id : undefined, hasSelectedSession ? editorWorkspacePath : undefined);
  const liveChangeCount = liveChanges?.ok ? liveChanges.files.length : 0;
  const [liveChangesFocus, setLiveChangesFocus] = useState<string | undefined>();
  // The editor actually used when Open is pressed: what was chosen, as long as
  // it is still installed, and otherwise the best one found. A preference for an
  // editor that has since been uninstalled must not leave the button dead.
  const preferredEditor =
    editorChoice === REVEAL_IN_FINDER
      ? null
      : installedEditors.find((editor) => editor.id === editorChoice) ?? installedEditors[0] ?? null;
  const activePitwallProject = pitwall.projects.find((project) => project.id === activeProject.id);
  const projectTasks = useMemo(
    () => pitwall.tasks.filter((task) => task.projectId === activeProject.id),
    [activeProject.id, pitwall.tasks],
  );
  // Work that was filed: what the board, its count and the task pickers show.
  const boardTasks = useMemo(() => projectTasks.filter((task) => !isScheduledRunTask(task)), [projectTasks]);
  const mcpTaskSources = useMemo(
    () => flattenMcpTaskSources(mcpByProvider),
    [mcpByProvider],
  );
  const importedTaskIdentities = useMemo(
    () => new Set(projectTasks.map(importedTaskIdentity).filter(Boolean)),
    [projectTasks],
  );
  const selectedPitwallSession = pitwall.sessions.find((session) => session.id === selectedSession.id);
  const selectedSessionTask = selectedPitwallSession
    ? projectTasks.find((task) => task.id === selectedPitwallSession.taskId)
    : undefined;
  // A paired task's reviewer has a tab of its own beside its implementer's.
  const selectedPair = hasSelectedSession && selectedSessionTask?.pair ? selectedSessionTask.pair : null;
  const [pairView, setPairView] = useState<"implementer" | "reviewer" | "split">("implementer");
  // A different session starts on its own terminal, unless both are wanted side by side.
  useEffect(() => setPairView((view) => (view === "split" ? view : "implementer")), [selectedSession.id]);
  const activeTask =
    (workspaceSection === "work" ? selectedSessionTask : undefined) ??
    projectTasks.find((task) => task.id === draftTaskId) ??
    projectTasks.find((task) => task.status !== "completed" && task.status !== "cancelled") ??
    projectTasks[0];
  /**
   * The task the Work view is about: the selected session's own, or none.
   *
   * `activeTask` falls back to the last task picked anywhere and then to the
   * first open one, which is right for "what would you start" and wrong for
   * "what is this session": an untasked session was headed with whichever
   * ticket happened to be selected last, as though it were working on it.
   */
  const workTask = baseSection === "work" && hasSelectedSession ? selectedSessionTask : activeTask;
  const reviewQueueCount = projectTasks.filter((task) => task.status === "review").length;
  // One state for Hermes, most pressing first: what it cannot do, then what it is doing.
  const hermesReviewing = pitwall.tasks.filter((task) => task.pair?.reviewer === "hermes" && task.pair.state === "reviewing");
  const activeOverseer = pitwall.projects.find((item) => item.id === activeProject.id)?.overseer ?? DEFAULT_OVERSEER;
  const hermesState: HermesState = agentChecks.Hermes && agentChecks.Hermes.status !== "ready"
    ? { kind: "not-set-up", installed: Boolean(agentChecks.Hermes.installed) }
    : hermesSignedOut ? { kind: "signed-out" }
      : hermesReviewing.length ? { kind: "reviewing", tasks: hermesReviewing }
        : hermesLearning.length ? { kind: "learning", keys: hermesLearning.map((item) => item.key) }
          : !activeOverseer.enabled ? { kind: "off" }
            : { kind: "ready" };
  const readyWatchFindings = watchState.findings.filter((finding) => finding.projectId === activeProject.id && finding.state === "ready").length;
  const SECTION_TITLES: Partial<Record<WorkspaceSection, string>> = {
    overview: activeProject.name,
    tasks: "Board",
    review: "Review queue",
    schedule: "Automations",
    watch: "Automations",
    context: "Memory",
    activity: "Activity",
    connections: "Settings",
    extensions: "Extensions",
    hermes: "Hermes",
  };
  const headerTitle = baseSection === "work"
    ? workTask?.title ?? (hasSelectedSession ? selectedSession.name : activeProject.name)
    : SECTION_TITLES[baseSection] ?? activeProject.name;
  const headerSubtitle = baseSection === "connections" || baseSection === "extensions"
    ? undefined
    : baseSection === "work" && workTask
      ? [workTask.identifier?.toUpperCase() || "Local task", activeProject.name, workTask.worktree || activeProject.branch].filter(Boolean).join(" · ")
      : baseSection === "work" && hasSelectedSession
        ? ["No task", selectedSession.agent, selectedSession.branch || activeProject.branch].filter(Boolean).join(" · ")
        : baseSection === "overview"
          ? activeProject.branch
          : [activeProject.name, activeProject.branch].filter(Boolean).join(" · ");
  const inspectedTask = taskDetail
    ? projectTasks.find((task) => task.id === taskDetail.id) ?? taskDetail
    : null;
  const projectContextEntries = useMemo(
    () => pitwall.contextEntries.filter((entry) => entry.projectId === activeProject.id),
    [activeProject.id, pitwall.contextEntries],
  );
  const selectedContextEntries = useMemo(() => {
    const selected = projectContextEntries.filter((entry) => selectedContextIds.includes(entry.id));
    return contextForAgent(selected, activeProject.id, providerIdFromAgent(draftAgent));
  }, [activeProject.id, draftAgent, projectContextEntries, selectedContextIds]);
  const projectActivity = useMemo(
    () =>
      pitwall.activity
        .filter((event) => event.projectId === activeProject.id)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activeProject.id, pitwall.activity],
  );
  const runCountByTask = useMemo(() => {
    const counts: Record<string, number> = {};
    const groupedSessionIds = new Set(
      [...pitwall.councilRuns, ...pitwall.compareRuns]
        .filter((run) => run.projectId === activeProject.id)
        .flatMap((run) => run.responses.map((response) => response.sessionId)),
    );

    for (const session of pitwall.sessions) {
      if (session.projectId !== activeProject.id || groupedSessionIds.has(session.id)) continue;
      counts[session.taskId] = (counts[session.taskId] ?? 0) + 1;
    }
    for (const run of pitwall.councilRuns) {
      if (run.projectId !== activeProject.id) continue;
      counts[run.taskId] = (counts[run.taskId] ?? 0) + 1;
    }
    for (const run of pitwall.compareRuns) {
      if (run.projectId !== activeProject.id) continue;
      counts[run.taskId] = (counts[run.taskId] ?? 0) + 1;
    }
    return counts;
  }, [activeProject.id, pitwall.compareRuns, pitwall.councilRuns, pitwall.sessions]);
  const activeCouncilRun = useMemo(
    () => pitwall.councilRuns.find((run) => run.id === activeCouncilRunId && run.projectId === activeProject.id),
    [pitwall.councilRuns, activeCouncilRunId, activeProject.id],
  );
  const activeRelay = relayRunRef.current[activeCouncilRunId];
  useEffect(() => {
    if (!activeCouncilRunId || !window.pitwall?.inspectProjectKnowledge) return;
    let active = true;
    void window.pitwall.inspectProjectKnowledge({ projectPath: activeProject.path }).then((result) => {
      if (!active || !result.ok) return;
      setContextReceipts((current) => ({ ...Object.fromEntries(result.receipts.map((receipt) => [receipt.id, receipt])), ...current }));
    }).catch(() => { /* The Context screen exposes storage failures and retry. */ });
    return () => { active = false; };
  }, [activeCouncilRunId, activeProject.path]);
  const councilSessions = useMemo(() => {
    if (!activeCouncilRun) return [];
    // Relabelled the same way the rail relabels them: a member's role is the
    // only thing that tells it apart from the others, and members created
    // before that was true still carry the shared task title.
    const title = pitwall.tasks.find((task) => task.id === activeCouncilRun.taskId)?.title;
    return activeCouncilRun.responses
      .map((response) => activeProject.sessions.find((session) => session.id === response.sessionId))
      .filter((session): session is AgentSession => Boolean(session))
      .map((session) => {
        if (!title) return session;
        const label = councilMemberLabel(session.name, title);
        return label === session.name ? session : { ...session, name: label };
      });
  }, [activeCouncilRun, activeProject.sessions, pitwall.tasks]);
  const councilSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of pitwall.councilRuns) {
      if (run.projectId !== activeProject.id) continue;
      for (const response of run.responses) ids.add(response.sessionId);
    }
    return ids;
  }, [pitwall.councilRuns, activeProject.id]);
  const railOrder = sessionOrderByProject[activeProject.id] ?? EMPTY_ORDER;
  // Memoised because SessionRail is, and the app re-renders on every frame that
  // carries terminal output — a fresh array here would defeat the memo sixty
  // times a second with six sessions running.
  const regularSessions = useMemo(
    () => applySessionOrder(activeProject.sessions.filter((session) => !councilSessionIds.has(session.id)), railOrder),
    [activeProject.sessions, councilSessionIds, railOrder],
  );
  const councilChipSessions = activeProject.sessions.filter((session) => councilSessionIds.has(session.id));
  const taskStartSessions = activeTask
    ? regularSessions.filter((session) => session.branch === taskBranchName(activeTask))
    : [];
  /**
   * The roles working the current task, joined from the two places that know
   * about a run: the Pitwall record carries the role it was started with, the
   * live session carries what it is doing now. Neither store has both.
   */
  const inspectorTaskRuns = useMemo<RoleRun[]>(() => {
    if (!activeTask) return [];
    return pitwall.sessions
      .filter((record) => record.taskId === activeTask.id)
      .map((record) => {
        const live = activeProject.sessions.find((session) => session.id === record.id);
        return {
          role: record.type,
          // A record with no live session is a run that has already finished:
          // the terminal is gone but the work it did is what the row is about.
          status: live?.status ?? "completed",
          progress: live?.progress ?? 0,
          sessionId: record.id,
        };
      });
  }, [activeTask, pitwall.sessions, activeProject.sessions]);

  useEffect(() => {
    if (workspaceSection !== "connections") return;
    let live = true;
    void (async () => {
      const result = await window.pitwall?.whichCommands?.({
        commands: agentCatalogue.map((entry) => entry.command),
      });
      if (live && result?.ok) setCatalogueInstalled(result.found);
    })();
    return () => { live = false; };
  }, [workspaceSection, installEntry, installProviderId]);

  /**
   * What each installed CLI said it can reach, keyed by its binary.
   *
   * `modelSource` is how Pitwall distinguishes a list the CLI produced from
   * the fallback it ships with — only the former is a fact about this
   * machine, and only the former is worth showing as one.
   */
  /** The binaries Pitwall can actually start a session with. */
  const drivableCommands = useMemo(
    () => new Set(providerRegistry.map((definition) => definition.command)),
    [],
  );

  const liveModelsByCommand = useMemo<LiveModels>(() => {
    const byCommand: LiveModels = {};
    for (const definition of providerRegistry) {
      const runtime = runtimeProviderProfiles.find((profile) => profile.id === definition.id);
      if (!runtime?.modelSource || !runtime.supportedModels.length) continue;
      byCommand[definition.command] = runtime.supportedModels.map((model) => model.label);
    }
    return byCommand;
  }, [runtimeProviderProfiles]);

  const selectedCouncilRun = useMemo(
    () =>
      pitwall.councilRuns.find(
        (run) =>
          run.projectId === activeProject.id &&
          run.responses.some((response) => response.sessionId === selectedSessionId),
      ),
    [activeProject.id, pitwall.councilRuns, selectedSessionId],
  );

  useEffect(() => {
    if (activeCouncilRun) return;
    const restoredRun =
      selectedCouncilRun ?? pitwall.councilRuns.find((run) => run.projectId === activeProject.id);
    if (!restoredRun) return;
    setActiveCouncilRunId(restoredRun.id);
    setActiveCouncilMode(
      restoredRun.responses.some((response) => response.sessionId.startsWith("compare-")) ? "compare" : "council",
    );
  }, [activeCouncilRun, activeProject.id, pitwall.councilRuns, selectedCouncilRun]);

  /**
   * Rebuilds councils that were running when the app last closed. The agent
   * processes are gone, so a restored council comes back paused rather than
   * resuming on its own — but the thread, roster and routing history are intact,
   * so the conductor picks up with full context the moment it is handed on.
   */
  useEffect(() => {
    for (const run of pitwall.councilRuns) {
      if (relayRunRef.current[run.id] || !isRestorableRelayState(run.relay)) continue;
      const relay = run.relay;
      const sessions = new Map(activeProject.sessions.map((session) => [session.id, session]));
      // Members whose pane is gone cannot take a turn; below two there is no
      // council left to restore.
      const members = relay.members.filter((member) => sessions.has(member.sessionId));
      if (members.length < 2) continue;
      const currentPanel = restoreCouncilPanel(members, relay.currentMemberId, relay.currentPanelMemberIds);

      relayRunRef.current[run.id] = {
        runId: run.id,
        projectPath: relay.projectPath,
        projectRoot: relay.projectRoot ?? projectsRef.current.find((project) => project.id === run.projectId)?.path,
        taskId: relay.taskId ?? run.taskId,
        currentAssignment: relay.currentAssignment,
        contextEntryIds: relay.contextEntryIds,
        taskPrompt: relay.taskPrompt,
        task: relay.task,
        members,
        turn: relay.turn,
        auto: false,
        stopped: true,
        conductor: relay.conductor,
        directives: relay.directives ?? [],
        maxTurns: relay.maxTurns === undefined ? MAX_RELAY_TURNS : normalizeTurnLimit(relay.maxTurns),
        messages: relay.messages,
        history: relay.history,
        currentMemberId: currentPanel[0]?.memberId,
        routes: relay.routes,
        repoSnapshot: {},
        evidence: relay.evidence ?? null,
        verification: relay.verification,
        treeHistory: [],
        lessons: relay.lessons ?? [],
        workingSet: restoreCouncilWorkingSet(relay.messages, relay.workingSet),
        nudgedTurns: [],
        reroutedTurns: [],
        currentPanel,
        conductorCostUsd: relay.conductorCostUsd ?? 0,
        // Only if it still makes sense: a debate waiting on a member whose pane
        // did not survive the restart can never finish.
        debate: isRestorableDebate(relay.debate, members.map((member) => member.memberId)) ? relay.debate : null,
        openingDirective: typeof relay.openingDirective === "string" ? relay.openingDirective : undefined,
        restored: true,
        startedAt: relay.startedAt ?? run.createdAt,
      };

      for (const member of members) {
        relayRunIdBySessionRef.current[member.sessionId] = run.id;
        const session = sessions.get(member.sessionId);
        if (session) relaySessionRef.current[member.sessionId] = session;
      }

      setRelayBySession((current) => ({
        ...current,
        ...Object.fromEntries(
          members.map((member) => [
            member.sessionId,
            {
              state: "handed" as const,
              turn: member.memberId === currentPanel[0]?.memberId ? relay.turn : 0,
              // Any member can restart a restored council; the one that held the
              // baton is simply the obvious choice.
              canHandoff: member.memberId === currentPanel[0]?.memberId,
            },
          ]),
        ),
      }));
      const restoredLimit = relayRunRef.current[run.id].maxTurns;
      setRelayRunState((current) => ({
        ...current,
        [run.id]: {
          turn: relay.turn,
          auto: false,
          note: relay.running
            ? `Council restored at turn ${relay.turn} — Pitwall restarted under it, so it is picking up where it left off.`
            : `Council restored from turn ${relay.turn}. Its agents were stopped when Pitwall closed — hand off to continue with the full thread.`,
          directives: (relay.directives ?? []).map((directive) => directive.text),
          config: {
            enabled: relay.conductor.enabled,
            model: relay.conductor.model,
            runTests: Boolean(relay.conductor.runTests),
            maxTurns: restoredLimit,
          },
        },
      }));
      if (relay.running) void resumeRestoredRelay(run.id);
    }
  }, [pitwall.councilRuns, activeProject.sessions]);

  // Show fade cues on the chip strip when it overflows, so hidden sessions read
  // as "there's more" rather than silently clipping off-screen.
  const updateChipEdges = useCallback(() => {
    const el = chipStripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setChipEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < maxScroll - 2 });
  }, []);
  useEffect(() => {
    updateChipEdges();
    window.addEventListener("resize", updateChipEdges);
    return () => window.removeEventListener("resize", updateChipEdges);
  }, [updateChipEdges, regularSessions.length, councilChipSessions.length, activeProject.id]);
  // Every session across all projects, so terminals stay mounted (and live) when
  // switching projects instead of being re-created from scratch.
  /**
   * Every session, with a stable identity.
   *
   * `projects.flatMap(...)` built a fresh array on every render, and two
   * effects depend on it — retaining the mirror and pruning mounted panes — so
   * both ran on every render of the largest component in the app, at whatever
   * rate terminal output was arriving. Memoised, they run when the sessions
   * actually change.
   */
  const allSessions = useMemo(() => projects.flatMap((project) => project.sessions), [projects]);

  /**
   * The rail's two composite props, built only when their inputs change.
   *
   * SessionRail is memoised and re-sorts every session it is handed, and the
   * app re-renders on every frame that carries terminal output. Passing a fresh
   * array or object literal here defeated the memo completely: with six busy
   * sessions the whole rail re-sorted about sixty times a second.
   */
  /**
   * Remember where the operator put a session.
   *
   * Stored per project and pruned as it is written, so a project that has
   * churned through hundreds of sessions does not accumulate ranks for all of
   * them — a stale id is not merely wasted space, it silently shifts every row
   * that sorts below it.
   */
  const reorderSessions = useCallback(
    (orderedIds: string[]) => {
      setSessionOrderByProject((current) => {
        const next = { ...current, [activeProject.id]: pruneSessionOrder(orderedIds, activeProject.sessions) };
        writeStoredJson(SESSION_ORDER_STORAGE_KEY, next);
        return next;
      });
    },
    [activeProject.id, activeProject.sessions],
  );

  /**
   * The sessions whose panes stay alive.
   *
   * Mounting every session's terminal is what made ten of them slow; mounting
   * only the selected one made switching *back* expensive, because a pane that
   * unmounts loses its terminal and replays its entire buffer on the way in —
   * the visible symptom being the whole pane repainting on every switch.
   *
   * Keeping the last few is the middle: flipping between the sessions you are
   * actually working in is instant, and the ones you are not stay unmounted.
   */
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>([]);
  const [ptySize, setPtySize] = useState<Record<string, { cols: number; rows: number }>>({});
  useEffect(() => {
    if (!selectedSession.id) return;
    setMountedSessionIds((current) => {
      if (current[0] === selectedSession.id) return current;
      const next = [selectedSession.id, ...current.filter((id) => id !== selectedSession.id)];
      return next.slice(0, MOUNTED_SESSION_LIMIT);
    });
  }, [selectedSession.id]);
  // A deleted session must not keep a screen alive behind it either. The mirror
  // holds one terminal per session and nothing else would ever free them.
  useEffect(() => {
    screenMirrorRef.current.retain(allSessions.map((session) => session.id));
    // Only what is read: the project on screen, plus whichever council is
    // being watched. Parsing every session of every project cost a four-second
    // worst-case project switch and blocked the main thread in 68 ms bursts.
    screenMirrorRef.current.setScope([
      ...activeProject.sessions.map((session) => session.id),
      ...councilSessions.map((session) => session.id),
      ...(selectedSessionId ? [selectedSessionId] : []),
    ]);
  }, [allSessions, activeProject.sessions, councilSessions, selectedSessionId]);
  useEffect(() => {
    const mirror = screenMirrorRef.current;
    return () => mirror.dispose();
  }, []);
  // Sessions that are gone must not keep a pane alive behind them.
  useEffect(() => {
    setMountedSessionIds((current) => {
      const live = current.filter((id) => allSessions.some((session) => session.id === id));
      return live.length === current.length ? current : live;
    });
  }, [allSessions]);

  /**
   * Read once per screen tick, not once per render.
   *
   * Both of these come from reading the live terminal, and both used to be
   * recomputed — and to change identity — on every render of the app, which
   * defeated every memo below them.
   */
  const selectedScreen = useMemo(
    () => ({ menu: pendingMenuFor(selectedSession.id), busy: screenBusyFor(selectedSession.id) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSession.id, screenTick, workbenchTab],
  );

  /**
   * One handler per action, shared by every pane.
   *
   * A pane knows its own session id and hands it back, so these are created
   * once instead of once per pane per render — which is what kept the panes
   * re-rendering no matter how well they were memoised.
   */
  const sessionByIdRef = useRef<Record<string, AgentSession>>({});
  sessionByIdRef.current = Object.fromEntries(allSessions.map((session) => [session.id, session]));
  const answerMenuForSession = useCallback((sessionId: string, menu: TerminalMenu, choice: MenuOption) => {
    const session = sessionByIdRef.current[sessionId];
    if (session) void answerTerminalMenu(session, menu, choice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showTerminalForSession = useCallback((sessionId: string) => {
    const session = sessionByIdRef.current[sessionId];
    if (session) void switchAgentSurface(session, "terminal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * One anonymous count, never content.
   *
   * The main process holds the allowlist and the project key; this is only a
   * way to reach it. Fire-and-forget by design: a dropped event must never be
   * visible in the interface.
   */
  const track = useCallback((event: string, properties?: Record<string, string | number | boolean>) => {
    void window.pitwall?.captureEvent?.(event, properties);
  }, []);


  /**
   * Every session waiting on an answer, not only the one on screen.
   *
   * This read the selected session alone, which made the rail's whole premise
   * unworkable: a row could not tell you it needed you until you clicked it,
   * and by then you were already looking at it. The rail exists to answer
   * "which one needs me?" without visiting each in turn.
   *
   * Bounded by the panes that are mounted, since a menu is read off a rendered
   * screen and an unmounted session has none.
   */
  // Sessions named before names were kept whole have theirs cut short; the
  // task's own title puts it back.
  const sidebarFullNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const session of activeProject.sessions) {
      if (!session.name.includes("…")) continue;
      const taskId = pitwall.sessions.find((record) => record.id === session.id)?.taskId;
      const title = taskId ? pitwall.tasks.find((task) => task.id === taskId)?.title : undefined;
      const full = expandSessionName(session.name, title);
      if (full !== session.name) names[session.id] = full;
    }
    return names;
  }, [activeProject.sessions, pitwall.sessions, pitwall.tasks]);
  const sidebarBusyById = useMemo(
    () => Object.fromEntries(activeProject.sessions.map((session) => [session.id, screenBusyFor(session.id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProject.sessions, screenTick],
  );
  const railWaitingIds = useMemo(
    () => {
      const waiting = activeProject.sessions.filter((session) => pendingMenuFor(session.id)).map((session) => session.id);
      return waiting.length > 0 ? waiting : EMPTY_IDS;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProject.sessions, screenTick],
  );
  // The session on screen is the selected row, however it was opened: from
  // its own row, from a Review row's session button, or from anywhere else.
  const sidebarSessionRowId = useMemo(() => {
    if (workspaceSection !== "work" || !selectedSession.id) return "";
    const row = sidebarGroups.find((group) => group.name === "Working")?.rows.find((item) =>
      item.sessionId === selectedSession.id
      || (item.councilRunId && pitwall.councilRuns.find((run) => run.id === item.councilRunId)?.responses.some((response) => response.sessionId === selectedSession.id)));
    return row?.id ?? "";
  }, [workspaceSection, selectedSession.id, sidebarGroups, pitwall.councilRuns]);
  // An agent that has stopped to ask something, anywhere: the moment it starts
  // waiting is the moment to say so, once.
  const waitingSessionsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const waiting = new Set<string>();
    for (const project of projects) {
      for (const session of project.sessions) {
        if (session.status === "waiting" || pendingMenuFor(session.id)) waiting.add(session.id);
      }
    }
    const before = waitingSessionsRef.current;
    waitingSessionsRef.current = waiting;
    if (!before) return;
    for (const project of projects) {
      for (const session of project.sessions) {
        if (!waiting.has(session.id) || before.has(session.id)) continue;
        notifyRef.current({
          tone: "warn",
          title: `${session.name} needs you`,
          body: `${session.agent} asked you something and is waiting.`,
          target: { section: "work", projectId: project.id, sessionId: session.id },
          banner: true,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, screenTick]);

  // Work that reached Review, by whatever path: a session finishing, a
  // reviewer approving, a tracker sync. Tasks seen for the first time are
  // where they were, not news.
  const reviewWatchRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const before = reviewWatchRef.current;
    reviewWatchRef.current = new Map(pitwall.tasks.map((task) => [task.id, task.status]));
    if (!before) return;
    for (const task of pitwall.tasks) {
      const was = before.get(task.id);
      if (task.status !== "review" || !was || was === "review") continue;
      notifyRef.current({
        title: `Ready for review: ${task.title}`,
        body: task.pair?.state === "approved" ? "The reviewer approved it." : task.pair?.state === "open-points" ? "The reviewer left open points." : "An agent finished it.",
        target: { section: "review", projectId: task.projectId, taskId: task.id },
        banner: true,
      });
    }
  }, [pitwall.tasks]);

  const sidebarAttention = useMemo(
    () => {
      const attention: Record<string, SessionAttention> = {};
      for (const row of sidebarGroups.flatMap((group) => group.rows)) {
        const session = row.session;
        if (!session) continue;
        attention[session.id] = readSessionAttention(session, sessionActivity[session.id], activityNow, {
          // A session can say it is waiting before its menu is on a mounted screen.
          waiting: Boolean(pendingMenuFor(session.id)) || session.status === "waiting",
          attached: terminalAttachedBySession[session.id],
          busy: screenBusyFor(session.id),
        });
      }
      return attention;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sidebarGroups, sessionActivity, activityNow, terminalAttachedBySession, screenTick],
  );

  /**
   * The recent output lines per member, kept across activity ticks.
   *
   * A ref rather than state: it is read on the tick that already re-renders the
   * thread, and making it state would render twice for one piece of news.
   */
  const councilStepTrailRef = useRef<Record<string, string[]>>({});

  /**
   * What the session on screen is doing, for its thread to show while it works.
   *
   * The Council thread has said this since it was built — a member's card with
   * its state, its elapsed time and the last thing it printed — and a solo
   * session had nothing: it sat silent through minutes of work with no way to
   * tell "thinking" from "finished ten minutes ago". Same inputs, same card.
   */
  const sessionWork = useMemo<MemberWork | null>(() => {
    const session = selectedSession;
    if (!session?.id) return null;

    const attention = readSessionAttention(session, sessionActivity[session.id], activityNow, {
      waiting: railWaitingIds.includes(session.id),
      attached: terminalAttachedBySession[session.id],
    });

    /**
     * Working is read off the screen, never off how much the pane is printing.
     *
     * `readSessionAttention` calls a session "working" whenever it is attached
     * and has produced output recently — and a CLI at an idle prompt redraws
     * its own status bar continuously, so by that measure a finished session
     * never goes quiet. The card sat on "Working · 32s" beside a terminal
     * plainly waiting at a prompt.
     *
     * The screen answers it properly: a CLI offers a way to interrupt exactly
     * when there is something to interrupt.
     */
    const busy = screenBusyFor(session.id);
    const state: MemberWork["state"] =
      attention?.level === "needs-you"
        ? "waiting"
        : session.status === "completed"
          ? "done"
          : busy === true
            ? "working"
            : busy === false
              ? "quiet"
              : attention?.level === "working"
                ? "working"
                : attention?.level === "quiet"
                  ? "quiet"
                  : "idle";

    const live = state === "working" || state === "waiting";
    // Only while it is genuinely mid-turn. Read at an idle prompt the "last
    // meaningful line" is the CLI's own status bar, which reported "auto mode
    // on (shift+tab to cycle)" as though it were a step the agent had taken.
    const step = live && busy !== false ? currentStep(screenMirrorRef.current.read(session.id)) : null;
    const trail = live ? pushStep(councilStepTrailRef.current[session.id], step) : [];
    councilStepTrailRef.current[session.id] = trail;

    return {
      memberId: session.id,
      sessionId: session.id,
      roleLabel: session.name,
      agentLabel: session.agent,
      state,
      step,
      steps: trail,
      forMs: attention?.busyFor ?? attention?.quietFor ?? null,
      isCurrent: true,
    };
    // `screenTick` is what makes the busy read current: the screen is polled
    // rather than pushed, so without it the card holds whatever the screen said
    // when the activity clock last moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession, sessionActivity, activityNow, railWaitingIds, terminalAttachedBySession, screenTick]);


  /**
   * What each Council member is doing, for the thread to show while they work.
   *
   * Recomputed on the activity tick rather than on every chunk of output: the
   * agents produce hundreds of lines a second between them, and re-rendering
   * the thread that often would cost more than the information is worth.
   */
  const councilMemberWork = useMemo<MemberWork[]>(() => {
    const members = relayRunRef.current[activeCouncilRunId]?.members ?? [];
    if (members.length === 0) return [];
    const currentMemberId = relayRunRef.current[activeCouncilRunId]?.currentMemberId;

    return members.map((member) => {
      const session = allSessions.find((item) => item.id === member.sessionId);
      const attention = session
        ? readSessionAttention(session, sessionActivity[member.sessionId], activityNow, {
            waiting: railWaitingIds.includes(member.sessionId),
            attached: terminalAttachedBySession[member.sessionId],
          })
        : null;

      // Read off the pane, as for a solo session: an idle CLI redraws its
      // footer, which looks like output, and kept a finished member "working"
      // under the line its turn ended on.
      const busy = screenBusyFor(member.sessionId);
      const state: MemberWork["state"] =
        attention?.level === "needs-you"
          ? "waiting"
          : session?.status === "completed"
            ? "done"
            : busy === true
              ? "working"
              : busy === false
                ? "quiet"
                : attention?.level === "working"
                  ? "working"
                  : attention?.level === "quiet"
                    ? "quiet"
                    : "idle";

      // Only while something is happening. A stale last line under a finished
      // member reads as though it is still going.
      const live = state === "working" || state === "waiting";
      const step = live ? currentStep(screenMirrorRef.current.read(member.sessionId)) : null;

      // Built during render rather than in an effect, so the card and its trail
      // are the same age. `pushStep` ignores a repeat of the step already at the
      // end, which is what makes the second StrictMode pass a no-op. A finished
      // member starts empty, so the next turn does not open with the last one's
      // output.
      const trail = live ? pushStep(councilStepTrailRef.current[member.sessionId], step) : [];
      councilStepTrailRef.current[member.sessionId] = trail;

      return {
        memberId: member.memberId,
        sessionId: member.sessionId,
        roleLabel: member.roleLabel,
        agentLabel: member.agentLabel,
        state,
        step,
        steps: trail,
        forMs: attention?.busyFor ?? attention?.quietFor ?? null,
        isCurrent: member.memberId === currentMemberId,
      };
    });
    // `screenTick` keeps the busy read current, as for `sessionWork`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCouncilRunId,
    allSessions,
    sessionActivity,
    activityNow,
    railWaitingIds,
    terminalAttachedBySession,
    screenTick,
  ]);
  const railCouncil = useMemo(
    () => (councilChipSessions.length > 0
      ? {
          label: selectedCouncilRun?.name
            ?? (selectedCouncilRun
              ? formatCouncilRunName(
                  pitwall.tasks.find((task) => task.id === selectedCouncilRun.taskId)?.title ?? "Untitled task",
                  activeCouncilMode,
                )
              : `Councils · ${pitwall.councilRuns.filter((run) => run.projectId === activeProject.id).length}`),
          runName: selectedCouncilRun?.name ?? null,
          // Relabelled here rather than trusted from the record: members created
          // before members were named by role carry the task title, and every one
          // of them truncates to the same string in a rail this narrow.
          //
          // Resolved per member against its own run. Reading it off the selected
          // run only works when a run is selected, and the rail also shows the
          // group when none is — which is exactly when every row looks alike.
          sessions: councilChipSessions.map((session) => {
            const run = pitwall.councilRuns.find((item) =>
              item.responses.some((response) => response.sessionId === session.id),
            );
            const title = run ? pitwall.tasks.find((task) => task.id === run.taskId)?.title : undefined;
            if (!title) return session;
            const label = councilMemberLabel(session.name, title);
            return label === session.name ? session : { ...session, name: label };
          }),
          onDeleteRun: selectedCouncilRun ? () => setCouncilPendingDelete(selectedCouncilRun) : null,
          onOpenCouncil: () => setWorkbenchTab("council"),
        }
      : null),
    [councilChipSessions, selectedCouncilRun, pitwall.tasks, pitwall.councilRuns, activeProject.id, activeCouncilMode],
  );
  const sessionPreviews = useMemo(() => activeProject.sessions.flatMap((session) => {
    const url = previewUrlBySession[session.id] ?? "";
    if (!url) return [];
    const run = pitwall.sessions.find((item) => item.id === session.id);
    const task = run ? projectTasks.find((item) => item.id === run.taskId) : undefined;
    const identity = task?.identifier || task?.title || session.name;
    return [{
      sessionId: session.id,
      taskId: task?.id || "",
      url,
      label: `${identity} · ${formatServerLabel(url)}`,
    }];
  }), [activeProject.sessions, pitwall.sessions, projectTasks, previewUrlBySession]);
  const previewByTask = useMemo(() => ({
    ...Object.fromEntries(Object.entries(previewUrlsByProject[activeProject.id] ?? {})
      .filter(([taskId]) => taskId !== "project")
      .map(([taskId, preview]) => [taskId, { url: preview.url, label: preview.label }])),
    ...Object.fromEntries(sessionPreviews.filter((preview) => preview.taskId).map((preview) => [preview.taskId, { url: preview.url, label: preview.label }])),
  }), [activeProject.id, previewUrlsByProject, sessionPreviews]);
  const selectedSessionPreview = sessionPreviews.find((preview) => preview.sessionId === selectedSession.id);
  const detectedPreviewUrl = selectedSessionPreview?.url || sessionPreviews.at(-1)?.url || "";
  const previewUrl = (activeTask ? previewUrlsByProject[activeProject.id]?.[activeTask.id]?.url : "")
    || previewUrlsByProject[activeProject.id]?.project?.url
    || "";
  const previewInput = detectedPreviewUrl || previewUrl;
  const activeBroadcastSessions = useMemo(() => broadcastEligibleSessions(regularSessions), [regularSessions]);

  /** Everything the command palette can do — closures over the same handlers the buttons use. */
  type PaletteAction = PaletteItem & { run: () => void };
  const paletteActions = useMemo<PaletteAction[]>(() => {
    const go = (section: WorkspaceSection, title: string, keywords: string): PaletteAction => ({
      id: `go-${section}`, title, group: "Go to", keywords,
      run: () => setWorkspaceSection(section),
    });
    const actions: PaletteAction[] = [
      { id: "new-task", title: "New task", group: "Actions", keywords: "create outcome ticket",
        run: () => setCreateTaskOpen(true) },
      { id: "new-session", title: "New work", group: "Actions", keywords: "create agent start run terminal session",
        run: () => { setDraftInstruction(""); setCreateSessionOpen(true); } },
      { id: "import-mcp", title: "Import tasks from MCP", group: "Actions", keywords: "jira linear tracker sync",
        run: () => { setMcpTaskImportOpen(true); void Promise.all(providerRegistry.map((provider) => refreshMcp(provider.id))); } },
      { id: "schedule-task", title: "Schedule a task", group: "Actions", keywords: "daily recurring every day cron automation",
        run: () => setWorkspaceSection("schedule") },
      { id: "new-context", title: "New shared context", group: "Actions", keywords: "knowledge note",
        run: () => setCreateContextOpen(true) },
      { id: "mcp-servers", title: "Manage MCP servers", group: "Actions", keywords: "connections tools",
        run: () => setMcpManagerOpen(true) },
      { id: "unfinished-worktrees", title: "Unfinished worktrees", group: "Actions",
        keywords: "worktree checkout branch unpushed uncommitted dirty disk clean up remove",
        run: () => void openWorktreeAudit() },
      // The window's own settings live here rather than in the title bar.
      { id: "connections", title: "Connections", group: "App", keywords: "github gitlab mcp cli auth account",
        run: () => { setConnectionsProvider(null); setConnectionsOpen(true); } },
      { id: "guide", title: "Guide", group: "App", keywords: "help onboarding welcome how",
        run: () => setOnboardingOpen(true) },
      { id: "toggle-mode", title: theme === "dark" ? "Switch to light" : "Switch to dark", group: "App",
        keywords: "theme mode appearance light dark",
        run: () => setThemePreference(theme === "dark" ? "light" : "dark") },
      { id: "toggle-inspector", title: missionOpen ? "Hide task details" : "Show task details", group: "App",
        keywords: "inspector mission panel sidebar",
        run: () => setMissionOpen((open) => !open) },
      { id: "terminal-text-larger", title: "Terminal text larger", group: "App",
        keywords: "font size zoom bigger increase terminal", hint: `${terminalFontSize}px`,
        run: () => setTerminalFontSize((size) => normalizeTerminalFontSize(size + 1)) },
      { id: "terminal-text-smaller", title: "Terminal text smaller", group: "App",
        keywords: "font size zoom decrease terminal", hint: `${terminalFontSize}px`,
        run: () => setTerminalFontSize((size) => normalizeTerminalFontSize(size - 1)) },
      { id: "terminal-text-default", title: "Terminal text default size", group: "App",
        keywords: "font size reset zoom terminal", hint: `${DEFAULT_TERMINAL_FONT_SIZE}px`,
        run: () => setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE) },
      go("overview", "Overview", "cockpit home"),
      go("tasks", "Tasks", "board kanban backlog"),
      go("work", "Work", "runs sessions terminal"),
      go("review", "Review", "evidence approve"),
      go("schedule", "Schedule", "daily recurring job cron automation"),
      go("context", "Shared context", "knowledge"),
      go("activity", "Activity", "history log"),
      go("connections", "Agents", "cli install providers models"),
      go("extensions", "Extensions", "capabilities plugins skills mcp"),
      ...FONT_OPTIONS.map((option): PaletteAction => ({
        id: `font-${option.value}`, title: `Font: ${option.label}`, group: "App",
        keywords: "font typeface interface", hint: option.value === appFont ? "current" : undefined,
        run: () => setAppFont(option.value),
      })),
    ];
    if (activeBroadcastSessions.length > 1) {
      actions.splice(2, 0, {
        id: "broadcast", title: "Send to all sessions", group: "Actions",
        keywords: "broadcast message everyone", hint: String(activeBroadcastSessions.length),
        run: () => setBroadcastOpen(true),
      });
    }
    for (const session of activeProject.sessions) {
      actions.push({
        id: `session-${session.id}`, title: session.name, group: "Sessions",
        keywords: `session ${session.agent}`, hint: session.status,
        run: () => void selectSession(session),
      });
    }
    // The open project's tasks, so ⌘K then a ticket key or a few words opens one.
    for (const task of projectTasks) {
      if (task.status === "completed" || task.status === "cancelled") continue;
      actions.push({
        id: `task-${task.id}`, title: task.title, group: "Tasks",
        keywords: `task ${task.identifier ?? ""} ${task.status}`, hint: task.identifier ? task.identifier.toUpperCase() : getTaskStatusLabel(task.status),
        run: () => setTaskDetail(task),
      });
    }
    for (const project of projects) {
      if (project.id === activeProject.id) continue;
      actions.push({
        id: `project-${project.id}`, title: project.name, group: "Projects",
        keywords: "project switch open", hint: project.branch,
        run: () => selectProject(project),
      });
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBroadcastSessions.length, activeProject.id, activeProject.sessions, appFont, missionOpen, projectTasks, projects, terminalFontSize, theme]);


  const runningAgentSummary = useMemo(() => {
    const sessions = pitwall.sessions.filter(
      (session) => session.projectId === activeProject.id && session.status === "running",
    );
    return providerRegistry.map((provider) => {
      const session = sessions.find((item) => item.provider === provider.id);
      const task = session ? pitwall.tasks.find((item) => item.id === session.taskId) : undefined;
      return {
        provider,
        status: session ? "Working" : "Idle",
        task: task?.title ?? "No active task",
      };
    });
  }, [activeProject.id, pitwall.sessions, pitwall.tasks]);
  const providerReadiness = useMemo(() => {
    const connected: AgentOption[] = [];
    let needsSetup = 0;

    for (const provider of providerOptions) {
      const status = agentChecks[provider.agent]?.status ?? "unknown";
      if (status === "missing" || status === "needs-login") {
        needsSetup += 1;
      } else if (status !== "unknown") {
        connected.push(provider);
      }
    }

    return {
      connected,
      needsSetup,
      working: runningAgentSummary.filter((item) => item.status === "Working").length,
    };
  }, [agentChecks, providerOptions, runningAgentSummary]);
  const agentOptions = useMemo<AgentOption[]>(
    () => [
      ...providerOptions,
      // A saved agent that the derived local row now covers is dropped rather
      // than shown twice. Pressing "Use this model" used to be the only way to
      // register a pulled model, so anybody who did that before discovery
      // existed is carrying a saved copy of the row Pitwall now works out on
      // its own — same command, same model, two entries, no way to tell which
      // one to pick. The saved one is left in storage, not deleted: it is the
      // user's, and it becomes visible again if the local model goes away.
      ...customAgents
        .filter((agent) => !(
          localAgent
          && agent.command === localAgent.command
          && agent.models.some((model) => localAgent.models.some((item) => item.label === model.label))
        ))
        .map((agent) => {
        const runtime = runtimeCustomModels[agent.id];
        const discoveredConcreteModels = runtime?.supportedModels.filter((model) => model.value !== "auto") ?? [];
        const models = discoveredConcreteModels.length
          ? runtime?.supportedModels ?? []
          : agent.models.length
            ? [{ label: "Auto", value: "auto" }, ...agent.models]
            : runtime?.supportedModels.length
              ? runtime.supportedModels
              : [{ label: "Auto", value: "auto" }];
        return {
          agent: agent.name,
          command: agent.command,
          loginCommand: agent.loginCommand,
          models,
          modelSource: discoveredConcreteModels.length ? runtime?.modelSource : "Configured fallback",
          modelError: runtime?.modelError ?? undefined,
          custom: true,
          args: agent.args,
          id: agent.id,
        };
      }),
      // Local models last: they are the ones that appear on their own, and
      // pushing them above the agents somebody deliberately signed into would
      // reorder a list for a reason the user never asked for.
      ...(localAgent
        ? [{
            agent: localAgent.name,
            command: localAgent.command,
            loginCommand: "",
            models: localAgent.models,
            modelSource: "Pulled with Ollama, running on this machine",
            custom: true,
            local: true,
            args: localAgent.args,
            id: localAgent.id,
          } satisfies AgentOption]
        : []),
    ],
    [customAgents, localAgent, providerOptions, runtimeCustomModels],
  );

  /**
   * Agents a council seat can be handed to.
   *
   * Filtered the same way the setup modal filters: a local model or an agent
   * you added yourself is only ever offered once Pitwall knows it can run it,
   * so it is never "missing", while a first-class provider has to actually be
   * installed. Offering one that cannot start would trade a working member for
   * a pane that never boots.
   */
  // Who may be chosen to do the work: every agent but the reviewer-only ones.
  const implementerOptions = useMemo(() => agentOptions.filter((option) => canImplement(option.agent)), [agentOptions]);

  // Claude's aliases, then each agent's listed models. Codex's are marked so the
  // main process knows which CLI runs them.
  const automationModelOptions = useMemo(() => {
    const listed = (agent: string) => agentOptions.find((option) => option.agent === agent)?.models ?? [];
    const usable = (value: string) => Boolean(value) && value !== "auto" && value !== "default";
    const claude = [{ value: "haiku", label: "Haiku" }, { value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }, ...listed("Claude")]
      .filter((model) => usable(model.value))
      .map((model) => ({ value: model.value, label: `Claude · ${model.label}` }));
    const codex = listed("Codex")
      .filter((model) => usable(model.value))
      .map((model) => ({ value: `codex:${model.value}`, label: `Codex · ${model.label}` }));
    const seen = new Set<string>();
    return [...claude, ...codex].filter((model) => !seen.has(model.value) && Boolean(seen.add(model.value)));
  }, [agentOptions]);

  // Reviews can also be Hermes's: the project's own Hermes, read-only.
  const reviewModelOptions = useMemo(() => {
    const hermes = (agentOptions.find((option) => option.agent === "Hermes")?.models ?? [])
      .filter((model) => model.value && model.value !== "auto")
      .map((model) => ({ value: `hermes:${model.value}`, label: `Hermes · ${model.label}` }));
    return [...automationModelOptions, { value: "hermes", label: "Hermes · the project's model" }, ...hermes];
  }, [agentOptions, automationModelOptions]);

  const councilSwapOptions = useMemo(
    () =>
      implementerOptions
        .filter((option) => option.local || option.custom || agentChecks[option.agent]?.status !== "missing")
        .map((option) => ({
          agent: option.agent,
          label: option.agent,
          models: option.models.length > 0 ? option.models.map((model) => model.label) : ["Auto"],
        })),
    [implementerOptions, agentChecks],
  );

  // Mirrored for the completion handler, which is registered once and would
  // otherwise read the first render's empty state.
  agentChecksRef.current = agentChecks;
  agentOptionsRef.current = agentOptions;

  const draftProvider = agentOptions.find((option) => option.agent === draftAgent) ?? implementerOptions[0] ?? agentOptions[0];
  const draftCheck = agentChecks[draftAgent];
  const draftLaunch = resolveAgentLaunch(draftProvider, draftModel);
  const draftBootCommand = draftLaunch.command
    ? [draftLaunch.command, ...(draftLaunch.args ?? [])].join(" ")
    : getBootCommand(agentOptions, draftAgent, draftModel);

  const quickOpenFiles = useMemo(() => {
    const ranked = projectFiles
      .filter((path) => isExplorerVisible(path, showToolingFiles))
      .map((path) => ({ path, score: scoreFileMatch(path, paletteQuery) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    return ranked.slice(0, 30).map((entry) => entry.path);
  }, [paletteQuery, projectFiles, showToolingFiles]);
  const projectFilesRef = useRef(projectFiles);

  function rememberPreviewUrl(projectId: string, url: string, taskId?: string) {
    if (!projectId || !url) return;
    setPreviewUrlsByProject((current) => {
      const task = taskId ? pitwallRef.current.tasks.find((item) => item.id === taskId) : undefined;
      const key = taskId || "project";
      const label = task ? `${task.identifier || "Task"} · ${task.title}` : "Project preview";
      const next = {
        ...current,
        [projectId]: {
          ...(current[projectId] ?? {}),
          [key]: { url, label, updatedAt: nowIso() },
        },
      };
      writeStoredJson(PREVIEW_URLS_STORAGE_KEY, next);
      return next;
    });
  }

  /**
   * Opens the project's local server in the user's browser.
   *
   * Pitwall used to render this itself in a native view layered over the app.
   * The URL is still remembered per project and still detected from terminal
   * output — only the window it opens in changed.
   */
  async function openProjectPreview(rawUrl = previewInput, taskId?: string) {
    const typed = rawUrl.trim();
    if (!typed) return;
    // The main process is the one that normalises: it is the boundary that
    // hands the URL to the OS, so "localhost:5173" with no scheme and an
    // ftp:// paste have to be resolved there rather than trusted from here.
    const result = await window.pitwall?.openExternalUrl?.(typed);
    if (!result?.ok) {
      setSystemNotice({
        tone: "error",
        title: "Could not open the local server",
        message: result?.error || `${typed} could not be opened in your browser.`,
      });
      return;
    }
    rememberPreviewUrl(activeProject.id, result.url ?? typed, taskId || activeTask?.id);
  }

  async function resolveTaskWorkspace(task: PitwallTask) {
    const listed = await window.pitwall?.listWorktrees?.(activeProject.path);
    return selectTaskWorkspace({
      task,
      sessions: activeProject.sessions,
      runs: pitwall.sessions.filter((session) => session.projectId === activeProject.id),
      worktrees: listed?.ok ? listed.worktrees : [],
      projectPath: activeProject.path,
    });
  }

  async function openTaskInEditor(task: PitwallTask) {
    const workspace = await resolveTaskWorkspace(task);
    const opened = await openProjectInEditor(workspace.path);
    if (!opened) {
      setSystemNotice({
        tone: "error",
        title: "Could not open the task checkout",
        message: editorStatus || `${workspace.path} could not be opened in the preferred editor. Check the Editor tab's application setting.`,
      });
      return;
    }
    if (workspace.fallback) {
      setSystemNotice({
        tone: "info",
        title: "Opened the project root",
        message: `${task.identifier || task.title} has no available task checkout yet, so Pitwall opened ${activeProject.name}.`,
      });
    }
  }

  /**
   * A written request for a task's branch: its commits, files and checks, laid
   * out by `composeRequest`, or filled into the repository's own template.
   */
  async function draftTaskRequest(task: PitwallTask, projectPath: string, worktreePath: string, baseBranch: string) {
    const context = await window.pitwall?.requestContext?.({ projectPath, worktreePath, baseBranch });
    if (!context?.ok || !context.branch) return { ok: false as const, error: context?.error || "The task's checkout could not be read." };
    return {
      ok: true as const,
      context,
      draft: composeRequest({
        task,
        commits: context.commits ?? [],
        files: context.files ?? [],
        checks: taskValidation(task),
        template: context.template,
      }),
    };
  }

  async function startTaskRequest(task: PitwallTask) {
    const workspace = await resolveTaskWorkspace(task);
    const written = await draftTaskRequest(task, activeProject.path, workspace.path, activeProject.branch);
    const noun = requestNoun;
    if (!written.ok) {
      setSystemNotice({ tone: "error", title: `Could not prepare the ${noun}`, message: written.error });
      return;
    }
    const { context, draft } = written;
    const uncommittedFiles = context.uncommittedFiles ?? [];
    // The draft counts the files about to be committed, so it describes the
    // request as it will be rather than the branch as it is.
    const filesInRequest = [...new Set([...(context.files ?? []), ...uncommittedFiles.map((file) => file.path)])];
    const factual = composeRequest({ task, commits: context.commits ?? [], files: filesInRequest, checks: taskValidation(task), template: context.template });
    const pending = {
      task,
      worktreePath: workspace.path,
      taskTitle: task.title,
      noun: context.requestNoun || noun,
      branch: context.branch!,
      baseBranch: activeProject.branch,
      title: draft.title,
      body: factual.body,
      uncommitted: uncommittedFiles.length,
      uncommittedFiles,
      commitMessage: commitMessage(task),
      manual: context.kind !== "github" && context.kind !== "gitlab",
      usedTemplate: Boolean(context.template?.trim()),
      commits: context.commits ?? [],
      files: filesInRequest,
      template: context.template,
    };
    setRequestError("");
    setRequestWritten(null);
    setRequestDraft(pending);
    void writeTaskRequest(pending);
  }

  /**
   * The description written from the change itself, while the dialog is open.
   * It replaces the factual draft unless the person has started editing; a
   * failure leaves the factual draft, which is complete on its own.
   */
  async function writeTaskRequest(pending: NonNullable<typeof requestDraft>) {
    const token = ++requestWriteToken.current;
    if (!window.pitwall?.writeRequest) return;
    setRequestWriting(true);
    setRequestWriteError("");
    try {
      const result = await window.pitwall.writeRequest({
        projectPath: activeProject.path,
        worktreePath: pending.worktreePath,
        baseBranch: pending.baseBranch,
        requestNoun: pending.noun,
        task: { identifier: pending.task.identifier, title: pending.task.title, description: pending.task.description },
      });
      if (token !== requestWriteToken.current) return;
      if (!result?.ok || !result.summary) {
        setRequestWriteError(result?.error ? `Could not write the description from the changes: ${result.error}` : "");
        return;
      }
      const writtenRequest = {
        summary: result.summary,
        changes: result.changes ?? [],
        testing: result.testing ?? [],
        commitSubject: result.commitSubject,
        commitBody: result.commitBody,
      };
      const { body } = composeRequest({
        task: pending.task,
        commits: pending.commits,
        files: pending.files,
        checks: taskValidation(pending.task),
        template: pending.template,
        written: writtenRequest,
      });
      setRequestWritten({ body, commitMessage: commitMessage(pending.task, writtenRequest) });
    } finally {
      if (token === requestWriteToken.current) setRequestWriting(false);
    }
  }

  async function createTaskRequest(input: { title: string; body: string; baseBranch: string; draft: boolean; commit?: { message: string; paths: string[] } }) {
    const pending = requestDraft;
    if (!pending) return;
    setRequestBusy(true);
    setRequestError("");
    try {
      const result = await window.pitwall?.openPullRequest?.({
        projectPath: activeProject.path,
        worktreePath: pending.worktreePath,
        branch: pending.branch,
        ticket: pending.task.identifier,
        baseBranch: input.baseBranch || undefined,
        title: input.title,
        body: input.body,
        draft: input.draft,
        ...(input.commit ? { commit: input.commit } : {}),
      });
      // The task keeps its worktree's folder name; Review already reads that
      // as whatever branch the folder is on now.
      if (result?.renamedFrom && result.branch) {
        appendActivity({ projectId: activeProject.id, type: "system", message: `Renamed branch ${result.renamedFrom} to ${result.branch}: the repository only accepts names that follow its convention` });
      }
      const elsewhere = Boolean(result?.existed && result.branch && result.branch !== pending.branch && !result.renamedFrom);
      if (result?.ok && result.url) {
        setRequestDraft(null);
        track("pull_request_created");
        appendActivity({ projectId: activeProject.id, type: "system", message: `${sentenceNoun(pending.noun)} ${result.existed ? "already open" : "opened"} for ${pending.task.identifier || pending.task.title}: ${result.url}` });
        setSystemNotice({
          tone: "info",
          title: elsewhere
            ? `${sentenceNoun(pending.noun)}${result.number ? ` #${result.number}` : ""} is already open for ${pending.task.identifier}`
            : result.existed ? `A ${pending.noun} was already open for this branch` : `${sentenceNoun(pending.noun)} created`,
          message: elsewhere
            ? `On ${result.branch}, so Pitwall did not open a second one. ${result.url}`
            : result.renamedFrom
            ? `Pushed as ${result.branch}, because the repository refused ${result.renamedFrom}. ${result.url}`
            : result.url,
        });
        void window.pitwall?.openExternalUrl?.(result.url);
        void refreshReviewState(true);
        return;
      }
      if (result?.pushed && result.url) {
        // No CLI for this host: the branch is up, the description goes on the
        // clipboard, and the host's own page takes it from there.
        try { await navigator.clipboard.writeText(`${input.title}\n\n${input.body}`); } catch { /* The page still opens. */ }
        setRequestDraft(null);
        setSystemNotice({ tone: "info", title: `Pushed ${result.branch || pending.branch}`, message: `The title and description are on the clipboard. Paste them into the ${pending.noun} page that just opened.` });
        void window.pitwall?.openExternalUrl?.(result.url);
        return;
      }
      setRequestError(result?.error || `The ${pending.noun} could not be created.`);
    } finally {
      setRequestBusy(false);
    }
  }

  async function openTaskPullRequest(task: PitwallTask) {
    // Review already found it, possibly on a branch the agent named itself,
    // which asking about the worktree's own branch would miss.
    const known = task.worktree ? reviewFacts?.[task.worktree]?.pullRequest?.url : "";
    if (known && (await window.pitwall?.openExternalUrl?.(known))?.ok) return;
    const workspace = await resolveTaskWorkspace(task);
    const result = await window.pitwall?.getPullRequest?.({ projectPath: workspace.path });
    const noun = result?.requestNoun || requestNoun;
    if (!result?.ok) {
      setSystemNotice({
        tone: "error",
        title: `Could not find the ${noun}`,
        message: result?.error || `Finding a ${noun} is not available in this build.`,
      });
      return;
    }
    if (result.unsupported) {
      // No CLI to ask on this host, so offer the host's own page for a new one.
      if (result.newUrl) {
        const opened = await window.pitwall?.openExternalUrl?.(result.newUrl);
        if (opened?.ok) return;
      }
      setSystemNotice({
        tone: "info",
        title: `Pitwall cannot look up ${noun}s on ${result.host || "this host"}`,
        message: result.newUrl ? `Open one at ${result.newUrl}` : "Open one from the host's website.",
      });
      return;
    }
    if (!result.found || !result.url) {
      setSystemNotice({
        tone: "info",
        title: `No ${noun} for this branch`,
        message: `${task.identifier || task.title} does not have a ${noun} that ${result.kind === "gitlab" ? "GitLab CLI" : "GitHub CLI"} can see yet.`,
      });
      return;
    }
    // Reaching a pull request is the far end of the whole product. Counted
    // here rather than at discovery: found-but-never-opened is not the same
    // outcome, and only this line means somebody actually went and looked.
    track("pull_request_opened");
    const opened = await window.pitwall?.openExternalUrl?.(result.url);
    if (!opened?.ok) {
      setSystemNotice({ tone: "error", title: `Could not open the ${noun}`, message: opened?.error || result.url });
    }
  }

  async function openTaskPreview(task: PitwallTask) {
    const preview = previewByTask[task.id];
    if (!preview) {
      setSystemNotice({ tone: "info", title: "No preview reported", message: "This task has not reported a local development URL yet." });
      return;
    }
    await openProjectPreview(preview.url, task.id);
  }

  function openPalette(mode: PaletteMode) {
    setPaletteMode(mode);
    setPaletteQuery("");
    setPaletteIndex(0);
    setPaletteOpen(true);
  }

  /**
   * Opens one of the project's files in the user's editor.
   *
   * The palette and voice both offer "open <file>", and with no editor of its
   * own Pitwall has nowhere to show one — so the file goes where the user's
   * other files go. Editor launchers take a file path as readily as a folder.
   */
  function openFileInEditor(filePath: string) {
    if (!filePath) return;
    setPaletteOpen(false);
    setWorkspaceSection("work");
    if (hasSelectedSession && filesPanelEnabled) {
      setFilesOpen(true);
      setWorkbenchTab("terminal");
      setFilesRequest({ path: filePath, nonce: Date.now() });
      return;
    }
    setWorkbenchTab("editor");
    void openProjectInEditor(`${activeProject.path.replace(/\/$/, "")}/${filePath}`);
  }


  useEffect(() => {
    writeStoredJson(PROJECTS_STORAGE_KEY, projects);
    window.localStorage.removeItem("agent-studio-projects");
  }, [projects]);

  useEffect(() => {
    writeStoredJson(PROJECT_NOTIFICATIONS_STORAGE_KEY, projectNotifications);
  }, [projectNotifications]);

  useEffect(() => {
    writeStored(NOTIFICATION_SOUND_STORAGE_KEY, String(notificationSoundEnabled));
  }, [notificationSoundEnabled]);

  useEffect(() => {
    const unlockAudio = () => {
      // Starting audio costs ~90ms, which on the first click is the click's
      // own frame. The gesture is remembered, so it can wait for idle time.
      window.requestIdleCallback(() => {
        try {
          const context = getCompletionAudioContext();
          if (context.state === "suspended") void context.resume();
        } catch {
          // Web Audio can be unavailable in a restricted renderer.
        }
      }, { timeout: 2000 });
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    pitwallRef.current = pitwall;
    writePitwallState(pitwall);
  }, [pitwall]);

  // Completed, approved by git, or cancelled: every way a task finishes passes
  // through its status, so its worktree is offered for removal here once.
  const taskStatusRef = useRef<Record<string, PitwallTask["status"]> | null>(null);
  useEffect(() => {
    const previous = taskStatusRef.current;
    taskStatusRef.current = Object.fromEntries(pitwall.tasks.map((task) => [task.id, task.status]));
    if (!previous) return;
    for (const task of pitwall.tasks) {
      const was = previous[task.id];
      if (was && was !== task.status && (task.status === "completed" || task.status === "cancelled")) {
        void retireTaskWorktrees(task.projectId, task.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitwall.tasks]);

  useEffect(() => {
    let active = true;
    void window.pitwall?.getUpdateState?.().then((state) => {
      if (active) setUpdateState(state);
    });
    const unsubscribe = window.pitwall?.onUpdateStatus?.((state) => setUpdateState(state));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void window.pitwall?.getRuntimeRecovery?.().then(async (recovery) => {
      if (!active) return;
      settleOrphanedRecords(recovery?.live ?? []);
      if (!recovery?.restorable && !recovery?.recovered) return;
      const savedIds = new Set(recovery.terminals.map((item) => item.sessionId));
      const recoveredTerminalById = new Map(recovery.terminals.map((item) => [item.sessionId, item]));
      const restoredSessions = projects.flatMap((project) =>
        project.sessions
          .filter((session) => savedIds.has(session.id))
          .map((session) => ({
            ...session,
            nativeSessionId:
              session.nativeSessionId || recoveredTerminalById.get(session.id)?.nativeSessionId || undefined,
          })),
      );

      if (savedIds.size > 0) {
        const interrupted = recovery.interrupted ?? recovery.recovered;
        const transcriptCount = restoredSessions.filter(
          (session) => (restoredTerminalLinesBySession[session.id]?.length ?? 0) > 0,
        ).length;
        const claudeResumeCount = restoredSessions.filter((session) => session.agent === "Claude").length;
        const codexResumeCount = restoredSessions.filter((session) => session.agent === "Codex" && session.nativeSessionId).length;
        const relaunchedCount = restoredSessions.length - claudeResumeCount - codexResumeCount;
        const transcriptMessage = transcriptCount > 0
          ? ` Open Transcript in the terminal header to review output saved before Pitwall closed.`
          : " No earlier terminal output was stored.";
        const recoveryMessage = [
          claudeResumeCount > 0
            ? `${claudeResumeCount} Claude conversation${claudeResumeCount === 1 ? "" : "s"} will resume with native chat history.`
            : "",
          codexResumeCount > 0
            ? `${codexResumeCount} Codex conversation${codexResumeCount === 1 ? "" : "s"} will resume where ${codexResumeCount === 1 ? "it" : "they"} left off.`
            : "",
          relaunchedCount > 0
            ? `${relaunchedCount} other agent CLI${relaunchedCount === 1 ? " was" : "s were"} relaunched.`
            : "",
        ].filter(Boolean).join(" ");
        setSystemNotice({
          // Recovering from an interrupted shutdown is a success: the sessions
          // came back. It is worth a beat more attention than a routine
          // restore, which is what `warn` is for — and unlike `error` it goes
          // away on its own.
          tone: interrupted ? "warn" : "info",
          title: interrupted ? "Saved sessions recovered" : "Saved sessions restored",
          message: `${recoveryMessage}${transcriptMessage}`,
        });
        setProjects((current) => current.map((project) => ({
          ...project,
          sessions: project.sessions.map((session) => savedIds.has(session.id) && interrupted
            ? { ...session, status: "disconnected", logs: ["Recovered after an interrupted Pitwall shutdown", ...session.logs] }
            : session),
        })));
        setPitwall((current) => ({
          ...current,
          sessions: current.sessions.map((session) => savedIds.has(session.id) && interrupted
            ? { ...session, status: "disconnected", updatedAt: nowIso() }
            : session),
          activity: [
            {
              id: makeId("activity"),
              projectId: recovery.terminals[0]?.projectId || current.projects[0]?.id || "",
              type: "system",
              message: `${interrupted ? "Recovered" : "Restored"} ${restoredSessions.length} saved agent session${restoredSessions.length === 1 ? "" : "s"}`,
              createdAt: nowIso(),
            },
            ...current.activity,
          ],
        }));
        setTerminalAttachedBySession((current) => ({
          ...current,
          ...Object.fromEntries([...savedIds].map((id) => [id, false])),
        }));
        updateTerminalLines((current) => ({
          ...current,
          ...Object.fromEntries(restoredSessions.map((session) => [
            session.id,
            appendCapped(current[session.id], [
              session.agent === "Claude" || (session.agent === "Codex" && session.nativeSessionId)
                ? `\r\n\u001b[90m--- Restoring the ${session.agent} conversation and its history ---\u001b[0m\r\n`
                : `\r\n\u001b[90m--- Previous Pitwall transcript ended; starting a new CLI process ---\u001b[0m\r\n`,
            ]),
          ])),
        }));

        await Promise.all(restoredSessions.map((session) => ensureAgentTerminal(session, { resume: true, refreshContext: true })));
      }

    }).catch((error: unknown) => {
      if (active) setSystemNotice({ tone: "error", title: "Session recovery failed", message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
    };
  }, []);

  // Drop a selection whose task has gone, but never pick one on the user's
  // behalf: a session started against a silently pre-filled task is worse than
  // one started against none, and createSession already falls back sensibly
  // when the draft is empty.
  useEffect(() => {
    setDraftTaskId((current) => (current && projectTasks.some((task) => task.id === current) ? current : ""));
  }, [projectTasks]);

  useEffect(() => {
    const scope = `${activeProject.id}:${draftAgent}`;
    if (contextSelectionScopeRef.current === scope) return;
    contextSelectionScopeRef.current = scope;
    setSelectedContextIds(contextForProvider(projectContextEntries, providerIdFromAgent(draftAgent)).map((entry) => entry.id));
  }, [activeProject.id, draftAgent, projectContextEntries]);

  useEffect(() => {
    writeStored(ACTIVE_PROJECT_STORAGE_KEY, activeProject.id);
    window.localStorage.removeItem("agent-studio-active-project");
  }, [activeProject.id]);

  useEffect(() => {
    writeStored(SELECTED_SESSION_STORAGE_KEY, selectedSession.id);
    if (selectedSession.id && activeProject.id && lastSessionByProject[activeProject.id] !== selectedSession.id) {
      setLastSessionByProject((current) => {
        const next = { ...current, [activeProject.id]: selectedSession.id };
        try { localStorage.setItem("pitwall-last-session-by-project", JSON.stringify(next)); } catch { /* a convenience */ }
        return next;
      });
    }
    window.localStorage.removeItem("agent-studio-selected-session");
    // Runs when the session on screen changes; the project is read with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession.id]);

  useEffect(() => {
    writeStored("pitwall-mission-open", String(missionOpen));
  }, [missionOpen]);
  // A review cut off by a restart is started again: the reviewer is not
  // restored with the sessions, and the work would otherwise wait on it forever.
  useEffect(() => {
    // Only reviews already under way at load: one started since is in flight, not cut off.
    const cutOff = new Set(pitwallRef.current.tasks.filter((task) => task.pair?.state === "reviewing").map((task) => task.id));
    const timer = window.setTimeout(() => {
      for (const task of pitwallRef.current.tasks) {
        const pair = task.pair;
        if (!cutOff.has(task.id)) continue;
        if (pair?.state !== "reviewing" || !pair.implementerSessionId || !pair.worktreePath) continue;
        if (terminalAttachedRef.current[pair.reviewerSessionId || ""]) continue;
        const project = projectsRef.current.find((item) => item.id === task.projectId);
        void runPairReview(task.id, pair.implementerSessionId, pair.worktreePath, project, { retry: true });
      }
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A CLI that updated itself has been started once to check it still works;
  // the person hears how that went.
  useEffect(() => window.pitwall?.onCliChecked?.(({ notice }) => setSystemNotice(notice)), []);
  // Shipped work keeps no agent running. Once a task is done, each of its
  // sessions ends as soon as it is quiet; one mid-turn, or asking something,
  // is left until it is.
  const endedForShippedRef = useRef(new Set<string>());
  useEffect(() => {
    const statusById = new Map(projects.flatMap((project) => project.sessions.map((session) => [session.id, session.status] as const)));
    const shipped = new Set(pitwall.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    for (const run of pitwall.sessions) {
      if (!run.taskId || !shipped.has(run.taskId) || endedForShippedRef.current.has(run.id)) continue;
      if (!terminalAttachedRef.current[run.id]) continue;
      const status = statusById.get(run.id);
      if (status === "running" || status === "starting" || status === "waiting") continue;
      endedForShippedRef.current.add(run.id);
      void window.pitwall?.detachTerminal?.(run.id);
    }
  }, [pitwall.tasks, pitwall.sessions, projects]);

  // Automations speak up: a notice in the window with the way to it, and a
  // click on the macOS notification opens the same place.
  // The banner is shown by the main process, which can do it with no window.
  useEffect(() => window.pitwall?.onAutomationNotice?.(({ title, body, target }) => {
    if (!target?.projectId) return;
    // Named, because the notice outlives a switch to another project.
    const project = projectsRef.current.find((item) => item.id === target.projectId);
    notifyRef.current({ title, body: project ? `${project.name} · ${body}` : body, target });
  }), []);
  useEffect(() => window.pitwall?.onNavigate?.(({ section, target }) => {
    if (target?.projectId) jumpToRef.current(target);
    else setWorkspaceSection(section === "schedule" ? "schedule" : "watch");
  }), []);

  // Hermes's sign-in, run from the notice: its progress replaces the notice as it goes.
  useEffect(() => window.pitwall?.onHermesSignInState?.((update) => {
    if (update.state === "approve") {
      setSystemNoticeNow({ tone: "warn", title: "Approve Hermes in your browser", message: `Nous opened in your browser. Confirm the code ${update.code} there, and Pitwall connects as soon as you approve.` });
    } else if (update.state === "done") {
      setHermesSignedOut(false);
      setSystemNoticeNow({ tone: "info", title: "Hermes is signed in", message: "Every project's Hermes is connected again. Start a Hermes session that was waiting, and it picks up from here." });
      void refreshAgentChecks();
    } else {
      setSystemNoticeNow({ tone: "error", title: "Hermes did not sign in", message: update.message, action: "hermes-sign-in" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => window.pitwall?.onAgentNotice?.(({ notice, modelsChanged, retiredModel, replacementModel, replacementLabel }) => {
    if (modelsChanged) void refreshProviderModels(false);
    if (retiredModel && replacementModel) {
      // Every project reviewing with the retired model, or with Hermes's own
      // default (which is what retired), moves to the replacement.
      setPitwall((current) => ({
        ...current,
        projects: current.projects.map((project) => {
          const overseer = project.overseer ?? DEFAULT_OVERSEER;
          if (overseer.model !== "auto" && overseer.model !== retiredModel) return project;
          return { ...project, overseer: { ...overseer, model: replacementModel }, updatedAt: nowIso() };
        }),
      }));
      setSystemNoticeNow({
        tone: "warn",
        title: "Hermes switched models",
        message: `“${retiredModel}” is no longer offered, so Hermes now reviews with ${replacementLabel || replacementModel}. You can pick another in Overview, under Hermes reviewer.`,
      });
      return;
    }
    if (notice?.action === "hermes-sign-in") setHermesSignedOut(true);
    if (notice) setSystemNotice(notice);
  }), [refreshProviderModels]);
  // Codex names its conversation after it starts; keep it with the session so
  // a later relaunch resumes it.
  useEffect(() => window.pitwall?.onSessionNativeId?.(({ sessionId, nativeSessionId }) => {
    setProjects((current) => current.map((project) => project.sessions.some((session) => session.id === sessionId)
      ? { ...project, sessions: project.sessions.map((session) => session.id === sessionId ? { ...session, nativeSessionId } : session) }
      : project));
  }), []);
  useEffect(() => {
    writeStored("pitwall-files-open", String(filesOpen));
    if (filesOpen && filesPanelEnabled) track("files_opened", { surface: "files" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesOpen]);
  // Which screens people use, and the last one before they stop.
  useEffect(() => {
    track("section_viewed", { surface: workspaceSection });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSection]);
  useEffect(() => {
    writeStored("pitwall-files-width", String(filesWidth));
  }, [filesWidth]);

  useEffect(() => {
    clearStaleTerminalRendererOptions();
  }, []);

  useEffect(() => {
    writeStored("pitwall-theme", themePreference);
    document.documentElement.dataset.theme = theme;
    // Windows draws its caption buttons itself; their colours follow the app's theme.
    void window.pitwall?.setWindowChrome?.({ dark: theme === "dark" });
  }, [theme, themePreference]);

  useEffect(() => {
    writeStored("pitwall-color-theme", colorTheme);
    document.documentElement.dataset.colorTheme = colorTheme;
  }, [colorTheme]);

  /**
   * The interface face.
   *
   * Set as the `--font-sans` token rather than on `body`, so everything that
   * already asks for that token follows — and the panes, which ask for
   * `--font-mono`, keep the fixed advance width their columns depend on.
   */
  useEffect(() => {
    writeStored("pitwall-app-font", appFont);
    writeStored("pitwall-app-font-migration", "zed");
    document.documentElement.style.setProperty("--font-sans", FONT_STACKS[appFont] ?? FONT_STACKS.plex);
    document.documentElement.dataset.appFont = appFont;
  }, [appFont]);

  useEffect(() => {
    writeStored(TERMINAL_FONT_SIZE_STORAGE_KEY, String(terminalFontSize));
    writeStored(TERMINAL_FONT_SIZE_MIGRATION_KEY, TERMINAL_FONT_SIZE_MIGRATION);
  }, [terminalFontSize]);

  useEffect(() => {
    writeStored(TERMINAL_FONT_FAMILY_STORAGE_KEY, terminalFontFamily);
    writeStored(TERMINAL_FONT_FAMILY_MIGRATION_KEY, TERMINAL_FONT_FAMILY_MIGRATION);
  }, [terminalFontFamily]);

  useEffect(() => {
    void refreshProviderModels(false);
  }, [refreshProviderModels]);

  useEffect(() => {
    void refreshCustomAgentModels();
  }, [refreshCustomAgentModels]);

  useEffect(() => {
    void refreshAgentChecks();
  }, [refreshAgentChecks]);

  useEffect(() => {
    if (!window.pitwall?.onTerminalData) return;

    /**
     * Chunks are collected and applied once a frame rather than one at a time.
     *
     * Every chunk used to be its own state update, and every state update
     * re-renders the whole workspace. One session is survivable; six starting
     * together stream their boot output at once, and the app spent its time
     * re-rendering instead of drawing — which is what the lag was.
     *
     * Order is preserved per session, and nothing is dropped: chunks accumulate
     * in the buffer and the flush appends them in arrival order.
     */
    let frame = 0;
    const pending: Record<string, string[]> = {};

    const flush = () => {
      frame = 0;
      const sessionIds = Object.keys(pending);
      if (sessionIds.length === 0) return;
      const batch: Record<string, string[]> = {};
      for (const id of sessionIds) {
        batch[id] = pending[id];
        delete pending[id];
      }
      // Bounded rather than appended to forever. The old line copied the whole
      // of a session's history on every frame, so the app got slower the longer
      // it stayed open — an hour of council output measured 73 seconds of
      // copying where this measures 3.
      updateTerminalLines((current) => applyBatch(current, batch, droppedChunksRef.current));

      // The mirror sees exactly what the panes see, in the same order.
      for (const [id, chunks] of Object.entries(batch)) screenMirrorRef.current.write(id, chunks);

      for (const [id, chunks] of Object.entries(batch)) answerCodexUpdatePromptRef.current(id, chunks);

      // Only the output that just arrived can hold a URL that was not there
      // before, so only that is read.
      for (const [id, chunks] of Object.entries(batch)) {
        const previous = previewWatchRef.current[id] ?? emptyPreviewWatch();
        const advanced = watchPreview(previous, chunks);
        if (advanced === previous) continue;
        previewWatchRef.current[id] = advanced;
        const url = advanced.preview?.url ?? "";
        if (url && url !== previewUrlRef.current[id]) {
          previewUrlRef.current[id] = url;
          setPreviewUrlBySession((current) => ({ ...current, [id]: url }));
        }
      }
    };

    flushTerminalDataRef.current = flush;

    const stop = window.pitwall.onTerminalData(({ sessionId, data }) => {
      const tail = knowledgeOutputRef.current[sessionId];
      if (tail) {
        tail.parts.push(data);
        tail.size += data.length;
        while (tail.parts.length > 1 && tail.size - tail.parts[0].length >= KNOWLEDGE_TAIL) tail.size -= tail.parts.shift()!.length;
      }
      const previous = terminalPtyActivityRef.current[sessionId];
      const at = Date.now();
      // Output arriving after a long enough silence is a new run of work, not a
      // continuation of the old one, so the clock restarts with it.
      const resumed = !previous || at - previous.lastAt >= QUIET_AFTER_MS;
      terminalPtyActivityRef.current[sessionId] = {
        chunks: (previous?.chunks ?? 0) + 1,
        firstAt: previous?.firstAt ?? at,
        lastAt: at,
        busySince: resumed ? at : previous.busySince,
      };
      // Stored on escape boundaries, so a replay never starts half way into one;
      // and the program's modes followed, so a replay can restore them.
      const { ready, carry } = splitAtEscapeBoundary((escapeCarryRef.current[sessionId] ?? "") + data);
      escapeCarryRef.current[sessionId] = carry;
      if (!ready) return;
      (terminalModesRef.current[sessionId] ??= createModeTracker()).observe(ready);
      (pending[sessionId] ??= []).push(ready);
      if (!frame) frame = window.requestAnimationFrame(flush);
    });

    return () => {
      stop?.();
      // Whatever arrived in the last frame still belongs to the transcript.
      if (frame) window.cancelAnimationFrame(frame);
      flush();
    };
  }, []);

  /**
   * Forgets a terminal the moment its process is gone.
   *
   * Attachment was recorded once and never revisited, so a CLI that finished
   * its turn and exited left the session looking attached forever. The council
   * then wrote the next turn into a PTY that did not exist: the write went
   * nowhere, the relay stopped with "its terminal is not running", and the
   * pane showed a clean `[process exited 0]` as though nothing were wrong.
   */
  useEffect(() => {
    if (!window.pitwall?.onTerminalClosed) return;
    return window.pitwall.onTerminalClosed(({ sessionId, exitCode, stopped }) => {
      terminalAttachedRef.current[sessionId] = false;
      settleClosedSession(sessionId, { exitCode, stopped });
      const run = pitwallRef.current.sessions.find((item) => item.id === sessionId);
      const task = pitwallRef.current.tasks.find((item) => item.id === run?.taskId)
        ?? taskBySessionRef.current[sessionId];
      const finished = task && (task.status === "completed" || task.status === "cancelled");
      if (finished) void releaseTaskRuntime(task.projectId, task.id);
      if (task && (finished || scheduledRunEnded(scheduleJobsRef.current, task.id))) {
        void retireTaskWorktrees(task.projectId, task.id);
      }
      setTerminalAttachedBySession((current) =>
        current[sessionId] === false ? current : { ...current, [sessionId]: false },
      );
    });
  }, []);

  useEffect(() => {
    if (!window.pitwall?.onAgentCompleted) return;
    return window.pitwall.onAgentCompleted((event) => {
      if (event.summary) lastSummaryRef.current[event.sessionId] = event.summary;
      // A pair's reviewer is not a session of its own: its finished turn is a verdict.
      const reviewed = pitwallRef.current.tasks.find((task) => task.pair?.reviewerSessionId === event.sessionId);
      if (reviewed) {
        void settlePairRound(reviewed.id, event.summary || "");
        return;
      }
      // A council member going quiet is a relay event, not just a notification:
      // its turn may have ended without the handoff the relay is waiting for.
      void handleRelayMemberCompleted(event.sessionId);
      // And a staged run's session going quiet is the end of one stage, which
      // is the only thing that moves that run forward.
      void handleStagedSessionCompleted(event.sessionId);
      // The cheapest evidence there is, run without being asked. Pitwall's
      // whole argument is evidence over claims, and until now the project's
      // own typecheck and tests only ran inside a staged run — so an ordinary
      // session could finish, report success, and leave code that does not
      // compile, with nothing to say so.
      void checkSessionWork(event.sessionId);
      // What it cost, read from what the CLI printed rather than estimated.
      recordSessionUsage(event.sessionId);
      // The last thing a session printed is the summary it was asked for, so
      // it has to be in the transcript before anything reads it.
      flushTerminalDataRef.current();
      void rememberSessionKnowledge(event.sessionId, knowledgeOutputRef.current[event.sessionId]?.parts.join("").slice(-KNOWLEDGE_TAIL) ?? "");
      const completedAt = event.at || nowIso();
      const completionLabel = event.status === "failed"
        ? `${event.sessionName} stopped with an error`
        : `${event.sessionName} finished`;
      if (event.status === "failed") {
        // The twin of session_completed. Without it an agent that died and one
        // that did the work were the same fact in the data, which is the only
        // question an alpha has: does this actually work.
        track("session_failed", { agent: String(event.agent || "").toLowerCase() });
        notifyRef.current({
          tone: "error",
          title: `${event.agent} session failed`,
          body: `${event.sessionName} stopped with an error. Open its terminal output, then use Retry session.`,
          target: { section: "work", projectId: event.projectId, sessionId: event.sessionId },
          banner: true,
        });
      } else if (!relayRunIdBySessionRef.current[event.sessionId]) {
        // Work that goes on to a reviewer or to Review says so when it gets
        // there; "finished" first would be the same news twice.
        const record = pitwallRef.current.sessions.find((item) => item.id === event.sessionId);
        const linked = record?.taskId ? pitwallRef.current.tasks.find((item) => item.id === record.taskId) : undefined;
        const reviewFollows = linked && (linked.pair || shouldMoveToReview(linked, pitwallRef.current.sessions, event.sessionId));
        if (!reviewFollows) {
          notifyRef.current({
            title: `${event.sessionName} finished`,
            body: `${event.agent} finished its turn.`,
            target: { section: "work", projectId: event.projectId, sessionId: event.sessionId },
            banner: true,
          });
        }
      }

      setProjects((current) => current.map((project) => {
        if (project.id !== event.projectId) return project;
        return {
          ...project,
          timeline: [completionLabel, ...project.timeline.slice(0, 5)],
          sessions: project.sessions.map((session) => session.id === event.sessionId
            ? {
                ...session,
                status: event.status === "failed" ? "failed" : "completed",
                logs: [completionLabel, ...session.logs.slice(0, 4)],
              }
            : session),
        };
      }));
      setPitwall((current) => ({
        ...current,
        sessions: current.sessions.map((session) => session.id === event.sessionId
          ? {
              ...session,
              status: event.status,
              updatedAt: completedAt,
            }
          : session),
        activity: [
          {
            id: makeId("activity"),
            projectId: event.projectId,
            sessionId: event.sessionId,
            provider: event.provider,
            type: "system",
            message: completionLabel,
            createdAt: completedAt,
          },
          ...current.activity,
        ],
      }));

      // A scheduled run settles here: this is where the agent says it is done,
      // and the only place that knows whether it failed.
      const settling = pitwallRef.current.sessions.find((session) => session.id === event.sessionId);
      if (settling?.taskId) void settleScheduledRun(settling.taskId, event.status === "failed");

      if (event.status !== "failed") {
        const run = pitwallRef.current.sessions.find((session) => session.id === event.sessionId);
        const task = run ? pitwallRef.current.tasks.find((item) => item.id === run.taskId) : undefined;
        const projectSession = projectsRef.current
          .find((project) => project.id === event.projectId)
          ?.sessions.find((session) => session.id === event.sessionId);
        const project = projectsRef.current.find((item) => item.id === event.projectId);
        if (run && task) {
          void (async () => {
            const parsed = parseTaskSummary((terminalLinesRef.current[event.sessionId] ?? []).join("\n"));
            const workspacePath = run.worktreePath || projectSession?.worktreePath || project?.path || "";
            // Changed files enrich the summary; they are not what it is. A git
            // call that blocks — an index.lock held by a concurrent worktree, a
            // slow filesystem — must not cost the user the report the agent
            // just wrote, so this waits only so long for the extra detail.
            const gitStatus = workspacePath && window.pitwall?.getGitStatus
              ? await Promise.race([
                  window.pitwall.getGitStatus(workspacePath).catch(() => null),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
                ])
              : null;
            const changedFiles = gitStatus?.ok ? gitStatus.changes.map((change) => change.path) : [];
            const baseSummary = parsed ?? {
              what: `The agent completed work for ${task.identifier || task.title}.`,
              how: `Work was performed in the task's isolated session${workspacePath ? ` at ${workspacePath}` : ""}. Review the saved transcript and changed components for implementation evidence.`,
              components: [],
              source: "derived" as const,
            };
            const completionSummary = {
              ...mergeTaskSummaryComponents(baseSummary, changedFiles),
              reportedAt: completedAt,
            };
            setPitwall((current) => ({
              ...current,
              tasks: current.tasks.map((item) => {
                if (item.id !== task.id) return item;
                const keepAgentReport = item.completionSummary?.source === "agent" && completionSummary.source !== "agent";
                const summary = keepAgentReport
                  ? { ...item.completionSummary!, components: Array.from(new Set([...item.completionSummary!.components, ...changedFiles])) }
                  : completionSummary;
                return {
                  ...item,
                  completionSummary: summary,
                  relatedFiles: Array.from(new Set([...item.relatedFiles, ...changedFiles])),
                  updatedAt: completedAt,
                };
              }),
            }));

            // The agent's own signal that it is done. It already writes
            // PITWALL_TASK_SUMMARY when it finishes, and that marker is the
            // only thing on this path that means "the work is complete" rather
            // than "the turn ended" — a blocked run that has since been
            // cleared finishes on a later turn, so the turn ending is not
            // enough to settle it, and the summary is.
            const summarised = pitwallRef.current.sessions.find((item) => item.id === event.sessionId);
            if (summarised?.taskId) void settleScheduledRun(summarised.taskId, false);
          })();

          // Counted out here rather than inside the updater below: React calls
          // an updater twice under StrictMode, and an event that fires twice is
          // worse than one that does not fire at all.
          track("session_completed", {
            agent: (sessionByIdRef.current[event.sessionId]?.agent ?? "").toLowerCase(),
          });

          // The preview belongs to the work whoever reviews it, so it is kept
          // and opened before a reviewer can take the task.
          const openCompletedPreview = (attempt = 0) => {
            const preview = findLatestDevPreview(terminalLinesRef.current[event.sessionId] ?? []);
            if (!preview && attempt < 8) {
              window.setTimeout(() => openCompletedPreview(attempt + 1), 250);
              return;
            }
            if (!preview) return;
            const { url } = preview;

            const previewKey = `${task.id}\u0000${url}`;
            if (openedCompletionPreviewsRef.current.has(previewKey)) return;
            openedCompletionPreviewsRef.current.add(previewKey);
            rememberPreviewUrl(event.projectId, url, task.id);
            // A mobile agent has already launched this URL on the task's named
            // device. Opening it through macOS again would route it to whichever
            // simulator happens to be the default and break task isolation.
            if (preview.target === "mobile") return;
            const opening = window.pitwall?.openExternalUrl?.(url);
            if (!opening) {
              openedCompletionPreviewsRef.current.delete(previewKey);
              return;
            }
            void opening.then((result) => {
              if (result?.ok) return;
              openedCompletionPreviewsRef.current.delete(previewKey);
              setSystemNotice({
                tone: "error",
                title: "Could not open the task preview",
                message: result?.error || `${url} could not be opened in your browser or simulator.`,
              });
            }).catch((error) => {
              openedCompletionPreviewsRef.current.delete(previewKey);
              setSystemNotice({
                tone: "error",
                title: "Could not open the task preview",
                message: error instanceof Error ? error.message : `${url} could not be opened in your browser or simulator.`,
              });
            });
          };
          openCompletedPreview();

          // A paired task goes to its reviewer before it goes to you. While the
          // reviewer reads, later turn-ends from the implementer are not new
          // work to review.
          const pairedTask = pitwallRef.current.tasks.find((item) => item.id === run.taskId);
          // A project with Hermes as its reviewer: finished work goes to Hermes
          // before it comes to you, whoever wrote it and however it was started.
          const overseer = overseerOf(pairedTask?.projectId);
          if (pairedTask && !pairedTask.pair && overseer && shouldMoveToReview(pairedTask, pitwallRef.current.sessions, event.sessionId)) {
            const pair: PitwallTaskPair = { reviewer: "hermes", model: overseer.model, maxRounds: overseer.rounds, round: 0, state: "implementing" };
            setPitwall((current) => ({
              ...current,
              tasks: current.tasks.map((item) => item.id === pairedTask.id && !item.pair ? { ...item, pair, updatedAt: completedAt } : item),
            }));
            void runPairReview(pairedTask.id, event.sessionId, run.worktreePath || projectSession?.worktreePath || project?.path || "", project, { pair });
            return;
          }
          if (pairedTask?.pair) {
            // The same test that would move it to review: only work that is
            // actually finished is worth a reviewer's round.
            if (pairedTask.pair.state === "implementing" && shouldMoveToReview(pairedTask, pitwallRef.current.sessions, event.sessionId)) {
              void runPairReview(pairedTask.id, event.sessionId, run.worktreePath || projectSession?.worktreePath || project?.path || "", project);
            }
            return;
          }

          // An agent finishing is what moves the work on. Nothing did that: the
          // completion path wrote a summary, opened the preview, and left the
          // task in Running, so a task whose agent had been done for an hour
          // was indistinguishable from one still being worked on.
          setPitwall((current) => {
            const liveTask = current.tasks.find((item) => item.id === run.taskId);
            if (!liveTask || !shouldMoveToReview(liveTask, current.sessions, event.sessionId)) return current;
            return {
              ...current,
              tasks: current.tasks.map((item) =>
                item.id === liveTask.id ? { ...item, status: "review" as const, updatedAt: completedAt } : item,
              ),
              activity: [
                {
                  id: makeId("activity"),
                  projectId: event.projectId,
                  taskId: liveTask.id,
                  type: "system" as const,
                  message: `Ready for review: ${liveTask.title}`,
                  createdAt: completedAt,
                },
                ...current.activity,
              ],
            };
          });

        }
      }

      if (event.projectId !== activeProjectIdRef.current || document.hidden) {
        setProjectNotifications((current) => recordProjectNotification(current, event.projectId, {
          lastAt: completedAt,
          sessionName: event.sessionName,
          agent: event.agent,
        }));
      }
      try {
        playCompletionSound();
      } catch {
        // Notification state still updates when audio initialization fails.
      }
    });
  }, []);

  // Checkpoint dirty scrollback at most every four seconds, even while an
  // agent streams continuously. Unload still flushes the latest snapshot.
  useEffect(() => {
    let saved = terminalLinesRef.current;
    const timer = window.setInterval(() => {
      const latest = terminalLinesRef.current;
      if (latest === saved) return;
      writeTerminalHistory(latest);
      saved = latest;
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const flush = () => writeTerminalHistory(terminalLinesRef.current);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  useEffect(() => {
    terminalAttachedRef.current = terminalAttachedBySession;
  }, [terminalAttachedBySession]);

  // Which editors are installed. Read once at startup: it is a property of the
  // machine, and re-scanning on every render would hit the filesystem for an
  // answer that changes about as often as an app is installed. The main process
  // re-detects on each open, so installing one mid-session still works.
  useEffect(() => {
    if (!window.pitwall?.listEditors) return;
    let active = true;
    void window.pitwall.listEditors().then((result) => {
      if (active && result?.ok) setInstalledEditors(result.editors ?? []);
    });
    return () => {
      active = false;
    };
  }, []);

  // Keep the drafted model valid for the drafted agent. draftAgent can change via
  // selectDraftAgent, handoffs, or "use in session", so this guards against a
  // stale model from another provider leaking into the launch command.
  useEffect(() => {
    const option = agentOptions.find((item) => item.agent === draftAgent);
    if (option && !option.models.some((model) => model.label === draftModel)) {
      setDraftModel(option.models[0].label);
    }
  }, [agentOptions, draftAgent, draftModel]);

  useEffect(() => {
    if (workbenchTab !== "terminal" || !selectedSession) return;
    void ensureAgentTerminal(selectedSession);
  }, [workbenchTab, selectedSession?.id]);

  useEffect(() => {
    projectFilesRef.current = projectFiles;
  }, [projectFiles]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Already taken by something on top: an open menu or a choice list.
        if (event.defaultPrevented) return;
        setPaletteOpen(false);
        setMcpManagerOpen(false);
        setConnectionsOpen(false);
        setCreateSessionOpen(false);
        setCreateTaskOpen(false);
        setStartTaskOpen(false);
        setCreateContextOpen(false);
        setAddMcpOpen(false);
        setMcpAuthServer(null);
        setCouncilSetupOpen(false);
        setAddAgentOpen(false);
        setAllSessionsOpen(false);
        setGitHubAuthOpen(false);
        setTranscriptSession(null);
        return;
      }
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      if (!hasPrimaryModifier) return;

      const key = event.key.toLowerCase();
      // Whatever these open would sit behind the dialog that is up, typing and all.
      if (["k", "p", "j", "n", "b", ","].includes(key) && document.querySelector("[aria-modal='true']:not(.dk-palette)")) return;
      if ((event.shiftKey && key === "p") || key === "k") {
        event.preventDefault();
        openPalette("commands");
        return;
      }
      if (key === "p") {
        event.preventDefault();
        openPalette("files");
        return;
      }
      if (key === "j") {
        event.preventDefault();
        setAllSessionsOpen(true);
        return;
      }
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        setDraftInstruction("");
        setCreateSessionOpen(true);
        return;
      }
      if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        setWorkspaceSection("tasks");
        return;
      }
      if (key === ",") {
        event.preventDefault();
        setConnectionsProvider(null);
        setWorkspaceSection("connections");
        return;
      }
      // The sidebar's rows as drawn — collapsed groups and all — so the numbers match what is on screen.
      const sidebarRows = () => document.querySelector("[aria-modal='true']") ? [] : [...document.querySelectorAll<HTMLElement>(".dk-tsb button[data-sidebar-row]")];
      if (/^[1-9]$/.test(event.key) && !event.shiftKey && !event.altKey) {
        const row = sidebarRows()[Number(event.key) - 1];
        if (row) {
          event.preventDefault();
          row.click();
        }
        return;
      }
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        const rows = sidebarRows();
        if (rows.length === 0) return;
        event.preventDefault();
        const current = rows.findIndex((row) => row.hasAttribute("aria-current"));
        const next = current < 0 ? 0 : (current + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows[next].click();
        return;
      }
      if (key === "`") {
        event.preventDefault();
        setWorkbenchTab("terminal");
        return;
      }
      // Command only: Control-E is the terminal's end-of-line.
      if (isFilesShortcut(event) && readStoredValue("pitwall-files-panel", "off") === "on") {
        event.preventDefault();
        setFilesOpen((open) => !open);
        setWorkspaceSection("work");
        return;
      }
      // The Editor tab is now a launcher rather than a workbench, so the panes
      // it used to switch between are gone with it.
      if (event.shiftKey && key === "e") {
        event.preventDefault();
        setWorkbenchTab("editor");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let active = true;

    if (!activeProject.path) {
      setProjectFiles([]);
      return () => {
        active = false;
      };
    }

    window.pitwall?.listProjectFiles?.(activeProject.path).then((result) => {
      if (!active) return;
      if (result?.ok && result.files.length > 0) {
        setProjectFiles(result.files);
      } else {
        setProjectFiles([]);
      }
    });

    return () => {
      active = false;
    };
  }, [activeProject.id, activeProject.path, showToolingFiles]);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      [project.name, project.path, project.branch].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [projects, query]);

  function appendActivity(event: Omit<PitwallActivityEvent, "id" | "createdAt">) {
    setPitwall((current) => ({
      ...current,
      activity: [
        {
          ...event,
          id: makeId("activity"),
          createdAt: nowIso(),
        },
        ...current.activity,
      ],
    }));
  }

  function createProjectTask() {
    const identifier = normalizeTaskIdentifier(draftTaskIdentifier);
    const identifierError = validateTaskIdentifier(identifier);
    if (identifierError) {
      setTaskFormError(identifierError);
      return;
    }
    if (projectTasks.some((task) => taskBranchName(task).toLowerCase() === identifier)) {
      setTaskFormError(`Task ID ${identifier} already exists in this project.`);
      return;
    }

    const title = draftTaskTitle.trim() || "Untitled task";
    const timestamp = nowIso();
    track("task_created", { source_kind: "local" });
    const task: PitwallTask = {
      id: makeId("task"),
      identifier,
      projectId: activeProject.id,
      title,
      description: draftTaskDescription.trim() || "No description yet.",
      images: draftTaskImages,
      status: "ready",
      priority: draftTaskPriority,
      assignedAgent: draftTaskAgent,
      relatedFiles: [],
      worktree: identifier,
      source: { kind: "local" },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setPitwall((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          taskId: task.id,
          type: "task-created",
          message: `Task created: ${identifier} · ${task.title}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    setDraftTaskId(task.id);
    setDraftAgent(agentFromProviderId(task.assignedAgent || "codex"));
    setDraftTaskIdentifier("");
    setDraftTaskTitle("Implement next task");
    setDraftTaskDescription("");
    setDraftTaskImages([]);
    // A fresh id for the next draft, so its images do not land in the previous
    // task's staging directory.
    draftTaskAttachmentId.current = makeId("task-draft");
    setTaskFormError("");
    setCreateTaskOpen(false);

    // Task creation only persists the task. Continue automatically solely when
    // the user had already chosen an explicit action before the task existed.
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    if (pending === "session") {
      setCreateSessionOpen(true);
    } else if (pending === "council" || pending === "compare") {
      setCouncilSetupMode(pending);
      setCouncilSetupOpen(true);
    } else {
      setWorkspaceSection("tasks");
    }
  }

  /**
   * A ticket a watch found, made into a task with the plan you approved.
   *
   * The same task an import makes, for the project the watch belongs to, with
   * the plan kept under the ticket's own text rather than replacing it.
   */
  function createTaskFromTicket(finding: WatchFinding, plan: string, assignedAgent: PitwallProviderId | "" = ""): PitwallTask | null {
    const ticket = finding.payload?.ticket;
    const source = finding.payload?.source;
    if (!ticket || !source) return null;
    const project = projectsRef.current.find((item) => item.id === finding.projectId);
    if (!project) return null;
    const used = new Set(pitwallRef.current.tasks.filter((task) => task.projectId === project.id).map((task) => taskBranchName(task).toLowerCase()));
    const candidate = { id: ticket.id || "", title: ticket.title, description: ticket.description, url: ticket.url, status: ticket.status } as McpTaskCandidate;
    const identifier = allocateImportedTaskIdentifier(candidate, used);
    const timestamp = nowIso();
    const description = [trackerHtmlToMarkdown(ticket.description ?? "").trim(), plan.trim() ? `## Plan\n\n${plan.trim()}` : ""].filter(Boolean).join("\n\n");
    const task: PitwallTask = {
      id: makeId("task"),
      identifier,
      projectId: project.id,
      title: ticket.title,
      description: description || ticket.title,
      status: "ready",
      priority: "medium",
      assignedAgent,
      relatedFiles: [],
      worktree: identifier,
      source: { kind: "mcp", name: source.name, provider: source.provider as PitwallProviderId, target: source.target, externalId: ticket.id, url: ticket.url, status: ticket.status },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setPitwall((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      activity: [
        { id: makeId("activity"), projectId: project.id, taskId: task.id, type: "task-created", message: `${ticket.id ? `${ticket.id} ` : ""}${ticket.title} — assigned to you, made a task from Watch`, createdAt: timestamp },
        ...current.activity,
      ],
    }));
    return task;
  }

  function importMcpTasks(source: McpTaskSource, candidates: McpTaskCandidate[]) {
    if (!candidates.length) return;
    const timestamp = nowIso();
    const usedIdentifiers = new Set(projectTasks.map((task) => taskBranchName(task).toLowerCase()));
    const tasks = candidates.map<PitwallTask>((candidate) => {
      const identifier = allocateImportedTaskIdentifier(candidate, usedIdentifiers);
      return {
        id: makeId("task"),
        identifier,
        projectId: activeProject.id,
        title: candidate.title,
        description: trackerHtmlToMarkdown(candidate.description ?? "").trim() || "Imported from connected work.",
        status: mapExternalTaskStatus(candidate.status),
        priority: "medium",
        assignedAgent: "",
        relatedFiles: [],
        worktree: identifier,
        source: {
          kind: "mcp",
          name: source.name,
          provider: source.provider,
          target: source.target,
          externalId: candidate.id,
          url: candidate.url,
          status: candidate.status,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

    setPitwall((current) => ({
      ...current,
      tasks: [...tasks, ...current.tasks],
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          type: "task-created",
          message: `Imported ${tasks.length} task${tasks.length === 1 ? "" : "s"} from ${source.label} via ${getProviderLabel(source.provider)}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    setDraftTaskId(tasks[0].id);
    track("task_imported", { count: tasks.length, source_kind: "mcp" });
    setMcpTaskImportOpen(false);
    setWorkspaceSection("tasks");
  }

  /** The session working on a task in the open project, if one is still there. */
  function sessionForTask(task: PitwallTask) {
    const pitwallSession = pitwall.sessions.find(
      (session) => session.projectId === activeProject.id && session.taskId === task.id,
    );
    return (
      (pitwallSession && activeProject.sessions.find((session) => session.id === pitwallSession.id)) ??
      activeProject.sessions.find((session) => session.task === task.title || `task-${session.id}` === task.id)
    );
  }

  function selectMissionTask(task: PitwallTask) {
    setDraftTaskId(task.id);
    setWorkspaceSection("work");
    if (task.assignedAgent) {
      setDraftAgent(agentFromProviderId(task.assignedAgent));
    }

    const projectSession = sessionForTask(task);
    if (!projectSession?.id) return;
    setSelectedSessionId(projectSession.id);
    setWorkbenchTab("terminal");
    void ensureAgentTerminal(projectSession);
  }

  /**
   * Sends the work back with a reason.
   *
   * Delivered straight to the agent's terminal when one is still attached,
   * which is the case that makes this worth having — the session is warm, it
   * has the file open, and it can act immediately. When nothing is listening
   * the request is kept on the task and the task goes back to the queue, so
   * starting a session for it later carries the request in.
   *
   * Either way it leaves review. A task with unaddressed feedback sitting under
   * "complete work only after its changes agree" is the one state this must not
   * end in.
   */
  /**
   * One round of a pair: the reviewer reads the implementer's change and
   * either approves it — it goes to the person's Review queue — or sends it
   * back to the implementer with what to fix. The rounds are bounded; when
   * they run out the work goes to the person with the open points on it.
   */
  async function runPairReview(taskId: string, implementerSessionId: string, worktreePath: string, project?: Project, { retry = false, pair: attached, task: attachedTask }: { retry?: boolean; pair?: PitwallTaskPair; task?: PitwallTask } = {}) {
    const task = pitwallRef.current.tasks.find((item) => item.id === taskId) ?? attachedTask;
    // A pair attached this instant is not in the ref until the next render.
    const pair = attached ?? task?.pair;
    if (!task || !pair) return;
    // A retry redoes the round a restart cut short rather than starting the next.
    const round = retry ? Math.max(1, pair.round) : pair.round + 1;
    const reviewerLabel = pairReviewerLabel(pair.reviewer);
    const reviewerSessionId = pair.reviewerSessionId || `${implementerSessionId}-reviewer`;
    const setPair = pairUpdater(taskId);

    setPair(
      { state: "reviewing", round, reviewerSessionId, implementerSessionId, worktreePath },
      {},
      `${reviewerLabel} is reviewing ${task.identifier || task.title} (round ${round} of ${pair.maxRounds})`,
    );
    const ownerProject = project ?? activeProject;
    const prepared = await window.pitwall?.pairPrepare?.({
      projectPath: ownerProject.path,
      worktreePath,
      baseBranch: ownerProject.branch,
      round,
      maxRounds: pair.maxRounds,
      task: { identifier: task.identifier, title: task.title, description: task.description },
    }).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "The review could not be prepared" }));

    // A reviewer that cannot run must not hold the work back: it goes to the
    // person, saying the review did not happen.
    const skip = (reason: string) => setPair(
      { state: "skipped", outcome: `${reviewerLabel} could not review it`, summary: reason },
      { status: "review" },
      `Ready for review: ${task.title} — ${reviewerLabel} could not review it (${reason})`,
    );
    if (!prepared?.ok || !prepared.prompt) {
      skip(prepared?.error || "unknown error");
      return;
    }

    // The same reviewer across rounds keeps what it already read; a fresh one
    // is started when there is none.
    let delivered = false;
    if (terminalAttachedRef.current[reviewerSessionId]) {
      delivered = await sendTerminalPrompt(reviewerSessionId, prepared.prompt);
    }
    if (!delivered) {
      updateTerminalLines((current) => ({ ...current, [reviewerSessionId]: [] }));
      const size = workbenchTerminalSizeRef.current;
      const result = await window.pitwall?.startTerminal?.({
        projectId: task.projectId,
        projectPath: prepared.worktree || worktreePath,
        sessionId: reviewerSessionId,
        sessionName: `${task.identifier || task.title} · Reviewer`,
        agent: reviewerLabel,
        // Hermes reviews on the project's chosen model; the others pick their own.
        model: (pair.model && pair.model !== "auto" ? pair.model : undefined) || (pair.reviewer === "hermes" ? projectOverseer(task.projectId)?.model : undefined) || "auto",
        pairReviewer: pair.reviewer,
        initialPrompt: prepared.prompt,
        cols: Math.max(60, Math.round((size?.cols ?? 132) * 0.45)),
        rows: size?.rows ?? 36,
      }).catch(() => null);
      delivered = Boolean(result?.ok);
      terminalAttachedRef.current[reviewerSessionId] = delivered;
      setTerminalAttachedBySession((current) => ({ ...current, [reviewerSessionId]: delivered }));
      if (!delivered) {
        skip(result?.error || "its CLI could not start");
        return;
      }
    }

    // The verdict arrives with the reviewer's own "turn finished" signal. If
    // that never comes, the work is not left waiting on it forever.
    const watched = round;
    window.setTimeout(() => {
      const current = pitwallRef.current.tasks.find((item) => item.id === taskId)?.pair;
      if (current?.state === "reviewing" && current.round === watched) skip("it did not finish within 20 minutes");
    }, 20 * 60_000);
  }

  /**
   * The person's decision on reviewed work, kept beside where the reviewer had
   * left it: the reviewer's track record. Only once the reviewer has finished;
   * a decision mid-review says nothing about its verdict.
   */
  function withLeadDecision(pair: PitwallTaskPair, lead: "approved" | "sent-back", at: string): PitwallTaskPair {
    if (pair.state !== "approved" && pair.state !== "open-points") return pair;
    const model = [...(pair.rounds ?? [])].reverse().find((round) => round.model)?.model;
    return { ...pair, decisions: [...(pair.decisions ?? []), { at, lead, reviewer: pair.state, ...(model ? { model } : {}) }] };
  }

  /** Writes a pair's state, with an Activity line when there is something to say. */
  function pairUpdater(taskId: string) {
    return (patch: Partial<PitwallTaskPair>, extra: Partial<PitwallTask> = {}, message = "") =>
      setPitwall((current) => {
        const task = current.tasks.find((item) => item.id === taskId);
        return {
          ...current,
          tasks: current.tasks.map((item) => item.id === taskId && item.pair
            ? { ...item, ...extra, pair: { ...item.pair, ...patch }, updatedAt: nowIso() }
            : item),
          activity: message && task
            ? [{ id: makeId("activity"), projectId: task.projectId, taskId, type: "system" as const, message, createdAt: nowIso() }, ...current.activity]
            : current.activity,
        };
      });
  }

  /**
   * The reviewer has finished a turn: read its closing message as a verdict,
   * then send the work back or on to the person.
   */
  function updateProjectRecord(projectId: string, patch: Partial<PitwallProjectRecord>) {
    setPitwall((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === projectId ? { ...item, ...patch, updatedAt: nowIso() } : item),
    }));
  }

  /** A project's Hermes settings, whether or not it is switched on; on unless turned off. */
  function projectOverseer(projectId?: string): PitwallProjectOverseer {
    return pitwallRef.current.projects.find((item) => item.id === projectId)?.overseer ?? DEFAULT_OVERSEER;
  }

  /**
   * The settings when Hermes is this project's reviewer, else nothing. A
   * Hermes that is not installed or signed in counts as off, so finished work
   * is never held for a reviewer that cannot run.
   */
  function overseerOf(projectId?: string): PitwallProjectOverseer | null {
    const overseer = projectOverseer(projectId);
    return overseer.enabled && hermesReadyRef.current ? overseer : null;
  }

  /**
   * Hermes learning from a checkpoint, in the background. What it reports as
   * project facts is filed as tentative knowledge, credited to Hermes, for the
   * person to keep or reject; how to review the project stays in its own memory.
   */
  function learnWithHermes(task: PitwallTask, observation: {
    kind: "task-finished" | "decision";
    agent?: string;
    summary?: string;
    review?: { verdict?: string; summary?: string };
    decision?: { action: "approved" | "merged" | "sent-back" | "rejected"; comment?: string };
  }) {
    const overseer = overseerOf(task.projectId);
    const project = projectsRef.current.find((item) => item.id === task.projectId);
    if (!overseer || !project || !window.pitwall?.overseerObserve) return;
    const sessionId = task.pair?.implementerSessionId ?? pitwallRef.current.sessions.find((item) => item.taskId === task.id)?.id;
    const learningId = makeId("learning");
    setHermesLearning((current) => [...current, { id: learningId, key: (task.identifier || task.title).toUpperCase() }]);
    void window.pitwall.overseerObserve({
      ...observation,
      projectId: project.id,
      projectPath: project.path,
      worktreePath: task.pair?.worktreePath,
      baseBranch: project.branch,
      model: overseer.model,
      task: { identifier: task.identifier, title: task.title, description: task.description },
    }).then(async (result) => {
      if (!result?.ok || !result.reply || !sessionId) return;
      const learned = parseKnowledgeObservations(result.reply).length;
      await rememberSessionKnowledge(sessionId, result.reply, [], "hermes");
      if (learned) {
        setPitwall((current) => ({
          ...current,
          activity: [{
            id: makeId("activity"), projectId: task.projectId, taskId: task.id, type: "system" as const,
            message: `Hermes learned ${learned} ${learned === 1 ? "fact" : "facts"} from ${task.identifier || task.title}`,
            createdAt: nowIso(),
          }, ...current.activity],
        }));
      }
    }).catch(() => {}).finally(() => {
      setHermesLearning((current) => current.filter((item) => item.id !== learningId));
    });
  }

  function learnFromFinishedTask(task: PitwallTask, pair: PitwallTaskPair, review?: { verdict?: string; summary?: string }) {
    const implementer = pair.implementerSessionId;
    learnWithHermes(task, {
      kind: "task-finished",
      agent: implementer ? sessionByIdRef.current[implementer]?.agent : undefined,
      summary: implementer ? lastSummaryRef.current[implementer] : undefined,
      review,
    });
  }

  async function settlePairRound(taskId: string, closing: string) {
    const task = pitwallRef.current.tasks.find((item) => item.id === taskId);
    const pair = task?.pair;
    if (!task || !pair || pair.state !== "reviewing") return;
    const reviewerLabel = pairReviewerLabel(pair.reviewer);
    const round = pair.round;
    const setPair = pairUpdater(taskId);
    const result = await window.pitwall?.pairVerdict?.({ raw: closing, reviewer: pair.reviewer, round, maxRounds: pair.maxRounds })
      .catch(() => null);
    const at = nowIso();
    // Which model reviewed, so its track record can be told apart from another's.
    const chosen = pair.model && pair.model !== "auto" ? pair.model : pair.reviewer === "hermes" ? projectOverseer(task.projectId).model : pair.model;
    const model = !chosen || chosen === "auto" ? `${reviewerLabel}'s default` : chosen;

    if (!result?.ok || !result.verdict) {
      track("pair_finished", { agent: pair.reviewer, outcome: "failed", turns: round });
      setPair(
        {
          state: "skipped",
          outcome: `${reviewerLabel} gave no verdict`,
          summary: result?.error || "Its reply could not be read as a review.",
          rounds: [...(pair.rounds ?? []), { round, verdict: "unreadable", summary: closing.slice(0, 600), comments: [], at, model }],
        },
        { status: "review" },
        `Ready for review: ${task.title} — ${reviewerLabel} gave no verdict`,
      );
      void window.pitwall?.detachTerminal?.(pair.reviewerSessionId || "");
      learnFromFinishedTask(task, pair);
      return;
    }

    const record = { round, verdict: result.verdict, summary: result.summary || "", comments: result.comments ?? [], at, model };
    const rounds = [...(pair.rounds ?? []), record];
    if (result.verdict === "approve" || round >= pair.maxRounds) {
      const approved = result.verdict === "approve";
      track("pair_finished", { agent: pair.reviewer, outcome: approved ? "accepted" : "rejected", turns: round });
      setPair(
        { state: approved ? "approved" : "open-points", outcome: result.outcome, summary: result.summary, rounds },
        { status: "review" },
        `Ready for review: ${task.title} — ${result.outcome}`,
      );
      // Its work is done; the transcript stays on screen.
      void window.pitwall?.detachTerminal?.(pair.reviewerSessionId || "");
      terminalAttachedRef.current[pair.reviewerSessionId || ""] = false;
      learnFromFinishedTask(task, pair, { verdict: result.verdict, summary: result.summary });
      return;
    }

    // Back to the implementer, which still has the context to fix it.
    const request = { ...makeChangeRequest(result.feedback || result.summary || "", at, makeId("request")), from: "reviewer" as const };
    // Implementing before the send: a quick turn can finish before it resolves.
    setPair(
      { state: "implementing", outcome: undefined, summary: result.summary, rounds },
      {
        status: "running",
        changeRequests: [...(task.changeRequests ?? []), { ...request, deliveredAt: at }],
      },
      `${reviewerLabel} sent ${task.identifier || task.title} back to the implementer (round ${round} of ${pair.maxRounds})`,
    );
    if (pair.implementerSessionId && (await sendTerminalPrompt(pair.implementerSessionId, result.feedback || ""))) return;
    // Nobody to hand it to: it goes to the person with the reviewer's points on it.
    setPair(
      { state: "open-points", outcome: `${reviewerLabel} sent it back, but the implementer was not reachable` },
      {
        status: "review",
        changeRequests: (pitwallRef.current.tasks.find((item) => item.id === taskId)?.changeRequests ?? []).map((item) => item.id === request.id ? { ...item, deliveredAt: null } : item),
      },
      `Ready for review: ${task.title} — the implementer was not reachable for ${reviewerLabel}'s points`,
    );
  }

  async function requestTaskChanges(
    task: PitwallTask,
    body: string,
    filePath?: string,
  ): Promise<boolean> {
    if (!isUsableRequest(body)) return false;
    learnWithHermes(task, { kind: "decision", decision: { action: "sent-back", comment: filePath ? `${filePath}: ${body}` : body } });
    const timestamp = nowIso();
    const request = makeChangeRequest(body, timestamp, makeId("request"), filePath);

    const withRequest = {
      ...task,
      changeRequests: [...(task.changeRequests ?? []), request],
    } as PitwallTask;

    // Only a session that is actually attached can be told anything.
    const live = pitwall.sessions.find(
      (session) => session.taskId === task.id && terminalAttachedBySession[session.id],
    );
    track("change_requested");
    const prompt = formatChangeRequestPrompt(withRequest, [request]);
    const delivered = live ? await sendTerminalPrompt(live.id, prompt) : false;

    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: statusAfterRequest(delivered),
              // Your feedback starts the pair over: the reviewer checks the
              // implementer's answer to it before the work comes back to you.
              ...(item.pair ? { pair: { ...withLeadDecision(item.pair, "sent-back", timestamp), round: 0, state: "implementing" as const, outcome: undefined, summary: undefined } } : {}),
              changeRequests: delivered
                ? markDelivered(withRequest, [request.id], timestamp)
                : withRequest.changeRequests,
              updatedAt: timestamp,
            }
          : item,
      ),
    }));

    // Go to whoever received it. The comment is an instruction to a running
    // agent, and staying on the diff meant reading "it is working on it" with
    // no way to watch it work — the session it went to was somewhere else
    // entirely, and finding it was on you.
    if (delivered && live) {
      const pane =
        projectsRef.current.flatMap((project) => project.sessions).find((item) => item.id === live.id) ??
        relaySessionRef.current[live.id];
      if (pane) void selectSession(pane);
    }

    setSystemNotice(
      delivered
        ? { tone: "info", title: "Sent to the agent", message: `${live ? getProviderLabel(live.provider) : "The session"} is working on it.` }
        : {
            tone: "info",
            title: "Saved for the agent",
            message: "No session is running for this task. The request goes with it when one starts.",
          },
    );

    return delivered;
  }

  function taskValidation(task: PitwallTask) {
    const sessions = pitwall.sessions.filter((session) => session.projectId === task.projectId && session.taskId === task.id);
    const results = [taskChecks[task.id], ...sessions.map((session) => sessionChecks[session.id])].filter((result): result is ValidationResult => Boolean(result));
    return results.sort((left, right) => Date.parse(right.ranAt) - Date.parse(left.ranAt))[0];
  }

  function taskValidationRunning(task: PitwallTask) {
    return Boolean(checkingTasks[task.id] || pitwall.sessions.some((session) => session.projectId === task.projectId && session.taskId === task.id && checkingSessions[session.id]));
  }

  async function runTaskValidation(task: PitwallTask) {
    if (taskCheckInFlight.current.has(task.id)) return;
    const project = projectsRef.current.find((item) => item.id === task.projectId);
    if (!project) return;
    taskCheckInFlight.current.add(task.id);
    setCheckingTasks((current) => ({ ...current, [task.id]: true }));
    try {
      const response = await window.pitwall?.runValidation?.({ projectPath: project.path, branch: task.worktree || project.branch });
      if (!response?.ok || !response.result) throw new Error("Validation is unavailable. Restart Pitwall and try again.");
      setTaskChecks((current) => ({ ...current, [task.id]: response.result }));
    } catch (error) {
      setTaskChecks((current) => ({ ...current, [task.id]: {
        ok: false, ranAt: nowIso(), checks: [{ name: "validation", command: "", ok: false, skipped: false, durationMs: 0, output: error instanceof Error ? error.message : "Could not run checks." }],
      } }));
    } finally {
      taskCheckInFlight.current.delete(task.id);
      setCheckingTasks((current) => ({ ...current, [task.id]: false }));
    }
  }

  function completeActiveTask(task: PitwallTask, override?: string) {
    if (override === undefined) {
      setTaskPendingCompletion(task);
      return;
    }
    if (taskValidationRunning(task)) return;
    void releaseTaskRuntime(task.projectId, task.id);
    setTaskPendingCompletion(null);
    learnWithHermes(task, { kind: "decision", decision: { action: "approved", comment: override || undefined } });
    const timestamp = nowIso();
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: "completed",
              ...(item.pair ? { pair: withLeadDecision(item.pair, "approved", timestamp) } : {}),
              updatedAt: timestamp,
            }
          : item,
      ),
      sessions: current.sessions.map((session) =>
        session.taskId === task.id
          ? {
              ...session,
              status: "completed",
              updatedAt: timestamp,
            }
          : session,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          taskId: task.id,
          type: "task-completed",
          message: `Task completed: ${task.title}${override ? ` — manual validation override: ${override}` : ""}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
  }

  function moveTaskToReview(task: PitwallTask) {
    const timestamp = nowIso();
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "review", updatedAt: timestamp } : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          taskId: task.id,
          type: "system",
          message: `Review requested: ${task.title}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    setWorkspaceSection("review");
    track("task_reviewed");
  }

  function createContextEntry() {
    const title = draftContextTitle.trim() || "Project context";
    const content = draftContextContent.trim() || "Add the project fact, decision, constraint, or standard agents should receive.";
    const timestamp = nowIso();
    const entry: PitwallContextEntry = {
      id: makeId("ctx"),
      projectId: activeProject.id,
      title,
      category: draftContextCategory,
      content,
      visibility: "all-agents",
      priority: 75,
      providerIds: ["claude", "codex", "gemini", "grok"],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setPitwall((current) => ({
      ...current,
      contextEntries: [entry, ...current.contextEntries],
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          type: "system",
          message: `Context added: ${entry.title}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    setSelectedContextIds((current) => [entry.id, ...current]);
    setDraftContextTitle("Architecture note");
    setDraftContextContent("");
    setDraftContextCategory("decision");
    setCreateContextOpen(false);
  }


  function createHandoff(targetProvider: PitwallProviderId = "codex") {
    const task = activeTask;
    if (!task) return;

    setDraftTaskId(task.id);
    setDraftAgent(agentFromProviderId(targetProvider));
    setDraftSessionType(task.status === "review" ? "review" : "implementation");
    setCreateSessionOpen(true);
    appendActivity({
      projectId: activeProject.id,
      taskId: task.id,
      provider: targetProvider,
      type: "handoff-created",
      message: `Handoff prepared for ${getProviderLabel(targetProvider)}: ${task.title}`,
    });
  }

  function openCouncilSetup(mode: "council" | "compare" = "council") {
    // Council/Compare spin up their own agents, but still need a task to work on.
    // On a fresh project there's none yet, so define the task first, then flow
    // straight into the setup (see createProjectTask).
    if (!activeTask) {
      pendingActionRef.current = mode;
      setCreateTaskOpen(true);
      return;
    }
    setCouncilSetupMode(mode);
    setCouncilSetupOpen(true);
  }

  function openCreateSession() {
    if (!activeTask) {
      pendingActionRef.current = "session";
      setCreateTaskOpen(true);
      return;
    }
    setCreateSessionOpen(true);
  }

  function recordTaskStarted(task: PitwallTask, session: AgentSession) {
    const timestamp = nowIso();
    const provider = providerIdFromAgent(session.agent);
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id
          ? { ...item, status: "running", assignedAgent: provider, updatedAt: timestamp }
          : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          taskId: task.id,
          sessionId: session.id,
          provider,
          type: "task-started",
          message: `Task started in ${session.name}: ${task.title}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
  }

  async function prepareAgentPrompt(input: PrepareKnowledgeInput): Promise<string> {
    const manualEntries = contextForAgent(input.manualEntries ?? [], input.projectId ?? "", input.provider);
    const basePrompt = `${input.basePrompt}\n\n${KNOWLEDGE_CAPTURE_PROMPT}`;
    let prompt = withManualContext(basePrompt, manualEntries);
    let receipt: DeliveryReceipt | undefined;
    try {
      const result = await window.pitwall?.prepareProjectContext?.({ ...input, manualEntries, basePrompt });
      if (result?.ok && result.receipt) {
        prompt = result.prompt;
        receipt = result.receipt;
        setContextReceipts((current) => ({ ...current, [receipt!.id]: receipt! }));
      } else if (result && !result.ok) {
        setSystemNotice({ tone: "error", title: "Project memory could not be loaded", message: `${result.error || "The knowledge store is unavailable."} Selected context is still included; the agent will need to inspect the repository.` });
      }
    } catch (error) {
      setSystemNotice({ tone: "error", title: "Project memory could not be loaded", message: `${error instanceof Error ? error.message : "The knowledge store is unavailable."} Selected context is still included.` });
    }
    if (input.sessionId) {
      const prior = pitwallRef.current.sessions.find((session) => session.id === input.sessionId);
      const providerRestricted = Boolean(prior?.contextProviderRestricted || preparedContextRef.current[input.sessionId]?.providerRestricted || receipt?.providerRestricted) ||
        pitwallRef.current.contextSnapshots.some((snapshot) => snapshot.sessionId === input.sessionId && snapshot.receipt?.providerRestricted) ||
        manualEntries.some((entry) => entry.visibility === "selected-agents");
      preparedContextRef.current[input.sessionId] = { prompt, receipt, projectPath: input.projectPath, providerRestricted };
    }
    return prompt;
  }

  async function markPreparedContext(sessionId: string, prompt: string, status: "delivered" | "failed") {
    const prepared = preparedContextRef.current[sessionId];
    if (prepared?.prompt === prompt && prepared.providerRestricted) {
      setPitwall((current) => ({ ...current, sessions: current.sessions.map((session) =>
        session.id === sessionId && !session.contextProviderRestricted ? { ...session, contextProviderRestricted: true } : session),
      }));
    }
    if (!prepared?.receipt || prepared.prompt !== prompt || prepared.receipt.status === "delivered") return;
    try {
      const result = await window.pitwall?.markContextReceipt?.({ projectPath: prepared.projectPath, id: prepared.receipt.id, status,
        ...(status === "failed" ? { error: "The agent transport did not accept this prompt." } : {}),
      });
      if (!result?.ok || !result.receipt) return;
      prepared.receipt = result.receipt;
      const receipt = result.receipt;
      setContextReceipts((current) => ({ ...current, [receipt.id]: receipt }));
      setPitwall((current) => ({ ...current, contextSnapshots: current.contextSnapshots.map((snapshot) =>
        snapshot.receipt?.id === receipt.id ? { ...snapshot, receipt } : snapshot),
      }));
    } catch { /* The saved prepared receipt remains honest when persistence fails. */ }
  }

  async function prepareCouncilMemberPrompt(runId: string, member: CouncilRelayMember, basePrompt: string) {
    const run = relayRunRef.current[runId];
    if (!run) return basePrompt;
    const storedSession = pitwallRef.current.sessions.find((entry) => entry.id === member.sessionId);
    const project = sessionProjectRef.current[member.sessionId] ?? projectsRef.current.find((entry) =>
      entry.id === storedSession?.projectId || entry.path === run.projectRoot || entry.sessions.some((session) => session.id === member.sessionId));
    if (!project) return basePrompt;
    const task = pitwallRef.current.tasks.find((entry) => entry.id === (run.taskId ?? storedSession?.taskId))
      ?? taskBySessionRef.current[member.sessionId];
    const provider = providerIdFromAgent(relaySessionRef.current[member.sessionId]?.agent ?? member.agentLabel);
    return prepareAgentPrompt({
      projectPath: run.projectRoot ?? project.path, workspacePath: run.projectPath, projectId: project.id,
      taskId: run.taskId ?? task?.id, runId, sessionId: member.sessionId, task: task ?? run.task,
      role: run.verification?.pending ? "verification" : member.roleLabel, provider,
      manualEntries: pitwallRef.current.contextEntries.filter((entry) => entry.projectId === project.id &&
        (run.contextEntryIds === undefined || run.contextEntryIds.includes(entry.id))), basePrompt,
    });
  }

  async function rememberSessionKnowledge(sessionId: string, output: string, extra: KnowledgeObservation[] = [], author?: string) {
    const observations = [...parseKnowledgeObservations(output), ...extra];
    if (!observations.length || !window.pitwall?.rememberProjectKnowledge) return;
    const session = pitwallRef.current.sessions.find((item) => item.id === sessionId);
    const task = taskBySessionRef.current[sessionId] ?? pitwallRef.current.tasks.find((item) => item.id === session?.taskId);
    const project = projectsRef.current.find((item) => item.id === (task?.projectId ?? session?.projectId)) ?? sessionProjectRef.current[sessionId];
    if (!project || !task) return;
    const fingerprint = JSON.stringify(observations);
    if (capturedKnowledgeRef.current[sessionId] === fingerprint) return;
    const provider = session?.provider ?? providerIdFromAgent(sessionByIdRef.current[sessionId]?.agent ?? "");
    const restricted = session?.contextProviderRestricted || preparedContextRef.current[sessionId]?.providerRestricted ||
      pitwallRef.current.contextEntries.some((entry) => entry.projectId === project.id && entry.visibility === "selected-agents");
    try {
      const result = await window.pitwall.rememberProjectKnowledge({
        projectPath: project.path,
        workspacePath: session?.worktreePath ?? sessionByIdRef.current[sessionId]?.worktreePath ?? project.path,
        taskId: task.id, runId: relayRunIdBySessionRef.current[sessionId],
        observations: observations.map((observation) => ({ ...observation, ...(author ? { author } : {}), ...(restricted ? { providerIds: [provider] } : {}) })),
      });
      if (result.ok) {
        capturedKnowledgeRef.current[sessionId] = fingerprint;
        setKnowledgeRefresh((value) => value + 1);
        for (const warning of result.warnings ?? []) appendTerminalLine(sessionId, `Project memory: ${warning}`);
      }
      else appendTerminalLine(sessionId, `Project memory could not be saved: ${result.error || "unknown error"}`);
    } catch (error) { appendTerminalLine(sessionId, `Project memory could not be saved: ${error instanceof Error ? error.message : "unknown error"}`); }
  }

  /** A council member's long prompt goes into a file; what is typed is a pointer to it. */
  async function councilPromptForTerminal(sessionId: string, prompt: string) {
    const runId = relayRunIdBySessionRef.current[sessionId];
    const run = runId ? relayRunRef.current[runId] : undefined;
    const member = run?.members.find((item) => item.sessionId === sessionId);
    if (!run || !member || !run.projectPath) return prompt;
    const plan = planCouncilPromptDelivery({
      runId,
      turn: run.turn,
      memberId: member.memberId,
      stageFile: getTurnStageFile(runId, run.turn, member.memberId, Math.max(1, run.currentPanel?.length ?? 1)),
      prompt,
      stamp: Date.now(),
    });
    if (!plan) return prompt;
    const written = await window.pitwall?.writeProjectFile?.({ projectPath: run.projectPath, filePath: plan.filePath, content: plan.content })
      .catch(() => null);
    return written?.ok ? plan.pointer : prompt;
  }

  /** Sends a prompt to a session's terminal. False means it never landed. */
  async function sendTerminalPrompt(sessionId: string, prompt: string) {
    const write = window.pitwall?.writeTerminal;
    if (!write) { await markPreparedContext(sessionId, prompt, "failed"); return false; }
    if (preparedContextRef.current[sessionId]?.prompt === prompt) {
      knowledgeOutputRef.current[sessionId] = { parts: [], size: 0 };
      delete capturedKnowledgeRef.current[sessionId];
    }
    const sent = await submitTerminalPrompt(write, sessionId, await councilPromptForTerminal(sessionId, prompt));
    await markPreparedContext(sessionId, prompt, sent ? "delivered" : "failed");
    // Only a session that actually received something is running. Marking one
    // that did not would show a member as working while its pane is dead.
    if (sent) markSessionRunning(sessionId);
    return sent;
  }

  /**
   * Re-reads the trackers this project has already imported from.
   *
   * Only those sources: it never goes looking for boards nobody connected. New
   * tickets become tasks, and known ones have the fields the tracker owns
   * refreshed. It cannot move work — the board column, the agent and the
   * worktree stay Pitwall's, so a ticket closed upstream never pulls a running
   * task out from under a council.
   */
  async function syncTrackerSources(projectId: string, { manual = false }: { manual?: boolean } = {}) {
    if (!window.pitwall?.listMcpTasks) return;
    lastTrackerSyncRef.current[projectId] = Date.now();
    setTrackerSyncedAt((current) => ({ ...current, [projectId]: Date.now() }));
    const report = (message: string) =>
      appendActivity({ projectId, type: "system", message });
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    const tasks = pitwallRef.current.tasks.filter((task) => task.projectId === projectId);
    const sources = new Map<string, { provider: string; name: string; target: string }>();
    for (const task of tasks) {
      if (task.source?.kind !== "mcp" || !task.source.name) continue;
      const provider = task.source.provider || "claude";
      sources.set(mcpTaskSourceKey(provider, task.source.name), {
        provider,
        name: task.source.name,
        target: task.source.target || "",
      });
    }
    if (!sources.size) {
      if (manual) report("No tracker to re-read: no task here was imported from one.");
      return;
    }

    for (const source of sources.values()) {
      let result;
      try {
        result = await window.pitwall.listMcpTasks({
          projectId,
          projectPath: project.path,
          provider: source.provider,
          source: source.name,
          target: source.target,
        });
      } catch (cause) {
        report(summariseTrackerSync({ source, error: cause instanceof Error ? cause.message : "the request failed" }));
        continue;
      }
      // Every one of these used to be silent, which is what made a sync that
      // did nothing indistinguishable from one that never ran.
      if (!result?.ok) {
        report(summariseTrackerSync({ source, error: result?.error || "the source did not answer" }));
        continue;
      }
      if (!result.tasks?.length) {
        report(summariseTrackerSync({ source, candidates: 0 }));
        continue;
      }

      const current = pitwallRef.current.tasks.filter((task) => task.projectId === projectId);
      const plan = planTrackerSync({ tasks: current, candidates: result.tasks, source });
      if (!plan.added.length && !plan.updates.length) {
        // Only on request: a quiet board every half hour would bury the
        // timeline in lines saying nothing happened.
        if (manual) report(summariseTrackerSync({ source, candidates: result.tasks.length }));
        continue;
      }

      const timestamp = nowIso();
      const usedIdentifiers = new Set(current.map((task) => taskBranchName(task).toLowerCase()));
      const created = plan.added.map<PitwallTask>((candidate) => {
        const identifier = allocateImportedTaskIdentifier(candidate, usedIdentifiers);
        return {
          id: makeId("task"),
          identifier,
          projectId,
          title: candidate.title,
          description: trackerHtmlToMarkdown(candidate.description ?? "").trim() || "Imported from connected work.",
          status: mapExternalTaskStatus(candidate.status),
          priority: "medium",
          assignedAgent: "",
          relatedFiles: [],
          worktree: identifier,
          source: {
            kind: "mcp",
            name: source.name,
            provider: source.provider as PitwallProviderId,
            target: source.target,
            externalId: candidate.id,
            url: candidate.url,
            status: candidate.status,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });

      const patches = new Map(plan.updates.map((update) => [update.taskId, update.patch]));
      setPitwall((state) => ({
        ...state,
        tasks: [
          ...created,
          ...state.tasks.map((task) => {
            const patch = patches.get(task.id);
            return patch ? { ...task, ...patch, updatedAt: timestamp } : task;
          }),
        ],
        activity: [
          {
            id: makeId("activity"),
            projectId,
            type: "task-created",
            message: summariseTrackerSync({
              source,
              candidates: result.tasks.length,
              added: created.length,
              updated: plan.updates.length,
            }),
            createdAt: timestamp,
          },
          ...state.activity,
        ],
      }));
    }
  }

  /** Refreshes imported tracker data through Pitwall's audited read-only broker. */
  async function refreshTaskFromOrigin(task: PitwallTask) {
    if (task.source?.kind !== "mcp" || !task.source.name || !window.pitwall?.listMcpTasks) {
      return { task, refreshed: false, error: "" };
    }
    try {
      const result = await window.pitwall.listMcpTasks({
        projectId: task.projectId,
        projectPath: projectsRef.current.find((project) => project.id === task.projectId)?.path || activeProject.path,
        provider: task.source.provider || "claude",
        source: task.source.name,
        target: task.source.target || "",
        query: task.source.externalId || task.identifier || task.title,
      });
      if (!result.ok) return { task, refreshed: false, error: result.error || "The source did not return the task." };
      const candidate = result.tasks.find((item) =>
        (task.source?.externalId && item.id === task.source.externalId) ||
        (task.source?.url && item.url === task.source.url),
      ) ?? (result.tasks.length === 1 ? result.tasks[0] : undefined);
      if (!candidate) return { task, refreshed: false, error: "The imported work item was not present in the source response." };
      const refreshedTask: PitwallTask = {
        ...task,
        title: candidate.title || task.title,
        description: candidate.description?.trim() || task.description,
        status: candidate.status ? mapExternalTaskStatus(candidate.status) : task.status,
        source: {
          ...task.source,
          externalId: candidate.id || task.source.externalId,
          url: candidate.url || task.source.url,
          status: candidate.status || task.source.status,
        },
        updatedAt: candidate.updatedAt || nowIso(),
      };
      setPitwall((current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id ? refreshedTask : item),
      }));
      return { task: refreshedTask, refreshed: true, error: "" };
    } catch (cause) {
      return { task, refreshed: false, error: cause instanceof Error ? cause.message : "The source refresh failed." };
    }
  }

  async function prepareProjectTrust(projectPath: string, provider: string, autoApprove = false) {
    try {
      const result = await window.pitwall?.trustProject?.({ projectPath, provider, autoApprove });
      if (!result?.ok || !result.trusted) throw new Error(result?.error || result?.message || "Project trust could not be established.");
      return true;
    } catch (error) {
      setSystemNotice({ tone: "error", title: "Project trust could not be established", message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async function allocateTaskRuntime(task: PitwallTask, sessionId: string) {
    const previousTask = taskBySessionRef.current[sessionId];
    const cached = taskRuntimeBySessionRef.current[sessionId];
    taskBySessionRef.current[sessionId] = task;
    if (cached && previousTask?.id === task.id && previousTask.projectId === task.projectId) return cached;
    try {
      const result = await window.pitwall?.allocateTaskRuntime?.({
        projectId: task.projectId,
        taskId: task.id,
        taskIdentifier: task.identifier,
        taskTitle: task.title,
        sessionId,
      });
      if (!result?.ok || !result.previewPort || !result.mobileRuntimeId || !result.mobileDeviceName) {
        throw new Error(result?.error || "No isolated runtime could be allocated. Retry when a preview port is available.");
      }
      const runtime = {
        previewPort: result.previewPort,
        mobileRuntimeId: result.mobileRuntimeId,
        mobileDeviceName: result.mobileDeviceName,
      };
      taskRuntimeBySessionRef.current[sessionId] = runtime;
      return runtime;
    } catch (error) {
      setSystemNotice({ tone: "error", title: "Task runtime isolation unavailable", message: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }

  async function broadcastSessionMessage(message: string) {
    const recipients = activeBroadcastSessions;
    if (recipients.length < 2 || broadcastSending) return;
    setBroadcastSending(true);
    try {
      const results = await Promise.all(recipients.map(async (session) => {
        const wasAttached = Boolean(terminalAttachedRef.current[session.id]);
        const attached = wasAttached || await ensureAgentTerminal(session);
        if (!attached) return false;
        if (session.status === "starting" || !wasAttached) {
          const ready = await waitForSessionSettle(session.id);
          if (!ready) return false;
        }
        if (councilOutputLooksGated(session.id)) return false;
        return await sendTerminalPrompt(session.id, message);
      }));
      const sent = results.filter(Boolean).length;
      setBroadcastOpen(false);
      setSystemNotice(sent === recipients.length
        ? { tone: "info", title: "Message sent to every session", message: `${sent} sessions received the same instruction.` }
        : { tone: "error", title: "Message sent to some agents", message: `${sent} of ${recipients.length} sessions received it. Open the failed session terminals to reconnect them.` });
    } finally {
      setBroadcastSending(false);
    }
  }

  // Called on every keystroke typed into a terminal, so a session that is
  // already running must cost nothing: no new state, no render, no save.
  function markSessionRunning(sessionId: string) {
    setProjects((current) => {
      const index = current.findIndex((project) => project.sessions.some((session) => session.id === sessionId && session.status !== "running"));
      if (index === -1) return current;
      const next = current.slice();
      next[index] = {
        ...current[index],
        sessions: current[index].sessions.map((session) => session.id === sessionId ? { ...session, status: "running" } : session),
      };
      return next;
    });
    setPitwall((current) => {
      if (!current.sessions.some((session) => session.id === sessionId && session.status !== "running")) return current;
      const timestamp = nowIso();
      return {
        ...current,
        sessions: current.sessions.map((session) => session.id === sessionId
          ? { ...session, status: "running", updatedAt: timestamp }
          : session),
      };
    });
  }

  /** Settles the rail's and the workspace's records alike, writing nothing when nothing changed. */
  function settleSessionRecords(settle: (session: { id: string; status: SessionStatus }) => SessionStatus | null) {
    setProjects((current) => {
      let changed = false;
      const next = current.map((project) => {
        const sessions = settleSessions(project.sessions, settle);
        if (sessions === project.sessions) return project;
        changed = true;
        return { ...project, sessions };
      });
      return changed ? next : current;
    });
    setPitwall((current) => {
      const sessions = settleSessions(current.sessions, settle, { updatedAt: nowIso() });
      return sessions === current.sessions ? current : { ...current, sessions };
    });
  }

  function settleClosedSession(sessionId: string, closure: TerminalClosure) {
    settleSessionRecords((session) => session.id === sessionId ? statusAfterTerminalClosed(session.status, closure) : null);
  }

  /** Nothing is live without a terminal, whatever the stored record says. */
  function settleOrphanedRecords(liveTerminals: string[]) {
    const live = new Set(liveTerminals);
    const hasTerminal = (sessionId: string) =>
      live.has(sessionId) || Boolean(terminalAttachedRef.current[sessionId] || attachingTerminalRef.current[sessionId]);
    settleSessionRecords((session) => statusWithoutTerminal(session, hasTerminal));
  }

  async function startTaskInSession(task: PitwallTask, session: AgentSession) {
    if (!licence.canStartWork) {
      track("licence_required");
      setLicenceOpen(true);
      return;
    }
    setStartingTaskId(task.id);
    try {
      const taskRuntime = await allocateTaskRuntime(task, session.id);
      if (!taskRuntime) return;
      setWorkspaceSection("work");
      setSelectedSessionId(session.id);
      setWorkbenchTab("terminal");
      const attached = terminalAttachedBySession[session.id] || (await ensureAgentTerminal(session));
      if (!attached) {
        appendTerminalLine(session.id, `${session.agent} CLI could not attach — task was not sent`);
        return;
      }
      const ready = await waitForSessionSettle(session.id);
      if (!ready) {
        appendTerminalLine(session.id, "Agent input did not become ready — the task was not sent.");
        return;
      }
      if (councilOutputLooksGated(session.id)) {
        appendTerminalLine(session.id, "Sign-in or approval is required before this task can be sent.");
        return;
      }
      const origin = await refreshTaskFromOrigin(task);
      if (origin.error) appendTerminalLine(session.id, `Tracker refresh unavailable: ${origin.error}`);
      const sessionType = pitwall.sessions.find((item) => item.id === session.id)?.type;
      const basePrompt = formatTaskLaunchPrompt(origin.task, {
        startDevServer: sessionType ? roleWritesCode[sessionType] : true,
        originRefreshed: origin.refreshed,
        runtime: taskRuntime,
        // A council's members read each other's summaries; it is how the work
        // is handed on.
        wantsSummary: true,
      });
      const project = projectsRef.current.find((entry) => entry.id === task.projectId) ?? activeProject;
      const prepared = await prepareAgentPrompt({ projectPath: project.path, workspacePath: session.worktreePath ?? project.path,
        projectId: project.id, taskId: task.id, sessionId: session.id, task: origin.task, provider: providerIdFromAgent(session.agent),
        role: sessionType ?? "implementation", manualEntries: pitwallRef.current.contextEntries.filter((entry) => entry.projectId === project.id), basePrompt });
      const sent = await sendTerminalPrompt(session.id, prepared);
      if (sent) {
        recordTaskStarted(origin.task, session);
        setStartTaskOpen(false);
      }
    } finally {
      setStartingTaskId("");
    }
  }

  function chooseTaskDestination(destination: TaskStartDestination) {
    const task = activeTask;
    if (!task) return;

    if (destination === "staged") {
      pendingTaskStartRef.current = null;
      setStartTaskOpen(false);
      void startStagedRun(task);
      return;
    }

    if (destination === "council") {
      pendingTaskStartRef.current = null;
      setStartTaskOpen(false);
      setCouncilSetupMode("council");
      setCouncilSetupOpen(true);
      return;
    }

    if (destination === "new-session") {
      pendingTaskStartRef.current = task.id;
      setDraftTaskId(task.id);
      setDraftSessionType("implementation");
      if (task.assignedAgent && task.assignedAgent !== "council") {
        selectDraftAgent(agentFromProviderId(task.assignedAgent));
      }
      setStartTaskOpen(false);
      setCreateSessionOpen(true);
      return;
    }

    const sessionId = destination.slice("session:".length);
    const session = regularSessions.find((item) => item.id === sessionId);
    if (session) void startTaskInSession(task, session);
  }

  async function startCouncilMode(
    members?: CouncilMember[],
    mode: "council" | "compare" = "council",
    overrides?: { project?: Project; task?: PitwallTask; contextEntries?: PitwallContextEntry[] },
    conductor?: { enabled: boolean; agent: string; model: string; runTests?: boolean; openingDebate?: boolean; autoApprove?: boolean; maxTurns?: number | null },
  ) {
    if (!licence.canStartWork) {
      track("licence_required");
      setLicenceOpen(true);
      return;
    }
    const conductorConfig = conductor ?? DEFAULT_COUNCIL_CONDUCTOR;
    // A council normally runs against the current selection. The new-project flow
    // starts one for a project and task that React state has not caught up with
    // yet, so all three can be handed in explicitly.
    const councilProject = overrides?.project ?? activeProject;
    const task = overrides?.task ?? activeTask;
    const councilContextEntries = overrides?.contextEntries ?? projectContextEntries.filter((entry) => selectedContextIds.includes(entry.id));
    if (!task || !councilProject.id) return;

    const timestamp = nowIso();
    const runId = makeId("council");
    // Two events rather than one with a mode property: a council and a compare
    // are different products to the person running them, and asking "how many
    // councils" should not mean remembering to filter.
    track(mode === "compare" ? "compare_started" : "council_started", { mode });
    const prompt = `${task.title}\n\n${task.description || ""}`.trim();
    const councilBranch = taskBranchName(task);
    const councilWorktree = await window.pitwall?.ensureWorktree?.({
      projectPath: councilProject.path,
      branch: councilBranch,
      baseBranch: councilProject.branch || "HEAD",
    }).catch((error: unknown) => ({ ok: false, path: undefined, error: error instanceof Error ? error.message : String(error) }));
    if (!councilWorktree?.ok || !councilWorktree.path) {
      setSystemNotice({
        tone: "error",
        title: "Could not create an isolated checkout",
        message: councilWorktree?.error || "Worktree creation is unavailable. Resolve the Git error and retry the council.",
      });
      return;
    }
    const councilProjectPath = councilWorktree.path;
    const taskBriefPath = getCouncilTaskBriefPath(runId);
    const briefResult = await window.pitwall?.writeProjectFile?.({
      projectPath: councilProjectPath,
      filePath: taskBriefPath,
      content: buildCouncilTaskBrief(task),
    });
    const deliveredTaskPrompt = briefResult?.ok
      ? formatCouncilTaskFilePrompt(taskBriefPath)
      : prompt;

    // Explicit members, else one of every installed provider (implementation role).
    const implementers = providerRegistry.filter((provider) => canImplement(provider.agent));
    const availableProviders = implementers.filter(
      (provider) => agentChecks[provider.agent]?.status !== "missing",
    );
    const councilMembers: CouncilMember[] =
      members && members.length > 0
        ? members
        : (availableProviders.length > 0 ? availableProviders : implementers).map((provider) => ({
            agent: provider.agent,
            model: providerOptions.find((option) => option.agent === provider.agent)?.models[0]?.label ?? "Auto",
            role: "implementation" as PitwallSessionType,
          }));
    // Number members that reuse the same agent so their panes stay distinguishable.
    const providerTotals: Record<string, number> = {};
    councilMembers.forEach((member) => {
      providerTotals[member.agent] = (providerTotals[member.agent] ?? 0) + 1;
    });
    const providerSeen: Record<string, number> = {};

    const built = councilMembers.map((member, index) => {
      // Resolved from every agent a session can start with, not only the
      // first-class providers. Looking a member up in the provider registry
      // silently dropped local models and agents you added yourself, which is
      // why they could be chosen nowhere and appeared in no council.
      const option = agentOptions.find((item) => item.agent === member.agent);
      if (!option) return null;
      const agent = option.agent;
      // The model the user picked for this seat, not the first one going.
      const model = member.model || option.models[0]?.label || "Auto";
      const providerId = providerIdFromAgent(agent);
      // Compare = every agent answers the same task independently (no role).
      // Council = each member takes its assigned role.
      const roleType: PitwallSessionType = mode === "compare" ? "implementation" : member.role;
      const role = getRole(roleType);
      providerSeen[member.agent] = (providerSeen[member.agent] ?? 0) + 1;
      const dupSuffix = providerTotals[member.agent] > 1 ? ` ${providerSeen[member.agent]}` : "";
      const roleLabel = mode === "compare" ? "Compare" : role.label;
      const agentLabel = `${agent}${dupSuffix}`;
      const injected = mode === "compare" ? deliveredTaskPrompt : `${role.systemPrompt} ${deliveredTaskPrompt}`;
      const sessionId = `${mode}-${providerId}-${councilProject.id}-${Date.now()}-${index}`;
      const nativeSessionId = createNativeSessionId(agent);
      const snapshot = makeContextSnapshot({
        projectId: councilProject.id,
        task,
        sessionId,
        provider: providerId,
        model,
        contextEntries: contextForAgent(councilContextEntries, councilProject.id, providerId),
      });
      const agentSession: AgentSession = {
        id: sessionId,
        name: formatCouncilMemberName(roleLabel, agentLabel),
        agent,
        status: "running",
        model,
        branch: councilBranch,
        worktreePath: councilWorktree?.ok ? councilWorktree.path : undefined,
        nativeSessionId,
        nativeSessionStarted: false,
        ...(() => {
          const launch = resolveAgentLaunch(option, model);
          return { launchCommand: launch.command, launchArgs: launch.args };
        })(),
        // Recorded per member rather than read off the run: a member restarted
        // or swapped in on turn twelve has to come back in the mode the
        // council was started in, or the relay stops on the one pane that
        // reverted to asking.
        autoApprove: Boolean(conductorConfig.autoApprove) && supportsAutoApprove(option.command),
        task: task.title,
        progress: 5,
        tokens: "0",
        approvals: 0,
        risk: "low",
        files: 0,
        started: "now",
        logs: [`${roleLabel} session for ${task.title}`],
      };
      const pitwallSession: PitwallSession = {
        id: sessionId,
        projectId: councilProject.id,
        provider: providerId,
        taskId: task.id,
        type: roleType,
        status: "running",
        model,
        worktreePath: councilWorktree?.ok ? councilWorktree.path : undefined,
        nativeSessionId,
        nativeSessionStarted: false,
        messages: [{ role: "system", content: `${roleLabel}: "${task.title}"`, createdAt: timestamp }],
        contextSnapshotId: snapshot.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      sessionProjectRef.current[sessionId] = councilProject;
      return { providerId, agent, model, sessionId, snapshot, agentSession, pitwallSession, injected };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const trusted = await Promise.all(built.map((item) => prepareProjectTrust(councilProjectPath, item.providerId, Boolean(item.agentSession.autoApprove))));
    if (trusted.some((ok) => !ok) || !built.length) return;
    const runtime = await allocateTaskRuntime(task, built[0].sessionId);
    if (!runtime) return;
    for (const item of built) {
      taskRuntimeBySessionRef.current[item.sessionId] = runtime;
      taskBySessionRef.current[item.sessionId] = task;
    }

    // Council mode runs as a file-backed relay, but not a carousel: after every
    // handoff a conductor reads the whole thread and decides who speaks next and
    // what they should do, so the council converses (implementer -> architect ->
    // qa -> implementer -> qa) instead of taking fixed turns. It runs until a
    // member signals completion, the conductor calls it done, the turn cap is
    // hit, or the user stops it. Every turn writes a new numbered file, which is
    // what lets the watcher tell a fresh handoff from the one it already acted on.
    // Compare stays parallel + independent (no relay).
    const relay = mode === "council" && built.length > 1;
    if (relay) {
      const handles: string[] = [];
      const members: CouncilRelayMember[] = built.map((item) => {
        const role = getRole(item.pitwallSession.type);
        const memberId = makeCouncilMemberId(roleKeys[item.pitwallSession.type], item.agent, handles);
        handles.push(memberId);
        return {
          sessionId: item.sessionId,
          memberId,
          rolePrompt: role.systemPrompt,
          roleLabel: role.label,
          agentLabel: item.agent,
          writesCode: roleWritesCode[item.pitwallSession.type],
        };
      });
      relayRunRef.current[runId] = {
        runId,
        projectPath: councilProjectPath,
        projectRoot: councilProject.path,
        taskId: task.id,
        taskPrompt: deliveredTaskPrompt,
        contextEntryIds: councilContextEntries.map((entry) => entry.id),
        task: { title: task.title, description: task.description },
        members,
        turn: 1,
        auto: true,
        stopped: false,
        conductor: conductorConfig,
        directives: [],
        maxTurns: normalizeTurnLimit(conductorConfig.maxTurns ?? MAX_RELAY_TURNS),
        messages: [],
        history: [],
        currentMemberId: members[0].memberId,
        routes: [],
        repoSnapshot: {},
        evidence: null,
        nudgedTurns: [],
        reroutedTurns: [],
        currentPanel: [members[0]],
        conductorCostUsd: 0,
        treeHistory: [],
        lessons: [],
        workingSet: emptyWorkingSet(),
        startedAt: timestamp,
      };
      void resolveRelayTestCommand(runId);
      await loadCouncilLessons(runId);
      built.forEach((item) => {
        relaySessionRef.current[item.sessionId] = item.agentSession;
        relayRunIdBySessionRef.current[item.sessionId] = runId;
      });
      // A council decides how to work before it works.
      //
      // Turn 1 used to hand the task straight to the first member, which let
      // whoever happened to be first set the approach for everyone — the rest
      // of the roster then inherited it as something already half-built. The
      // opening debate spends the first round asking each member how it would
      // approach the task instead, which is the only point where disagreeing is
      // cheap. It is skipped for a one-member council and when the user turned
      // it off, and in both cases turn 1 is the working turn it always was.
      const opening = conductorConfig.openingDebate === false
        ? null
        : openOpeningDebate({ taskPrompt: deliveredTaskPrompt, memberIds: members.map((member) => member.memberId) });
      relayRunRef.current[runId].debate = opening;

      // Turn 1 is injected on boot below; later turns are driven by beginRelayTurn.
      const firstPrompt = opening
        ? buildOpeningDebatePrompt({
            taskPrompt: deliveredTaskPrompt,
            member: members[0],
            others: members.slice(1),
            threadFile: getCouncilThreadFile(runId),
            stanceFile: getCouncilStageFile(runId, 1),
          })
        : buildCouncilRelayTurn({
            runId,
            taskPrompt: deliveredTaskPrompt,
            member: members[0],
            members,
            turn: 1,
            isCycle: false,
          }).prompt;
      built[0].injected = `${firstPrompt}${formatLessonsPrompt(relayRunRef.current[runId].lessons, getCouncilLessonsPath())}`;
      relayRunRef.current[runId].currentPrompt = built[0].injected;
      setRelayBySession((current) => ({
        ...current,
        ...Object.fromEntries(
          built.map((item, index) => [
            item.sessionId,
            { state: index === 0 ? ("active" as const) : ("waiting" as const), turn: index === 0 ? 1 : 0, canHandoff: index === 0 },
          ]),
        ),
      }));
      setRelayRunState((current) => ({
        ...current,
        [runId]: {
          turn: 1,
          auto: true,
          note: "",
          config: {
            enabled: conductorConfig.enabled,
            model: conductorConfig.model,
            runTests: Boolean(conductorConfig.runTests),
            maxTurns: relayRunRef.current[runId].maxTurns,
          },
        },
      }));
    }

    for (const item of built) {
      // The first relay member and independent compare members receive work now.
      if (relay && item !== built[0]) continue;
      const manualEntries = contextForAgent(councilContextEntries, councilProject.id, item.providerId);
      item.injected = await prepareAgentPrompt({ projectPath: councilProject.path, workspacePath: councilProjectPath,
        projectId: councilProject.id, taskId: task.id, runId, sessionId: item.sessionId, task,
        role: item.pitwallSession.type, provider: item.providerId, manualEntries, basePrompt: item.injected });
      item.snapshot.receipt = preparedContextRef.current[item.sessionId]?.receipt;
      if (relay) relayRunRef.current[runId].currentPrompt = item.injected;
    }

    const councilRun: PitwallCouncilRun = {
      id: runId,
      name: formatCouncilRunName(task.title, mode),
      projectId: councilProject.id,
      taskId: task.id,
      prompt,
      providerIds: built.map((item) => item.providerId),
      synthesizer: "claude",
      status: "running",
      responses: built.map((item) => ({ provider: item.providerId, sessionId: item.sessionId, status: "running" as const })),
      createdAt: timestamp,
    };

    setProjects((current) =>
      current.map((project) =>
        project.id === councilProject.id
          ? {
              ...project,
              openSessions: project.sessions.length + built.length,
              timeline: [
                `${mode === "compare" ? "Compare" : "Council"} started: ${task.title}`,
                ...project.timeline.slice(0, 5),
              ],
              sessions: [...project.sessions, ...built.map((item) => item.agentSession)],
            }
          : project,
      ),
    );
    setPitwall((current) => ({
      ...current,
      sessions: [...built.map((item) => item.pitwallSession), ...current.sessions],
      contextSnapshots: [...built.map((item) => item.snapshot), ...current.contextSnapshots],
      councilRuns: [councilRun, ...current.councilRuns],
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "running", updatedAt: timestamp } : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: councilProject.id,
          taskId: task.id,
          type: mode === "compare" ? "compare-started" : "council-started",
          message:
            mode === "compare"
              ? `Compare Responses: ${built.length} agents answering "${task.title}" independently`
              : `Council Mode: ${built.length} agents working on "${task.title}"`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));

    updateTerminalLines((current) => {
      const next = { ...current };
      for (const item of built) {
        next[item.sessionId] = terminalNotices([
          `$ ${getBootCommand(agentOptions, item.agent, item.model) || item.agent}`,
          `cwd ${councilProjectPath}`,
          `branch ${councilBranch}`,
          `council task: ${task.title}`,
        ]);
      }
      return next;
    });

    setActiveCouncilRunId(runId);
    setActiveCouncilMode(mode);
    setWorkspaceSection("work");
    setWorkbenchTab("council");
    setSelectedSessionId(built[0]?.sessionId ?? "");

    // Boot every PTY in parallel. For each: pre-trust the folder (kills the
    // "trust this folder?" dialog), wait for the CLI to settle, and only type
    // the task if the pane isn't sitting on a trust/sign-in gate.
    await Promise.all(
      built.map(async (item, index) => {
        const attached = await ensureAgentTerminal(item.agentSession);
        if (!attached) {
          setCouncilGate(item.sessionId, "CLI could not attach.");
          return;
        }
        await waitForSessionSettle(item.sessionId);
        // In a relay, downstream stages boot but idle until the upstream hands off.
        if (relay && index > 0) {
          setCouncilGate(item.sessionId, null);
          return;
        }
        if (councilOutputLooksGated(item.sessionId)) {
          setCouncilGate(
            item.sessionId,
            councilGateReason(
              item.sessionId,
              "This pane is waiting on you — a sign-in, a trust prompt, or the CLI offering to update itself. Answer it and the council starts by itself.",
            ),
          );
          // A first-turn trust prompt is the most common gate of all; waiting it
          // out means a council never needs a click to get going.
          if (relay && index === 0) void resumeWhenGateClears(runId, 1, item.sessionId, item.injected);
        } else {
          setCouncilGate(item.sessionId, null);
          await sendTerminalPrompt(item.sessionId, item.injected);
          if (relay && index === 0) void watchRelayTurn(runId, 1);
        }
      }),
    );
  }

  /**
   * Removes sessions from whatever relay they belong to. A relay needs at least
   * two members to pass work back and forth, so dropping below that ends it
   * rather than leaving a run handing off to itself.
   */
  function detachSessionsFromRelay(sessionIds: Iterable<string>) {
    const touchedRuns = new Set<string>();
    for (const sessionId of sessionIds) {
      const runId = relayRunIdBySessionRef.current[sessionId];
      if (runId) touchedRuns.add(runId);
      delete relayRunIdBySessionRef.current[sessionId];
      delete relaySessionRef.current[sessionId];
      const run = relayRunRef.current[runId];
      if (run) run.members = run.members.filter((member) => member.sessionId !== sessionId);
    }
    for (const runId of touchedRuns) {
      const run = relayRunRef.current[runId];
      if (!run) continue;
      if (run.members.length < 2) {
        stopRelay(runId, "Relay ended — fewer than two members remain.");
        delete relayRunRef.current[runId];
        delete relayWatchTokenRef.current[runId];
        setRelayRunState((current) => {
          const next = { ...current };
          delete next[runId];
          return next;
        });
      } else {
        // Cancel the in-flight watch; the member list changed underneath it.
        relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
      }
    }
  }

  /**
   * Puts a different agent in a council seat without ending the council.
   *
   * The roster was fixed at creation: giving QA to Claude and then wanting
   * Codex reading the code meant stopping the run and starting over, which
   * threw away the thread — every handoff and every decision argued out.
   *
   * The seat keeps its handle. `thread.md` already holds `TO: qa-claude` lines
   * that members have read and the conductor routes against, so the handle is
   * the seat's name and the agent is who currently answers to it; the roster
   * prints "`qa-claude` — Reviewer / QA (codex)" afterwards, which is the truth.
   * Renaming to `qa-codex` would leave every historical reference pointing at a
   * member no longer on the roster.
   */
  async function swapCouncilMember(sessionId: string, nextAgent: AgentProvider, nextModel: string) {
    const runId = relayRunIdBySessionRef.current[sessionId];
    const run = relayRunRef.current[runId];
    if (!run) {
      setCouncilGate(sessionId, "That pane is not part of a running council.");
      return;
    }
    const planned = planSwap(
      { members: run.members, currentMemberId: run.currentMemberId, turn: run.turn, stopped: run.stopped },
      { sessionId, agent: nextAgent, model: nextModel },
    );
    if (!planned.ok) {
      setCouncilGate(sessionId, planned.reason);
      return;
    }
    const plan = planned.plan;
    const option = agentOptions.find((item) => item.agent === nextAgent);
    if (!option) {
      setCouncilGate(sessionId, `${nextAgent} is not installed.`);
      return;
    }

    const outgoing = relaySessionRef.current[sessionId];
    // The seat's role, task and context belong to the seat, not to whoever was
    // sitting in it, so they are carried across rather than re-derived.
    const outgoingRecord = pitwallRef.current.sessions.find((item) => item.id === sessionId);
    const councilProject = sessionProjectRef.current[sessionId]
      ?? projectsRef.current.find((project) => project.id === outgoingRecord?.projectId) ?? activeProject;
    const projectPath = run.projectPath || councilProject.path;
    const model = nextModel || option.models[0]?.label || "Auto";
    const providerId = providerIdFromAgent(nextAgent);
    const timestamp = nowIso();

    // The watch in flight is reading for the outgoing agent's handoff file. It
    // has to be cancelled before the seat changes hands, or it closes the turn
    // on behalf of a member that is no longer there.
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;

    // Stop the outgoing CLI. Deliberately not detachSessionsFromRelay: that
    // drops the member from the roster, and below two members it ends the run —
    // which is the opposite of a swap.
    const stopped = await window.pitwall?.runSessionAction?.({
      projectId: councilProject.id,
      sessionId,
      action: "stop",
    });
    if (stopped && !stopped.ok) {
      setCouncilGate(sessionId, stopped.error || "The current agent could not be stopped for the swap.");
      if (run.auto && !run.stopped) void watchRelayTurn(runId, run.turn);
      return;
    }
    delete relaySessionRef.current[sessionId];
    delete relayRunIdBySessionRef.current[sessionId];

    const nextSessionId = `council-${providerId}-${councilProject.id}-${Date.now()}-swap`;
    const nativeSessionId = createNativeSessionId(nextAgent);
    const launch = resolveAgentLaunch(option, model);
    const agentSession: AgentSession = {
      ...(outgoing ?? ({} as AgentSession)),
      id: nextSessionId,
      name: formatCouncilMemberName(plan.member.roleLabel, nextAgent),
      agent: nextAgent,
      status: "running",
      model,
      branch: outgoing?.branch,
      worktreePath: outgoing?.worktreePath,
      nativeSessionId,
      nativeSessionStarted: false,
      launchCommand: launch.command,
      launchArgs: launch.args,
      // The seat's mode, not the outgoing agent's: a council started
      // unattended stays unattended, and an agent with no verified flag keeps
      // its prompts even when the seat it took over ran without them.
      autoApprove: Boolean(outgoing?.autoApprove) && supportsAutoApprove(option.command),
      progress: 5,
      tokens: "0",
      approvals: 0,
      files: 0,
      started: "now",
      logs: [`${plan.member.roleLabel} seat taken over from ${plan.fromAgent}`],
    };
    const pitwallSession: PitwallSession = {
      id: nextSessionId,
      projectId: councilProject.id,
      provider: providerId,
      taskId: run.taskId ?? outgoingRecord?.taskId ?? "",
      type: outgoingRecord?.type ?? "implementation",
      status: "running",
      model,
      worktreePath: outgoing?.worktreePath,
      nativeSessionId,
      nativeSessionStarted: false,
      messages: [{ role: "system", content: swapNotice(plan), createdAt: timestamp }],
      contextSnapshotId: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    sessionProjectRef.current[nextSessionId] = councilProject;
    const task = pitwallRef.current.tasks.find((item) => item.id === pitwallSession.taskId) ?? taskBySessionRef.current[sessionId];
    if (task) taskBySessionRef.current[nextSessionId] = task;
    if (taskRuntimeBySessionRef.current[sessionId]) taskRuntimeBySessionRef.current[nextSessionId] = taskRuntimeBySessionRef.current[sessionId];

    run.members = applySwap(run.members, plan, nextSessionId);
    // The panel is a list of member objects, not ids, so a stale entry would
    // keep the retired agent in the turn.
    run.currentPanel = (run.currentPanel ?? []).map(
      (member) => run.members.find((item) => item.memberId === member.memberId) ?? member,
    );
    run.messages = [...run.messages, swapMessage(plan, COUNCIL_USER_ID)];
    track("council_member_swapped", { role: roleKeys[outgoingRecord?.type ?? "implementation"], turns: run.turn });
    relaySessionRef.current[nextSessionId] = agentSession;
    relayRunIdBySessionRef.current[nextSessionId] = runId;
    persistRelayRun(runId);
    await writeRelayThread(runId);

    setRelayBySession((current) => {
      const next = { ...current };
      const previous = next[sessionId];
      delete next[sessionId];
      next[nextSessionId] = plan.holdsTurn
        ? { state: "active", turn: run.turn, canHandoff: true }
        : { state: "waiting", turn: previous?.turn ?? 0, canHandoff: false };
      return next;
    });
    setCouncilGate(sessionId, null);

    setProjects((current) =>
      current.map((project) =>
        project.id === councilProject.id
          ? {
              ...project,
              sessions: project.sessions.map((item) => (item.id === sessionId ? agentSession : item)),
              timeline: [
                `${plan.member.roleLabel}: ${plan.fromAgent} → ${nextAgent}`,
                ...project.timeline.slice(0, 5),
              ],
            }
          : project,
      ),
    );
    setPitwall((current) => ({
      ...current,
      sessions: [
        pitwallSession,
        ...current.sessions.map((item) =>
          item.id === sessionId ? { ...item, status: "completed" as const, updatedAt: timestamp } : item,
        ),
      ],
      // The grid renders one pane per response, so the seat's pane follows the
      // session that now holds it.
      councilRuns: current.councilRuns.map((item) =>
        item.id === runId
          ? {
              ...item,
              providerIds: item.providerIds.map((id, index) =>
                item.responses[index]?.sessionId === sessionId ? providerId : id,
              ),
              responses: item.responses.map((response) =>
                response.sessionId === sessionId
                  ? { ...response, provider: providerId, sessionId: nextSessionId, status: "running" as const }
                  : response,
              ),
            }
          : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: councilProject.id,
          taskId: outgoingRecord?.taskId,
          sessionId: nextSessionId,
          provider: providerId,
          type: "system",
          message: `${plan.member.roleLabel} seat: ${plan.fromAgent} → ${nextAgent}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    setSelectedSessionId(nextSessionId);
    updateTerminalLines((current) => {
      const next = { ...current };
      delete next[sessionId];
      next[nextSessionId] = terminalNotices([
        `$ ${getBootCommand(agentOptions, nextAgent, model) || nextAgent}`,
        `cwd ${projectPath}`,
        `${plan.member.roleLabel} seat, taken over from ${plan.fromAgent}`,
      ]);
      return next;
    });

    const prompt = plan.holdsTurn ? await prepareCouncilSessionPrompt(runId, agentSession) : null;
    await window.pitwall?.trustProject?.({
      projectPath,
      provider: providerId,
      autoApprove: Boolean(agentSession.autoApprove),
    });
    // The watch was cancelled above; every way out that sends no prompt has to
    // restart it, or the member holding the turn hands off to nobody.
    const keepWatching = () => {
      if (run.auto && !run.stopped) void watchRelayTurn(runId, run.turn);
    };
    const attached = await ensureAgentTerminal(agentSession);
    if (!attached) {
      setCouncilGate(nextSessionId, "CLI could not attach.");
      keepWatching();
      return;
    }
    await waitForSessionSettle(nextSessionId);

    // A replacement that does not hold the turn just idles until it is routed
    // to, exactly as a member booted at the start of a relay does.
    if (!plan.holdsTurn) {
      setCouncilGate(nextSessionId, null);
      keepWatching();
      return;
    }
    if (!prompt) {
      setCouncilGate(nextSessionId, "The council assignment could not be prepared. Send task to retry.");
      keepWatching();
      return;
    }
    if (councilOutputLooksGated(nextSessionId)) {
      setCouncilGate(
        nextSessionId,
        councilGateReason(
          nextSessionId,
          "This pane is waiting on you — a sign-in, a trust prompt, or the CLI offering to update itself. Answer it and the council carries on by itself.",
        ),
      );
      void resumeWhenGateClears(runId, run.turn, nextSessionId, prompt);
      return;
    }
    setCouncilGate(nextSessionId, null);
    await sendTerminalPrompt(nextSessionId, prompt);
    void watchRelayTurn(runId, run.turn);
  }

  /**
   * Hands a solo session to another agent: the same session and worktree, a
   * new CLI driving it. The outgoing agent is stopped first so its last turn is
   * on disk, then its conversation goes into a handoff file the new one reads.
   */
  async function swapSessionAgent(session: AgentSession, nextAgent: AgentProvider, nextModel: string) {
    const refusal = swapRefusal({
      fromAgent: session.agent,
      fromModel: session.model,
      toAgent: nextAgent,
      toModel: nextModel,
      inCouncil: councilSessionIds.has(session.id) || Boolean(relayRunIdBySessionRef.current[session.id]),
    });
    const option = agentOptions.find((item) => item.agent === nextAgent);
    if (refusal || !option) {
      setSystemNotice({ tone: "error", title: "Could not swap the agent", message: refusal ?? `${nextAgent} is not installed.` });
      return;
    }
    const ownerProject = sessionProjectRef.current[session.id]
      ?? projectsRef.current.find((project) => project.sessions.some((item) => item.id === session.id)) ?? activeProject;
    const workspacePath = await sessionWorkspace(session, ownerProject);
    const record = pitwallRef.current.sessions.find((item) => item.id === session.id);
    const task = (record?.taskId ? pitwallRef.current.tasks.find((item) => item.id === record.taskId) : undefined)
      ?? taskBySessionRef.current[session.id];

    if (terminalAttachedRef.current[session.id]) {
      const detached = await window.pitwall?.detachTerminal?.(session.id);
      if (detached && !detached.ok) {
        setSystemNotice({ tone: "error", title: "Could not swap the agent", message: `${session.agent} could not be stopped.` });
        return;
      }
    }
    terminalAttachedRef.current[session.id] = false;
    setTerminalAttachedBySession((current) => ({ ...current, [session.id]: false }));
    delete terminalInitialPromptRef.current[session.id];

    const handoff = await window.pitwall?.writeSessionHandoff?.({
      cwd: workspacePath,
      fromAgent: session.agent,
      toAgent: nextAgent,
      nativeSessionId: session.nativeSessionId,
      task: task ? { identifier: task.identifier, title: task.title, description: task.description } : undefined,
    });

    const model = nextModel || option.models[0]?.label || "Auto";
    const launch = resolveAgentLaunch(option, model);
    const providerId = providerIdFromAgent(nextAgent);
    const nativeSessionId = createNativeSessionId(nextAgent);
    const timestamp = nowIso();
    const nextSession: AgentSession = {
      ...session,
      name: swappedSessionName(session.name, session.agent, nextAgent),
      agent: nextAgent,
      model,
      status: "running",
      nativeSessionId,
      nativeSessionStarted: false,
      launchCommand: launch.command,
      launchArgs: launch.args,
      autoApprove: Boolean(session.autoApprove) && supportsAutoApprove(option.command),
    };
    sessionProjectRef.current[session.id] = ownerProject;
    setProjects((current) => current.map((project) => project.id === ownerProject.id
      ? { ...project, sessions: project.sessions.map((item) => (item.id === session.id ? nextSession : item)) }
      : project));
    setPitwall((current) => ({
      ...current,
      sessions: current.sessions.map((item) => item.id === session.id
        ? { ...item, provider: providerId, model, nativeSessionId, nativeSessionStarted: false, status: "running" as const, updatedAt: timestamp }
        : item),
      activity: [
        {
          id: makeId("activity"),
          projectId: ownerProject.id,
          taskId: record?.taskId,
          sessionId: session.id,
          provider: providerId,
          type: "system",
          message: `Session handed from ${session.agent} to ${nextAgent}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    appendTerminalLine(session.id, handoffDivider(session.agent, nextAgent), { informational: true });
    if (!handoff?.ok) appendTerminalLine(session.id, `The handoff file could not be written: ${handoff?.error ?? "unknown error"}`);
    track("session_agent_swapped", { from: session.agent.toLowerCase(), to: nextAgent.toLowerCase() });

    await window.pitwall?.trustProject?.({ projectPath: workspacePath, provider: providerId, autoApprove: Boolean(nextSession.autoApprove) });
    const attached = await ensureAgentTerminal(nextSession, { resume: false });
    if (!attached) return;
    if (!(await waitForSessionSettle(session.id))) {
      appendTerminalLine(session.id, `${nextAgent} did not become ready — the handoff was not sent.`);
      return;
    }
    if (councilOutputLooksGated(session.id)) {
      appendTerminalLine(session.id, `${nextAgent} needs a sign-in or approval first. Answer it, then tell it to read the handoff.`);
      return;
    }
    await sendTerminalPrompt(session.id, handoffPrompt(session.agent, handoff?.ok ? handoff.file ?? null : null));
  }

  /**
   * Puts a reviewer on a session that is already running: the same pair a
   * session started with a reviewer has. A session with no task gets a small
   * one named after it, because a review's verdict lands on a task in Review.
   */
  async function attachReviewer(session: AgentSession, choice: { reviewer: PairReviewer; model: string; rounds: number; now: boolean }) {
    const ownerProject = sessionProjectRef.current[session.id]
      ?? projectsRef.current.find((project) => project.sessions.some((item) => item.id === session.id)) ?? activeProject;
    const record = pitwallRef.current.sessions.find((item) => item.id === session.id);
    const timestamp = nowIso();
    const existing = record?.taskId ? pitwallRef.current.tasks.find((item) => item.id === record.taskId) : undefined;
    const pair: PitwallTaskPair = { reviewer: choice.reviewer, ...(choice.model ? { model: choice.model } : {}), maxRounds: choice.rounds, round: 0, state: "implementing" };
    const task: PitwallTask = existing
      ? { ...existing, pair, status: existing.status === "completed" || existing.status === "review" ? "running" : existing.status, updatedAt: timestamp }
      : {
          id: makeId("task"),
          projectId: ownerProject.id,
          title: session.name,
          description: `The work done in the session "${session.name}".`,
          status: "running",
          priority: "medium",
          assignedAgent: providerIdFromAgent(session.agent),
          relatedFiles: [],
          worktree: session.branch || "",
          pair,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
    taskBySessionRef.current[session.id] = task;
    setPitwall((current) => ({
      ...current,
      tasks: existing ? current.tasks.map((item) => (item.id === task.id ? task : item)) : [task, ...current.tasks],
      sessions: record
        ? current.sessions.map((item) => (item.id === session.id ? { ...item, taskId: task.id } : item))
        : [{ id: session.id, projectId: ownerProject.id, provider: providerIdFromAgent(session.agent), taskId: task.id, type: "implementation", status: "running", model: session.model, contextSnapshotId: "", messages: [], createdAt: timestamp, updatedAt: timestamp } as PitwallSession, ...current.sessions],
    }));
    track("pair_started", { agent: choice.reviewer, turns: choice.rounds });
    if (!choice.now) return;
    const worktreePath = session.worktreePath || (await sessionWorkspace(session, ownerProject));
    void runPairReview(task.id, session.id, worktreePath, ownerProject, { pair, task });
  }

  /** Takes the reviewer off a session; what it already said stays on the task. */
  function detachReviewer(session: AgentSession) {
    const taskId = pitwallRef.current.sessions.find((item) => item.id === session.id)?.taskId;
    const task = taskId ? pitwallRef.current.tasks.find((item) => item.id === taskId) : undefined;
    if (!task?.pair) return;
    if (task.pair.reviewerSessionId) {
      void window.pitwall?.detachTerminal?.(task.pair.reviewerSessionId);
      terminalAttachedRef.current[task.pair.reviewerSessionId] = false;
    }
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, pair: undefined, updatedAt: nowIso() } : item)),
    }));
  }

  /** Ends automatic advancement for a run and explains why in the council bar. */
  /**
   * Halts the relay and says why.
   *
   * `tone` exists because every reason for stopping looked identical: a council
   * that had finished the work showed the same amber bar behind the same
   * warning triangle as one that had run out of turns or lost a member. The
   * most common outcome — it worked — was presented as a problem, and there was
   * nothing anywhere else on the screen to say otherwise.
   */
  function stopRelay(
    runId: string,
    rawNote: string,
    options: { atTurnLimit?: boolean; atRunBudget?: boolean; awaitingStart?: boolean; tone?: "done" | "warn" | "attention" } = {},
  ) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    // Some notes are built from what an agent wrote — a verification verdict
    // lists every gap it found — and the bar that shows this is one line of
    // status, not a document. The whole verdict is in the thread.
    const note = summariseNote(rawNote);
    run.stopped = true;
    persistRelayRun(runId);
    // The shape of the whole run, at the only point where it is known: whether
    // it converged, how many turns that took, how many members, and whether it
    // was running unattended. "Did a council ever finish" was unanswerable.
    track(options.tone === "done" ? "council_finished" : "council_stopped", {
      outcome: options.tone === "done" ? "finished" : options.atTurnLimit ? "cancelled" : "stopped",
      turns: run.turn,
      members: run.members.length,
      auto_approve: run.members.some(
        (member) => relaySessionRef.current[member.sessionId]?.autoApprove === true,
      ),
      seconds: run.startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000))
        : 0,
    });
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? {}),
        turn: run.turn,
        auto: run.auto,
        note,
        tone: options.tone ?? "warn",
        stopped: true,
        finishedAt: options.tone === "done" ? nowIso() : undefined,
        atTurnLimit: Boolean(options.atTurnLimit),
        atRunBudget: Boolean(options.atRunBudget),
        awaitingStart: Boolean(options.awaitingStart),
      },
    }));
    // Nobody holds the baton once the relay stops, but the member that last had
    // it keeps its hand-off button so the user can push the loop on regardless.
    setRelayBySession((current) => {
      const next = { ...current };
      for (const member of run.members) {
        const existing = next[member.sessionId];
        if (existing?.state === "active") {
          next[member.sessionId] = { ...existing, state: "handed", canHandoff: true };
        }
      }
      return next;
    });
  }

  /**
   * Runs one turn: point the chosen member at the thread and the previous
   * handoff, send the prompt, and (when auto is on) start watching for the file
   * it writes. The member is chosen by the conductor and handed in; only a
   * manual hand-off with no routing behind it falls back to rotation.
   */
  async function beginRelayTurn(
    runId: string,
    turn: number,
    options: {
      manual?: boolean;
      route?: RelayRoute;
      from?: CouncilRelayMember;
      /** A debate turn asks a different question, but writes to the same
       *  handoff file, so the existing watcher picks it up unchanged. */
      promptOverride?: string;
    } = {},
  ) {
    const run = relayRunRef.current[runId];
    if (!run || !relayMayStartTurn(run)) return;
    if (!run.knowledgeHydrated) await loadCouncilLessons(runId);
    const member = options.route?.member ?? relayMemberForTurn(run.members, turn);
    if (!member) return;

    // The cap only gates automatic advancement — a manual hand-off is an
    // explicit instruction and always goes through.
    if (!isWithinTurnLimit(turn, run.maxTurns) && !options.manual) {
      run.pending = { turn, route: options.route, from: options.from };
      stopRelay(runId, formatTurnLimitNote(run.maxTurns), { atTurnLimit: true });
      return;
    }

    // Turns were capped and each turn was capped, but the run was not, so those
    // two ceilings multiplied into an afternoon nobody had chosen.
    if (!isWithinRunBudget(run.startedAt, Date.now(), run.runBudgetMs) && !options.manual) {
      run.pending = { turn, route: options.route, from: options.from };
      stopRelay(
        runId,
        `Paused after ${formatCouncilDuration(Date.now() - Date.parse(run.startedAt ?? new Date().toISOString()))} so a` +
          " long run does not keep going unwatched. Give it more time or hand off manually to continue.",
        { atTurnLimit: true, atRunBudget: true },
      );
      return;
    }
    run.pending = undefined;

    const panel = options.route?.panel?.length ? options.route.panel : [member];
    run.turn = turn;
    run.currentMemberId = member.memberId;
    run.currentPanel = panel;
    // The baseline for this turn's evidence. advanceRelay refreshes it after a
    // handoff, but a manual or resumed turn can start without one.
    if (Object.keys(run.repoSnapshot).length === 0) run.repoSnapshot = await snapshotRelayRepo(runId);
    const plan = buildCouncilRelayTurn({
      runId,
      taskPrompt: run.taskPrompt,
      member,
      members: run.members,
      turn,
      isCycle: turn > run.members.length,
      directive: options.route?.directive,
      from: options.from,
      evidence: run.evidence,
      panel,
      workingSet: run.workingSet,
      messages: run.messages,
      directives: run.directives,
    });
    run.currentAssignment = options.route?.directive || options.route?.reason || member.roleLabel;

    setRelayBySession((current) => {
      const next = { ...current };
      const active = new Set(panel.map((item) => item.sessionId));
      for (const item of run.members) {
        const existing = next[item.sessionId];
        next[item.sessionId] = active.has(item.sessionId)
          ? { state: "active", turn, canHandoff: true }
          : {
              state: existing?.state === "active" ? "handed" : existing?.state ?? "waiting",
              turn: existing?.turn ?? 0,
              canHandoff: false,
            };
      }
      return next;
    });
    // Keep whatever routing decision led here: this runs immediately after the
    // conductor recorded it, and a fresh object would drop it before it renders.
    setRelayRunState((current) => ({
      ...current,
      // `stopped` is cleared here rather than anywhere else: a turn starting is
      // the only thing that means the council is running again.
      [runId]: { ...(current[runId] ?? {}), turn, auto: run.auto, note: "", stopped: false, tone: undefined, awaitingStart: false },
    }));

    // Panel members are independent by construction — none of them writes code,
    // so they can be dispatched together rather than one after another.
    const dispatched = await Promise.all(
      panel.map(async (item) => {
        const itemPlan =
          item.memberId === member.memberId
            ? plan
            : buildCouncilRelayTurn({
                runId,
                taskPrompt: run.taskPrompt,
                member: item,
                members: run.members,
                turn,
                isCycle: turn > run.members.length,
                directive: options.route?.directive,
                from: options.from,
                evidence: run.evidence,
                panel,
                workingSet: run.workingSet,
                messages: run.messages,
                directives: run.directives,
              });
        const basePrompt = options.promptOverride ?? `${itemPlan.prompt}${formatLessonsPrompt(run.lessons, getCouncilLessonsPath())}`;
        const deliveredPrompt = await prepareCouncilMemberPrompt(runId, item, basePrompt);
        if (item.memberId === member.memberId) run.currentPrompt = deliveredPrompt;
        const session = relaySessionRef.current[item.sessionId];
        if (session && !terminalAttachedRef.current[item.sessionId]) {
          await ensureAgentTerminal(session);
        }
        if (councilOutputLooksGated(item.sessionId)) {
          setCouncilGate(item.sessionId, councilGateReason(item.sessionId, "Sign-in or approval needed — resolve it and the council carries on by itself."));
          // Not a dead end: the pane is watched, and the turn is sent the moment
          // the prompt is answered.
          void resumeWhenGateClears(runId, turn, item.sessionId, deliveredPrompt);
          return "gated" as const;
        }
        setCouncilGate(item.sessionId, null);
        // The delivery result, not an assumption: a prompt written into a
        // session whose PTY is gone disappears without a word, and the relay
        // would then wait out its full poll for a handoff nobody was asked for.
        if (await sendTerminalPrompt(item.sessionId, deliveredPrompt)) return "sent" as const;

        // A member's CLI exiting is ordinary rather than exceptional: Codex
        // finishes its turn and quits, cleanly, and the pane it leaves behind
        // is only a record of what it said. Ending a twelve-turn council over
        // that — and asking the user to go and press something — treats the
        // normal end of a turn as a failure. Bring the terminal back and
        // deliver the turn instead.
        if (session) {
          appendTerminalLine(item.sessionId, "Restarting this agent for the next turn…", { informational: true });
          terminalAttachedRef.current[item.sessionId] = false;
          if (await ensureAgentTerminal(session, { resume: false })) {
            await waitForSessionSettle(item.sessionId);
            if (councilOutputLooksGated(item.sessionId)) {
              setCouncilGate(item.sessionId, councilGateReason(item.sessionId, "This pane is waiting on you — answer it and the council carries on by itself."));
              void resumeWhenGateClears(runId, turn, item.sessionId, deliveredPrompt);
              return "gated" as const;
            }
            if (await sendTerminalPrompt(item.sessionId, deliveredPrompt)) return "restarted" as const;
          }
        }
        return "failed" as const;
      }),
    );
    persistRelayRun(runId);

    // A turn nobody could be given has nothing to wait for.
    if (dispatched.includes("sent") || dispatched.includes("restarted")) {
      if (run.auto) void watchRelayTurn(runId, turn);
      return;
    }
    // A gated member is already being watched, and its pane says why. A turn
    // that simply could not be delivered has neither, and saying nothing there
    // is the silent stall this path exists to prevent.
    if (!dispatched.includes("gated")) {
      stopRelay(
        runId,
        `Turn ${turn} could not be delivered to ${member.roleLabel} (${member.agentLabel}) — its terminal would not start.` +
          " Restart it from the pane, or swap the seat to another agent, then hand off to continue.",
      );
    }
  }

  /**
   * Polls for the handoff file the current turn was told to write. A file that
   * stops changing for 1.5s counts as finished — then the relay either ends (the
   * agent wrote the completion marker) or the finished turn is recorded and
   * routed on.
   */
  async function watchRelayTurn(runId: string, turn: number) {
    const run = relayRunRef.current[runId];
    if (!run || run.paused || !window.pitwall?.readProjectFile) return;

    const token = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    relayWatchTokenRef.current[runId] = token;
    let candidate = "";
    let stableSince = 0;
    const startedAt = Date.now();
    // How much the turn's panes have printed, and when that last changed. This
    // is what separates a member still working from one that has stopped.
    let lastPrinted = "";
    let lastActivity = startedAt;
    const deadline = startedAt + 2 * 60 * 60 * 1000;

    while (Date.now() < deadline && relayWatchTokenRef.current[runId] === token) {
      // Re-read every tick so pausing mid-wait takes hold.
      const active = relayRunRef.current[runId];
      if (!active || !relayMayAutoAdvance(active)) return;

      // A panel writes one file each, and the turn is only over when every
      // member has answered — otherwise the fastest reviewer decides the hop
      // alone. Read through the shared helper so the file the watcher waits on
      // is always the one the member was told to write.
      const content = await readRelayHandoff(runId, turn);

      if (content && content !== candidate) {
        candidate = content;
        stableSince = Date.now();
      } else if (content && candidate === content && Date.now() - stableSince >= 1500) {
        if (isRelayComplete(content)) {
          await recordRelayMessage(runId, turn, content, null);
          await captureCouncilLessons(runId, content);
          // A member declaring the work finished is the least independent
          // opinion available. Check it before believing it.
          if (await beginVerification(runId, turn)) return;
          stopRelay(runId, "The council finished — an agent marked the work complete.", { tone: "done" });
          return;
        }
        await advanceRelay(runId, turn, content);
        return;
      }

      // A member that has stopped without saying so.
      //
      // The nudge that rescues this normally fires on the CLI reporting it
      // finished — a signal that depends on the provider's notification hooks
      // and simply never arrives for some agents. When it does not, nothing
      // else notices, and the council sits here for the full two hours. Panes
      // print as they work, so no handoff plus no output is the shape of an
      // agent that has stopped rather than one still thinking.
      // Progress, not volume. Counting lines meant any output at all reset this
      // clock, so an agent stuck in a loop printed its way past the check and
      // the turn ran to the two-hour ceiling instead of being rescued in ten
      // minutes.
      const mark = relayProgressMark(
        relayTurnMembers(active).flatMap((item) => terminalLinesRef.current[item.sessionId] ?? []),
      );
      if (mark !== lastPrinted) {
        lastPrinted = mark;
        lastActivity = Date.now();
      }
      if (!content && Date.now() - lastActivity >= RELAY_IDLE_NUDGE_MS) {
        // Restart the clock before asking: the nudge itself takes a moment, and
        // a member that answers it needs a full window to do the work.
        lastActivity = Date.now();
        if (!(await nudgeRelayForHandoff(runId, turn))) return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }

    // The poll can only run out on a council nobody is watching any more. Say so
    // rather than leaving a run that reads as "Auto" with nothing behind it.
    if (relayWatchTokenRef.current[runId] === token) {
      stopRelay(runId, `Turn ${turn} produced no handoff in two hours, so the council stopped watching for one.`);
    }
  }

  /** Read what earlier councils on this project learned. Once per run. */
  async function loadCouncilLessons(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const locations = [...new Set([run.projectRoot, run.projectPath].filter((value): value is string => Boolean(value)))];
    const files = await Promise.allSettled(locations.flatMap((projectPath) => getCouncilLessonsPaths().map((filePath) => window.pitwall?.readProjectFile?.({ projectPath, filePath }))));
    for (const result of files) {
      if (result.status === "fulfilled" && result.value?.ok) run.lessons = mergeLessons(run.lessons, parseLessonsFile(result.value.content ?? ""));
    }
    run.knowledgeHydrated = true;
  }

  /** Capture discoveries with their source and visibility instead of sharing raw lessons. */
  async function captureCouncilLessons(runId: string, content: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const found = extractLessons(content);
    const member = run.members.find((item) => item.memberId === run.currentMemberId);
    if (member) {
      const set = parseWorkingSet(content, run.turn, member.memberId);
      const sourcePaths = set.files.map((file) => file.path.replace(/:\d+(?:-\d+)?$/, ""));
      const observations: KnowledgeObservation[] = [
        ...found.map((lesson) => ({ title: lesson.slice(0, 100), content: lesson, kind: "convention" as const, sourcePaths })),
        ...set.files.filter((file) => file.note).map((file) => ({ title: file.path, content: file.note, kind: "area" as const, sourcePaths: [file.path.replace(/:\d+(?:-\d+)?$/, "")] })),
        ...(set.decisions ?? []).map((decision) => ({ title: decision.slice(0, 100), content: decision, kind: "decision" as const, sourcePaths })),
      ];
      await rememberSessionKnowledge(member.sessionId, content, observations);
    }
  }

  /** Starts a verifier in a fresh provider conversation, including after a restart. */
  async function restartCouncilVerifier(runId: string, verifier: CouncilRelayMember): Promise<boolean> {
    // A different seat is not an independent context if its CLI remembers the debate.
    const previousSession = relaySessionRef.current[verifier.sessionId];
    if (!previousSession) {
      stopRelay(runId, "The final reviewer's session is unavailable. Restore its pane before retrying verification.");
      return false;
    }
    const detached = await window.pitwall?.detachTerminal?.(verifier.sessionId);
    if (!detached?.ok) {
      stopRelay(runId, "The final reviewer could not start a fresh conversation. Restart the reviewer and hand off to retry verification.");
      return false;
    }
    terminalAttachedRef.current[verifier.sessionId] = false;
    setTerminalAttachedBySession((current) => ({ ...current, [verifier.sessionId]: false }));
    const freshSession = { ...previousSession, nativeSessionId: createNativeSessionId(previousSession.agent), nativeSessionStarted: false };
    relaySessionRef.current[verifier.sessionId] = freshSession;
    delete terminalInitialPromptRef.current[verifier.sessionId];
    setProjects((current) => current.map((project) => ({ ...project, sessions: project.sessions.map((session) => session.id === verifier.sessionId ? freshSession : session) })));
    setPitwall((current) => ({ ...current, sessions: current.sessions.map((session) => session.id === verifier.sessionId
      ? { ...session, nativeSessionId: freshSession.nativeSessionId, nativeSessionStarted: false } : session) }));
    return true;
  }

  /** Returns true once verification was dispatched or its failed setup stopped the run. */
  async function beginVerification(runId: string, turn: number): Promise<boolean> {
    const run = relayRunRef.current[runId];
    if (!run) return false;
    const attempts = run.verification?.attempts ?? 0;
    if (attempts >= MAX_VERIFICATION_ROUNDS) return false;

    const verifier = chooseVerifier(run.members, run.currentMemberId);
    if (!verifier) return false;
    if (!(await restartCouncilVerifier(runId, verifier))) return true;

    const attempt = attempts + 1;
    run.verification = { attempts: attempt, pending: true, verdict: null };

    const prompt = buildVerificationPrompt({
      task: { ...run.task, description: [run.task.description, ...run.messages.filter((message) => message.author === "user").map((message) => message.content), ...run.directives.map((directive) => directive.text)].filter(Boolean).join("\n\n") },
      member: verifier,
      evidence: run.evidence,
      threadFile: getCouncilThreadFile(runId),
      verdictFile: getCouncilStageFile(runId, turn + 1),
      attempt,
    });

    const route: RelayRoute = {
      member: verifier,
      panel: [verifier],
      source: "conductor",
      directive: "",
      reason: `Verifying the finished work against the original task (attempt ${attempt}).`,
    };
    const verifyEntry: RelayRouteLogEntry = {
      turn: turn + 1,
      fromMemberId: run.currentMemberId ?? "",
      toMemberId: verifier.memberId,
      source: route.source,
      reason: route.reason,
      directive: "",
    };
    run.routes = [...run.routes, verifyEntry];
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? {}),
        turn: turn + 1,
        auto: run.auto,
        note: summariseVerification(null, attempt),
        atTurnLimit: false,
        route: verifyEntry,
        costUsd: run.conductorCostUsd,
      },
    }));
    await beginRelayTurn(runId, turn + 1, { route, promptOverride: prompt });
    return true;
  }

  /**
   * Adds a finished turn to the run's thread and mirrors the whole conversation
   * to thread.md. Members read that file rather than only the handoff aimed at
   * them, which is what lets a late joiner argue with a decision made three
   * turns ago instead of silently inheriting it.
   */
  async function recordRelayMessage(runId: string, turn: number, content: string, addressed: string | null) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const from = run.members.find((member) => member.memberId === run.currentMemberId) ?? run.members[0];
    const panel = run.currentPanel ?? [];
    const message: CouncilThreadMessage = {
      turn,
      fromMemberId: from?.memberId ?? "",
      toMemberId: resolveMemberRef(run.members, addressed)?.memberId ?? null,
      content,
      // A panel turn is several members' work in one entry; credit them all.
      ...(panel.length > 1 ? { participants: panel.map((member) => member.memberId) } : {}),
    };
    run.messages = [...run.messages, message];
    run.history = [...run.history, message.fromMemberId];
    // Per turn, with the role rather than the member id — the id carries an
    // agent name and a number, the role is the thing worth counting.
    track("council_turn_completed", {
      turns: turn,
      role: (from?.memberId ?? "").split("-")[0] || "other",
      members: run.members.length,
    });
    // The map the turn built, folded into what the council already knew. This
    // is what stops the next member re-reading the repository from scratch.
    run.workingSet = mergeWorkingSet(
      run.workingSet ?? emptyWorkingSet(),
      parseWorkingSet(content, turn, message.fromMemberId),
    );

    persistRelayRun(runId);
    syncRelayActivityState(runId);
    await Promise.all([writeRelayThread(runId), writeRelayWorkingSet(runId)]);
  }

  /**
   * Mirrors the working set to the file members can open.
   *
   * The prompt carries an abbreviated version, which is what actually changes
   * behaviour; this is the complete one, for a member that wants the rest.
   */
  async function writeRelayWorkingSet(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    await window.pitwall?.writeProjectFile?.({
      projectPath: run.projectPath || activeProject.path,
      filePath: getCouncilWorkingSetFile(runId),
      content: renderWorkingSet(run.workingSet ?? emptyWorkingSet(), run.task.title),
    });
  }

  /**
   * Copies the relay onto the stored council run. Everything else about a
   * council is already persisted; without this the conversation, roster and
   * routing history die with the window, and a restarted council shows its panes
   * but cannot be advanced.
   */
  function persistRelayRun(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const relay = toPersistedRelayState({
      projectPath: run.projectPath,
      taskPrompt: run.taskPrompt,
      task: run.task,
      members: run.members,
      turn: run.turn,
      startedAt: run.startedAt,
      maxTurns: run.maxTurns,
      conductor: run.conductor,
      directives: run.directives,
      messages: run.messages,
      history: run.history,
      currentMemberId: run.currentMemberId,
      currentPanelMemberIds: run.currentPanel.map((member) => member.memberId),
      routes: run.routes,
      conductorCostUsd: run.conductorCostUsd,
      debate: run.debate ?? null,
      openingDirective: run.openingDirective,
      projectRoot: run.projectRoot,
      taskId: run.taskId,
      workingSet: run.workingSet,
      lessons: run.lessons,
      evidence: run.evidence,
      verification: run.verification,
      currentAssignment: run.currentAssignment,
      contextEntryIds: run.contextEntryIds,
      running: run.auto && !run.stopped,
    });
    setPitwall((current) => ({
      ...current,
      councilRuns: current.councilRuns.map((item) => (item.id === runId ? { ...item, relay } : item)),
    }));
  }

  /** Mirrors the run's conversation to the file every member reads. */
  async function writeRelayThread(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    await window.pitwall?.writeProjectFile?.({
      projectPath: run.projectPath || activeProject.path,
      filePath: getCouncilThreadFile(runId),
      content: renderCouncilThread(run.members, run.messages, run.task, run.workingSet),
    });
  }

  /**
   * Puts something the user said into the council's thread. Without this the
   * members are told one thing while the conductor keeps routing against a
   * transcript that has no record of it, and the two quietly diverge.
   */
  async function recordRelayUserMessage(message: string, toMemberId: string | null = null) {
    const runId = activeRelayRunId();
    const run = relayRunRef.current[runId];
    if (!run || !message.trim()) return;
    run.messages = [
      ...run.messages,
      { turn: run.turn, fromMemberId: COUNCIL_USER_ID, toMemberId, content: message.trim(), author: "user" },
    ];
    persistRelayRun(runId);
    syncRelayActivityState(runId);
    await writeRelayThread(runId);
  }

  /**
   * The handoff a turn has written, as the watcher would see it: one file for a
   * solo turn, and every member's file merged for a panel — with nothing at all
   * until the panel is complete, since a partial panel is a half-formed opinion.
   *
   * Anything that closes a turn outside the watcher has to read it this way too,
   * or a panel's work is invisible to it and gets discarded as an empty turn.
   */
  async function readRelayHandoff(runId: string, turn: number): Promise<string> {
    const run = relayRunRef.current[runId];
    if (!run) return "";
    const read = async (filePath: string) => {
      const result = await window.pitwall?.readProjectFile?.({
        projectPath: run.projectPath || activeProject.path,
        filePath,
      });
      return result?.ok ? result.content?.trim() ?? "" : "";
    };

    const panel = relayTurnMembers(run);
    if (panel.length <= 1) return read(getCouncilStageFile(runId, turn));
    const parts = await Promise.all(
      panel.map(async (member) => ({
        member,
        content: await read(getTurnStageFile(runId, turn, member.memberId, panel.length)),
      })),
    );
    // Every voice or none: a partial panel is a half-formed opinion.
    return parts.every((part) => part.content) ? mergePanelHandoffs(parts) : "";
  }

  /** The relay behind the council currently on screen, if it has one. */
  function activeRelayRunId() {
    return relayRunIdBySessionRef.current[councilSessions[0]?.id ?? ""] ?? "";
  }

  function appendConductorNote(runId: string, role: ConductorNote["role"], text: string) {
    setConductorLogByRun((current) => ({
      ...current,
      [runId]: [...(current[runId] ?? []), { id: makeId("conductor-note"), role, text, at: nowIso() }],
    }));
  }

  /** Keeps the council bar's routing spend in step with what the lane has cost. */
  function syncConductorCost(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    setRelayRunState((current) => ({
      ...current,
      [runId]: { ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }), costUsd: run.conductorCostUsd },
    }));
  }

  /**
   * Gives the conductor a standing instruction.
   *
   * It goes to two places deliberately. The conductor gets it on every routing
   * call from here on, which is what makes it stick. The thread gets it too,
   * because the members read the thread and not the conductor's prompt — an
   * instruction the router honoured silently would have the council working
   * towards something nobody told the agents about.
   */
  async function instructConductor(text: string) {
    const runId = activeRelayRunId();
    const run = relayRunRef.current[runId];
    const message = text.trim();
    if (!run || !message) return;

    run.directives = addConductorDirective(run.directives, run.turn, message);
    const directives = run.directives.map((directive) => directive.text);
    setRelayRunState((current) => ({
      ...current,
      [runId]: { ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }), directives },
    }));
    appendConductorNote(runId, "you", message);
    await recordRelayUserMessage(`Instruction to the conductor: ${message}`);
    appendConductorNote(
      runId,
      "system",
      "Standing instruction added — the conductor is given this on every routing decision from now on, and the members can see it in the thread.",
    );
    setConductorMessage("");
  }

  /**
   * Asks the conductor a question and shows what it says.
   *
   * The same headless call routing uses, pointed at a different job: the
   * conductor holds the only whole-run view in the system, and until now the
   * user could see its conclusions — one hop, one reason — without being able to
   * ask it anything. The question is not written to the thread: it is a question
   * about the council, not an instruction to it, and members finding it in
   * thread.md would start working on it.
   */
  async function askConductorQuestion(text: string) {
    const runId = activeRelayRunId();
    const run = relayRunRef.current[runId];
    const question = text.trim();
    if (!run || !question) return;
    if (!window.pitwall?.routeCouncilTurn) {
      appendConductorNote(runId, "system", "The conductor cannot be reached from this build.");
      return;
    }

    appendConductorNote(runId, "you", question);
    setConductorMessage("");
    setConductorBusy(true);
    try {
      const result = await window.pitwall.routeCouncilTurn({
        agent: run.conductor.agent,
        model: run.conductor.model,
        projectPath: run.projectPath || activeProject.path,
        prompt: buildConductorAnswerPrompt({
          task: run.task,
          members: run.members,
          messages: run.messages,
          turn: run.turn,
          maxTurns: run.maxTurns,
          evidence: run.evidence,
          lastMemberId: run.currentMemberId,
          routes: run.routes,
          directives: run.directives,
          workingSet: run.workingSet,
          question,
        }),
      });
      // Answering costs the same as routing does, and a lane that spent money
      // invisibly would make the council's running total a lie.
      if (typeof result?.costUsd === "number") {
        run.conductorCostUsd += result.costUsd;
        syncConductorCost(runId);
      }
      const answer = result?.ok ? result.raw?.trim() ?? "" : "";
      if (!answer) {
        appendConductorNote(runId, "system", `No answer (${result?.error ?? "the conductor returned nothing"}).`);
        return;
      }
      appendConductorNote(runId, "conductor", answer);
    } catch (error) {
      appendConductorNote(runId, "system", `The conductor could not be reached (${(error as Error)?.message ?? "unknown error"}).`);
    } finally {
      setConductorBusy(false);
      setConductorStatus("");
    }
  }

  /**
   * Ends the turn in flight and routes from the thread as it stands.
   *
   * The relay advances when a handoff file appears. A member that stops without
   * writing one — and whose CLI never reports finishing, so the nudge never
   * fires — leaves the council waiting on a file that is not coming. This is the
   * way out: close the turn as unfinished and let the conductor decide who takes
   * it from here.
   */
  /** The Re-route now button: whoever is on screen, moved on by a person. */
  async function forceConductorReroute() {
    await conductorReroute(activeRelayRunId(), { automatic: false });
  }

  /**
   * Ends the turn in flight and asks the conductor who takes it from here.
   *
   * Called by the button, and by the stall rescue once a nudge has gone
   * unanswered — the council knows who is stuck and can move the work on
   * itself, which is the difference between a run that finishes and one that
   * waits hours for a person to notice.
   */
  async function recordCutShortTurn(runId: string, turn: number, from: CouncilRelayMember | undefined, automatic: boolean) {
    const run = relayRunRef.current[runId];
    if (!run || hasMemberHandoff(run.messages, turn)) return;
    // Recorded in the council's own voice, not the member's: nothing was
    // handed over, and attributing an empty turn to the agent would put
    // words in its mouth for every member that reads the thread afterwards.
    const who = from ? `${from.roleLabel} (${from.agentLabel})` : "The member holding the turn";
    run.messages = [
      ...run.messages,
      {
        turn,
        fromMemberId: "",
        toMemberId: null,
        author: "council",
        content:
          `## Turn ${turn} — cut short\n\n${who} did not write a handoff, and ${automatic ? "the council moved the work on rather than waiting" : "the person running the council moved the work on"}.` +
          " Nothing from that turn was recorded here, so check the repository rather than assuming it produced anything.",
      },
    ];
    persistRelayRun(runId);
    await writeRelayThread(runId);
  }

  async function conductorReroute(runId: string, { automatic }: { automatic: boolean }) {
    const run = relayRunRef.current[runId];
    if (!run || conductorBusy) return;

    const turn = run.turn;
    const from = run.members.find((member) => member.memberId === run.currentMemberId);
    // Cancel the watcher first. It is polling for this turn's handoff, and a
    // file landing while the conductor is being asked would otherwise advance
    // the same turn a second time.
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    run.stopped = false;
    setConductorBusy(true);
    try {
      // A handoff that did arrive is the honest end of the turn. Route on it
      // rather than throwing away a member's work because the watcher was late
      // or had already been cancelled.
      const content = await readRelayHandoff(runId, turn);
      if (content && !hasMemberHandoff(run.messages, turn)) {
        appendConductorNote(runId, "system", `Turn ${turn} had written its handoff after all — routing on it.`);
        await advanceRelay(runId, turn, content);
        return;
      }

      await recordCutShortTurn(runId, turn, from, automatic);

      if (run.debate?.status === "open") {
        const wasOpening = run.debate.kind === "opening";
        const { record } = abandonDebate(run.debate, `${from?.memberId ?? "The member holding the turn"} did not answer.`);
        run.debate = null;
        run.messages = [...run.messages, { turn, fromMemberId: "", toMemberId: null, author: "council", content: record }];
        persistRelayRun(runId);
        await writeRelayThread(runId);
        if (wasOpening) {
          stopRelay(
            runId,
            "The opening debate was cut short before the council agreed an approach. Read the positions in the thread, then start the work.",
            { tone: "attention", awaitingStart: true },
          );
          return;
        }
      }

      appendConductorNote(runId, "system", `Turn ${turn} cut short — asking the conductor who takes it from here.`);
      await routeRelayOnward(runId, turn, { from });
      syncConductorCost(runId);
    } finally {
      setConductorBusy(false);
      setConductorStatus("");
    }
  }

  /** Looks up the project's test command once, so every turn does not re-probe. */
  async function resolveRelayTestCommand(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run || run.testCommand !== undefined) return;
    const result = await window.pitwall?.getProjectTestCommand?.({
      projectPath: run.projectPath || activeProject.path,
    });
    const current = relayRunRef.current[runId];
    if (current) current.testCommand = result?.command ?? null;
  }

  /**
   * Runs the project's tests between turns. Changed files prove a member did
   * something; only the suite proves it works, which is the difference between
   * a council that reaches "done" and one that is actually finished.
   */
  async function runRelayTests(runId: string, changed: boolean) {
    const run = relayRunRef.current[runId];
    if (!run || !run.conductor.runTests || !changed) return null;
    await resolveRelayTestCommand(runId);
    const command = relayRunRef.current[runId]?.testCommand;
    if (!command || !window.pitwall?.runProjectTests) return null;

    setRelayRunState((current) => ({
      ...current,
      [runId]: { ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }), testing: true },
    }));
    try {
      const result = await window.pitwall.runProjectTests({
        projectPath: run.projectPath || activeProject.path,
        command,
      });
      if (!result?.ok || !result.ran) return null;
      return {
        command: result.command || command,
        passed: Boolean(result.passed),
        timedOut: Boolean(result.timedOut),
        output: result.output ?? "",
      };
    } catch {
      // A suite that cannot be run is not a failing suite; say nothing rather
      // than telling the conductor the work is broken.
      return null;
    } finally {
      setRelayRunState((current) => ({
        ...current,
        [runId]: { ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }), testing: false },
      }));
    }
  }

  /**
   * Fingerprints the working tree. Handoffs are self-reported, so this is the
   * council's only source of truth about whether anything was actually built.
   */
  async function snapshotRelayRepo(runId: string): Promise<Record<string, string>> {
    const run = relayRunRef.current[runId];
    if (!run || !window.pitwall?.getGitStatus) return {};
    try {
      const status = await window.pitwall.getGitStatus(run.projectPath || activeProject.path);
      return status?.ok ? snapshotRepoChanges(status.changes) : {};
    } catch {
      // A project that is not a Git worktree simply has no evidence to offer;
      // routing still works, it just runs on the handoffs alone.
      return {};
    }
  }

  /**
   * Asks the conductor who should speak next. Any failure — CLI missing, timed
   * out, unparseable answer — returns null and lets the caller fall back, since
   * a council that stalls because its orchestrator hiccuped is worse than one
   * that takes a turn in a slightly wrong order.
   */
  async function askConductor(
    runId: string,
    turn: number,
    addressed: string | null,
    options: { exclude?: string | null } = {},
  ): Promise<ConductorDecision | null> {
    const run = relayRunRef.current[runId];
    if (!run || !run.conductor.enabled || !window.pitwall?.routeCouncilTurn) return null;

    const prompt = buildConductorPrompt({
      task: run.task,
      members: run.members,
      messages: run.messages,
      turn,
      maxTurns: run.maxTurns,
      addressed,
      evidence: run.evidence,
      lastMemberId: run.currentMemberId,
      routes: run.routes,
      exclude: options.exclude,
      directives: run.directives,
      workingSet: run.workingSet,
    });

    const fallback = (why: string) => {
      setRelayRunState((current) => ({
        ...current,
        [runId]: { ...(current[runId] ?? { turn, auto: run.auto }), note: `${why} — routing by rotation.` },
      }));
      // Also in the lane. The bar note is one line that the next status
      // replaces, so a conductor that failed left no trace where a person
      // would look for it.
      appendConductorNote(runId, "system", `${why} — routing by rotation instead.`);
      return null;
    };

    setConductorStatus(
      options.exclude
        ? "The conductor picked a member that cannot take the turn. Asking again — up to two minutes."
        : "Asking the conductor who takes the turn — up to two minutes.",
    );
    try {
      const result = await window.pitwall.routeCouncilTurn({
        agent: run.conductor.agent,
        model: run.conductor.model,
        projectPath: run.projectPath || activeProject.path,
        prompt,
      });
      if (typeof result?.costUsd === "number") run.conductorCostUsd += result.costUsd;
      if (!result?.ok) return fallback(`Conductor unavailable (${result?.error ?? "no response"})`);
      const decision = parseConductorDecision(result.raw);
      // A conductor that answers with prose instead of a decision is a silent
      // downgrade to rotation, which looks identical to working routing — say so.
      return decision ?? fallback("Conductor did not return a routing decision");
    } catch (error) {
      return fallback(`Conductor call failed (${(error as Error)?.message ?? "unknown error"})`);
    }
  }

  /**
   * Closes out a finished turn and starts the next one: record the handoff, ask
   * the conductor where it should go, then hand the baton over with whatever
   * instruction came back.
   */
  async function advanceRelay(runId: string, turn: number, content: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    // Watchers are cancelled by bumping a token, which a watcher only checks
    // between polls — so one already past that point can advance a turn another
    // path has advanced. Recording the same turn twice would inflate the history
    // and trip the anti-stall guard on a council that never stalled.
    if (hasMemberHandoff(run.messages, turn)) return;

    const addressed = parseHandoffAddress(content);
    const from = run.members.find((member) => member.memberId === run.currentMemberId);
    await recordRelayMessage(runId, turn, content, addressed);

    // Ask the repository what the turn actually did before asking the conductor
    // where to send it — a handoff claiming an implementation that touched no
    // files must not be routed onward as though the work exists.
    await captureCouncilLessons(runId, content);

    // ---- The verifier's answer -------------------------------------------
    // A pending verification means this handoff is a verdict on the work, not
    // a turn of it, so it is read before anything else touches routing.
    if (run.verification?.pending) {
      const verdict = parseVerificationVerdict(content);
      const verification = { ...run.verification, pending: false, verdict };
      run.verification = verification;

      if (verdict.verified) {
        stopRelay(runId, `Verified against the original task: ${verdict.summary}`, { tone: "done" });
        return;
      }

      // The count and the attempt number, never the summary or the gaps —
      // those are written about somebody's codebase.
      track("council_verification_failed", { turns: run.turn, count: verification.attempts });
      const exhausted = verification.attempts >= MAX_VERIFICATION_ROUNDS;
      if (exhausted) {
        const gaps = verdict.gaps.length ? ` Still open: ${verdict.gaps.join("; ")}.` : "";
        stopRelay(
          runId,
          `The work did not pass verification after ${verification.attempts} attempts, so the council stopped rather than declare it done.${gaps}`,
        );
        return;
      }

      // Hand the gaps back as the next instruction and let the council work.
      const directive = buildRemediationDirective(verdict);
      const worker = chooseVerifier(run.members, run.currentMemberId) ?? run.members[0];
      const remediation: RelayRoute = {
        member: worker,
        panel: [worker],
        source: "conductor",
        directive,
        reason: `Verification found ${verdict.gaps.length || 1} unmet requirement${verdict.gaps.length === 1 ? "" : "s"}.`,
      };
      const remediationEntry: RelayRouteLogEntry = {
        turn: turn + 1,
        fromMemberId: from?.memberId ?? "",
        toMemberId: worker.memberId,
        source: remediation.source,
        reason: remediation.reason,
        directive,
      };
      run.routes = [...run.routes, remediationEntry];
      setRelayRunState((current) => ({
        ...current,
        [runId]: {
          ...(current[runId] ?? {}),
          turn: turn + 1,
          auto: run.auto,
          note: summariseVerification(verdict, verification.attempts),
          atTurnLimit: false,
          route: remediationEntry,
          costUsd: run.conductorCostUsd,
        },
      }));
      await beginRelayTurn(runId, turn + 1, { route: remediation, from });
      return;
    }

    // ---- Argument, before routing ----------------------------------------
    // A debate turn is deliberately handled ahead of the evidence snapshot and
    // the conductor: members are forbidden from editing while they argue, so
    // there is nothing for the repository to report and nothing to route. This
    // also keeps a full test run from firing on every round of a disagreement.
    const debateStep = advanceDebate({
      debate: run.debate ?? null,
      content,
      from: from?.memberId ?? "",
      memberIds: run.members.map((member) => member.memberId),
    });

    if (debateStep.kind !== "none") {
      const debate = debateStep.debate;
      run.debate = debate;

      if (debateStep.kind === "open" || debateStep.kind === "continue") {
        const speaker = run.members.find((member) => member.memberId === debateStep.speaker);
        if (!speaker) {
          // The member owed an answer is no longer on the council. Abandon the
          // argument rather than wait for a turn nobody can take.
          run.debate = null;
        } else {
          // Each participant's latest word, so the prompt shows the argument as
          // it actually stands rather than where it started.
          const positions = debate.participants
            .map((memberId) => {
              const member = run.members.find((item) => item.memberId === memberId);
              const latest = debate.turns.filter((item) => item.memberId === memberId).at(-1);
              return member && latest
                ? {
                    memberId,
                    roleLabel: member.roleLabel,
                    agentLabel: member.agentLabel,
                    summary: latest.stance.summary,
                  }
                : null;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          // Round 1 of an opening debate is the only round where there is
          // nothing to engage with yet — everyone is stating a position for the
          // first time, so they get the opening brief rather than a summary of
          // arguments that do not exist.
          const prompt =
            debate.kind === "opening" && debateStep.round === 1
              ? buildOpeningDebatePrompt({
                  taskPrompt: run.taskPrompt,
                  member: speaker,
                  others: run.members.filter((member) => member.memberId !== speaker.memberId),
                  threadFile: getCouncilThreadFile(runId),
                  stanceFile: getCouncilStageFile(runId, turn + 1),
                })
              : buildDebateRoundPrompt({
                  debate,
                  member: speaker,
                  positions,
                  round: debateStep.round,
                  stanceFile: getCouncilStageFile(runId, turn + 1),
                });

          const debateRoute: RelayRoute = {
            member: speaker,
            panel: [speaker],
            source: "addressed",
            directive: "",
            reason:
              debate.kind === "opening"
                ? `Opening debate, round ${debateStep.round} — how to approach this.`
                : debateStep.kind === "open"
                  ? `${from?.memberId ?? "a member"} disputed this with ${speaker.memberId}.`
                  : `Council debate, round ${debateStep.round}.`,
          };
          run.routes = [...run.routes, {
            turn: turn + 1,
            fromMemberId: from?.memberId ?? "",
            toMemberId: speaker.memberId,
            source: debateRoute.source,
            reason: debateRoute.reason,
            directive: "",
          }];
          setRelayRunState((current) => ({
            ...current,
            [runId]: {
              ...(current[runId] ?? {}),
              turn: turn + 1,
              auto: run.auto,
              note: summariseDebate(debate),
              atTurnLimit: false,
              route: run.routes.at(-1),
              costUsd: run.conductorCostUsd,
            },
          }));
          await beginRelayTurn(runId, turn + 1, { route: debateRoute, from, promptOverride: prompt });
          return;
        }
      } else {
      // The argument is over either way — write what was decided, and what was
      // overruled, into the thread the members read.
      run.messages = [...run.messages, {
        turn,
        fromMemberId: "",
        toMemberId: null,
        author: "council",
        content: debateStep.record,
      }];
      persistRelayRun(runId);
      await writeRelayThread(runId);
      // An opening debate is settled *for* the work that follows, so its outcome
      // is carried to the next turn as an instruction. A dispute needs no such
      // thing: it interrupted work already in progress, and the thread record is
      // enough context for it to resume.
      if (debate.kind === "opening" && debateStep.kind === "close") {
        run.openingDirective = buildOpeningDirective(debateStep.debate);
      }
      track("council_debate_completed", { kind: debate.kind === "opening" ? "extension" : "other", turns: run.turn });
      run.debate = null;

      // An agreed approach is not permission to build it.
      //
      // The debate used to fall straight through into the first working turn,
      // so a council convened to decide *how* to do something went and started
      // doing it — including picking up work nobody had asked for — off a plan
      // the person who asked for it had not read yet. This is the highest
      // leverage moment in the whole run and the cheapest one to intervene in:
      // one turn later the approach is already in the repository.
      //
      // So the council stops and shows its plan. Starting the work is one
      // press, and the directive it agreed on is carried into that turn
      // unchanged.
      if (debate.kind === "opening" && debateStep.kind === "close") {
        // Persisted here rather than relying on the write above it: the
        // directive is set after that one, and it is the whole product of the
        // debate. A council resumed without it starts the work with no agreed
        // approach, which is the outcome the debate exists to prevent.
        persistRelayRun(runId);
        stopRelay(
          runId,
          "The council agreed an approach and has not started building it. Read the plan above, then start the work.",
          { tone: "attention", awaitingStart: true },
        );
        return;
      }

      if (debateStep.kind === "escalate") {
        const positions = debate.participants
          .map((memberId) => {
            const latest = debate.turns.filter((item) => item.memberId === memberId).at(-1);
            return `${memberId}: ${latest?.stance.summary || "no stated position"}`;
          })
          .join("  ·  ");
        stopRelay(
          runId,
          `The council is split on something high-stakes and stopped rather than guess — ${debate.question}. ${positions}. Tell the council which way to go, then hand off.`,
        );
        return;
      }
      }
      // A settled debate falls through: the conductor routes the next real turn
      // with the outcome already in the thread.
    }

    await routeRelayOnward(runId, turn, { addressed, from });
  }

  /**
   * Takes a finished turn and starts the next one: check the repository, ask the
   * conductor where the work should go, hand the baton over.
   *
   * Split out of `advanceRelay` because a turn can also end without a handoff —
   * the user cutting short a member that has stopped responding — and that path
   * must route through exactly this logic rather than a second copy of it. The
   * evidence, oscillation and stall guards are the council's brakes; a routing
   * path that skipped them would be one the user reaches for precisely when the
   * council is already misbehaving.
   */
  async function routeRelayOnward(
    runId: string,
    turn: number,
    options: { addressed?: string | null; from?: CouncilRelayMember } = {},
  ) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const { addressed = null, from } = options;

    const after = await snapshotRelayRepo(runId);
    const evidence = buildCouncilEvidence({ before: run.repoSnapshot, after, member: from });
    // Only worth running when something changed: an unchanged tree gives the
    // same result as last turn, and a full suite per turn is real wall-clock.
    evidence.tests = await runRelayTests(runId, evidence.changedPaths.length > 0);
    run.evidence = evidence;
    run.repoSnapshot = after;

    // `isStuckOn` watches which member holds the turn; this watches whether the
    // work is moving. Two members can hand a file back and forth indefinitely —
    // every turn genuinely edits code, so the evidence check passes and the
    // stall guard never fires, while the tree keeps returning to a state it has
    // already been in.
    run.treeHistory = [...run.treeHistory, fingerprintTree(after)];
    const oscillation = detectTreeOscillation(run.treeHistory);
    if (oscillation.oscillating) {
      stopRelay(runId, oscillation.reason);
      return;
    }

    let decision = await askConductor(runId, turn, addressed);
    // Before falling back to blunt rotation, give the conductor a chance to pick
    // someone else deliberately — it knows which member can actually break the
    // deadlock, and rotation just takes whoever is next in the roster.
    const picked = resolveMemberRef(run.members, decision?.nextMemberId)?.memberId;
    // While a debate is open, consecutive turns by the same two members are the
    // argument working, not the council stalling.
    if (!debateSuppressesStallGuard(run.debate) && isStuckOn(run.members, run.history, picked)) {
      const retry = await askConductor(runId, turn, addressed, { exclude: picked });
      const retryPick = resolveMemberRef(run.members, retry?.nextMemberId)?.memberId;
      if (retry && retryPick && retryPick !== picked) decision = retry;
    }
    // The conductor can end the run outright — a member declaring itself done is
    // the marker's job, but the conductor sees whether anyone actually verified it.
    if (decision?.done && !decision.nextMemberId) {
      // The conductor has been routing this task for every turn of the run; it
      // is not a neutral judge of whether the run succeeded either.
      if (await beginVerification(runId, turn)) return;
      stopRelay(runId, `The council finished — ${decision.reason || "the conductor called the work done"}.`, { tone: "done" });
      return;
    }

    const route = chooseNextMember({
      members: run.members,
      decision,
      addressed,
      history: run.history,
      turn: turn + 1,
    });
    if (!route) return;

    // The opening debate's outcome rides on the first turn allowed to write
    // code, then is spent — it is the decision the council starts from, not a
    // standing instruction repeated for the rest of the run.
    if (run.openingDirective) {
      route.directive = route.directive
        ? `${run.openingDirective} ${route.directive}`
        : run.openingDirective;
      route.reason = route.reason || "Carrying out the approach the council agreed.";
      run.openingDirective = undefined;
    }

    const entry: RelayRouteLogEntry = {
      turn: turn + 1,
      fromMemberId: from?.memberId ?? "",
      toMemberId: route.member.memberId,
      source: route.source,
      reason: route.reason,
      directive: route.directive,
    };
    run.routes = [...run.routes, entry];
    setRelayRunState((current) => ({
      ...current,
      // Spread the existing entry: it carries the run's live settings, and
      // rebuilding it wholesale drops them the moment the council advances.
      [runId]: {
        ...(current[runId] ?? {}),
        turn: turn + 1,
        auto: run.auto,
        note: "",
        atTurnLimit: false,
        route: entry,
        costUsd: run.conductorCostUsd,
      },
    }));
    void window.pitwall?.writeProjectFile?.({
      projectPath: run.projectPath || activeProject.path,
      filePath: getCouncilConductorLogFile(runId),
      content: renderConductorLog(run.routes),
    });

    await beginRelayTurn(runId, turn + 1, { route, from });
  }

  /** Which member of a turn has already been asked to write its handoff. */
  function nudgeKey(turn: number, memberId: string) {
    return `${turn}:${memberId}`;
  }

  /**
   * Everyone taking the turn in flight: the panel when the conductor called one,
   * otherwise the single member holding the baton. Its length is also what
   * decides where each of them writes, so anything reasoning about the current
   * turn has to agree on this set.
   */
  function relayTurnMembers(run: RelayRun): CouncilRelayMember[] {
    if (run.currentPanel?.length) return run.currentPanel;
    return run.members.filter((item) => item.memberId === run.currentMemberId);
  }

  /**
   * Asks whoever owes this turn a handoff to write one, and ends the run if they
   * have already been asked.
   *
   * Both ways of noticing a stalled turn come through here — the CLI reporting
   * that it finished, and the watcher seeing a pane that has gone quiet — so a
   * member is asked once however the stall was spotted, and a council that has
   * genuinely stopped ends with an explanation instead of sitting out its
   * two-hour poll.
   *
   * Returns true while the turn is still worth watching.
   */
  async function nudgeRelayForHandoff(runId: string, turn: number, only?: string): Promise<boolean> {
    const run = relayRunRef.current[runId];
    if (!run || run.stopped || !run.auto || run.turn !== turn) return false;
    if (hasMemberHandoff(run.messages, turn)) return false;

    const panel = relayTurnMembers(run);
    const owing: CouncilRelayMember[] = [];
    const gated: CouncilRelayMember[] = [];
    for (const item of panel) {
      if (only && item.memberId !== only) continue;
      // A pane sitting on a sign-in or approval prompt is quiet for a reason,
      // and typing a nudge into that dialog is exactly what the gate guard
      // exists to prevent. resumeWhenGateClears is already watching it.
      if (councilOutputLooksGated(item.sessionId)) {
        gated.push(item);
        continue;
      }
      const stage = await window.pitwall?.readProjectFile?.({
        projectPath: run.projectPath || activeProject.path,
        filePath: getTurnStageFile(runId, turn, item.memberId, panel.length),
      });
      if ((stage?.ok ? stage.content?.trim() ?? "" : "").length > 0) continue;
      owing.push(item);
    }
    // A gate is only worth waiting on for so long. Skipping a blocked pane is
    // right — a nudge typed into a sign-in dialog is the thing the guard exists
    // to prevent — but it also made that member invisible here, so nobody was
    // owing and the run sat out its whole two-hour poll in silence.
    const gateKey = `${runId}:${turn}`;
    if (gated.length) {
      if (relayGateSinceRef.current[gateKey] === undefined) relayGateSinceRef.current[gateKey] = Date.now();
    } else {
      delete relayGateSinceRef.current[gateKey];
    }

    const decision = resolveStallAction({
      owing: owing.map((item) => item.memberId),
      nudged: owing.filter((item) => run.nudgedTurns.includes(nudgeKey(turn, item.memberId))).map((item) => item.memberId),
      rerouted: (run.reroutedTurns ?? []).includes(String(turn)),
      gated: gated.map((item) => item.memberId),
      gatedForMs: gated.length ? Date.now() - (relayGateSinceRef.current[gateKey] ?? Date.now()) : 0,
    });

    if (decision.action === "wait") return true;

    if (decision.action === "gated") {
      const blocked = gated.map((item) => `${item.roleLabel} (${item.agentLabel})`).join(", ");
      stopRelay(
        runId,
        `${blocked} ${gated.length === 1 ? "has" : "have"} been waiting on you for fifteen minutes — a sign-in, a trust prompt,` +
          " or an approval. Answer it in the pane, then Send task.",
        { tone: "attention" },
      );
      return false;
    }
    const who = owing.map((item) => `${item.roleLabel} (${item.agentLabel})`).join(", ");

    // The nudge is spent. Pitwall knows who is stuck and has a conductor that
    // can move the work on, so it does that itself rather than stopping and
    // asking the user to re-route by hand.
    if (decision.action === "reroute") {
      run.reroutedTurns = [...(run.reroutedTurns ?? []), String(turn)];
      appendConductorNote(
        runId,
        "system",
        `${who} did not write a handoff after being asked. Moving the turn on rather than waiting.`,
      );
      await conductorReroute(runId, { automatic: true });
      return false;
    }

    // The re-route is spent too. Stopping here is what keeps a stuck council
    // from cycling between the same two rescues forever.
    if (decision.action === "stop") {
      stopRelay(
        runId,
        `${who} ${owing.length === 1 ? "was" : "were"} asked for a handoff and re-routed, and the turn still produced nothing.` +
          " Read the pane, then hand off or re-route.",
      );
      return false;
    }

    const fresh = owing.filter((item) => decision.members.includes(item.memberId));
    if (!fresh.length) return true;

    run.nudgedTurns = [...run.nudgedTurns, ...fresh.map((item) => nudgeKey(turn, item.memberId))];
    const asked = fresh.map((item) => `${item.roleLabel} (${item.agentLabel})`).join(", ");
    setRelayRunState((state) => ({
      ...state,
      [runId]: {
        ...(state[runId] ?? { turn, auto: run.auto }),
        note: `${asked} stopped without a handoff — asking ${fresh.length === 1 ? "it" : "them"} to write one.`,
      },
    }));
    let delivered = false;
    for (const item of fresh) {
      const sent = await sendTerminalPrompt(
        item.sessionId,
        buildRelayNudge(getTurnStageFile(runId, turn, item.memberId, panel.length), {
          roleLabel: item.roleLabel,
          assignment: run.currentAssignment,
        }),
      );
      delivered = delivered || sent;
    }
    // Nothing reached a terminal, so nothing is going to answer. Say that now
    // rather than waiting another window to report it as an agent that ignored
    // the question — the pane is dead, which is a different problem.
    if (!delivered) {
      stopRelay(
        runId,
        `${asked} could not be asked for a handoff — ${fresh.length === 1 ? "its terminal is" : "their terminals are"} not running.` +
          " Start the session, then hand off to continue.",
      );
      return false;
    }
    return true;
  }

  /**
   * Handles a council member's CLI reporting that its turn is over. Agents
   * routinely finish by printing to the terminal and consider the job done, so
   * without this the relay waits out its two-hour poll on a handoff file that is
   * never going to appear.
   */
  async function handleRelayMemberCompleted(sessionId: string) {
    const runId = relayRunIdBySessionRef.current[sessionId];
    const run = relayRunRef.current[runId];
    if (!run || run.stopped || !run.auto) return;
    if (relaySessionRef.current[sessionId] === undefined) return;

    // Any member taking this turn, not only the one holding the baton: a panel
    // has several, and one of the others going quiet is the same event.
    const member = relayTurnMembers(run).find((item) => item.sessionId === sessionId);
    if (!member) return;

    const turn = run.turn;
    // The file often lands moments after the completion signal, and the watcher
    // still needs its stability window, so give both room before intervening.
    await new Promise((resolve) => window.setTimeout(resolve, 4000));
    if (await nudgeRelayForHandoff(runId, turn, member.memberId)) void watchRelayTurn(runId, turn);
  }

  /* ── the staged workflow: Architect → Implementer → QA ──────────────
     The council puts several agents in one thread and lets a conductor route
     between them. This is the other shape: one task, one stage at a time,
     each stage told only what it needs and judged by something that did not
     write it. `taskRunner` decides which stage is next; everything here
     performs what it decided and folds the answer back. */

  /**
   * What Pitwall could hand an implementation to, and what each costs.
   *
   * Deliberately only two costs. Pitwall knows one thing for certain about
   * price — whether inference happens on this machine — and inventing a
   * quality ranking between the cloud models on top of that would be a table
   * that is wrong within a month, which is the failure `modelHistory` exists
   * to replace with measurement.
   */
  function runnerCandidates(): Candidate[] {
    return agentOptionsRef.current.filter((option) => canImplement(option.agent)).flatMap((option) => {
      const local = Boolean(option.local);
      const ready = local || agentChecksRef.current[option.agent]?.status === "ready";
      if (!ready) return [];
      const model = option.models.find((item) => item.value !== "auto")?.value ?? option.models[0]?.value ?? "auto";
      return [{
        provider: local ? ("" as const) : providerIdFromAgent(option.agent),
        model: local ? model : option.agent,
        relativeCost: local ? 0 : 1,
        local,
        drivable: true,
      }];
    });
  }

  /**
   * The agent behind a routing choice.
   *
   * The router speaks in providers and models; sessions start against an
   * agent, so the choice has to be resolved back to one before it can be run.
   */
  function agentForCandidate(provider: PitwallProviderId | "", model: string): AgentProvider {
    const match = agentOptionsRef.current.find((option) => (provider
      ? !option.local && providerIdFromAgent(option.agent) === provider
      : Boolean(option.local) && option.models.some((item) => item.value === model)));
    return (match ?? agentOptionsRef.current[0] ?? agentOptions[0]).agent;
  }

  /** The seat that judges. Never local, because it is the check on the cheap one. */
  function judgeSeat(): { provider: PitwallProviderId | ""; model: string } {
    const cloud = runnerCandidates().find((candidate) => !candidate.local);
    return { provider: cloud?.provider ?? "", model: cloud?.model ?? "" };
  }

  function persistRun(next: TaskRun) {
    setTaskRuns((current) => {
      const runs = upsertRun(current, next);
      writeTaskRuns(runs);
      return runs;
    });

    // A settled run leaves one line of evidence behind. This is the only
    // thing that ever makes routing better than a guess.
    const outcome = outcomeFor(next);
    if (outcome && !recordedOutcomeRef.current[next.id]) {
      recordedOutcomeRef.current[next.id] = true;
      setModelOutcomes((current) => {
        const outcomes = [outcome, ...current];
        writeOutcomes(outcomes);
        return outcomes;
      });
    }
  }

  /** Starts a task through the staged loop rather than in a single session. */
  async function startStagedRun(task: PitwallTask) {
    const request = [task.title, task.description].filter(Boolean).join("\n\n");
    const run = startRun({
      id: makeId("run"),
      taskId: task.id,
      projectId: activeProject.id,
      // A first guess from the wording alone; the architect's own assessment
      // replaces it as soon as there is one.
      riskLevel: classifyRequest(request),
      at: nowIso(),
    });
    persistRun(run);
    stagedRequestRef.current[run.id] = request;
    await advanceStagedRun(run);
  }

  /**
   * Performs whatever the runner decided, once.
   *
   * Never loops on its own: each stage ends with a session completing or a
   * check finishing, and that event calls back in here. A driver that looped
   * would start the next stage before the last one had written its answer.
   */
  async function advanceStagedRun(run: TaskRun) {
    const request = stagedRequestRef.current[run.id] ?? "";
    const action = decide({
      run,
      request,
      candidates: runnerCandidates(),
      records: summarise(modelOutcomes, activeProject.id),
      policy: stagedPolicy,
      reviewer: judgeSeat(),
      architect: judgeSeat(),
      diff: stagedDiffRef.current[run.id] ?? "",
    });

    if (action.kind === "settled") return;

    if (action.kind === "blocked") {
      persistRun(withBlocked(run, nowIso()));
      setSystemNotice({ tone: "warn", title: "Staged run stopped", message: action.reason });
      return;
    }

    if (action.kind === "run-validation") {
      // In the worktree the work happened in, not the project root, which is
      // still sitting on the trunk.
      const attemptCwd = stagedCwdRef.current[run.id] || activeProject.path;
      const result = await window.pitwall?.runValidation?.({
        projectPath: attemptCwd,
        branch: run.contract ? run.contract.taskId : activeProject.branch,
      });
      const validation: ValidationResult = result?.ok && result.result
        ? result.result
        // A gate that could not run is not a gate that passed.
        : { ok: false, checks: [], ranAt: nowIso() };
      const next = withValidation(run, action.attemptId, validation);
      persistRun(next);
      await advanceStagedRun(next);
      return;
    }

    const session = await createAgentSession({
      agent: agentForCandidate(action.provider, action.model),
      model: action.model,
      sessionType: action.stage === "review" ? "review" : "implementation",
      task: projectTasks.find((item) => item.id === run.taskId),
      sessionName: `${stagedStageLabel[action.stage]} · ${run.taskId}`,
      startTask: false,
      prompt: action.prompt,
    });
    if (!session) {
      persistRun(withBlocked(run, nowIso()));
      return;
    }

    stagedBySessionRef.current[session.id] = {
      runId: run.id,
      stage: action.stage,
      outputFile: action.outputFile ?? "",
      // Where this stage actually works. A session gets its own worktree, so
      // a contract it writes lands there and not in the project directory —
      // reading the project root found nothing and blocked a run whose
      // architect had done its job perfectly well.
      cwd: session.worktreePath || activeProject.path,
    };
    if (session.worktreePath) stagedCwdRef.current[run.id] = session.worktreePath;

    if (action.stage === "implement" || action.stage === "fix") {
      persistRun(withAttempt(run, {
        id: makeId("attempt"),
        contractId: run.contract?.id ?? "",
        fixContractId: action.stage === "fix" ? run.fixContracts[run.fixContracts.length - 1]?.id : undefined,
        provider: action.provider,
        model: action.model,
        role: "implementation",
        sessionId: session.id,
        startedAt: nowIso(),
      }));
    }
  }

  /**
   * A stage finished. Collect what it wrote, fold it in, and go again.
   *
   * Everything is read from a file rather than from the terminal, for the
   * reason the council relay hands off through files: scrollback competes
   * with banners and tool traces, and a verdict read out of it is a verdict
   * subject to whatever else the agent decided to print.
   */
  async function handleStagedSessionCompleted(sessionId: string) {
    const link = stagedBySessionRef.current[sessionId];
    if (!link) return;
    delete stagedBySessionRef.current[sessionId];

    const run = taskRunsRef.current.find((item) => item.id === link.runId);
    if (!run) return;
    const at = nowIso();

    const readOutput = async () => {
      if (!link.outputFile) return "";
      // From the session's own directory. Falling back to the project root
      // only for a session that never got a worktree.
      for (const base of [link.cwd, activeProject.path]) {
        if (!base) continue;
        const result = await window.pitwall?.readProjectFile?.({ projectPath: base, filePath: link.outputFile });
        const content = result?.ok ? result.content?.trim() ?? "" : "";
        if (content) return content;
      }
      return "";
    };

    if (link.stage === "architect") {
      const draft = parseContract(await readOutput(), {
        id: makeId("contract"),
        taskId: run.taskId,
        projectId: run.projectId,
        architectModel: run.contract?.architectModel ?? "",
        architectProvider: judgeSeat().provider,
        createdAt: at,
        fallbackTask: stagedRequestRef.current[run.id],
      });
      if (!draft.contract) {
        // No contract rather than half of one: an implementer sent off with
        // two of the four things it needed produces work rejected for a
        // reason nobody wrote down.
        persistRun(withBlocked(run, at));
        setSystemNotice({
          tone: "warn",
          title: "The architect's contract could not be used",
          message: draft.problems.join(" "),
        });
        return;
      }
      const next = withContract(run, draft.contract, at);
      persistRun(next);
      await advanceStagedRun(next);
      return;
    }

    if (link.stage === "review") {
      const parsed = reconcile(parseVerdict(await readOutput()));
      const report = toReport({
        parsed,
        contractId: run.contract?.id ?? "",
        qaModel: judgeSeat().model,
        qaProvider: judgeSeat().provider,
        id: makeId("report"),
        createdAt: at,
      });
      const fix = report.verdict === "fail" && run.contract
        ? toFixContract({ report, contract: run.contract, id: makeId("fix"), createdAt: at })
        : undefined;
      const next = withReport(run, report, fix);
      persistRun(next);
      await advanceStagedRun(next);
      return;
    }

    // An implementation or a fix: the diff is what the reviewer will judge.
    const attempt = run.attempts[run.attempts.length - 1];
    // The reviewer judges a diff, and the changeset reports files rather than
    // patches, so the patches are fetched per file. Capped: past a few dozen
    // files this is no longer a change one review can meaningfully judge, and
    // the reviewer is told rather than quietly given a truncated picture.
    const changeset = await window.pitwall?.getTaskChangeset?.({
      projectPath: stagedCwdRef.current[run.id] || activeProject.path,
      branch: activeProject.branch,
      baseBranch: activeProject.branch,
    });
    if (changeset?.ok && changeset.files.length) {
      const shown = changeset.files.filter((file) => !file.binary).slice(0, 40);
      const patches = await Promise.all(shown.map(async (file) => {
        const result = await window.pitwall?.getTaskFileDiff?.({
          projectPath: stagedCwdRef.current[run.id] || activeProject.path,
          branch: activeProject.branch,
          base: changeset.base ?? "",
          filePath: file.path,
          untracked: file.untracked,
        });
        return result?.ok ? result.diff : "";
      }));
      const omitted = changeset.files.length - shown.length;
      stagedDiffRef.current[run.id] = [
        ...patches.filter(Boolean),
        omitted > 0 ? `[${omitted} further files changed and not shown]` : "",
      ].filter(Boolean).join("\n\n");
    }
    const next = attempt ? withAttemptFinished(run, attempt.id, at) : run;
    persistRun(next);
    await advanceStagedRun(next);
  }

  /**
   * Hands a council that has finished a new task, keeping the agents it has.
   *
   * The alternative is closing it and building another, which throws away the
   * expensive part. These CLIs are booted, signed in, attached to a worktree
   * and warm; the conversation is what is finished, not the roster. So the
   * sessions stay and everything about the run is replaced.
   *
   * A new run id rather than a reset of the old one. Turns write numbered
   * files under the run — `stage-1.md`, `stage-2.md` — so restarting a run at
   * turn 1 would write over the record of what it already did. The old run
   * keeps its history and is marked finished; the new one starts empty.
   */
  async function startAnotherCouncilTask(previousRunId: string, task: PitwallTask) {
    const previous = relayRunRef.current[previousRunId];
    if (!previous || !task) return;

    const members = previous.members;
    if (!members.length) return;
    const councilProject = projectsRef.current.find((project) => project.id === task.projectId);
    const previousProject = sessionProjectRef.current[members[0].sessionId];
    if (!councilProject || (previousProject && previousProject.id !== councilProject.id)) {
      setSystemNotice({ tone: "error", title: "This council belongs to another project", message: "Start a council in the task's project so its agents use the correct repository." });
      return;
    }
    const firstSession = relaySessionRef.current[members[0].sessionId]
      ?? councilProject.sessions.find((session) => session.id === members[0].sessionId);
    if (!firstSession) return;
    const taskForRun = { ...task, worktree: previous.projectPath };

    const runId = makeId("council");
    const timestamp = nowIso();
    const prompt = `${task.title}\n\n${task.description || ""}`.trim();

    // The brief is per run, so the new task gets its own file rather than
    // overwriting the one the finished run is the record of.
    const taskBriefPath = getCouncilTaskBriefPath(runId);
    const briefResult = await window.pitwall?.writeProjectFile?.({
      projectPath: previous.projectPath,
      filePath: taskBriefPath,
      content: buildCouncilTaskBrief(task),
    });
    const deliveredTaskPrompt = briefResult?.ok ? formatCouncilTaskFilePrompt(taskBriefPath) : prompt;

    // The finished run stops being the one its sessions belong to before the
    // new one claims them, so a late completion event from the old turn cannot
    // advance the new run.
    previous.stopped = true;
    previous.auto = false;
    relayWatchTokenRef.current[previousRunId] = (relayWatchTokenRef.current[previousRunId] ?? 0) + 1;
    persistRelayRun(previousRunId);

    // What is kept and what is cleared lives in `carryCouncilToNextTask`,
    // where it is tested: a field left behind here would be inherited quietly
    // by the new task and show up as a council behaving oddly for no visible
    // reason.
    relayRunRef.current[runId] = {
      ...carryCouncilToNextTask(previous, {
        runId,
        taskPrompt: deliveredTaskPrompt,
        task: { title: task.title, description: task.description },
        startedAt: timestamp,
      }),
      projectRoot: councilProject.path,
      taskId: task.id,
      contextEntryIds: pitwallRef.current.contextEntries.filter((entry) => entry.projectId === councilProject.id &&
        (activeProject.id !== councilProject.id || selectedContextIds.includes(entry.id))).map((entry) => entry.id),
      workingSet: emptyWorkingSet(),
      verification: undefined,
      openingDirective: undefined,
      currentAssignment: members[0].roleLabel,
      lessons: [],
      knowledgeHydrated: false,
      testCommand: undefined,
      conductorCostUsd: 0,
      restored: false,
      currentMemberId: members[0].memberId,
      currentPanel: [members[0]],
    };

    void resolveRelayTestCommand(runId);

    const opening = previous.conductor?.openingDebate === false
      ? null
      : openOpeningDebate({ taskPrompt: deliveredTaskPrompt, memberIds: members.map((member) => member.memberId) });
    relayRunRef.current[runId].debate = opening;

    for (const member of members) {
      relayRunIdBySessionRef.current[member.sessionId] = runId;
      sessionProjectRef.current[member.sessionId] = councilProject;
      taskBySessionRef.current[member.sessionId] = taskForRun;
      const session = relaySessionRef.current[member.sessionId] ?? councilProject.sessions.find((item) => item.id === member.sessionId);
      if (session) relaySessionRef.current[member.sessionId] = { ...session, task: task.title };
    }
    const firstPrompt = await prepareCouncilSessionPrompt(runId, firstSession);
    if (!firstPrompt) {
      stopRelay(runId, "The next task could not be prepared. Send task to retry.");
      return;
    }

    setRelayBySession((current) => ({
      ...current,
      ...Object.fromEntries(members.map((member, index) => [
        member.sessionId,
        { state: index === 0 ? ("active" as const) : ("waiting" as const), turn: index === 0 ? 1 : 0, canHandoff: index === 0 },
      ])),
    }));
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        turn: 1,
        auto: true,
        note: "",
        config: {
          enabled: Boolean(previous.conductor?.enabled),
          model: previous.conductor?.model ?? "opus",
          runTests: Boolean(previous.conductor?.runTests),
          maxTurns: relayRunRef.current[runId].maxTurns,
        },
      },
    }));

    setPitwall((current) => ({
      ...current,
      councilRuns: [
        {
          id: runId,
          name: formatCouncilRunName(task.title, "council"),
          projectId: councilProject.id,
          taskId: task.id,
          prompt,
          providerIds: members.map((member) => providerIdFromAgent(member.agentLabel)),
          synthesizer: "claude" as const,
          status: "running" as const,
          responses: members.map((member) => ({
            provider: providerIdFromAgent(member.agentLabel as AgentProvider),
            sessionId: member.sessionId,
            status: "running" as const,
          })),
          createdAt: timestamp,
        },
        // The finished one is kept and marked, not replaced: it is the record
        // of work that actually happened.
        ...current.councilRuns.map((run) =>
          run.id === previousRunId ? { ...run, status: "completed" as const } : run),
      ],
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, worktree: taskForRun.worktree, status: "running" as const, assignedAgent: "council" as const, updatedAt: timestamp } : item),
      sessions: current.sessions.map((session) => members.some((member) => member.sessionId === session.id)
        ? { ...session, taskId: task.id, status: "running" as const, contextSnapshotId: "", updatedAt: timestamp } : session),
    }));
    setProjects((current) => current.map((project) => project.id === councilProject.id
      ? { ...project, sessions: project.sessions.map((session) => members.some((member) => member.sessionId === session.id)
          ? { ...session, task: task.title, status: "running" as const } : session) } : project));
    persistRelayRun(runId);
    await Promise.all([writeRelayThread(runId), writeRelayWorkingSet(runId)]);

    setActiveCouncilRunId(runId);
    setDraftTaskId(task.id);

    // The sessions are already attached, so the new task is simply sent.
    const first = members[0];
    if (!terminalAttachedRef.current[first.sessionId] && !(await ensureAgentTerminal(firstSession))) {
      setCouncilGate(first.sessionId, "CLI could not attach. Send task to retry.");
      return;
    }
    const ready = await waitForSessionSettle(first.sessionId);
    if (!ready) {
      appendTerminalLine(first.sessionId, "Agent input did not become ready — the new task was not sent.");
      return;
    }
    if (councilOutputLooksGated(first.sessionId)) {
      setCouncilGate(first.sessionId, councilGateReason(first.sessionId, "Sign-in or approval needed — resolve it and the council carries on by itself."));
      void resumeWhenGateClears(runId, 1, first.sessionId, firstPrompt);
      return;
    }
    const sent = await sendTerminalPrompt(first.sessionId, firstPrompt);
    if (!sent) {
      appendTerminalLine(first.sessionId, "The new task could not be sent.");
      return;
    }
    void watchRelayTurn(runId, 1);
    setSystemNotice({
      tone: "info",
      title: "The council has a new task",
      message: `${task.title} — same agents, same worktree, a fresh thread.`,
    });
  }

  /**
   * Records what a finished session reported spending.
   *
   * Read from the transcript because Pitwall drives CLIs and never sees a
   * billing API. A CLI that reports nothing is recorded as nothing — not as
   * zero, which would read as "this was free" and be a claim rather than a
   * measurement.
   */
  function recordSessionUsage(sessionId: string) {
    const transcript = (terminalLinesRef.current[sessionId] ?? []).join("\n");
    const usage = readUsage(transcript);
    if (usage.tokens === undefined && usage.costUsd === undefined) return;
    setSessionUsage((current) => ({ ...current, [sessionId]: usage }));
  }

  /**
   * Runs the project's own checks against what a session left behind.
   *
   * Only when it actually changed something: a session that read code and
   * answered a question has nothing to check, and running a test suite at it
   * would be a minute of somebody's CPU spent to learn nothing.
   *
   * The result is recorded rather than announced. A failure here is not
   * necessarily the agent's fault — the branch may have been broken before it
   * started — so it belongs beside the work as a fact, where the person
   * deciding whether to accept it can see it.
   */
  async function checkSessionWork(sessionId: string) {
    // Read from the ref rather than the render's copy: this runs from a
    // completion event, which can arrive after the session list has moved on.
    const session = projectsRef.current
      .flatMap((project) => project.sessions)
      .find((item) => item.id === sessionId);
    if (!session) return;

    const project = sessionProjectRef.current[sessionId] ?? activeProject;
    const cwd = session.worktreePath || project.path;
    const changeset = await window.pitwall?.getTaskChangeset?.({
      projectPath: cwd,
      branch: session.branch,
      baseBranch: project.branch,
    });
    if (!changeset?.ok || changeset.files.length === 0) return;

    setCheckingSessions((current) => ({ ...current, [sessionId]: true }));
    try {
      const result = await window.pitwall?.runValidation?.({
        projectPath: cwd,
        branch: session.branch,
        reuseUnchanged: true,
      });
      if (!result?.ok || !result.result) return;
      setSessionChecks((current) => ({ ...current, [sessionId]: result.result }));
      // Nothing moved since the last run, so its failure was already said.
      if (result.reused) return;

      // Said once, when it matters: a suite that was already failing is not
      // news, but a session that just broke it is.
      if (!result.result.ok) {
        const failed = result.result.checks.filter((check) => !check.ok && !check.skipped);
        if (failed.length) {
          setSystemNotice({
            tone: "warn",
            title: `${session.name} left the checks failing`,
            message: `${failed.map((check) => check.name).join(", ")} — open Review to see what changed.`,
          });
        }
      }
    } finally {
      setCheckingSessions((current) => ({ ...current, [sessionId]: false }));
    }
  }

  /** Manual advance — the button on the active pane, and the fallback if an
   * agent finishes without writing its handoff file. */
  async function handoffCouncilStage(session: AgentSession) {
    const runId = relayRunIdBySessionRef.current[session.id];
    const run = relayRunRef.current[runId];
    // A second press while the first is still advancing would hand out two
    // turns at once, the later one asking for a handoff that cannot exist yet.
    if (!run || handoffInFlightRef.current[runId]) return;
    handoffInFlightRef.current[runId] = true;
    try {
      await handoffCouncilStageNow(runId, run);
    } finally {
      delete handoffInFlightRef.current[runId];
    }
  }

  /** Re-asks the pending verifier, in a fresh conversation, for the same verdict file. */
  async function resumeVerification(runId: string, run: RelayRun) {
    if (!run.verification?.pending) return;
    const verifier = run.members.find((member) => member.memberId === run.currentMemberId);
    if (!verifier || !(await restartCouncilVerifier(runId, verifier))) return;
    const prompt = buildVerificationPrompt({
      task: { ...run.task, description: [run.task.description, ...run.messages.filter((message) => message.author === "user").map((message) => message.content), ...run.directives.map((directive) => directive.text)].filter(Boolean).join("\n\n") },
      member: verifier, evidence: run.evidence, threadFile: getCouncilThreadFile(runId),
      verdictFile: getCouncilStageFile(runId, run.turn), attempt: run.verification.attempts,
    });
    await beginRelayTurn(runId, run.turn, { manual: true, promptOverride: prompt, route: {
      member: verifier, panel: [verifier], source: "conductor", directive: "",
      reason: `Resuming independent verification (attempt ${run.verification.attempts}).`,
    } });
  }

  /**
   * Picks a council back up after Pitwall restarted under it. The turn that was
   * interrupted is finished, not skipped: a handoff that landed is routed on,
   * otherwise the same turn is asked again of whoever held it.
   */
  async function resumeRestoredRelay(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    run.auto = true;
    run.stopped = false;
    setRelayRunState((current) => ({
      ...current,
      [runId]: { ...(current[runId] ?? {}), turn: run.turn, auto: true, stopped: false, tone: undefined },
    }));
    const content = await readRelayHandoff(runId, run.turn);
    if (content && !hasMemberHandoff(run.messages, run.turn)) {
      await advanceRelay(runId, run.turn, content);
      return;
    }
    if (run.verification?.pending) {
      await resumeVerification(runId, run);
      return;
    }
    setRelayBySession((current) => ({
      ...current,
      ...Object.fromEntries(run.currentPanel.map((member) => [member.sessionId, { state: "active" as const, turn: run.turn, canHandoff: true }])),
    }));
    for (const member of run.currentPanel) {
      const session = relaySessionRef.current[member.sessionId];
      if (session) await sendCouncilToSession(session);
    }
    persistRelayRun(runId);
  }

  async function handoffCouncilStageNow(runId: string, run: RelayRun) {
    // A manual handoff overrides a stop (turn cap reached, or a completion the
    // user disagrees with) so the council can always be pushed one turn further.
    run.stopped = false;
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;

    // Route it properly if the agent did write a handoff — the user pressing the
    // button means "this turn is done", not "skip the conductor". Only a turn
    // that produced nothing to route falls through to plain rotation.
    const content = await readRelayHandoff(runId, run.turn);
    if (content && !hasMemberHandoff(run.messages, run.turn)) {
      await advanceRelay(runId, run.turn, content);
      return;
    }
    if (run.verification?.pending) {
      await resumeVerification(runId, run);
      return;
    }
    await recordCutShortTurn(runId, run.turn, run.members.find((member) => member.memberId === run.currentMemberId), false);
    await beginRelayTurn(runId, run.turn + 1, { manual: true });
  }

  /**
   * Brings a council started before the conductor existed under its control.
   * Such runs have live panes and hours of work but no stored relay, so they
   * show no settings and cannot be routed. The roster is rebuilt from their
   * sessions and the conversation from the stage files already on disk, so
   * adopting one costs nothing and loses nothing.
   */
  async function adoptLegacyCouncil(runId: string) {
    const run = pitwallRef.current.councilRuns.find((item) => item.id === runId);
    if (!run || relayRunRef.current[runId]) return;
    const councilProject = projectsRef.current.find((project) => project.id === run.projectId);
    if (!councilProject) return;

    const sessions = run.responses
      .map((response) => councilProject.sessions.find((session) => session.id === response.sessionId))
      .filter((session): session is AgentSession => Boolean(session));
    if (sessions.length < 2) return;

    const handles: string[] = [];
    const members: CouncilRelayMember[] = sessions.map((session) => {
      const stored = pitwallRef.current.sessions.find((item) => item.id === session.id);
      const type = stored?.type ?? "implementation";
      const role = getRole(type);
      const memberId = makeCouncilMemberId(roleKeys[type], session.agent, handles);
      handles.push(memberId);
      return {
        sessionId: session.id,
        memberId,
        rolePrompt: role.systemPrompt,
        roleLabel: role.label,
        agentLabel: session.agent,
        writesCode: roleWritesCode[type],
      };
    });

    const task = pitwallRef.current.tasks.find((item) => item.id === run.taskId);
    const projectPath = sessions[0].worktreePath || councilProject.path;
    const taskBriefPath = getCouncilTaskBriefPath(runId);
    const existingBrief = await window.pitwall?.readProjectFile?.({ projectPath, filePath: taskBriefPath });
    const taskBrief = existingBrief?.ok && existingBrief.content?.trim() ? existingBrief
      : task ? await window.pitwall?.writeProjectFile?.({ projectPath, filePath: taskBriefPath, content: buildCouncilTaskBrief(task) }) : null;
    const taskPrompt = taskBrief?.ok ? formatCouncilTaskFilePrompt(taskBriefPath)
      : task ? `${task.title}\n\n${task.description}`.trim() : run.prompt;

    // Walk the handoffs the old council left behind: where it stopped is where
    // the adopted run must continue from, since renumbering would overwrite the
    // history it already wrote.
    const stages: Array<{ turn: number; content: string }> = [];
    for (let turn = 1; turn <= MAX_RELAY_TURNS * 4; turn += 1) {
      const stage = await window.pitwall?.readProjectFile?.({
        projectPath,
        filePath: getCouncilStageFile(runId, turn),
      });
      const content = stage?.ok ? stage.content?.trim() ?? "" : "";
      if (!content) break;
      stages.push({ turn, content });
    }

    const messages = rebuildThreadFromStages(members, stages);
    const lastTurn = Math.max(1, stages.length);
    // Rebuilt from the same handoffs, so an adopted council does not send its
    // next member back to re-read files earlier turns already wrote down.
    const adoptedWorkingSet = restoreCouncilWorkingSet(messages);
    relayRunRef.current[runId] = {
      runId,
      projectPath,
      projectRoot: councilProject.path,
      taskId: run.taskId,
      taskPrompt,
      task: { title: task?.title ?? run.name ?? "Council", description: task?.description },
      members,
      turn: lastTurn,
      auto: false,
      stopped: true,
      conductor: DEFAULT_COUNCIL_CONDUCTOR,
      directives: [],
      maxTurns: normalizeTurnLimit(lastTurn + MAX_RELAY_TURNS),
      messages,
      history: messages.map((message) => message.fromMemberId),
      currentMemberId: messages.at(-1)?.fromMemberId ?? members[0].memberId,
      routes: [],
      repoSnapshot: {},
      evidence: null,
      treeHistory: [],
      lessons: [],
      workingSet: adoptedWorkingSet,
      nudgedTurns: [],
      reroutedTurns: [],
      currentPanel: [members.find((member) => member.memberId === messages.at(-1)?.fromMemberId) ?? members[0]],
      conductorCostUsd: 0,
      restored: true,
      startedAt: run.createdAt,
    };

    for (const member of members) {
      relayRunIdBySessionRef.current[member.sessionId] = runId;
      sessionProjectRef.current[member.sessionId] = councilProject;
      if (task) taskBySessionRef.current[member.sessionId] = task;
      const session = sessions.find((item) => item.id === member.sessionId);
      if (session) relaySessionRef.current[member.sessionId] = session;
    }
    await loadCouncilLessons(runId);

    setRelayBySession((current) => ({
      ...current,
      ...Object.fromEntries(
        members.map((member) => [member.sessionId, { state: "handed" as const, turn: lastTurn, canHandoff: true }]),
      ),
    }));
    persistRelayRun(runId);
    syncRelayConfigState(runId);
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? {}),
        turn: lastTurn,
        auto: false,
        note: stages.length
          ? `Conductor enabled. ${stages.length} earlier handoff${stages.length === 1 ? "" : "s"} read back in — hand off to continue.`
          : "Conductor enabled on this council — hand off to continue.",
      },
    }));
    await Promise.all([writeRelayThread(runId), writeRelayWorkingSet(runId)]);
  }

  /**
   * Pushes how much the council has actually done into render state: handoffs
   * written, who wrote them, and when it started. The turn number alone does not
   * answer "how long have they been at this", which is the thing worth knowing
   * before letting a council keep spending.
   */
  function syncRelayActivityState(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }),
        activity: summariseCouncilActivity(run.members, run.messages),
        startedAt: run.startedAt,
      },
    }));
  }

  /** Mirrors a run's live settings into state so the council bar can show them. */
  function syncRelayConfigState(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? { turn: run.turn, auto: run.auto, note: "" }),
        config: {
          enabled: run.conductor.enabled,
          model: run.conductor.model,
          runTests: Boolean(run.conductor.runTests),
          maxTurns: run.maxTurns,
        },
      },
    }));
  }

  /**
   * Picks the council back up if a raised turn limit unblocked the hop that
   * stopped it. Re-watching the current turn would do nothing — its handoff is
   * already recorded — so the blocked routing decision is replayed instead.
   */
  function resumeRelayIfUnblocked(runId: string) {
    const run = relayRunRef.current[runId];
    if (!run?.pending || !isWithinTurnLimit(run.pending.turn, run.maxTurns)) return false;
    const pending = run.pending;
    run.pending = undefined;
    run.stopped = false;
    run.auto = true;
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    void beginRelayTurn(runId, pending.turn, { route: pending.route, from: pending.from });
    return true;
  }

  /**
   * Changes how a council runs without restarting it. A council is a long,
   * expensive thing to set up, so realising mid-run that the conductor should be
   * on a cheaper model — or that the tests should be checked — must not mean
   * throwing the conversation away and starting again.
   */
  function updateRelayConfig(
    runId: string,
    patch: { enabled?: boolean; model?: string; runTests?: boolean; maxTurns?: number | null },
  ) {
    const run = relayRunRef.current[runId];
    if (!run) return;

    if (patch.enabled !== undefined) run.conductor = { ...run.conductor, enabled: patch.enabled };
    if (patch.model !== undefined) run.conductor = { ...run.conductor, model: patch.model };
    if (patch.runTests !== undefined) run.conductor = { ...run.conductor, runTests: patch.runTests };
    if (patch.maxTurns !== undefined) {
      run.maxTurns = patch.maxTurns === null ? null : normalizeTurnLimit(patch.maxTurns);
    }

    persistRelayRun(runId);
    syncRelayConfigState(runId);

    const resumed = patch.maxTurns !== undefined && resumeRelayIfUnblocked(runId);
    if (resumed) {
      setRelayRunState((current) => ({
        ...current,
        [runId]: { ...(current[runId] ?? { turn: run.turn }), auto: true, note: "", atTurnLimit: false },
      }));
      return;
    }
    // A limit dropped below the turn already reached is a deliberate stop, and
    // silently continuing would ignore what the user just asked for.
    if (patch.maxTurns !== undefined && !isWithinTurnLimit(run.turn + 1, run.maxTurns) && !run.stopped) {
      stopRelay(runId, formatTurnLimitNote(run.maxTurns), { atTurnLimit: true });
    }
  }

  /**
   * Raises a paused council's turn budget and sets it going again. Hitting the
   * cap on a run that is clearly still productive should not mean nursing it one
   * manual hand-off at a time.
   */
  /**
   * Gives a paused council more wall-clock, the way extendRelayTurns gives it
   * more turns. Measured from now rather than from the start, so "two more
   * hours" means two more hours of work rather than a budget already spent.
   */
  function extendRelayBudget(runId: string, extraHours: number | null) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    const elapsed = run.startedAt ? Math.max(0, Date.now() - Date.parse(run.startedAt)) : 0;
    run.runBudgetMs = extraHours === null ? null : elapsed + (normalizeRunBudget(extraHours) ?? DEFAULT_RUN_BUDGET_MS);
    run.stopped = false;
    run.auto = true;
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    persistRelayRun(runId);
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? { turn: run.turn }),
        turn: run.turn,
        auto: true,
        atTurnLimit: false,
        atRunBudget: false,
        note: extraHours === null ? "Running on with no time limit." : `Running on for another ${extraHours}h.`,
      },
    }));
    if (!resumeRelayIfUnblocked(runId)) void watchRelayTurn(runId, run.turn);
  }

  function extendRelayTurns(runId: string, extraTurns: number | null) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    run.maxTurns = extraTurns === null ? null : normalizeTurnLimit(run.turn + extraTurns);
    run.stopped = false;
    run.auto = true;
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    persistRelayRun(runId);
    syncRelayConfigState(runId);
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? { turn: run.turn }),
        turn: run.turn,
        auto: true,
        atTurnLimit: false,
        note:
          run.maxTurns === null
            ? `Turn limit lifted — the council runs to the ${RELAY_TURN_CEILING}-turn safety ceiling.`
            : `Turn limit raised to ${run.maxTurns}.`,
      },
    }));
    if (!resumeRelayIfUnblocked(runId)) void watchRelayTurn(runId, run.turn);
  }

  /** Turns automatic advancement on or off mid-run. */
  function setRelayAuto(runId: string, auto: boolean) {
    const run = relayRunRef.current[runId];
    if (!run) return;
    run.auto = auto;
    if (auto) run.stopped = false;
    persistRelayRun(runId);
    relayWatchTokenRef.current[runId] = (relayWatchTokenRef.current[runId] ?? 0) + 1;
    setRelayRunState((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? {}),
        turn: run.turn,
        auto,
        note: auto ? "" : "Automatic hand-off is off — advance with the button.",
      },
    }));
    if (auto && !run.stopped) void watchRelayTurn(runId, run.turn);
  }

  /**
   * Which kind of prompt a gate message describes.
   *
   * The message is written for a person and must never be sent; this maps it
   * to one of a handful of words so "what stops people" is answerable without
   * shipping the text.
   */
  function gateKind(reason: string): string {
    const text = reason.toLowerCase();
    if (text.includes("trust")) return "trust";
    if (text.includes("update")) return "update";
    if (text.includes("responsibility") || text.includes("accept")) return "consent";
    if (text.includes("sign-in") || text.includes("sign in")) return "signin";
    return "unknown";
  }

  function setCouncilGate(sessionId: string, reason: string | null) {
    // Counted on the transition, not on every poll: the gate check runs on a
    // timer and would otherwise report one stuck pane thousands of times.
    //
    // Read from a ref rather than from inside the state updater. An updater
    // has to be pure — React runs it twice in development, which would double
    // every count — and the state value itself is stale inside a callback.
    const wasGated = Boolean(councilGatedRef.current[sessionId]);
    if (reason === null && wasGated) {
      delete councilGatedRef.current[sessionId];
      track("agent_gate_cleared");
    } else if (reason !== null && !wasGated) {
      councilGatedRef.current[sessionId] = true;
      track("agent_gate_hit", { gate_kind: gateKind(reason) });
    }
    setCouncilGateBySession((current) => {
      if (reason === null) {
        if (!(sessionId in current)) return current;
        const next = { ...current };
        delete next[sessionId];
        return next;
      }
      return { ...current, [sessionId]: reason };
    });
  }

  function councilOutputTail(sessionId: string) {
    const chunks = terminalLinesRef.current[sessionId] ?? [];
    return chunks.slice(-50).join("\n");
  }

  function councilOutputLooksGated(sessionId: string) {
    return looksLikeAgentGate(councilOutputTail(sessionId));
  }

  /** Names the gate when it is one Pitwall recognises, rather than "sign-in or approval". */
  function councilGateReason(sessionId: string, fallback: string) {
    return codexUpdatePromptShowing(councilOutputTail(sessionId))
      ? "Codex update prompt — Pitwall chose Skip. If it stays, press 2 in this pane."
      : fallback;
  }

  /**
   * Answers Codex's self-update menu with Skip, once per appearance. "Update
   * now" would reinstall the CLI mid-session, and a task typed into the menu
   * goes nowhere, so a council would otherwise stall here.
   */
  function answerCodexUpdatePrompt(sessionId: string, arrived: string[]) {
    const answered = codexUpdateAnsweredRef.current[sessionId];
    if (!answered && !arrived.some((chunk) => /update|skip/i.test(chunk))) return;
    const session =
      relaySessionRef.current[sessionId] ??
      projectsRef.current.flatMap((project) => project.sessions).find((item) => item.id === sessionId);
    if (session?.agent !== "Codex") return;
    if (!codexUpdatePromptShowing(councilOutputTail(sessionId))) {
      delete codexUpdateAnsweredRef.current[sessionId];
      return;
    }
    if (answered) return;
    codexUpdateAnsweredRef.current[sessionId] = true;
    void window.pitwall?.writeTerminal?.({ sessionId, data: CODEX_UPDATE_SKIP_KEY });
  }

  /**
   * Waits out a sign-in or trust prompt and then gets on with the turn. A gate
   * used to be terminal: the council parked, and even once the prompt was
   * answered nothing noticed, so the run had to be pushed on by hand. Polling
   * the pane means resolving the prompt is the only thing a person has to do.
   */
  async function resumeWhenGateClears(runId: string, turn: number, sessionId: string, prompt: string) {
    if (relayGateWatchRef.current[sessionId]) return;
    relayGateWatchRef.current[sessionId] = true;
    const deadline = Date.now() + COUNCIL_GATE_WATCH_MS;

    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const run = relayRunRef.current[runId];
        // The turn moved on, or the council did — nothing left to resume.
        if (!run || run.stopped || !run.auto || run.turn !== turn) return;
        if (hasMemberHandoff(run.messages, turn)) return;
        if (councilOutputLooksGated(sessionId)) continue;

        setCouncilGate(sessionId, null);
        await sendTerminalPrompt(sessionId, prompt);
        void watchRelayTurn(runId, turn);
        return;
      }
      setCouncilGate(sessionId, councilGateReason(sessionId, "Still waiting on sign-in or approval — resolve it, then Send task."));
    } finally {
      delete relayGateWatchRef.current[sessionId];
    }
  }

  async function waitForSessionSettle(sessionId: string, maxMs = 30_000, startupMs = 2000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const activity = terminalPtyActivityRef.current[sessionId];
      // Synthetic Pitwall history lines are deliberately excluded. Only the
      // spawned PTY can prove that the CLI has begun drawing its input screen.
      // Do not wait for silence: full-screen TUIs redraw cursors and status
      // lines continuously even while they are ready for input.
      if (activity?.chunks && Date.now() - activity.firstAt >= startupMs) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
  }

  /** Rebuild a seat's brief before retrieval so another provider's context is never reused. */
  async function prepareCouncilSessionPrompt(runId: string, session: AgentSession) {
    const relay = relayRunRef.current[runId];
    const member = relay?.members.find((item) => item.sessionId === session.id);
    if (relay && member) {
      if (!relay.knowledgeHydrated) await loadCouncilLessons(runId);
      let basePrompt: string;
      if (relay.verification?.pending) {
        basePrompt = buildVerificationPrompt({
          task: relay.task,
          member,
          evidence: relay.evidence,
          threadFile: getCouncilThreadFile(runId),
          verdictFile: getCouncilStageFile(runId, relay.turn),
          attempt: relay.verification.attempts,
        });
      } else if (relay.debate?.status === "open") {
        const debate = relay.debate;
        const lastRound = Math.max(1, ...debate.turns.map((item) => item.round));
        const answered = new Set(debate.turns.filter((item) => item.round === lastRound).map((item) => item.memberId));
        const round = debate.participants.every((id) => answered.has(id)) ? lastRound + 1 : lastRound;
        const positions = debate.participants.flatMap((memberId) => {
          const participant = relay.members.find((item) => item.memberId === memberId);
          const latest = debate.turns.filter((item) => item.memberId === memberId).at(-1);
          return participant && latest ? [{ memberId, roleLabel: participant.roleLabel, agentLabel: participant.agentLabel, summary: latest.stance.summary }] : [];
        });
        basePrompt = debate.kind === "opening" && round === 1
          ? buildOpeningDebatePrompt({ taskPrompt: relay.taskPrompt, member, others: relay.members.filter((item) => item.memberId !== member.memberId),
              threadFile: getCouncilThreadFile(runId), stanceFile: getCouncilStageFile(runId, relay.turn) })
          : buildDebateRoundPrompt({ debate, member, positions, round, stanceFile: getCouncilStageFile(runId, relay.turn) });
      } else {
        const route = relay.routes.filter((item) => item.turn === relay.turn).at(-1);
        basePrompt = buildCouncilRelayTurn({
          runId, taskPrompt: relay.taskPrompt, member, members: relay.members, turn: relay.turn,
          isCycle: relay.turn > relay.members.length,
          directive: route?.directive || relay.currentAssignment,
          from: relay.members.find((item) => item.memberId === route?.fromMemberId),
          evidence: relay.evidence, panel: relay.currentPanel,
          workingSet: relay.workingSet, messages: relay.messages, directives: relay.directives,
        }).prompt;
      }
      if (relay.verification?.pending || relay.debate?.status === "open") {
        const instructions = [...new Set([
          ...relay.messages.filter((message) => message.author === "user").map((message) => message.content),
          ...relay.directives.map((directive) => directive.text),
        ])];
        if (instructions.length) basePrompt += `\n\nInstructions from the person running the council (these outrank member opinions):\n${instructions.join("\n\n")}`;
      }
      const prompt = await prepareCouncilMemberPrompt(runId, member, `${basePrompt}${formatLessonsPrompt(relay.lessons, getCouncilLessonsPath())}`);
      if (relay.currentMemberId === member.memberId) relay.currentPrompt = prompt;
      return prompt;
    }

    const run = pitwallRef.current.councilRuns.find((item) => item.id === runId);
    const project = projectsRef.current.find((item) => item.id === run?.projectId) ?? sessionProjectRef.current[session.id];
    if (!run || !project) return null;
    const task = pitwallRef.current.tasks.find((item) => item.id === run.taskId);
    const snapshotIds = new Set(run.responses.map((response) => response.sessionId));
    const snapshots = pitwallRef.current.contextSnapshots.filter((snapshot) => snapshotIds.has(snapshot.sessionId) && snapshot.taskId === run.taskId);
    const contextIds = relay?.contextEntryIds ?? (snapshots.length ? snapshots.flatMap((snapshot) => snapshot.contextEntries.map((entry) => entry.id)) : undefined);
    const synthesis = session.id.startsWith("synth-");
    const basePrompt = synthesis
      ? `You are the synthesizer for the council working on: ${task?.title ?? run.name}. ${task?.description ?? ""}\nReview the actual code and git diff, compare the council's approaches, and produce one consolidated recommendation with concrete next steps. Do not change code during synthesis.${relay ? ` Read ${getCouncilThreadFile(runId)} and ${getCouncilWorkingSetFile(runId)} for accepted decisions, user instructions, and unresolved questions.` : ""}`
      : run.prompt;
    return prepareAgentPrompt({
      projectPath: relay?.projectRoot ?? project.path, workspacePath: session.worktreePath ?? relay?.projectPath ?? project.path,
      projectId: project.id, taskId: run.taskId, runId, sessionId: session.id,
      task: task ?? { title: run.name ?? "Council" }, provider: providerIdFromAgent(session.agent),
      role: synthesis ? "synthesis" : "comparison",
      manualEntries: pitwallRef.current.contextEntries.filter((entry) => entry.projectId === project.id && (!contextIds || contextIds.includes(entry.id))),
      basePrompt,
    });
  }

  async function sendCouncilPrompt() {
    const run = pitwall.councilRuns.find((item) => item.id === activeCouncilRunId);
    if (!run) return;
    const targets =
      activeCouncilMode === "compare"
        ? run.responses
        : run.responses.filter((response) => relayBySession[response.sessionId]?.state === "active");
    await Promise.all(targets.map(async (response) => {
      const session = relaySessionRef.current[response.sessionId] ?? sessionByIdRef.current[response.sessionId];
      if (session) await sendCouncilToSession(session);
    }));
  }

  /**
   * A message typed into the Council composer, delivered to who it is for.
   *
   * "all" is what a council without a conductor wants: every member is running
   * the same prompt at the same time. A conducted council is a relay — one
   * member holds the turn and the others are parked — so "current" sends only
   * to the one actually working. Sending to a parked member does not reach a
   * reader; it queues in an agent that will read it whenever its turn opens, as
   * an instruction about work that has since moved on.
   */
  async function broadcastCouncilMessage(scope: "all" | "current" = "all") {
    const message = councilSharedMessage.trim();
    const run = pitwall.councilRuns.find((item) => item.id === activeCouncilRunId);
    if (!message || !run || councilSessions.length === 0) return;

    const relayRun = relayRunRef.current[activeCouncilRunId];
    const currentMemberId = relayRun?.currentMemberId;
    const currentSessionId = currentMemberId
      ? relayRun?.members.find((member) => member.memberId === currentMemberId)?.sessionId
      : undefined;
    const recipients = councilRecipients(councilSessions, scope, currentSessionId);
    // Only claim the thread entry was addressed to one member when it truly was
    // — `councilRecipients` falls back to everyone rather than sending nowhere.
    const addressedTo =
      scope === "current" && recipients.length === 1 && recipients[0].id === currentSessionId
        ? currentMemberId ?? null
        : null;
    if (recipients.length === 0) return;

    setCouncilBroadcasting(true);
    // Shown before it is sent, not after. Delivery types the message into every
    // recipient's terminal and waits for each, so recording it afterwards meant
    // your own words took the whole send to appear — seconds, on a long message
    // to several members. The conductor routes from the thread, so it has to be
    // recorded either way.
    setCouncilSharedMessage("");
    await recordRelayUserMessage(message, addressedTo);
    try {
      const delivered = await Promise.all(
        recipients.map(async (session) => {
          const attached = terminalAttachedRef.current[session.id] || (await ensureAgentTerminal(session));
          if (!attached) return false;
          setCouncilGate(session.id, null);
          await sendTerminalPrompt(session.id, message);
          return true;
        }),
      );
      const deliveredCount = delivered.filter(Boolean).length;
      // Said plainly rather than by leaving the message out: it is in the thread
      // now, and a reader has to know the members never got it.
      if (deliveredCount === 0) {
        await recordRelayUserMessage(
          "That message reached none of the members — their terminals are not running. Restart them and send it again.",
          addressedTo,
        );
      }
      const targetIds = new Set(recipients.map((session) => session.id));
      const timestamp = nowIso();
      setPitwall((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          targetIds.has(session.id)
            ? {
                ...session,
                messages: [...session.messages, { role: "user", content: message, createdAt: timestamp }],
                updatedAt: timestamp,
              }
            : session,
        ),
        activity: [
          {
            id: makeId("activity"),
            projectId: activeProject.id,
            taskId: run.taskId,
            type: "system",
            message: addressedTo
              ? `Council message sent to ${relayRun?.members.find((member) => member.memberId === addressedTo)?.roleLabel ?? "the member on turn"}`
              : `Shared Council message sent to ${deliveredCount} member${deliveredCount === 1 ? "" : "s"}`,
            createdAt: timestamp,
          },
          ...current.activity,
        ],
      }));
    } finally {
      setCouncilBroadcasting(false);
    }
  }

  async function sendCouncilToSession(session: AgentSession) {
    const runId = relayRunIdBySessionRef.current[session.id] ?? activeCouncilRunId;
    const run = pitwallRef.current.councilRuns.find((item) => item.id === runId);
    if (!run) return;
    const relayRun = relayRunRef.current[runId];
    const member = relayRun?.members.find((item) => item.sessionId === session.id);
    if (member && relayRun?.currentMemberId !== member.memberId && !relayRun?.currentPanel.some((item) => item.memberId === member.memberId)) {
      setCouncilGate(session.id, "This member is waiting for its assignment. Hand off the current turn to continue.");
      return;
    }
    const turn = relayRun?.turn;
    const prompt = await prepareCouncilSessionPrompt(runId, session);
    if (!prompt) return;
    const attached = terminalAttachedRef.current[session.id] || (await ensureAgentTerminal(session));
    if (attached) {
      if (relayRun && (relayRunRef.current[runId] !== relayRun || relayRun.turn !== turn)) return;
      if (councilOutputLooksGated(session.id)) {
        setCouncilGate(session.id, councilGateReason(session.id, "Sign-in or approval needed — resolve it, then send the task."));
        if (member && relayRun) void resumeWhenGateClears(runId, relayRun.turn, session.id, prompt);
        return;
      }
      setCouncilGate(session.id, null);
      const sent = await sendTerminalPrompt(session.id, prompt);
      if (sent && member && relayRun && relayRun.auto && !relayRun.stopped) void watchRelayTurn(runId, relayRun.turn);
    }
  }

  /**
   * Halts the council without ending it.
   *
   * "Stop all" kills every member's CLI and marks the run finished, which is
   * the right thing when the council is going nowhere and the wrong thing —
   * irreversibly — when you only wanted it to wait. The relay already knows how
   * to not-advance; this exposes it.
   *
   * The member on turn is left to finish and write its hand-off. Interrupting
   * it mid-turn would cost the work it has already done and leave a partial
   * hand-off for the conductor to route from, which is worse than the few
   * tokens the rest of the turn costs. Nothing starts after it.
   */
  function pauseCouncil() {
    const run = relayRunRef.current[activeCouncilRunId];
    if (!run || run.paused) return;
    track("council_stopped", { outcome: "paused" });
    run.paused = true;
    stopRelay(
      activeCouncilRunId,
      "Paused. The member on turn finishes its hand-off; nothing starts after it.",
    );
    setRelayRunState((current) => ({
      ...current,
      [activeCouncilRunId]: { ...(current[activeCouncilRunId] ?? { turn: run.turn, auto: run.auto, note: "" }), paused: true },
    }));
    persistRelayRun(activeCouncilRunId);
    appendActivity({ projectId: activeProject.id, type: "system", message: `Council paused at turn ${run.turn}` });
  }

  /** Picks a paused council back up from the turn it stopped on. */
  function resumeCouncil() {
    const run = relayRunRef.current[activeCouncilRunId];
    if (!run?.paused) return;
    run.paused = false;
    run.stopped = false;
    relayWatchTokenRef.current[activeCouncilRunId] = (relayWatchTokenRef.current[activeCouncilRunId] ?? 0) + 1;
    setRelayRunState((current) => ({
      ...current,
      [activeCouncilRunId]: { ...(current[activeCouncilRunId] ?? { turn: run.turn, auto: run.auto }), paused: false, note: "" },
    }));
    persistRelayRun(activeCouncilRunId);
    appendActivity({ projectId: activeProject.id, type: "system", message: `Council resumed at turn ${run.turn}` });
    // The turn it paused on may already have written its hand-off, in which
    // case the watcher picks it up immediately and routes on.
    if (run.auto) void watchRelayTurn(activeCouncilRunId, run.turn);
  }

  async function stopCouncil() {
    const run = pitwall.councilRuns.find((item) => item.id === activeCouncilRunId);
    if (!run) return;
    track("council_stopped", { outcome: "stopped" });

    // Cancel the relay first: the watch token is keyed by run, so stopping the
    // PTYs alone would leave the watcher polling and spawning the next turn.
    stopRelay(run.id, "Council stopped.");
    for (const session of councilSessions) {
      delete relaySessionRef.current[session.id];
      if (!(await runSessionAction(session, "stop"))) return;
    }
    setPitwall((current) => ({
      ...current,
      councilRuns: current.councilRuns.map((item) =>
        item.id === run.id ? { ...item, status: "completed" } : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: activeProject.id,
          taskId: run.taskId,
          type: "system",
          message: "Council stopped",
          createdAt: nowIso(),
        },
        ...current.activity,
      ],
    }));
  }

  async function synthesizeCouncil() {
    const run = pitwallRef.current.councilRuns.find((item) => item.id === activeCouncilRunId);
    if (!run) return;
    const task = pitwallRef.current.tasks.find((item) => item.id === run.taskId);
    const councilProject = projectsRef.current.find((project) => project.id === run.projectId);
    if (!task || !councilProject || run.responses.length === 0) return;
    const firstMember = councilProject.sessions.find((session) => run.responses.some((response) => response.sessionId === session.id));
    const workspacePath = relayRunRef.current[run.id]?.projectPath ?? firstMember?.worktreePath ?? councilProject.path;

    // Prefer the run's synthesizer, else the first installed provider.
    const provider =
      providerRegistry.find((item) => item.id === run.synthesizer && agentChecks[item.agent]?.status !== "missing") ??
      providerRegistry.find((item) => canImplement(item.agent) && agentChecks[item.agent]?.status !== "missing") ??
      providerRegistry[0];
    const agent = provider.agent;
    const model = providerOptions.find((option) => option.agent === agent)?.models[0]?.label ?? "Auto";
    const timestamp = nowIso();
    const sessionId = `synth-${provider.id}-${councilProject.id}-${Date.now()}`;
    const nativeSessionId = createNativeSessionId(agent);

    const agentSession: AgentSession = {
      id: sessionId,
      name: `Synthesizer · ${agent}`,
      agent,
      status: "running",
      model,
      branch: firstMember?.branch ?? councilProject.branch,
      worktreePath: workspacePath,
      nativeSessionId,
      nativeSessionStarted: false,
      task: task.title,
      progress: 5,
      tokens: "0",
      approvals: 0,
      risk: "low",
      files: 0,
      started: "now",
      logs: [`Synthesizing council for ${task.title}`],
    };
    const pitwallSession: PitwallSession = {
      id: sessionId,
      projectId: councilProject.id,
      provider: provider.id,
      taskId: task.id,
      type: "review",
      status: "running",
      model,
      worktreePath: workspacePath,
      nativeSessionId,
      nativeSessionStarted: false,
      messages: [{ role: "system", content: `Synthesizer for "${task.title}"`, createdAt: timestamp }],
      contextSnapshotId: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    sessionProjectRef.current[sessionId] = councilProject;
    taskBySessionRef.current[sessionId] = task;
    const prompt = await prepareCouncilSessionPrompt(run.id, agentSession);
    if (!prompt) return;

    setProjects((current) =>
      current.map((project) =>
        project.id === councilProject.id
          ? { ...project, openSessions: project.sessions.length + 1, sessions: [...project.sessions, agentSession] }
          : project,
      ),
    );
    setPitwall((current) => ({
      ...current,
      sessions: [pitwallSession, ...current.sessions],
      councilRuns: current.councilRuns.map((item) =>
        item.id === run.id
          ? {
              ...item,
              synthesizer: provider.id,
              responses: [...item.responses, { provider: provider.id, sessionId, status: "running" as const }],
            }
          : item,
      ),
      activity: [
        {
          id: makeId("activity"),
          projectId: councilProject.id,
          taskId: task.id,
          type: "council-started",
          message: `Synthesizing council with ${getProviderLabel(provider.id)}`,
          createdAt: timestamp,
        },
        ...current.activity,
      ],
    }));
    updateTerminalLines((current) => ({
      ...current,
      [sessionId]: terminalNotices([
        `$ ${getBootCommand(agentOptions, agent, model) || agent}`,
        `synthesizing: ${task.title}`,
      ]),
    }));
    setWorkspaceSection("work");
    setSelectedSessionId(sessionId);

    await window.pitwall?.trustProject?.({ projectPath: workspacePath, provider: provider.id });
    const attached = await ensureAgentTerminal(agentSession);
    if (!attached) {
      setCouncilGate(sessionId, "CLI could not attach.");
      return;
    }
    await waitForSessionSettle(sessionId);
    if (councilOutputLooksGated(sessionId)) {
      setCouncilGate(sessionId, councilGateReason(sessionId, "Sign-in or approval needed in this pane — resolve it, then Send task."));
    } else {
      setCouncilGate(sessionId, null);
      await sendTerminalPrompt(sessionId, prompt);
    }
  }

  async function addProject() {
    const selectedPath = await window.pitwall?.chooseProjectDirectory();
    if (!selectedPath) return;

    const newProject = makeProjectFromPath(selectedPath, projects.length);
    const projectState = createEmptyProjectState(newProject);
    setProjects((current) => [...current, newProject]);
    setPitwall((current) => ({
      ...current,
      projects: [...current.projects, ...projectState.projects],
      tasks: [...current.tasks, ...projectState.tasks],
      contextEntries: [...current.contextEntries, ...projectState.contextEntries],
      activity: [...projectState.activity, ...current.activity],
    }));
    setActiveProjectId(newProject.id);
    setSelectedSessionId("");
    track("project_added");
    void window.pitwall?.learnProjectKnowledge?.({ projectPath: newProject.path }).then((result) => {
      if (result.ok) setKnowledgeRefresh((value) => value + 1);
      else setSystemNotice({ tone: "error", title: "Project learning failed", message: result.error || "Open Context to retry learning this project." });
    }).catch((error: unknown) => setSystemNotice({ tone: "error", title: "Project learning failed", message: error instanceof Error ? error.message : String(error) }));
  }

  /**
   * Description-first project creation. Creates the folder, registers the
   * project, seeds a task from the description, and starts a two-stage relay:
   * the scoping agent designs and writes a handoff, the implementer builds from
   * it. Everything after the folder exists reuses the normal council path.
   */
  async function createDescribedProject(draft: DescribedProjectDraft) {
    const invalid = validateProjectName(draft.name) || validateProjectDescription(draft.description);
    if (invalid) {
      setCreateProjectFlowError(invalid);
      return;
    }

    setCreateProjectFlowError("");
    const parentPath = await window.pitwall?.chooseProjectDirectory();
    if (!parentPath) return;

    setCreateProjectFlowBusy(true);
    try {
      const created = await window.pitwall?.createProjectDirectory?.({
        parentPath,
        folderName: slugifyProjectName(draft.name),
        brief: buildProjectBrief({ name: draft.name, description: draft.description }),
      });
      if (!created?.ok || !created.path) {
        setCreateProjectFlowError(created?.error || "Could not create the project folder.");
        return;
      }

      const newProject = makeProjectFromPath(created.path, projects.length);
      const projectState = createEmptyProjectState(newProject);
      const taskDraft = buildProjectTaskDraft({ name: draft.name, description: draft.description });
      const timestamp = nowIso();
      const task: PitwallTask = {
        id: makeId("task"),
        identifier: taskDraft.identifier,
        projectId: newProject.id,
        title: taskDraft.title,
        description: taskDraft.description,
        status: "ready",
        priority: "high",
        assignedAgent: "council",
        relatedFiles: ["BRIEF.md"],
        worktree: taskDraft.identifier,
        source: { kind: "local" },
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      setProjects((current) => [...current, newProject]);
      setPitwall((current) => ({
        ...current,
        projects: [...current.projects, ...projectState.projects],
        tasks: [task, ...current.tasks, ...projectState.tasks],
        contextEntries: [...current.contextEntries, ...projectState.contextEntries],
        activity: [
          {
            id: makeId("activity"),
            projectId: newProject.id,
            taskId: task.id,
            type: "task-created" as const,
            message: `Project created from a description: ${newProject.name}`,
            createdAt: timestamp,
          },
          // Git problems are non-fatal — the project still opens, so surface the
          // reason in the timeline instead of blocking creation on it.
          ...(created.warning
            ? [
                {
                  id: makeId("activity"),
                  projectId: newProject.id,
                  type: "system" as const,
                  message: created.warning,
                  createdAt: timestamp,
                },
              ]
            : []),
          ...projectState.activity,
          ...current.activity,
        ],
      }));
      setActiveProjectId(newProject.id);
      setSelectedSessionId("");
      setDraftTaskId(task.id);
      setCreateProjectFlowOpen(false);

      await startCouncilMode(
        // The scaffold speaks in provider ids; a council member is now an
        // agent and the model it runs, so the pipeline is resolved to one.
        buildScopingPipeline({
          scopingProviderId: draft.scopingProviderId,
          implementerProviderId: draft.implementerProviderId,
        }).map((member) => {
          const agent = providerRegistry.find((item) => item.id === member.providerId)?.agent
            ?? providerOptions[0]?.agent;
          return {
            agent,
            model: providerOptions.find((option) => option.agent === agent)?.models[0]?.label ?? "Auto",
            role: member.role,
          };
        }),
        "council",
        { project: newProject, task, contextEntries: projectState.contextEntries },
      );
    } catch (error) {
      setCreateProjectFlowError(actionableError(error, "filesystem"));
    } finally {
      setCreateProjectFlowBusy(false);
    }
  }

  async function removeProject(project: Project) {
    const confirmed = window.confirm(
      `Remove "${project.name}" from Pitwall? Its sessions, tasks and context in Pitwall are cleared — your files on disk are untouched.`,
    );
    if (!confirmed) return;

    const stopped = await Promise.all(project.sessions.map((session) => requestSessionAction(project.id, session.id, "delete")));
    if (stopped.some((ok) => !ok)) return;
    await releaseTaskRuntime(project.id);

    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      if (activeProjectId === project.id) {
        setActiveProjectId(next[0]?.id ?? "");
        setSelectedSessionId("");
      }
      return next;
    });
    setPitwall((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== project.id),
      tasks: current.tasks.filter((item) => item.projectId !== project.id),
      sessions: current.sessions.filter((item) => item.projectId !== project.id),
      contextEntries: current.contextEntries.filter((item) => item.projectId !== project.id),
      contextSnapshots: current.contextSnapshots.filter((item) => item.projectId !== project.id),
      activity: current.activity.filter((item) => item.projectId !== project.id),
      councilRuns: current.councilRuns.filter((item) => item.projectId !== project.id),
      compareRuns: current.compareRuns.filter((item) => item.projectId !== project.id),
    }));
    setProjectNotifications((current) => clearProjectNotification(current, project.id));
  }

  async function requestSessionAction(projectId: string, sessionId: string, action: string) {
    try {
      const result = await window.pitwall?.runSessionAction({ projectId, sessionId, action });
      if (!result?.ok) throw new Error(result?.error || "The session action could not be completed.");
      if (action === "stop" || action === "delete") {
        terminalAttachedRef.current[sessionId] = false;
        setTerminalAttachedBySession((current) => ({ ...current, [sessionId]: false }));
      }
      return true;
    } catch (error) {
      setSystemNotice({ tone: "error", title: `Could not ${action} the session`, message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async function releaseTaskRuntime(projectId: string, taskId?: string) {
    try {
      const result = await window.pitwall?.releaseTaskRuntime?.({ projectId, taskId });
      if (!result?.ok) return false;
      for (const sessionId of Object.keys(taskRuntimeBySessionRef.current)) {
        const task = taskBySessionRef.current[sessionId];
        const run = pitwallRef.current.sessions.find((item) => item.id === sessionId);
        const ownerId = task?.projectId ?? run?.projectId ?? sessionProjectRef.current[sessionId]?.id;
        if (ownerId === projectId && (!taskId || (task?.id ?? run?.taskId ?? sessionId) === taskId)) {
          delete taskRuntimeBySessionRef.current[sessionId];
          delete taskBySessionRef.current[sessionId];
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Removes a finished task's worktrees, when nothing in them would be lost.
   *
   * Main keeps one a terminal still runs in, or with uncommitted work, or with
   * commits no remote has; those stay listed under unfinished worktrees. Asked
   * again when the task's last terminal closes.
   */
  async function retireTaskWorktrees(projectId: string, taskId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project || !taskId) return;
    const paths = new Set(pitwallRef.current.sessions
      .filter((session) => session.taskId === taskId && session.worktreePath && session.worktreePath !== project.path)
      .map((session) => session.worktreePath as string));
    for (const worktreePath of paths) {
      const result = await window.pitwall?.removeWorktree?.({ projectPath: project.path, worktreePath, onlyIfSafe: true })
        .catch(() => null);
      // The agent may have renamed the branch it was given, and a resume
      // recreates the worktree from the branch the work is actually on.
      const branch = result?.removed ? result.branch : "";
      if (!branch) continue;
      setProjects((current) => current.map((item) => item.id !== projectId ? item : {
        ...item,
        sessions: item.sessions.map((session) =>
          session.worktreePath === worktreePath && session.branch !== branch ? { ...session, branch } : session),
      }));
    }
  }

  /** Where a session runs: its worktree, recreated from its branch if finished work removed it. */
  async function sessionWorkspace(session: AgentSession, project: Project) {
    const current = session.worktreePath;
    if (!current || current === project.path || !session.branch) return current || project.path;
    const worktree = await window.pitwall?.ensureWorktree?.({
      projectPath: project.path,
      branch: session.branch,
      baseBranch: project.branch || "HEAD",
      worktreePath: current,
      // So a worktree comes back on the branch the agent moved this ticket's work to.
      ticket: pitwallRef.current.tasks.find((task) => task.id === pitwallRef.current.sessions.find((item) => item.id === session.id)?.taskId)?.identifier,
    }).catch(() => null);
    const restored = worktree?.ok ? worktree.path : undefined;
    if (worktree && !worktree.ok && worktree.error) workspaceProblemRef.current[session.id] = worktree.error;
    else delete workspaceProblemRef.current[session.id];
    if (!restored || restored === current) return current;
    const moved = <T extends { worktreePath?: string }>(item: T): T =>
      item.worktreePath === current ? { ...item, worktreePath: restored } : item;
    setProjects((all) => all.map((item) => item.id !== project.id ? item : { ...item, sessions: item.sessions.map(moved) }));
    setPitwall((state) => ({ ...state, sessions: state.sessions.map(moved) }));
    return restored;
  }

  async function openWorktreeAudit(projectPath = activeProject.path) {
    setWorktreeAudit((current) => ({ ...current, open: true, error: "", worktrees: current.open ? current.worktrees : null }));
    const result = await window.pitwall?.auditWorktrees?.({ projectPath }).catch(() => null);
    setWorktreeAudit((current) => ({
      ...current,
      worktrees: result?.ok ? result.worktrees : [],
      error: result?.ok ? "" : result?.error || "Worktrees could not be read.",
    }));
  }

  async function removeAuditedWorktree(worktree: WorktreeAudit) {
    setWorktreeAudit((current) => ({ ...current, busyPath: worktree.path }));
    const result = await window.pitwall?.removeWorktree?.({ projectPath: activeProject.path, worktreePath: worktree.path })
      .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    setWorktreeAudit((current) => ({ ...current, busyPath: "" }));
    await openWorktreeAudit();
    if (!result?.ok) setWorktreeAudit((current) => ({ ...current, error: result?.error || "The worktree could not be removed." }));
  }

  async function runSessionAction(session: AgentSession, action: string) {
    if (!session.id) return;

    if (!(await requestSessionAction(activeProject.id, session.id, action))) return false;

    const started = action === "start" ? await ensureAgentTerminal(session) : undefined;
    if (action === "stop") track("session_stopped", { agent: session.agent.toLowerCase() });

    const timestamp = nowIso();
    setPitwall((current) => {
      const pitwallSession = current.sessions.find((item) => item.id === session.id);
      const nextSessionStatus =
        action === "start" || action === "unblock"
          ? started ? "running" : "failed"
          : action === "pause"
            ? "waiting"
            : action === "stop"
              ? "completed"
              : pitwallSession?.status ?? "completed";
      return {
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id
            ? {
                ...item,
                status: nextSessionStatus,
                updatedAt: timestamp,
              }
            : item,
        ),
        activity: [
          {
            id: makeId("activity"),
            projectId: activeProject.id,
            taskId: pitwallSession?.taskId,
            sessionId: session.id,
            provider: pitwallSession?.provider,
            type: "system",
            message: `${session.name}: ${action}`,
            createdAt: timestamp,
          },
          ...current.activity,
        ],
      };
    });

    setProjects((current) =>
      current.map((project) => {
        if (project.id !== activeProject.id) return project;

        return {
          ...project,
          timeline: [
            `${session.name}: ${action} issued`,
            ...project.timeline.slice(0, 5),
          ],
          sessions: project.sessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  status: action === "start" ? started ? "running" : "failed" : nextStatus(action, item.status),
                  logs: [`${action} command accepted`, ...item.logs.slice(0, 4)],
                  progress:
                    action === "start" || action === "unblock"
                      ? Math.max(item.progress, 12)
                      : item.progress,
                }
              : item,
          ),
        };
      }),
    );
    return action === "start" ? Boolean(started) : true;
  }

  async function deleteSession(session: AgentSession) {
    if (!session.id) return;

    // The sidebar offers a delete on every project's rows, not only the open one's.
    const owner = projectsRef.current.find((project) => project.sessions.some((item) => item.id === session.id)) ?? activeProject;
    setDeletingSessionId(session.id);
    try {
      if (!(await requestSessionAction(owner.id, session.id, "delete"))) return false;
      const taskId = pitwallRef.current.sessions.find((item) => item.id === session.id)?.taskId;
      await releaseTaskRuntime(owner.id, taskId || session.id);

      const remainingSessions = owner.sessions.filter((item) => item.id !== session.id);
      const workspaceStillUsed = Boolean(
        session.worktreePath && remainingSessions.some((item) => item.worktreePath === session.worktreePath),
      );

      if (session.worktreePath && !workspaceStillUsed && session.worktreePath !== owner.path) {
      }

      setProjects((current) =>
        current.map((project) => {
          if (project.id !== owner.id) return project;
          const sessions = project.sessions.filter((item) => item.id !== session.id);
          return {
            ...project,
            openSessions: sessions.length,
            timeline: [`${session.name}: session deleted`, ...project.timeline.slice(0, 5)],
            sessions,
          };
        }),
      );
      setPitwall((current) => ({
        ...current,
        sessions: current.sessions.filter((item) => item.id !== session.id),
        contextSnapshots: current.contextSnapshots.filter((item) => item.sessionId !== session.id),
        councilRuns: current.councilRuns
          .map((run) => ({
            ...run,
            responses: run.responses.filter((response) => response.sessionId !== session.id),
          }))
          .filter((run) => run.responses.length > 0),
        compareRuns: current.compareRuns
          .map((run) => ({
            ...run,
            responses: run.responses.filter((response) => response.sessionId !== session.id),
          }))
          .filter((run) => run.responses.length > 0),
        activity: [
          {
            id: makeId("activity"),
            projectId: owner.id,
            type: "system",
            message: `${session.name}: session deleted (branch and files kept)`,
            createdAt: nowIso(),
          },
          ...current.activity,
        ],
      }));
      setSelectedSessionId((current) =>
        current === session.id ? remainingSessions[0]?.id ?? "" : current,
      );

      detachSessionsFromRelay([session.id]);

      const omitSession = <T,>(current: Record<string, T>) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      };
      setTerminalAttachedBySession(omitSession);
      updateTerminalLines(omitSession);
      setCouncilGateBySession(omitSession);
      setRelayBySession(omitSession);
      setSessionPendingDelete(null);
      return true;
    } finally {
      setDeletingSessionId("");
    }
  }

  async function deleteCouncilRun(run: PitwallCouncilRun) {
    const sessionIds = new Set(run.responses.map((response) => response.sessionId));
    const owner = projectsRef.current.find((project) => project.id === run.projectId) ?? activeProject;
    const sessions = owner.sessions.filter((session) => sessionIds.has(session.id));
    if (sessions.length === 0) {
      setCouncilPendingDelete(null);
      return;
    }

    setDeletingCouncilRunId(run.id);
    try {
      const stopped = await Promise.all(sessions.map((session) => requestSessionAction(owner.id, session.id, "stop")));
      if (stopped.some((ok) => !ok)) return false;
      await releaseTaskRuntime(owner.id, run.taskId);

      const remainingSessions = owner.sessions.filter((session) => !sessionIds.has(session.id));
      setProjects((current) =>
        current.map((project) => {
          if (project.id !== owner.id) return project;
          const projectSessions = project.sessions.filter((session) => !sessionIds.has(session.id));
          return {
            ...project,
            openSessions: projectSessions.length,
            timeline: [`${run.name ?? "Council"}: Council deleted`, ...project.timeline.slice(0, 5)],
            sessions: projectSessions,
          };
        }),
      );
      setPitwall((current) => ({
        ...current,
        sessions: current.sessions.filter((session) => !sessionIds.has(session.id)),
        contextSnapshots: current.contextSnapshots.filter((snapshot) => !sessionIds.has(snapshot.sessionId)),
        councilRuns: current.councilRuns.filter((item) => item.id !== run.id),
        compareRuns: current.compareRuns
          .map((item) => ({
            ...item,
            responses: item.responses.filter((response) => !sessionIds.has(response.sessionId)),
          }))
          .filter((item) => item.responses.length > 0),
        activity: [
          {
            id: makeId("activity"),
            projectId: owner.id,
            taskId: run.taskId,
            type: "system",
            message: `${run.name ?? "Council"}: Council deleted (branches and files kept)`,
            createdAt: nowIso(),
          },
          ...current.activity,
        ],
      }));
      setSelectedSessionId((current) =>
        sessionIds.has(current) ? remainingSessions[0]?.id ?? "" : current,
      );
      setActiveCouncilRunId((current) => (current === run.id ? "" : current));

      detachSessionsFromRelay(sessionIds);

      const omitSessions = <T,>(current: Record<string, T>) => {
        const next = { ...current };
        for (const sessionId of sessionIds) delete next[sessionId];
        return next;
      };
      setTerminalAttachedBySession(omitSessions);
      updateTerminalLines(omitSessions);
      setCouncilGateBySession(omitSessions);
      setRelayBySession(omitSessions);
      setCouncilPendingDelete(null);
    } finally {
      setDeletingCouncilRunId("");
    }
  }

  async function deleteTask(task: PitwallTask) {
    const taskCouncilRuns = pitwall.councilRuns.filter((run) => run.taskId === task.id);
    const taskCompareRuns = pitwall.compareRuns.filter((run) => run.taskId === task.id);
    const sessionIds = new Set(
      pitwall.sessions.filter((session) => session.taskId === task.id).map((session) => session.id),
    );
    for (const run of [...taskCouncilRuns, ...taskCompareRuns]) {
      for (const response of run.responses) sessionIds.add(response.sessionId);
    }

    const branch = taskBranchName(task);
    const sessions = activeProject.sessions.filter(
      (session) => sessionIds.has(session.id) || (branch && session.branch === branch),
    );
    for (const session of sessions) sessionIds.add(session.id);

    setDeletingTaskId(task.id);
    try {
      const stopped = await Promise.all(sessions.map((session) => requestSessionAction(activeProject.id, session.id, "stop")));
      if (stopped.some((ok) => !ok)) return false;
      await releaseTaskRuntime(task.projectId, task.id);

      const remainingSessions = activeProject.sessions.filter((session) => !sessionIds.has(session.id));
      setProjects((current) =>
        current.map((project) => {
          if (project.id !== activeProject.id) return project;
          const projectSessions = project.sessions.filter((session) => !sessionIds.has(session.id));
          return {
            ...project,
            openSessions: projectSessions.length,
            timeline: [`${task.title}: task deleted`, ...project.timeline.slice(0, 5)],
            sessions: projectSessions,
          };
        }),
      );
      setPitwall((current) => ({
        ...current,
        tasks: current.tasks.filter((item) => item.id !== task.id),
        sessions: current.sessions.filter((session) => !sessionIds.has(session.id) && session.taskId !== task.id),
        contextSnapshots: current.contextSnapshots.filter(
          (snapshot) => snapshot.taskId !== task.id && !sessionIds.has(snapshot.sessionId),
        ),
        councilRuns: current.councilRuns.filter((run) => run.taskId !== task.id),
        compareRuns: current.compareRuns.filter((run) => run.taskId !== task.id),
        activity: [
          {
            id: makeId("activity"),
            projectId: activeProject.id,
            type: "system",
            message: `${task.title}: task deleted (branches and files kept)`,
            createdAt: nowIso(),
          },
          ...current.activity.filter((event) => event.taskId !== task.id),
        ],
      }));

      const remainingTasks = projectTasks.filter((item) => item.id !== task.id);
      setDraftTaskId((current) => (current === task.id ? remainingTasks[0]?.id ?? "" : current));
      setSelectedSessionId((current) =>
        sessionIds.has(current) ? remainingSessions[0]?.id ?? "" : current,
      );
      const removedCouncilRunIds = new Set(taskCouncilRuns.map((run) => run.id));
      setActiveCouncilRunId((current) => (removedCouncilRunIds.has(current) ? "" : current));
      if (pendingTaskStartRef.current === task.id) pendingTaskStartRef.current = null;

      detachSessionsFromRelay(sessionIds);
      const omitSessions = <T,>(current: Record<string, T>) => {
        const next = { ...current };
        for (const sessionId of sessionIds) delete next[sessionId];
        return next;
      };
      setTerminalAttachedBySession(omitSessions);
      updateTerminalLines(omitSessions);
      setCouncilGateBySession(omitSessions);
      setRelayBySession(omitSessions);
      setSessionPendingDelete((current) => (current && sessionIds.has(current.id) ? null : current));
      setCouncilPendingDelete((current) =>
        current && removedCouncilRunIds.has(current.id) ? null : current,
      );
      setTasksPendingDelete((current) => current.filter((item) => item.id !== task.id));
    } finally {
      setDeletingTaskId("");
    }
  }

  async function selectSession(session: AgentSession) {
    if (!session.id) return;
    if (session.id !== selectedSession.id) track("session_opened", { agent: session.agent.toLowerCase() });

    const councilRun = pitwall.councilRuns.find((run) =>
      run.responses.some((response) => response.sessionId === session.id),
    );
    if (councilRun) {
      setActiveCouncilRunId(councilRun.id);
      const isCompareRun =
        councilRun.name?.endsWith(" · Compare") ||
        councilRun.responses.some((response) => response.sessionId.startsWith("compare-"));
      setActiveCouncilMode(isCompareRun ? "compare" : "council");
    }
    const run = pitwall.sessions.find((item) => item.id === session.id);
    if (run?.taskId) setDraftTaskId(run.taskId);
    setWorkspaceSection("work");
    setSelectedSessionId(session.id);
    // A council member opens on the grid, where the thread and the other
    // members are; a lone session opens on its terminal. Always choosing the
    // terminal put you on one pane of a four-pane conversation.
    setWorkbenchTab(councilRun ? "council" : "terminal");
    await ensureAgentTerminal(session);
  }

  function renameSession(sessionId: string, name: string) {
    const nextName = name.trim();
    if (!sessionId || !nextName) return;

    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              sessions: project.sessions.map((session) =>
                session.id === sessionId ? { ...session, name: nextName } : session,
              ),
            }
          : project,
      ),
    );
  }

  /**
   * Move `draggedId` to `targetId`'s position. Operates on the project's whole
   * session array rather than the filtered strip, so council chips keep their
   * places instead of being silently reshuffled by an index mismatch.
   */
  function reorderSession(draggedId: string, targetId: string) {
    if (!draggedId || draggedId === targetId) return;

    setProjects((current) =>
      current.map((project) => {
        if (project.id !== activeProject.id) return project;
        const sessions = [...project.sessions];
        const from = sessions.findIndex((session) => session.id === draggedId);
        const to = sessions.findIndex((session) => session.id === targetId);
        if (from === -1 || to === -1) return project;
        const [moved] = sessions.splice(from, 1);
        sessions.splice(to, 0, moved);
        return { ...project, sessions };
      }),
    );
  }

  function selectDraftAgent(agent: AgentProvider) {
    const provider = agentOptions.find((option) => option.agent === agent) ?? agentOptions[0];
    setDraftAgent(provider.agent);
    setDraftTaskAgent(providerIdFromAgent(provider.agent));
    setDraftModel(provider.models[0].label);
  }

  function handleSaveCustomAgent(input: AddAgentInput, reopenSession = true) {
    const name = input.name.trim();
    const command = input.command.trim();
    if (!name || !command) return;

    const models = splitLines(input.models).map((label) => ({ label, value: label }));
    const agent: CustomAgentDefinition = {
      id: makeId("agent"),
      name,
      command,
      args: input.args.trim(),
      loginCommand: input.login.trim(),
      modelDiscoveryCommand: input.modelDiscoveryCommand.trim(),
      models,
      createdAt: nowIso(),
    };

    setCustomAgents((current) => {
      const next = [...current.filter((item) => item.name !== name), agent];
      writeCustomAgents(next);
      return next;
    });
    setDraftAgent(name);
    setDraftModel(models[0]?.label ?? "default");
    setAddAgentOpen(false);
    if (reopenSession) setCreateSessionOpen(true);
  }

  function removeCustomAgent(id: string, name: string) {
    setCustomAgents((current) => {
      const next = current.filter((item) => item.id !== id);
      writeCustomAgents(next);
      return next;
    });
    if (draftAgent === name) setDraftAgent("Codex");
  }

  /**
   * The single writer for pane buffers. PTY output arrives on an event while
   * the app is also printing notices of its own, and the two used to reach the
   * buffer by different routes: the event built its next array from the ref,
   * everything else from React state, and whichever landed second overwrote
   * what the other had just put there. A council reseed racing a chunk that way
   * handed a mounted pane a buffer shorter than the one it had already written.
   *
   * The ref is the buffer; state is the copy React renders. Writing both here,
   * in that order, keeps them in step and keeps the ref current for the council
   * logic that reads it between renders.
   */
  function updateTerminalLines(
    update: (current: Record<string, string[]>) => Record<string, string[]>,
  ) {
    const next = update(terminalLinesRef.current);
    terminalLinesRef.current = next;
    terminalLinesStore.publish(next);
  }

  /**
   * Moves a session between its two surfaces.
   *
   * They are front-ends onto one Claude conversation, not two conversations, so
   * the surface being left is shut down first: both resume the same session id,
   * and leaving two processes attached to it means two writers on one history.
   * Whichever surface is showing is the one holding the conversation.
   */
  /**
   * The choice a pane is waiting on, read off its rendered screen.
   *
   * Not from the chunk stream: a TUI repaints constantly, so the stream holds
   * every past frame and there is no way to tell from it which menu is still
   * open. The screen is the current frame, which is the question being asked.
   */
  function pendingMenuFor(sessionId: string): TerminalMenu | null {
    void screenTick;
    // The mounted pane first, because it is the terminal the person is actually
    // looking at and is sized as they see it; the mirror for every session that
    // has no pane, which is most of them.
    const screen = terminalHandlesRef.current[sessionId]?.readScreen() || screenMirrorRef.current.read(sessionId);
    return screen ? readTerminalMenu(screen) : null;
  }

  /**
   * Whether a session is working, according to its own pane.
   *
   * The conversation cannot answer this on its own: a turn that ends normally
   * writes a stop_reason, and one that is abandoned writes nothing, so a reader
   * waiting for completion waits forever. The pane offers "esc to interrupt"
   * exactly while there is something to interrupt.
   */
  screenSignatureRef.current = () => allSessions.map((session) => {
    const screen = terminalHandlesRef.current[session.id]?.readScreen() || screenMirrorRef.current.read(session.id);
    if (!screen) return "";
    const menu = readTerminalMenu(screen);
    return `${session.id}:${readTerminalBusy(screen) ? 1 : 0}:${menu ? JSON.stringify(menu) : ""}`;
  }).join("\n");
  runningSessionCountRef.current = allSessions.filter((session) => session.status === "running").length;

  function screenBusyFor(sessionId: string): boolean | null {
    void screenTick;
    const screen = terminalHandlesRef.current[sessionId]?.readScreen() || screenMirrorRef.current.read(sessionId);
    return screen ? readTerminalBusy(screen) : null;
  }

  /**
   * Answers a pane's menu from the chat: one keystroke, the number on screen.
   *
   * An earlier version moved the highlight with arrows and verified before
   * confirming. That was worse than no feature. The arrows had to go out before
   * anything could be checked, so a failed check left the highlight moved and
   * told nobody — several clicks drifted it several rows, and the first check
   * that passed confirmed whatever it had landed on. Sending the number cannot
   * drift: the CLI acts on that option, or on nothing at all.
   */
  async function answerTerminalMenu(session: AgentSession, _menu: TerminalMenu, choice: MenuOption) {
    const write = window.pitwall?.writeTerminal;
    const key = menuChoiceKey(choice.index);
    if (!write || !key) {
      setSystemNotice({
        tone: "error",
        title: "That option cannot be sent",
        message: `Answer "${choice.label}" in Terminal instead.`,
      });
      return;
    }
    // A write is refused, not queued, when the session has no CLI attached, and
    // ignoring that is how a click on an option came to do nothing at all.
    const sent = await write({ sessionId: session.id, data: key });
    if (!sent?.ok) {
      setSystemNotice({
        tone: "error",
        title: "That option was not sent",
        message: `${session.name} has no CLI attached. Attach it, then answer "${choice.label}" again.`,
      });
    }
  }

  /** Which surface a session is showing. */
  function surfaceFor(session: AgentSession): SessionSurface {
    // The terminal is the default and always will be: it is the CLI itself and
    // cannot be wrong about itself. The thread is where the same session is
    // read back afterwards.
    return agentViewBySession[session.id] ?? "terminal";
  }

  /**
   * Which agents keep a session file Pitwall can read back.
   *
   * Everything else is terminal-only, and says so by not offering a toggle
   * rather than by offering one that opens an empty panel.
   */
  function hasReadableTranscript(session: AgentSession) {
    return session.agent === "Claude" || session.agent === "Codex";
  }

  function switchAgentSurface(session: AgentSession, surface: SessionSurface) {
    if (surfaceFor(session) === surface) return;
    setAgentViewBySession((current) => ({ ...current, [session.id]: surface }));
  }

  /**
   * Moves a card to another column.
   *
   * Pitwall's board only. The ticket in Jira or Linear is not transitioned, so
   * the column stops claiming to be the tracker's word the moment it is moved —
   * which is why the move is stored on the task rather than written back.
   */
  /**
   * The escape hatch for work git will never call done.
   *
   * A branch on a project with no remote, never merged and never deleted, has
   * no fact that settles it. Completing by hand is gone because it was the
   * drift; abandoning work is a judgement git cannot infer, so it stays here.
   */
  function cancelTask(task: PitwallTask) {
    const timestamp = nowIso();
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "cancelled" as const, updatedAt: timestamp } : item),
    }));
  }

  function moveTaskToColumn(task: PitwallTask, column: string) {
    setPitwall((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, boardColumn: column, updatedAt: nowIso() } : item,
      ),
    }));
  }

  /**
   * A line from Pitwall in a session's terminal — only while no program is
   * drawing there. A full-screen agent repaints by moving its cursor to cells
   * it remembers; a line written into its screen moves that cursor and scrolls
   * the screen under it, and every repaint after lands a row off for the rest
   * of the session. So once the agent has printed, news goes to the window,
   * and what is only news to the terminal is dropped.
   */
  function appendTerminalLine(sessionId: string, line: string, { informational = false } = {}) {
    if (terminalAttachedRef.current[sessionId] && terminalPtyActivityRef.current[sessionId]) {
      if (!informational) {
        const session = projectsRef.current.flatMap((project) => project.sessions).find((item) => item.id === sessionId);
        setSystemNotice({ tone: "warn", title: session?.name ?? "Agent session", message: line });
      }
      return;
    }
    updateTerminalLines((current) => ({
      ...current,
      [sessionId]: appendCapped(current[sessionId], [terminalNotice(line)]),
    }));
  }

  /**
   * The size a full-width terminal pane last fitted to, whichever session it
   * belonged to.
   *
   * A session started with no pane on screen — the scheduler's, or one created
   * while the council is open — has nobody to ask how wide it should be, and
   * started at a hardcoded 132 columns. The CLI then drew its tables and rules
   * for 132 while the pane you eventually opened it in was nearer 180, and the
   * width a screen was painted at cannot be recovered afterwards. Every pane in
   * this workspace is the same size, so the last one to fit is a good answer.
   *
   * Only full-width panes are recorded: a council cell is a quarter of the room
   * and would be the wrong answer for a session opened on its own.
   */
  const workbenchTerminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const [sendPtySize] = useState(() => createKeyedThrottle<{ cols: number; rows: number }>(80, (sessionId, size) => {
    void window.pitwall?.resizeTerminal?.({ sessionId, ...size });
  }));

  /** Remembers a pane's fitted size and keeps its PTY in step with it. */
  function recordTerminalSize(sessionId: string, cols: number, rows: number, workbench = false) {
    if (!sessionId || !cols || !rows) return;
    if (workbench) workbenchTerminalSizeRef.current = { cols, rows };
    const previous = terminalSizeRef.current[sessionId];
    terminalSizeRef.current[sessionId] = { cols, rows };
    // Published as state as well as a ref, because a session can be rendered in
    // two panes — its row in the Terminal tab and its cell in the Council grid —
    // and the hidden one has to be able to notice that the other resized the
    // PTY out from under it.
    // Both dimensions, because a pane that is only the wrong height is just as
    // unreadable as one that is the wrong width, and publishing the width alone
    // left the hidden pane unable to tell that anything had changed.
    if (!previous || previous.cols !== cols || previous.rows !== rows) {
      setPtySize((current) => {
        const held = current[sessionId];
        if (held && held.cols === cols && held.rows === rows) return current;
        return { ...current, [sessionId]: { cols, rows } };
      });
    }
    sendPtySize(sessionId, { cols, rows });
  }

  /**
   * Waits for a pane to report the size it fitted to. Panes mount a render or
   * two after the session is created, and starting the CLI before that means
   * guessing its width — which is how a council pane ends up showing wrapped,
   * overlapping text.
   *
   * Six hundred milliseconds, not two seconds. A pane that is going to answer
   * does so on the frame after it mounts, so the full wait was only ever spent
   * where nothing was going to answer at all — a session the scheduler started
   * with no pane on screen — and it was spent before the CLI had been asked to
   * start. There is a workspace size to fall back on now, so the wait no longer
   * has to be long enough to be the last word.
   */
  async function waitForTerminalSize(sessionId: string, maxMs = 600) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const size = terminalSizeRef.current[sessionId];
      if (size) return size;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return undefined;
  }

  async function ensureAgentTerminal(
    session: AgentSession,
    options: { resume?: boolean; initialPrompt?: string; refreshContext?: boolean } = {},
  ) {
    if (!session.id) return false;
    if (terminalAttachedRef.current[session.id]) return true;
    // Counted once per attach, below, when the CLI is confirmed running.
    const countAttach = () => track("session_started", { agent: session.agent.toLowerCase() });
    if (attachingTerminalRef.current[session.id]) {
      // Selecting the newly-created session can start attachment from the
      // terminal-pane effect before createAgentSession reaches this call. Join
      // that attempt instead of reporting a false failure and dropping the task.
      const deadline = Date.now() + 30_000;
      while (attachingTerminalRef.current[session.id] && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      return Boolean(terminalAttachedRef.current[session.id]);
    }

    attachingTerminalRef.current[session.id] = true;
    let initialPrompt = options.initialPrompt ?? terminalInitialPromptRef.current[session.id];
    let refreshedResumeContext = false;

    try {
      const model = getModelCommandValue(agentOptions, session.agent, session.model);
      const option = agentOptions.find((item) => item.agent === session.agent);
      const resolved = resolveAgentLaunch(option, session.model);
      // A session records how it was launched precisely for the case where the
      // option is not there any more: a local model's row is derived from what
      // Ollama has pulled, so a restart, a stopped server or a slow first
      // discovery would otherwise leave a session that cannot be started at all.
      const launch = resolved.command
        ? resolved
        : session.launchCommand
          ? { command: session.launchCommand, args: session.launchArgs ?? [] }
          : resolved;
      // A built-in provider needs no command — the main process has a profile
      // for it. Anything else does, and "Unsupported agent" is a useless thing
      // to be told when the real answer is that Ollama is not answering or the
      // model is no longer pulled.
      const builtIn = providerRegistry.some((provider) => provider.agent === session.agent);
      if (!builtIn && !launch.command) {
        appendTerminalLine(session.id, `${session.agent} has no launch command available.`);
        setSystemNotice({
          tone: "error",
          title: `${session.agent} is not available`,
          message: option?.local || /ollama/i.test(String(session.agent))
            ? "Ollama is not answering, or that model is no longer pulled. Start Ollama, or pull the model again, and retry the session."
            : "That agent is no longer configured. Add it again in Connections, then retry the session.",
        });
        return false;
      }

      const ownerProject =
        sessionProjectRef.current[session.id] ??
        projects.find((project) => project.sessions.some((item) => item.id === session.id)) ??
        activeProject;
      const workspacePath = await sessionWorkspace(session, ownerProject);
      const shouldResume = options.resume ?? session.nativeSessionStarted !== false;
      const taskRun = pitwallRef.current.sessions.find((item) => item.id === session.id);
      const task = (taskRun ? pitwallRef.current.tasks.find((item) => item.id === taskRun.taskId) : undefined)
        ?? taskBySessionRef.current[session.id];
      const taskRuntime = taskRuntimeBySessionRef.current[session.id] ?? (task ? await allocateTaskRuntime(task, session.id) : undefined);
      if (task && !taskRuntime) return false;
      if (!initialPrompt && options.refreshContext && shouldResume && task?.status === "running" && !relayRunIdBySessionRef.current[session.id]) {
        const snapshot = pitwallRef.current.contextSnapshots.find((entry) => entry.sessionId === session.id);
        const entryIds = new Set(snapshot?.contextEntries.map((entry) => entry.id) ?? []);
        initialPrompt = await prepareAgentPrompt({
          projectPath: ownerProject.path, workspacePath,
          projectId: ownerProject.id, taskId: task.id, sessionId: session.id, task,
          provider: providerIdFromAgent(session.agent), role: taskRun?.type ?? "implementation",
          manualEntries: pitwallRef.current.contextEntries.filter((entry) => entryIds.has(entry.id)),
          // Only Claude, and Codex once its conversation was recorded, come
          // back with their history. Anything else starts blank, and telling a
          // blank agent to "continue" left it waiting with no task at all.
          basePrompt: session.agent === "Claude" || (session.agent === "Codex" && session.nativeSessionId)
            ? `The existing session has resumed for task: ${task.title}. Continue from the latest user instruction in this conversation. The following project references have been checked against the current workspace; verify any stale claims before relying on them.`
            : [
                "Pitwall restarted and this session's earlier conversation could not be restored, so here is the task again. Check the worktree for work already done before starting over.",
                formatTaskLaunchPrompt(task, { runtime: taskRuntime }),
              ].join("\n\n"),
        });
        refreshedResumeContext = true;
      }
      // Spawn at the size the pane actually is. Falling back to a guess is only
      // for the case where the pane never reports one; it will still be corrected
      // by the resize that follows its first fit.
      // Its own pane if it has one, and otherwise the size the panes in this
      // workspace actually are — never the 132-column guess below, which no
      // pane has ever been.
      const size = (await waitForTerminalSize(session.id)) ?? workbenchTerminalSizeRef.current ?? undefined;
      // Columns from the pane, because a CLI that composes its tables for the
      // wrong width cannot be made right afterwards. Rows deliberately not: a
      // screen that starts shorter than the pane has its input somewhere
      // visible, and the pane's own fit corrects it a frame later with the
      // bottom row's worth of room the padding now reserves.
      const startRows = 36;
      if (initialPrompt) {
        knowledgeOutputRef.current[session.id] = { parts: [], size: 0 };
        delete capturedKnowledgeRef.current[session.id];
      }
      const result = await window.pitwall?.startTerminal?.({
        projectId: ownerProject.id,
        projectPath: workspacePath,
        projectRoot: ownerProject.path,
        workspaceProblem: workspaceProblemRef.current[session.id],
        sessionId: session.id,
        sessionName: session.name,
        agent: session.agent,
        model,
        command: launch.command,
        args: launch.args,
        // Resolved from the binary that will actually run, which for a
        // built-in provider is its profile's command rather than anything on
        // the session. An agent with no verified flag gets none, so it keeps
        // its prompts instead of being silently promised it will not have any.
        extraArgs: withAutoApprove(
          launch.command || providerRegistry.find((provider) => provider.agent === session.agent)?.command,
          [],
          Boolean(session.autoApprove),
        ),
        nativeSessionId: session.nativeSessionId,
        resumeSession: shouldResume,
        initialPrompt,
        taskId: task?.id,
        taskIdentifier: task?.identifier,
        taskTitle: task?.title,
        taskRuntime,
        cols: size?.cols ?? 132,
        rows: Math.min(startRows, size?.rows ?? startRows),
      });

      terminalAttachedRef.current[session.id] = Boolean(result?.ok);
      setTerminalAttachedBySession((current) => ({ ...current, [session.id]: Boolean(result?.ok) }));
      if (result?.ok) countAttach();
      // The CLI starts shorter than the pane, so its first screen lands where
      // it can be seen; then it gets the pane's real size. Sent here, because a
      // pane already fitted before the CLI existed never resizes again on its own.
      if (result?.ok) {
        const startedAt = { cols: size?.cols ?? 132, rows: Math.min(startRows, size?.rows ?? startRows) };
        window.setTimeout(() => {
          const pane = terminalSizeRef.current[session.id] ?? size;
          if (!pane || !terminalAttachedRef.current[session.id]) return;
          if (pane.cols === startedAt.cols && pane.rows === startedAt.rows) return;
          void window.pitwall?.resizeTerminal?.({ sessionId: session.id, cols: pane.cols, rows: pane.rows });
        }, 400);
      }
      if (initialPrompt && (!result?.ok || result.initialPromptMode === "argument")) {
        await markPreparedContext(session.id, initialPrompt, result?.ok ? "delivered" : "failed");
      }
      const lifecycleStatus = (status: SessionStatus): SessionStatus =>
        result?.ok ? statusAfterAttach(status, Boolean(initialPrompt)) : "failed";
      // The half that was missing: how often a session never starts at all, and
      // for which agent. Counted here because this is the only place that knows.
      if (!result?.ok) track("session_launch_failed", { agent: session.agent.toLowerCase() });
      const resolvedNativeSessionId = result?.nativeSessionId || session.nativeSessionId;

      // Follow the conversation from the moment its CLI is running, not from the
      // moment someone opens the chat. Both surfaces are meant to be current
      // whichever one is on screen, and a follower started late has already
      // missed the turns it was supposed to show.
      if (false && result?.ok && session.agent === "Claude") {
        void window.pitwall?.startAgentMirror?.({
          sessionId: session.id,
          projectPath: session.worktreePath || ownerProject.path,
          claudeSessionId: resolvedNativeSessionId,
        });
      }
      setProjects((current) => current.map((project) => project.id === ownerProject.id
        ? {
            ...project,
            sessions: project.sessions.map((item) => item.id === session.id
              ? {
                  ...item,
                  status: lifecycleStatus(item.status),
                  nativeSessionId: resolvedNativeSessionId || undefined,
                  nativeSessionStarted: result?.ok ? true : item.nativeSessionStarted,
                }
              : item),
          }
        : project));
      setPitwall((current) => ({
        ...current,
        sessions: current.sessions.map((item) => item.id === session.id
          ? {
              ...item,
              status: lifecycleStatus(item.status),
              nativeSessionId: resolvedNativeSessionId || undefined,
              nativeSessionStarted: result?.ok ? true : item.nativeSessionStarted,
              updatedAt: nowIso(),
            }
          : item),
      }));

      if (!result?.ok) {
        appendTerminalLine(session.id, `$ ${getBootCommand(agentOptions, session.agent, session.model) || session.agent}`);
        appendTerminalLine(session.id, result?.error ?? "PTY backend unavailable");
        setSystemNotice({
          tone: "error",
          title: `${session.agent} could not start`,
          message: `${result?.error ?? "PTY backend unavailable"} Check Connections for installation and authentication status, then retry the session.`,
        });
        return false;
      }

      appendTerminalLine(session.id, `[attached ${result.command ?? session.agent} in ${result.cwd ?? workspacePath}]`, { informational: true });
      if (refreshedResumeContext && initialPrompt && result.initialPromptMode !== "argument") {
        const prompt = initialPrompt;
        void (async () => {
          if (await waitForSessionSettle(session.id) && !councilOutputLooksGated(session.id)) {
            await sendTerminalPrompt(session.id, prompt);
          } else {
            await markPreparedContext(session.id, prompt, "failed");
            appendTerminalLine(session.id, "Updated project context could not be sent while the agent was waiting for input approval.");
          }
        })();
      }
      return true;
    } catch (error) {
      if (initialPrompt) await markPreparedContext(session.id, initialPrompt, "failed");
      terminalAttachedRef.current[session.id] = false;
      setTerminalAttachedBySession((current) => ({ ...current, [session.id]: false }));
      setSystemNotice({ tone: "error", title: `${session.agent} could not start`, message: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      attachingTerminalRef.current[session.id] = false;
    }
  }


  /**
   * Hands the selected project to the user's own editor.
   *
   * The worktree path, not the project root: a session working on its own
   * branch has its own checkout, and opening the root would show the user code
   * from a different branch than the agent is editing.
   */
  async function openProjectInEditor(targetPath?: string) {
    const target = targetPath || editorWorkspacePath;
    if (!target || openingEditor) return false;
    setOpeningEditor(true);
    setEditorStatus("");
    try {
      if (editorChoice === REVEAL_IN_FINDER) {
        const revealed = await window.pitwall?.openPath?.(target);
        if (revealed && !revealed.ok) {
          setEditorStatus(revealed.error || "Could not reveal the folder.");
          return false;
        }
        return true;
      }

      const result = await window.pitwall?.openInEditor?.({
        projectPath: target,
        editorId: editorChoice || preferredEditor?.id,
      });
      if (!result) {
        setEditorStatus("Opening an editor is not available in this build.");
        return false;
      }
      // A successful open says nothing: the editor is now in front of the user,
      // which is the only confirmation that matters. Only the fallback and the
      // failures are worth a line.
      if (!result.ok) {
        setEditorStatus(result.error || "The editor could not open this project.");
        return false;
      }
      if (result.revealed) setEditorStatus(result.error || "Revealed the folder instead.");
      return true;
    } finally {
      setOpeningEditor(false);
    }
  }

  function chooseEditor(choice: string) {
    setEditorChoice(choice);
    setEditorStatus("");
    writeStored(EDITOR_CHOICE_KEY, choice);
  }

  /**
   * Creates and launches a session.
   *
   * Every value the create-session modal would have supplied can also be passed
   * in, because the modal is not the only caller any more: voice starts
   * sessions directly. Reading the draft state unconditionally is what forced
   * `session.start` to open the form and ask the user to press create — a
   * spoken command that ends in "now use your hands" is not a spoken command.
   *
   * The agent-derived values are shadowed rather than reused from the
   * component: `draftProvider`, `draftCheck` and `draftBootCommand` are all
   * computed from `draftAgent`, so an overridden agent with the component's
   * derived launch would boot the wrong CLI.
   */
  /**
   * What a booking's run looks like when you open it.
   *
   * The live terminal while it is going, because for a command-line agent the
   * terminal is the conversation. Once it is finished, the run history: what
   * happened each day, on which branch, and where the pull request went. A
   * session that is still around can be opened in Work, where the transcript
   * and the turn-by-turn thread already live.
   */
  function renderScheduleRun(job: ScheduleJob) {
    const runs = (job.history ?? []).filter((entry) => entry.outcome !== "skipped");
    const live = runs.find((entry) => entry.outcome === "running");
    const session = live?.taskId
      ? activeProject.sessions.find((item) => {
        const record = pitwall.sessions.find((s) => s.id === item.id);
        return record?.taskId === live.taskId;
      })
      : undefined;

    if (session) {
      return (
        <div className="dk-schedule-terminal">
          <LiveTerminalView
            store={terminalLinesStore}
            placeholder={[`Session ${session.name} starting`]}
            sessionId={session.id}
            active
            fontFamily={terminalFontFamily}
            fontSize={terminalFontSize}
            onInput={(data) => {
              void (async () => {
                const attached = terminalAttachedBySession[session.id] || (await ensureAgentTerminal(session));
                if (attached) await window.pitwall?.writeTerminal?.({ sessionId: session.id, data });
              })();
            }}
            // Not a workbench pane: this is the small box inside a booking's
            // row, and its height is no guide to what a session opened on its
            // own should start at.
            onResize={(cols, rows) => recordTerminalSize(session.id, cols, rows)}
            ptySize={ptySize[session.id]}
          />
        </div>
      );
    }

    if (!runs.length) return <p className="dk-hint">No runs yet. It will start at its time.</p>;

    return (
      <div className="dk-schedule-history">
        {runs.slice(0, 8).map((run) => (
          <p key={`${run.at}-${run.outcome}`}>
            <span className="dk-mono dk-faint">{run.at.slice(0, 16).replace("T", " ")}</span>
            <span className={`dk-badge${run.outcome === "ok" ? " dk-badge--green" : " dk-badge--amber"}`}>{run.outcome === "ok" ? "Done" : run.outcome.charAt(0).toUpperCase() + run.outcome.slice(1)}</span>
            <span className="dk-muted">
              {run.pullRequestUrl ? (
                <button type="button" className="dk-link" onClick={() => void window.pitwall?.openExternalUrl?.(run.pullRequestUrl!)}>
                  Open the {requestNoun}
                </button>
              ) : (run.reason || run.branch || "")}
            </span>
          </p>
        ))}
      </div>
    );
  }

  /**
   * Settle a scheduled run once its session has finished.
   *
   * A finished run that could not open a pull request has not succeeded: the
   * branch exists and nobody knows. That is `blocked`, which notifies, rather
   * than `ok`, which is silent — reporting success that was not achieved is
   * the one outcome worse than failing.
   */
  /**
   * Settle a scheduled run once its session has finished.
   *
   * `blocked` counts as unsettled. A run that could not open a pull request is
   * blocked on a person — an unanswered prompt, a push the remote refused —
   * and the whole point of saying so is that the person then clears it and the
   * agent carries on. When it finishes after that, this is what has to notice:
   * before, the lookup only recognised a run still marked `running`, so a run
   * that had ever been blocked stayed blocked for ever and had to be marked
   * done by hand.
   *
   * A run already settled `ok` is left alone; re-settling it would overwrite a
   * finished record with a second opinion.
   */
  async function settleScheduledRun(taskId: string, failed: boolean) {
    const job = settlingJob(scheduleJobsRef.current, taskId);
    if (!job) return;

    const record = async (entry: ScheduleRun) => {
      await window.pitwall?.recordScheduleRun?.({ id: job.id, entry });
      await refreshSchedule();
    };

    const task = pitwallRef.current.tasks.find((item) => item.id === taskId);
    const branch = task?.worktree || "";
    if (failed) {
      await record({ at: nowIso(), outcome: "failed", taskId, branch });
      void retireTaskWorktrees(job.projectId, taskId);
      return;
    }

    const project = projectsRef.current.find((item) => item.id === job.projectId);
    // The worktree the run worked in, so the push can read what the agent is
    // actually on rather than the name Pitwall gave the branch before the
    // agent knew what the work was.
    const ranIn = pitwallRef.current.sessions.find((item) => item.taskId === taskId)?.worktreePath || "";
    const drafted = task && project ? await draftTaskRequest(task, project.path, ranIn, project.branch) : null;
    const written = drafted?.ok ? drafted : null;
    const pr = await window.pitwall?.openPullRequest?.({
      projectPath: project?.path || "",
      worktreePath: ranIn,
      branch,
      baseBranch: project?.branch,
      ...(written ? { title: written.draft.title, body: written.draft.body } : {}),
    });
    if (pr?.ok) {
      await record({ at: nowIso(), outcome: "ok", taskId, branch, pullRequestUrl: pr.url });
      void retireTaskWorktrees(job.projectId, taskId);
      return;
    }
    await record({
      at: nowIso(),
      outcome: "blocked",
      taskId,
      branch,
      reason: pr?.error || `Finished, but no ${requestNoun} was opened`,
    });
  }

  /**
   * Turn a typed line into a job.
   *
   * A parse failure says what the grammar is rather than failing quietly: the
   * whole surface is one line, so there is nowhere else for the rule to live.
   */
  async function createScheduleJob(time: string, prompt: string, agent: string, days: number[], everyHours: number, until = ""): Promise<string> {
    // An end is only meaningful for a repeat, and a typo in it should be said
    // out loud rather than quietly ignored — a booking that runs to midnight
    // when you asked it to stop at 20:00 is the kind of thing nobody notices
    // until something has run all night.
    const times = bookingTimes(time, everyHours, until);
    if ("error" in times && !parseClock(time)) return times.error;
    if (!prompt.trim()) return `Say what should run at ${time.trim()}.`;
    if (!agent) return "Pick an agent for this booking.";
    if ("error" in times) return times.error;
    const result = await window.pitwall?.saveScheduleJob?.({
      untilMinutes: times.untilMinutes,
      hour: times.hour,
      minute: times.minute,
      prompt: prompt.trim(),
      projectId: activeProject.id,
      agent,
      days,
      everyHours,
    });
    if (!result?.ok) return result?.error || "The job could not be saved.";
    await refreshSchedule();
    return "";
  }

  /**
   * Run a scheduled job, the way a typed prompt runs.
   *
   * Deliberately the same path: a task, then `createAgentSession` with the
   * prompt sent on start. A separate launcher for scheduled work would drift
   * from the one people use, and the drift would only ever show itself at
   * 13:00 on a machine nobody is watching.
   */
  async function runScheduledJob(job: ScheduleJob) {
    const record = async (entry: ScheduleRun) => {
      await window.pitwall?.recordScheduleRun?.({ id: job.id, entry });
      await refreshSchedule();
    };

    const project = projects.find((item) => item.id === job.projectId);
    if (!project) {
      await record({ at: nowIso(), outcome: "failed", reason: "Its project is no longer open in Pitwall" });
      return;
    }

    // The overlap rule, enforced in exactly one place: a booking whose
    // previous run is still going is left alone, and this fire is recorded as
    // a fact about the occurrence rather than as a run.
    const overlap = scheduleOverlap(job, (taskId) => pitwall.sessions.some(
      (session) => session.taskId === taskId
        && (session.status === "running" || session.status === "starting" || session.status === "waiting"),
    ), Date.now());
    if (overlap.kind === "overdue") {
      // Still not started alongside. But a run this long has stopped being
      // work in progress and become something only a person can clear, and
      // the quiet skip it would otherwise get is indistinguishable from a
      // booking that is simply busy.
      await record({
        at: nowIso(),
        outcome: "blocked",
        taskId: overlap.entry.taskId,
        branch: overlap.entry.branch,
        reason: `Still running after ${overlap.hours} hours — it may be waiting on you`,
      });
      return;
    }
    if (overlap.kind === "running") {
      await record({ at: nowIso(), outcome: "skipped", reason: "still running" });
      return;
    }

    // The agent the booking was made with, not whatever the session dialog is
    // showing now. A run that quietly used a different agent than the one you
    // booked would be the same class of bug as one that never ran. Resolved
    // before anything is created, so a booking whose agent is gone does not
    // leave a task behind that never ran.
    const booked = agentOptions.find((option) => option.agent === job.agent);
    if (!booked) {
      await record({
        at: nowIso(),
        outcome: "failed",
        reason: job.agent
          ? `${job.agent} is not available any more. Open this booking and pick another agent.`
          : "This booking has no agent. Open it and pick one.",
      });
      return;
    }

    /**
     * Carry on where this booking left off.
     *
     * Every fire used to create a task, a branch and a worktree of its own, so
     * an hourly booking left twenty-four of each behind in a day — and the
     * agent started from nothing every hour, having already learned the
     * repository twenty-three times. If the last run's session is still there,
     * this fire is another turn in it: the agent keeps its context, its branch
     * and whatever it had part-finished.
     */
    const previous = (job.history ?? []).find((entry) => entry.taskId && entry.outcome !== "skipped");
    // The rail's session, not the workspace record: attaching and typing both
    // work on the agent session, which is what carries the agent and the PTY.
    // The workspace record knows the task; the rail's session carries the
    // agent and the PTY. Match on the first to find the second.
    const ran = previous?.taskId
      ? pitwall.sessions.find((item) => item.taskId === previous.taskId)
      : undefined;
    const existing = ran
      ? projectsRef.current.flatMap((item) => item.sessions).find((item) => item.id === ran.id)
      : undefined;
    if (existing && previous?.taskId) {
      await record({ at: nowIso(), outcome: "running", taskId: previous.taskId, branch: previous.branch });
      // The CLI has to be attached before it can be typed into: the session
      // survived Pitwall being closed, its terminal did not.
      const attached = terminalAttachedRef.current[existing.id] || (await ensureAgentTerminal(existing));
      if (!attached) {
        await record({ at: nowIso(), outcome: "blocked", taskId: previous.taskId, branch: previous.branch,
          reason: `${existing.agent} could not be attached, so this turn was not sent` });
        return;
      }
      await sendTerminalPrompt(existing.id, job.prompt);
      return;
    }

    const timestamp = nowIso();
    const identifier = scheduleRunBranch(job.id, new Date(timestamp));
    const task: PitwallTask = {
      id: makeId("task"),
      identifier,
      projectId: project.id,
      title: job.prompt.slice(0, 80),
      description: job.prompt,
      status: "ready",
      priority: "medium",
      assignedAgent: providerIdFromAgent(booked.agent),
      relatedFiles: [],
      worktree: identifier,
      source: { kind: "schedule" },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setPitwall((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    await record({ at: timestamp, outcome: "running", taskId: task.id, branch: identifier });

    try {
      const session = await createAgentSession({
        // The project the booking was made in, not the one you happen to be
        // looking at when it fires.
        project,
        agent: booked.agent,
        model: booked.models[0]?.label ?? "Auto",
        sessionType: "implementation",
        taskId: task.id,
        task,
        startTask: true,
        // Nobody is here to answer a permission prompt at 13:00.
        autoApprove: true,
        // A scheduled run settles on the agent's closing summary, so this is
        // one of the two places the marker is still worth asking for.
        wantsSummary: true,
        // Nobody is here to rename a branch the remote refused at 08:00.
        namesOwnBranch: true,
      });
      if (!session) {
        await record({ at: nowIso(), outcome: "failed", reason: "The session could not be started", taskId: task.id });
      } else {
        // An automation's work is shown as it starts, in whichever project it runs.
        openStartedSession(project.id, session.id);
      }
    } catch (error) {
      await record({
        at: nowIso(),
        outcome: "failed",
        reason: error instanceof Error ? error.message : "The session could not be started",
        taskId: task.id,
      });
    }
  }

  /**
   * Starts a session, with a "starting" row in the sidebar from the first
   * moment until the session itself is listed — or until it fails.
   */
  async function createAgentSession(overrides: Parameters<typeof createAgentSessionNow>[0] = {}) {
    const key = makeId("starting");
    const agent = overrides.agent ?? draftAgent;
    const instruction = (overrides.instruction ?? "").trim();
    const title = (overrides.sessionName ?? "").trim()
      || (instruction ? formatInstructionSessionName(instruction) : "")
      || overrides.task?.title
      || formatUntaskedSessionName(String(agent));
    const done = () => setStartingSessions((current) => current.filter((item) => item.id !== key));
    setStartingSessions((current) => [...current, { id: key, projectId: (overrides.project ?? activeProject).id, title, agent: String(agent) }]);
    try {
      return await createAgentSessionNow(overrides, done);
    } finally {
      done();
    }
  }

  async function createAgentSessionNow(
    overrides: {
      agent?: AgentProvider;
      model?: string;
      sessionType?: PitwallSessionType;
      taskId?: string;
      /** A task the caller already has in hand, for callers with no draft state. */
      task?: PitwallTask;
      /** A name for the session; blank falls through to one derived from the work. */
      sessionName?: string;
      /** What the person typed for the agent to do: sent after the role and any task brief, and names the session. */
      instruction?: string;
      /** Sends the task prompt immediately after the new session becomes ready. */
      startTask?: boolean;
      /**
       * Runs without stopping for permission prompts, where the agent's own
       * CLI documents a flag for it. Scheduled jobs need this: nobody is there
       * at 13:00 to answer, and a session parked on a prompt is a job that
       * silently did nothing.
       */
      autoApprove?: boolean;
      /** Ask the agent for a closing summary marker. Only a scheduled run and
          a council read one; a session you are watching does not. */
      wantsSummary?: boolean;
      /** Let the agent cut the branch it pushes, following the repository's
          own convention. Pitwall's name is created before anyone knows what
          the work is, and cannot satisfy rules it has never heard of. */
      namesOwnBranch?: boolean;
      /** The project this session belongs to. Defaults to the one on screen,
          which is wrong for anything Pitwall starts by itself. */
      project?: Project;
      /** Sent instead of a task launch, for a stage that carries its own brief. */
      prompt?: string;
      /**
       * The tracker refresh this caller has already done, so it is not done
       * twice. Reading a task from its source is a CLI round trip, which is
       * most of what starting a session costs.
       */
      origin?: { task: PitwallTask; refreshed: boolean; error: string };
    } = {},
    /** Called once the session is in the sidebar, so its "starting" row can go. */
    listed: () => void = () => {},
  ) {
    /**
     * The project this session belongs to, which is not always the one on
     * screen. A scheduled run fires against the project it was booked in
     * while you are looking at another, and every path here read the visible
     * project — so a booking made in admin opened its worktree, its
     * branch and its agent inside web-app.
     */
    const runProject = overrides.project ?? activeProject;
    // With no project there is no repository, and a blank path resolves to wherever the app was launched from.
    if (!runProject.path) {
      setSystemNotice({ tone: "warn", title: "Add a project first", message: "New work runs in a project's repository. Add a project folder from the Project menu." });
      return null;
    }
    // A lapsed licence stops new work; it never touches a session already running,
    // which could be twenty minutes into a task and holding uncommitted work in
    // a worktree. Opening the dialog is the whole response — there is no error
    // state to dismiss, because the thing to do next is right there.
    if (!licence.canStartWork) {
      track("licence_required");
      setLicenceOpen(true);
      return null;
    }

    const agent = overrides.agent ?? draftAgent;
    const model = overrides.model ?? draftModel;
    const sessionType = overrides.sessionType ?? draftSessionType;
    const provider = agentOptions.find((option) => option.agent === agent) ?? agentOptions[0];
    const check = agentChecks[agent];
    const resolvedLaunch = resolveAgentLaunch(provider, model);
    const bootCommand = resolvedLaunch.command
      ? [resolvedLaunch.command, ...(resolvedLaunch.args ?? [])].join(" ")
      : getBootCommand(agentOptions, agent, model);

    let task =
      overrides.task ??
      projectTasks.find((item) => item.id === (overrides.taskId ?? draftTaskId)) ??
      activeTask ??
      createDefaultTask(runProject.id);
    // `task` deliberately falls back for untasked sessions, so only an explicit
    // selection means the agent should receive and begin the task.
    /**
     * How long each part of starting a session actually took.
     *
     * Creating a session is half a dozen things in a row — reading the ticket
     * from the tracker, making a worktree, allocating a port, assembling the
     * context, then the CLI's own startup — and "it feels slow" cannot be acted
     * on without knowing which. The line goes to the console and into the new
     * session's own terminal, so the answer is where the waiting was.
     */
    const startedAt = Date.now();
    let lastMark = startedAt;
    const phases: string[] = [];
    const mark = (name: string) => {
      const now = Date.now();
      const spent = now - lastMark;
      lastMark = now;
      // Only what is worth reading: a step under a tenth of a second is noise.
      if (spent >= 100) phases.push(`${name} ${(spent / 1000).toFixed(1)}s`);
    };

    const chosenTaskId = overrides.taskId ?? draftTaskId;
    const hasChosenTask = Boolean(
      overrides.task || (chosenTaskId && projectTasks.some((item) => item.id === chosenTaskId)),
    );
    const shouldStartTask = overrides.startTask ?? (hasChosenTask || pendingTaskStartRef.current === task.id);
    const origin = overrides.origin
      ?? (shouldStartTask ? await refreshTaskFromOrigin(task) : { task, refreshed: false, error: "" });
    mark("tracker");
    task = origin.task;
    const providerId = providerIdFromAgent(agent);
    const taskContext = contextForAgent(
      projectContextEntries.filter((entry) => selectedContextIds.includes(entry.id)), runProject.id, providerId,
    );
    const sessionNumber = runProject.sessions.length + 1;
    const sessionId = makeId(`${agent.toLowerCase()}-${runProject.id}`);
    const nativeSessionId = createNativeSessionId(agent);
    // A task's branch only when a task was actually chosen.
    //
    // `task` falls back to whatever is selected in the workspace, so a session
    // started without one was given the active task's branch — and therefore
    // its worktree. It was not merely labelled with a ticket it had nothing to
    // do with; anything it wrote landed on that ticket's branch.
    const sessionBranch =
      (hasChosenTask ? taskBranchName(task) : "") || `${agent.toLowerCase()}/session-${sessionNumber}`;
    const worktree = await window.pitwall?.ensureWorktree?.({
      projectPath: runProject.path,
      branch: sessionBranch,
      baseBranch: runProject.branch || "HEAD",
    }).catch((error: unknown) => ({ ok: false, path: undefined, error: error instanceof Error ? error.message : String(error) }));
    if (!worktree?.ok || !worktree.path) {
      setSystemNotice({
        tone: "error",
        title: "Could not create an isolated checkout",
        message: worktree?.error || "Worktree creation is unavailable. Resolve the Git error and retry the session.",
      });
      return null;
    }
    const sessionProjectPath = worktree.path;
    const modelValue = getModelCommandValue(agentOptions, agent, model);
    const snapshot = makeContextSnapshot({
      projectId: runProject.id,
      task,
      sessionId,
      provider: providerId,
      model: model,
      contextEntries: taskContext,
    });
    const agentLaunch = resolveAgentLaunch(provider, model);
    // A typed title wins. Otherwise fall back to the task-derived name only if a
    // task was actually chosen — `task` above resolves to activeTask or a fresh
    // default, so naming from it unconditionally would put a task the user never
    // selected into the chip.
    // Numbered against what this project already has. A derived name is not
    // unique on its own — two sessions on one task, in one role, produced the
    // same string — and the rail then showed the same name twice with no way
    // to tell which was which. A name the user typed is left exactly as typed.
    const typedName = (overrides.sessionName ?? "").trim();
    const instruction = (overrides.instruction ?? "").trim();
    const sessionName =
      typedName ||
      uniqueSessionName(
        instruction
          ? formatInstructionSessionName(instruction)
          : hasChosenTask
          ? formatTaskSessionName(task.title, getRole(sessionType).label)
          : formatUntaskedSessionName(String(agent)),
        (projectsRef.current.find((item) => item.id === runProject.id)?.sessions ?? []).map(
          (item) => item.name,
        ),
      );
    mark("worktree");
    const role = getRole(sessionType);
    const taskRuntime = shouldStartTask && roleWritesCode[sessionType]
      ? await allocateTaskRuntime(task, sessionId)
      : undefined;
    if (shouldStartTask && roleWritesCode[sessionType] && !taskRuntime) return null;
    // Feedback left while nothing was running rides in with the session that
    // starts next. Without this a request made against a dead session is only
    // ever a note to nobody.
    const waitingRequests = shouldStartTask ? pendingRequests(task) : [];
    const requestPrompt = formatChangeRequestPrompt(task, waitingRequests);
    // A caller with its own brief — the staged workflow sends a contract or a
    // review, not a task launch — supplies the whole prompt. The role prompt
    // still leads it, so the agent knows which seat it is in.
    const basePrompt = overrides.prompt
      ? [role.systemPrompt, overrides.prompt].filter(Boolean).join("\n\n")
      : shouldStartTask
      ? [
          role.systemPrompt,
          formatTaskLaunchPrompt(task, {
            startDevServer: roleWritesCode[sessionType],
            originRefreshed: origin.refreshed,
            runtime: taskRuntime,
            // Only where something reads it. A scheduled run settles on this
            // marker; a session you are sitting in front of does not, and the
            // paragraph of JSON was being printed into a terminal you are
            // reading for its own sake.
            wantsSummary: Boolean(overrides.wantsSummary),
            namesOwnBranch: Boolean(overrides.namesOwnBranch),
          }),
          requestPrompt,
          instruction,
        ]
          .filter(Boolean)
          .join("\n\n")
      : [role.systemPrompt, instruction].filter(Boolean).join("\n\n");
    const initialPrompt = await prepareAgentPrompt({
      projectPath: runProject.path, workspacePath: sessionProjectPath, projectId: runProject.id,
      taskId: hasChosenTask ? task.id : undefined, task: hasChosenTask ? task : { title: "Project session" },
      sessionId, provider: providerId, role: sessionType, manualEntries: taskContext, basePrompt,
    });
    mark("context");
    snapshot.receipt = preparedContextRef.current[sessionId]?.receipt;
    // Establish trust before selecting/persisting a session: selection can
    // attach its terminal before this function resumes after an await.
    if (initialPrompt && !(await prepareProjectTrust(sessionProjectPath, providerId, Boolean(overrides.autoApprove)))) return null;
    mark("trust");
    const launch = await window.pitwall?.launchSession({
      projectId: runProject.id,
      projectPath: sessionProjectPath,
      sessionId,
      sessionName,
      agent: agent,
      model: modelValue,
      command: agentLaunch.command,
      args: agentLaunch.args,
      nativeSessionId,
      resumeSession: false,
      initialPrompt,
    });
    if (initialPrompt) terminalInitialPromptRef.current[sessionId] = initialPrompt;
    if (waitingRequests.length > 0) {
      const deliveredAt = nowIso();
      const ids = waitingRequests.map((request) => request.id);
      setPitwall((current) => ({
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === task.id
            ? { ...item, changeRequests: markDelivered(item, ids, deliveredAt), updatedAt: deliveredAt }
            : item,
        ),
      }));
    }
    mark("launch");
    // Reported once, where the person waiting can see it. The CLI's own startup
    // is not in here: the agent is running by this point and what it does with
    // its first second is its own business, which is worth knowing when the
    // numbers below are small and the wait was not.
    const breakdown = `${((Date.now() - startedAt) / 1000).toFixed(1)}s${phases.length ? ` — ${phases.join(", ")}` : ""}`;
    console.info(`[pitwall] session ready in ${breakdown}`);
    appendTerminalLine(sessionId, `ready in ${breakdown}`, { informational: true });

    const command = launch?.command ?? bootCommand;
    const needsLogin = check?.status === "needs-login";
    const newSession: AgentSession = {
      id: sessionId,
      name: sessionName,
      agent: agent,
      status: launch?.ok === false ? "failed" : "starting",
      model: model,
      // A reused worktree may sit on a branch other than the one requested, and
      // the session has to say which branch it is really on.
      branch: (worktree?.ok && worktree.branch) || sessionBranch,
      worktreePath: worktree?.ok ? worktree.path : undefined,
      nativeSessionId,
      nativeSessionStarted: false,
      // Read again at terminal:start, where withAutoApprove turns it into the
      // flag that agent's CLI actually documents — or into nothing, for an
      // agent whose flag was never verified.
      autoApprove: Boolean(overrides.autoApprove) && supportsAutoApprove(agentLaunch.command),
      // Kept so this session can be restarted when the agent row that
      // produced it is not there — a local model's row is derived from what
      // Ollama has pulled, and nothing guarantees it exists at re-attach.
      launchCommand: resolvedLaunch.command,
      launchArgs: resolvedLaunch.args,
      task: hasChosenTask ? task.title : "",
      progress: 8,
      tokens: "0",
      approvals: 0,
      risk: "low",
      files: 0,
      started: "now",
      logs: [
        launch?.ok === false ? `Launch failed: ${launch.error ?? "unknown error"}` : `Boot command: ${command}`,
        `Context snapshot: ${snapshot.contextEntries.length} ${snapshot.contextEntries.length === 1 ? "entry" : "entries"}`,
        needsLogin ? `${agent} sign-in may be required` : `Selected ${model}`,
      ],
    };
    const pitwallSession: PitwallSession = {
      id: sessionId,
      projectId: runProject.id,
      provider: providerId,
      // Only a task that was chosen. The fallback above is what the prompt is
      // built around for an untasked session; recording it here gave that
      // session someone else's task — its header, its pair, its reviewer.
      taskId: hasChosenTask ? task.id : "",
      type: sessionType,
      status: launch?.ok === false ? "failed" : "starting",
      model: model,
      worktreePath: worktree?.ok ? worktree.path : undefined,
      nativeSessionId,
      nativeSessionStarted: false,
      messages: [
        {
          role: "system",
          content: `Context prepared with ${snapshot.contextEntries.length} selected notes and ${snapshot.files.length} file references. Delivery is recorded after the agent accepts the prompt.`,
          createdAt: nowIso(),
        },
      ],
      contextSnapshotId: snapshot.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    setProjects((current) =>
      current.map((project) => {
        if (project.id !== runProject.id) return project;

        return {
          ...project,
          openSessions: project.sessions.length + 1,
          timeline: [
            `${newSession.name}: ${task.title}`,
            ...project.timeline.slice(0, 5),
          ],
          sessions: [...project.sessions, newSession],
        };
      }),
    );
    listed();
    setPitwall((current) => {
      const taskExists = current.tasks.some((item) => item.id === task.id);
      const timestamp = nowIso();
      return {
        ...current,
        tasks: !hasChosenTask
          ? current.tasks
          : taskExists
          ? current.tasks.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    status: launch?.ok === false ? "review" : item.status,
                    assignedAgent: providerId,
                    worktree: item.worktree || newSession.branch,
                    updatedAt: timestamp,
                  }
                : item,
            )
          : [
              {
                ...task,
                status: launch?.ok === false ? "review" : task.status,
                assignedAgent: providerId,
                worktree: task.worktree || newSession.branch,
                updatedAt: timestamp,
              },
              ...current.tasks,
            ],
        sessions: [pitwallSession, ...current.sessions],
        contextSnapshots: [snapshot, ...current.contextSnapshots],
        activity: [
          {
            id: makeId("activity"),
            projectId: runProject.id,
            taskId: hasChosenTask ? task.id : undefined,
            sessionId,
            provider: providerId,
            type: "context-snapshot",
            message: `Snapshot recorded for ${getProviderLabel(providerId)}: ${snapshot.contextEntries.length} context entries`,
            createdAt: timestamp,
          },
          {
            id: makeId("activity"),
            projectId: runProject.id,
            taskId: hasChosenTask ? task.id : undefined,
            sessionId,
            provider: providerId,
            type: "session-started",
            message: hasChosenTask
              ? `${getProviderLabel(providerId)} started ${sessionType} session for ${task.title}`
              : `${getProviderLabel(providerId)} started a session with no task`,
            createdAt: timestamp,
          },
          ...current.activity,
        ],
      };
    });

    setSelectedSessionId(sessionId);
    updateTerminalLines((current) => ({
      ...current,
      [sessionId]: terminalNotices([
        `$ ${command}`,
        `cwd ${sessionProjectPath}`,
        worktree?.ok
          ? `worktree ${worktree.reused ? "reused" : "created"}: ${worktree.branch || sessionBranch}${
              worktree.reused && worktree.branch && worktree.branch !== sessionBranch
                ? ` (requested ${sessionBranch})`
                : ""
            }`
          : `worktree unavailable: ${worktree?.error ?? "using project root"}`,
        `task ${hasChosenTask ? task.title : "none"}`,
        `context ${snapshot.contextEntries.map((entry) => entry.title).join(", ") || "none"}`,
        needsLogin ? `${agent} sign-in required before usage is available` : `${agent} CLI ready`,
      ]),
    }));
    const attached = await ensureAgentTerminal(newSession, { initialPrompt });
    delete terminalInitialPromptRef.current[sessionId];
    setCreateSessionOpen(false);

    // Claude and Codex own the first turn from process launch, so MCP startup
    // cannot swallow it. Other/custom agents use a PTY fallback after their
    // first real output settles; Pitwall's synthetic history never counts.
    if (initialPrompt && attached && launch?.initialPromptMode === "argument") {
      if (shouldStartTask) recordTaskStarted(task, newSession);
      if (shouldStartTask) pendingTaskStartRef.current = null;
    } else if (initialPrompt && attached && launch?.ok !== false) {
      void (async () => {
        try {
          const ready = await waitForSessionSettle(sessionId);
          if (!ready) {
            appendTerminalLine(sessionId, "Agent input did not become ready — the task was not sent.");
            return;
          }
          if (councilOutputLooksGated(sessionId)) {
            appendTerminalLine(sessionId, "Sign-in or approval is required before this task can be sent.");
            return;
          }
          const sent = await sendTerminalPrompt(sessionId, initialPrompt);
          if (sent && shouldStartTask) recordTaskStarted(task, newSession);
        } finally {
          if (shouldStartTask) pendingTaskStartRef.current = null;
        }
      })();
    } else if (shouldStartTask) {
      pendingTaskStartRef.current = null;
    }

    // Returned so a caller driving several stages can follow this one to its
    // completion; every other caller ignores it.
    return newSession;
  }

  async function startSelectedTaskSessions() {
    if (bulkStartTasks.length === 0 || bulkStarting) return;
    bulkCancelRef.current = false;
    setBulkCancelling(false);
    setBulkStarting(true);
    try {
      // Reading each task from its tracker is a CLI round trip, and doing four
      // of them end to end was most of the wait — the sessions themselves are
      // quick by comparison. They do not depend on each other, so they are read
      // together and the loop below starts with the answers already in hand.
      //
      // Only the reads are parallel. Creating the sessions stays sequential:
      // each one writes to the same project state, and four of those racing is
      // a different and much worse problem than a slow modal.
      setBulkStartingCount(0);
      const origins = await Promise.all(bulkStartTasks.map((task) => refreshTaskFromOrigin(task)));

      // The tracker read is the longest part and nothing exists yet while it
      // runs, so stopping during it costs nothing and creates no sessions.
      if (bulkCancelRef.current) {
        appendActivity({
          projectId: activeProject.id,
          type: "system",
          message: `Cancelled before any of the ${bulkStartTasks.length} sessions were created.`,
        });
        return;
      }

      for (let index = 0; index < bulkStartTasks.length; index += 1) {
        // Between sessions, never inside one. A half-created session with a
        // worktree and no agent is worse than one more session than you wanted.
        if (bulkCancelRef.current) {
          appendActivity({
            projectId: activeProject.id,
            type: "system",
            message: `Stopped after ${index} of ${bulkStartTasks.length} sessions. The ones already created are running.`,
          });
          setDraftTaskId(bulkStartTasks[index - 1]?.id ?? "");
          setBulkStartTasks([]);
          if (index > 0) setWorkspaceSection("work");
          return;
        }
        setBulkStartingCount(index + 1);
        const task = bulkStartTasks[index];
        await createAgentSession({
          agent: draftAgent,
          model: draftModel,
          sessionType: draftSessionType,
          taskId: task.id,
          task,
          startTask: true,
          origin: origins[index],
        });
      }
      setDraftTaskId(bulkStartTasks.at(-1)?.id ?? "");
      setBulkStartTasks([]);
      setWorkspaceSection("work");
    } finally {
      setBulkStartingCount(0);
      setBulkStarting(false);
      setBulkCancelling(false);
      bulkCancelRef.current = false;
    }
  }

  /** Asks the run in flight to stop at the next session boundary. */
  function cancelSelectedTaskSessions() {
    if (!bulkStarting) {
      setBulkStartTasks([]);
      return;
    }
    bulkCancelRef.current = true;
    setBulkCancelling(true);
  }

  function updateSessionModel(session: AgentSession, model: string) {
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== activeProject.id) return project;

        return {
          ...project,
          timeline: [
            `${session.name}: switched to ${model}`,
            ...project.timeline.slice(0, 5),
          ],
          sessions: project.sessions.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  model,
                  logs: [`Model switched to ${model}`, ...item.logs.slice(0, 4)],
                }
              : item,
          ),
        };
      }),
    );
  }

  /**
   * Opens what a sidebar row stands for, in whichever project it belongs to.
   * A task waiting on the person opens in Review; anything else opens its
   * session. Switching project first means the open waits for that render.
   */
  function openSidebarRow(row: SidebarRow) {
    setSidebarSelection(row.id);
    if (row.projectId !== activeProject.id) {
      const project = projects.find((item) => item.id === row.projectId);
      if (!project) return;
      pendingSidebarRowRef.current = row;
      setProjectNotifications((current) => clearProjectNotification(current, project.id));
      setActiveProjectId(project.id);
      return;
    }
    openSidebarRowInProject(row);
  }

  /** Brings a session an automation just started on screen, switching project if it runs in another. */
  function openStartedSession(projectId: string, sessionId: string) {
    openSidebarRow({ id: `session:${sessionId}`, kind: "session", needsYou: false, projectId, sessionId, title: "", key: "", status: "", when: "", sortAt: 0 });
  }

  /**
   * Tells the person something happened, with the way back to it: a line in
   * the bell's list, a message in the window, and — when Pitwall is not in
   * front — a macOS banner. Nothing at all when it is already on screen.
   */
  function notify(input: { title: string; body: string; tone?: AppNotification["tone"]; target: NotificationTarget; banner?: boolean }) {
    const focused = document.hasFocus() && !document.hidden;
    if (alreadyOnScreen(input.target, { focused, ...viewRef.current })) return;
    const tone = input.tone ?? "info";
    setNotifications((list) => addNotification(list, { id: makeId("note"), title: input.title, body: input.body, tone, at: Date.now(), target: input.target, seen: false }));
    setSystemNotice({ tone, title: input.title, message: input.body, target: input.target });
    if (input.banner && !focused) void window.pitwall?.showNotification?.({ title: input.title, body: input.body, target: input.target });
  }

  /** Opens what a notification is about, in whichever project it happened. */
  function jumpTo(target: NotificationTarget) {
    setSystemNoticeNow(null);
    const project = projectsRef.current.find((item) => item.id === target.projectId);
    if (!project) return;
    // A filter on another project would hide the row the jump highlights.
    if (sidebarProjectFilter && sidebarProjectFilter !== project.id) setSidebarProjectFilter(project.id);
    const blank = { needsYou: false, title: "", key: "", status: "", when: "", sortAt: 0, projectId: project.id };
    const scheduledSession = target.section === "schedule" && target.taskId
      ? pitwallRef.current.sessions.find((item) => item.taskId === target.taskId)?.id
      : undefined;
    const sessionId = target.sessionId ?? scheduledSession;
    if (sessionId && project.sessions.some((item) => item.id === sessionId)) {
      openSidebarRow({ ...blank, id: `session:${sessionId}`, kind: "session", sessionId });
      return;
    }
    if (target.section === "review" && target.taskId) {
      openSidebarRow({ ...blank, id: `task:${target.taskId}`, kind: "task", taskId: target.taskId });
      return;
    }
    if (project.id !== activeProject.id) {
      setProjectNotifications((current) => clearProjectNotification(current, project.id));
      setActiveProjectId(project.id);
    }
    setFocusFindingId(target.findingId ?? "");
    setWorkspaceSection(target.section === "schedule" ? "schedule" : target.section === "watch" ? "watch" : target.section);
  }

  /**
   * The status bar counts what is waiting in every project, so it opens where
   * that is: a count from another project used to open an empty Watches here.
   */
  function openAutomations() {
    const target = automationsTarget(watchState.findings, activeProject.id, projectsRef.current.map((project) => project.id));
    if (target.projectId === activeProject.id) setWorkspaceSection(target.section);
    else jumpTo(target);
  }

  function openSidebarRowInProject(row: SidebarRow) {
    if (row.councilRunId) {
      const session = activeProject.sessions.find((item) => item.id === row.sessionId);
      if (session) void selectSession(session);
      setActiveCouncilRunId(row.councilRunId);
      setWorkspaceSection("work");
      setWorkbenchTab("council");
      return;
    }
    if (row.kind === "session") {
      // From the ref: a session an automation has only just added is not in
      // this render's copy of the project yet.
      const session = (projectsRef.current.find((item) => item.id === row.projectId) ?? activeProject).sessions.find((item) => item.id === row.sessionId);
      if (!session) return;
      void selectSession(session);
      setWorkspaceSection("work");
      if (!councilSessionIds.has(session.id)) setWorkbenchTab("terminal");
      return;
    }
    const task = pitwall.tasks.find((item) => item.id === row.taskId);
    if (!task) return;
    if (task.status === "review") {
      setReviewFocusTaskId(task.id);
      setWorkspaceSection("review");
      return;
    }
    // Shipped work is read about, not worked in; a task with no session has
    // nothing to show but itself. Both open their details.
    if (task.status === "completed" || !sessionForTask(task)) {
      setDraftTaskId(task.id);
      setTaskDetail(task);
      return;
    }
    selectMissionTask(task);
  }

  function selectProject(project: Project) {
    setProjectNotifications((current) => clearProjectNotification(current, project.id));
    setActiveProjectId(project.id);
    // A filter on another project would leave the sidebar showing a project that is not open.
    // Functional, since the palette keeps an older copy of this function.
    setSidebarProjectFilter((current) => (current && current !== project.id ? project.id : current));
    // Back to the session that was open there, while it still exists.
    const remembered = project.sessions.find((session) => session.id === lastSessionByProject[project.id]);
    setSelectedSessionId((remembered ?? project.sessions[0])?.id ?? "");
    setWorkspaceSection(project.sessions.length > 0 ? "work" : "overview");
  }

  /**
   * The renderer's half of the capability registry.
   *
   * These are the capabilities whose state lives up here rather than in the
   * main process. Main dispatches them over IPC and awaits the result, so each
   * one returns a plain object; `useVoice` guarantees a single reply even when
   * a handler throws.
   *
   * Handlers deliberately bind to functions that already take explicit
   * arguments. `createAgentSession` reads the create-session draft state
   * instead, so `session.start` pre-fills that form and opens it rather than
   * silently constructing a session from state the user cannot see. That is
   * also the right behaviour for a guarded action.
   */
  const voiceHandlers = useMemo<VoiceHandlers>(
    () => ({
      "context.snapshot": () => ({
        ok: true,
        projectId: activeProject.id,
        projectName: activeProject.name,
        projectPath: activeProject.path,
        workbenchTab,
        activeSession: selectedSession.id ? selectedSession.name : null,
        activeSessionId: selectedSession.id || null,
        sessions: activeProject.sessions.map((session) => ({
          id: session.id,
          agent: session.agent,
          name: session.name,
          status: session.status,
        })),
        runningSessions: activeProject.sessions
          .filter((session) => session.status === "running")
          .map((session) => session.name),
        projects: projects.map((project) => project.name),
        // The tail of the active terminal is what "why is this failing?"
        // almost always means, and main has no view of it.
        terminalTail: (terminalLinesRef.current[selectedSession.id] ?? []).slice(-120).join("\n"),
      }),

      "project.list": () => ({
        ok: true,
        projects: projects.map((project) => ({ id: project.id, name: project.name })),
        activeName: activeProject.name,
      }),

      "project.switch": (params) => {
        const target = bestMatch(String(params.name ?? ""), projects, (project) => project.name);
        if (!target) {
          return {
            ok: false,
            error: "no match",
            speak: `I couldn't tell which project you meant. You have ${projects.map((project) => project.name).join(", ")}.`,
          };
        }
        selectProject(target);
        return { ok: true, name: target.name };
      },

      "editor.open_file": (params) => {
        const spoken = String(params.path ?? "");
        const exact = projectFiles.find((file) => file === spoken);
        const target = exact ?? bestMatch(spoken, projectFiles, (file) => file);
        if (!target) return { ok: false, error: "no match", speak: `I couldn't find a file matching ${spoken}.` };
        openFileInEditor(target);
        return { ok: true, path: target };
      },

      "session.start": async (params) => {
        const spokenAgent = typeof params.agent === "string" ? params.agent : "";
        const matched = spokenAgent ? bestMatch(spokenAgent, implementerOptions, (option) => option.agent) : null;
        // Naming an agent that isn't installed has to fail out loud. Silently
        // starting a different one is worse than not starting anything.
        if (spokenAgent && !matched) {
          return {
            ok: false,
            error: "no match",
            speak: `I don't have an agent called ${spokenAgent}. You have ${agentOptions.map((option) => option.agent).join(", ")}.`,
          };
        }
        const agent = matched?.agent ?? draftAgent;
        const check = agentChecks[agent];
        if (check?.status === "missing") {
          return {
            ok: false,
            error: "not installed",
            speak: `${agent}'s CLI isn't installed, so I can't start a session with it.`,
          };
        }

        // The task arrives either as words the user spoke or as an item pulled
        // from a tracker, and both become a real task so the session is attached
        // to something the rest of the app can see rather than to draft state.
        const item = params.task && typeof params.task === "object" ? (params.task as Record<string, string>) : null;
        const title = (item ? item.title : typeof params.task === "string" ? params.task : "")?.trim() ?? "";
        const existing = title
          ? projectTasks.find((entry) => entry.title.toLowerCase() === title.toLowerCase())
          : undefined;
        const task = title
          ? existing ?? {
              ...createDefaultTask(activeProject.id, title),
              // A tracker item carries its own description; a spoken one has
              // only the sentence that was said, and repeating it beats the
              // placeholder text createDefaultTask would otherwise leave.
              description: item?.description?.trim() || title,
              assignedAgent: agent,
            }
          : undefined;

        await createAgentSession({ agent, task });
        return {
          ok: true,
          agent,
          taskTitle: title,
          message: title ? `Started a ${agent} session on ${title}.` : `Started a ${agent} session.`,
        };
      },

      "session.send": async (params) => {
        if (!selectedSession.id) return { ok: false, error: "no session", speak: "There's no session running." };
        await sendTerminalPrompt(selectedSession.id, String(params.message ?? ""));
        setWorkbenchTab("terminal");
        return { ok: true };
      },

      "session.stop": async () => {
        if (!selectedSession.id) return { ok: false, error: "no session", speak: "There's no session running." };
        return { ok: Boolean(await runSessionAction(selectedSession, "stop")) };
      },

      "session.delete": async (params) => {
        const roster = activeProject.sessions.map(({ id, name }) => ({ id, name }));
        if (params.expectedProjectId !== activeProject.id || params.expectedProjectPath !== activeProject.path
          || params.expectedSessionId !== (selectedSession.id || null)
          || JSON.stringify(params.expectedSessions) !== JSON.stringify(roster)) {
          return { ok: false, error: "The session selection changed. Request deletion again." };
        }
        const spoken = String(params.name ?? "");
        const target = spoken
          ? bestMatch(spoken, activeProject.sessions, (session) => session.name)
          : selectedSession.id
            ? selectedSession
            : null;
        if (!target) return { ok: false, error: "no session", speak: "I couldn't tell which session you meant." };
        const stopped = await deleteSession(target);
        return stopped ? { ok: true, speak: `Deleted ${target.name}.` } : { ok: false, error: "The session could not be stopped." };
      },

      "council.start": async (params) => {
        const mode = params.mode === "compare" ? "compare" : "council";
        const task = typeof params.task === "string" ? params.task.trim() : "";
        if (!task) {
          // Without a question there is nothing for the members to work on, so
          // open the setup rather than spawn idle agents.
          openCouncilSetup(mode);
          return { ok: true, message: `I've opened the ${mode} setup. Pick who should take part.` };
        }
        openCouncilSetup(mode);
        setDraftTaskTitle(task);
        setDraftTaskDescription(task);
        return { ok: true, message: `I've set up a ${mode} on that. Choose the members and start it.` };
      },

      "task.start": async (params) => {
        const identifier = typeof params.identifier === "string" ? params.identifier.trim() : "";
        const title = typeof params.title === "string" ? params.title.trim() : "";
        const existing = projectTasks.find(
          (task) =>
            (identifier && task.identifier?.toLowerCase() === identifier.toLowerCase()) ||
            (title && task.title.toLowerCase() === title.toLowerCase()),
        );

        if (existing && selectedSession.id) {
          await startTaskInSession(existing, selectedSession);
          return { ok: true, message: `Started ${existing.identifier || existing.title} in ${selectedSession.name}.` };
        }

        // No session to put it in, or the task does not exist yet: pre-fill the
        // create flow so the identifier the user spoke is not lost.
        if (identifier) setDraftTaskIdentifier(identifier);
        if (title || identifier) {
          setDraftTaskTitle(title || identifier);
          setDraftTaskDescription(title || `Work on ${identifier}`);
        }
        setCreateSessionOpen(true);
        return {
          ok: true,
          message: `I've set up ${identifier || title} and opened the session picker. Choose an agent to start.`,
        };
      },

      "os.open_terminal": () => {
        setWorkbenchTab("terminal");
        return { ok: true };
      },

      "memory.restore": (snapshot) => {
        const name = String((snapshot as { projectName?: string }).projectName ?? "");
        const target = name ? bestMatch(name, projects, (project) => project.name) : null;
        if (!target) return { ok: false, error: `${name} is no longer in the workspace.` };
        selectProject(target);
        const files = Array.isArray((snapshot as { openFiles?: string[] }).openFiles)
          ? (snapshot as { openFiles: string[] }).openFiles
          : [];
        if (files[0]) openFileInEditor(files[0]);
        return { ok: true, projectName: target.name };
      },
    }),
    [
      activeProject,
      projects,
      projectFiles,
      projectTasks,
      selectedSession,
      workbenchTab,
      agentOptions,
    ],
  );

  const voice = useVoice(voiceHandlers);

  const handleTerminalInput = useCallback((data: string) => {
    if (!selectedSession.id) return;

    void (async () => {
      const attached = terminalAttachedBySession[selectedSession.id] || (await ensureAgentTerminal(selectedSession));
      if (attached) {
        await window.pitwall?.writeTerminal?.({
          sessionId: selectedSession.id,
          data,
        });
        if (data.trim() && !isTerminalReply(data)) markSessionRunning(selectedSession.id);
      } else {
        appendTerminalLine(selectedSession.id, `${selectedSession.agent} CLI could not attach`);
      }
    })();
  }, [selectedSession, terminalAttachedBySession]);

  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    if (!selectedSession.id) return;
    recordTerminalSize(selectedSession.id, cols, rows);
  }, [selectedSession.id]);

  // Task facts only matter where a task is being worked or judged.
  // Review carries its own decision bar; a second Approve beside it was noise.
  const inspectorSection = baseSection === "work" ? baseSection : null;
  // The council shows its own members, and its terminals need the width more
  // than a second list of the same people beside them.
  const filesShown = filesPanelEnabled && filesOpen && baseSection === "work" && workbenchTab !== "council" && hasSelectedSession && Boolean(editorWorkspacePath);
  const inspectorShown = filesShown || (missionOpen && inspectorSection !== null && !(inspectorSection === "work" && workbenchTab === "council"));

  /** One section's page; rendered under a sheet, or inside one. */
  const renderSection = (section: WorkspaceSection) => (
    <>
      {section === "hermes" ? (
        <HermesPanel
          state={hermesState}
          projectName={activeProject.name}
          overseer={activeOverseer}
          models={(agentOptions.find((option) => option.agent === "Hermes")?.models ?? []).map((model) => ({ value: model.value, label: model.label }))}
          reviews={pitwall.tasks
            .filter((task) => task.pair?.reviewer === "hermes" && (task.pair.state === "reviewing" || task.pair.outcome))
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, 12)}
          learned={pitwall.activity.filter((event) => event.message.startsWith("Hermes learned")).slice(0, 12)}
          scorecard={reviewerScorecard(pitwall.tasks, "hermes", activeProject.id)}
          onToggle={(enabled) => updateProjectRecord(activeProject.id, { overseer: { ...activeOverseer, enabled } })}
          onModel={(model) => updateProjectRecord(activeProject.id, { overseer: { ...activeOverseer, model } })}
          onSignIn={() => {
            setSystemNoticeNow({ tone: "warn", title: "Signing Hermes in…", message: "Starting Hermes's sign-in. Your browser opens to approve it." });
            void window.pitwall?.hermesSignIn?.();
          }}
          onSetUp={() => { setConnectionsProvider(null); setWorkspaceSection("connections"); }}
          onOpenReview={(task) => {
            if (task.status === "review") {
              setReviewFocusTaskId(task.id);
              setWorkspaceSection("review");
            } else setTaskDetail(task);
          }}
          onOpenMemory={() => setWorkspaceSection("context")}
        />
      ) : section === "connections" ? (
            <ConnectionsPanel
              embedded
              usageReporting={{
                enabled: analyticsEnabled,
                onChange: (enabled) => {
                  setAnalyticsEnabled(enabled);
                  void window.pitwall?.analyticsState?.({ enabled });
                },
              }}
              onAddAgent={() => {
                setAddAgentFromSession(false);
                setAddAgentOpen(true);
              }}
              onInstall={(providerId) => setInstallProviderId(providerId)}
              showRepositoryIdentity={false}
              catalogue={agentCatalogue}
              installedCommands={catalogueInstalled}
              onInstallCatalogue={(entry) => {
          // A first-class agent arriving from the catalogue is still a
          // provider, and its row already knows how to install one.
          const known = getProviderById(entry.id);
          if (known) setInstallProviderId(known.id);
          else setInstallEntry(entry);
        }}
              liveModels={liveModelsByCommand}
              drivableCommands={drivableCommands}
              localModelCount={localModelCount}
              onAgentReady={(agent) => handleSaveCustomAgent(agent)}
              projectName={activeProject.name}
              githubLogin={githubAuthStatus?.configured ? githubAuthStatus.login ?? null : null}
              checks={agentChecks}
              mcpByProvider={mcpByProvider}
              focusedProvider={connectionsProvider}
              refreshing={checkingAgents || refreshingProviderModels}
              onGitHub={() => {
                setGitHubAuthNotice("");
                setGitHubAuthOpen(true);
              }}
              onProvider={(provider) => {
                const definition = getProviderById(provider);
                if (!definition) return;
                setDraftAgent(definition.agent);
                setDraftModel(providerOptions.find((item) => item.agent === definition.agent)?.models[0]?.label ?? "Auto");
                setWorkspaceSection("work");
                setCreateSessionOpen(true);
              }}
              onMcp={(provider) => {
                setMcpProvider(provider);
                setMcpManagerOpen(true);
                void refreshMcp(provider);
              }}
              onBrowseExtensions={(provider) => {
                setExtensionsProvider(provider);
                setWorkspaceSection("extensions");
              }}
              onRefresh={() => {
                void Promise.all([refreshAgentChecks(), refreshProviderModels(true)]);
              }}
            />
          ) : section === "extensions" ? (
            <ExtensionsPanel
              track={track}
              initialProvider={extensionsProvider}
              onAddCustomMcp={(provider) => {
                setMcpProvider(provider as PitwallProviderId);
                setAddMcpOpen(true);
              }}
            />
          ) : section === "home" ? (
            <HomePage
              projects={projects}
              tasks={pitwall.tasks}
              defaultProjectId={activeProject.id}
              onStart={(projectId, instruction) => {
                const project = projects.find((item) => item.id === projectId);
                if (project && project.id !== activeProject.id) selectProject(project);
                setWorkspaceSection("work");
                setDraftInstruction(instruction);
                setCreateSessionOpen(true);
              }}
              onOpenSession={(project, session) => {
                if (project.id !== activeProject.id) selectProject(project);
                void selectSession(session);
                setWorkspaceSection("work");
              }}
              onOpenReview={(project) => {
                if (project.id !== activeProject.id) selectProject(project);
                setWorkspaceSection("review");
              }}
            />
          ) : section === "watch" ? (
            <WatchPage
              key={activeProject.id}
              project={activeProject}
              focusFindingId={focusFindingId}
              modelOptions={automationModelOptions}
              reviewModelOptions={reviewModelOptions}
              automationSettings={automationSettings}
              onSetModel={(watch, model) => void window.pitwall?.updateWatch?.({ watchId: watch.id, config: { model } })}
              onSaveAutomationSettings={(patch) => {
                void window.pitwall?.setAutomationSettings?.(patch).then((result) => { if (result?.settings) setAutomationSettings(result.settings); });
              }}
              hostLabel={codeHost?.kind === "github" ? "GitHub" : codeHost?.kind === "gitlab" ? "GitLab" : codeHost ? null : "your code host"}
              requestNoun={requestNoun}
              watches={watchState.watches.filter((watch) => watch.projectId === activeProject.id)}
              findings={watchState.findings.filter((finding) => finding.projectId === activeProject.id && finding.state !== "skipped")}
              trackerSources={(() => {
                // The trackers this project already imports from: the only ones it is connected to.
                const sources = new Map<string, { provider: string; name: string; target: string; label: string }>();
                for (const task of projectTasks) {
                  if (task.source?.kind !== "mcp" || !task.source.name) continue;
                  const provider = task.source.provider || "claude";
                  sources.set(`${provider}:${task.source.name}`, { provider, name: task.source.name, target: task.source.target || "", label: task.source.name });
                }
                return [...sources.values()];
              })()}
              onAdd={async (kind, config, intervalSeconds) => {
                const result = await window.pitwall?.addWatch?.({ projectId: activeProject.id, projectPath: activeProject.path, kind, config, intervalSeconds });
                return result ?? { ok: false, error: "Watches are not available in this build." };
              }}
              onToggleWatch={(watch, enabled) => void window.pitwall?.updateWatch?.({ watchId: watch.id, enabled })}
              onSetInterval={(watch, intervalSeconds) => void window.pitwall?.updateWatch?.({ watchId: watch.id, intervalSeconds })}
              onRemoveWatch={(watch) => void window.pitwall?.removeWatch?.({ watchId: watch.id })}
              onCheckNow={async () => {
                const state = await window.pitwall?.checkWatchesNow?.({ projectId: activeProject.id });
                if (state?.ok) setWatchState({ watches: state.watches, findings: state.findings });
              }}
              onRetry={(finding) => void window.pitwall?.retryWatchFinding?.({ findingId: finding.id })}
              onDismiss={(finding) => void window.pitwall?.dismissWatchFinding?.({ findingId: finding.id })}
              onPost={async (finding, review, approveOnly = false) => {
                const result = await window.pitwall?.postWatchReview?.(approveOnly ? { findingId: finding.id, approveOnly } : { findingId: finding.id, review });
                if (!result) return { ok: false, error: "Posting is not available in this build." };
                if (result.ok) {
                  appendActivity({ projectId: activeProject.id, type: "system", message: `${approveOnly ? "Approved" : "Review posted on"} ${requestNoun === "merge request" ? "!" : "#"}${finding.number} ${finding.title}` });
                  setSystemNotice({ tone: result.warning ? "warn" : "info", title: approveOnly ? "Approved" : "Review posted", message: result.warning || result.url || finding.url });
                }
                return result;
              }}
              onApproveFix={async (finding, fix) => {
                const result = await window.pitwall?.approveWatchFix?.({ findingId: finding.id, fix });
                if (!result) return { ok: false, error: "This is not available in this build." };
                if (result.ok) {
                  const what = fix.commit ? `Pushed a fix to ${finding.headRef}` : "Posted replies";
                  appendActivity({ projectId: activeProject.id, type: "system", message: `${what} on ${requestNoun === "merge request" ? "!" : "#"}${finding.number} ${finding.title}` });
                  setSystemNotice({ tone: result.warning ? "warn" : "info", title: fix.commit ? "Fix pushed" : "Replies posted", message: result.warning || result.url || finding.url });
                }
                return result;
              }}
              agents={councilSwapOptions}
              defaultAgent={activeProject.sessions.at(-1)?.agent ?? draftAgent}
              onApproveTicket={async (finding, plan, start, agent, model) => {
                const created = createTaskFromTicket(finding, plan, providerIdFromAgent(agent as AgentProvider));
                if (!created) return { ok: false, error: "The ticket could not be made into a task." };
                await window.pitwall?.resolveWatchFinding?.({ findingId: finding.id, url: finding.url });
                if (start) {
                  const session = await createAgentSession({ project: activeProject, agent: agent as AgentProvider, model, sessionType: "implementation", taskId: created.id, task: created, startTask: true });
                  if (!session) return { ok: true, warning: "The task was created, but its session could not start." };
                  openStartedSession(activeProject.id, session.id);
                }
                setSystemNotice({ tone: "info", title: start ? "Task created and started" : "Task created", message: created.title });
                return { ok: true };
              }}
              onRevise={async (finding, instruction, current) => {
                const result = await window.pitwall?.reviseWatchFinding?.({ findingId: finding.id, instruction, current });
                return result ?? { ok: false, error: "This is not available in this build." };
              }}
              onOpenUrl={(url) => void window.pitwall?.openExternalUrl?.(url)}
            />
          ) : section !== "work" ? (
            <ProjectHub
              key={activeProject.id}
              section={section}
              project={activeProject}
              scheduleJobs={scheduleJobs.filter((job) => job.projectId === activeProject.id)}
              onSaveScheduleJob={(job) => { void window.pitwall?.saveScheduleJob?.(job).then(refreshSchedule); }}
              onDeleteScheduleJob={(job) => { void window.pitwall?.deleteScheduleJob?.({ id: job.id }).then(refreshSchedule); }}
              onRunScheduleJobNow={(job) => { void runScheduledJob(job); }}
              onMarkScheduleRunDone={(job) => {
                // Recorded as a run rather than as a flag, so the history says
                // what settled it and when — and says plainly that it was you.
                void window.pitwall?.recordScheduleRun?.({
                  id: job.id,
                  entry: { at: nowIso(), outcome: "ok", reason: "marked done by you" },
                }).then(refreshSchedule);
              }}
              onCreateScheduleJob={createScheduleJob}
              scheduleAgents={implementerOptions.map((option) => option.agent)}
              renderScheduleRun={renderScheduleRun}
              reviewFacts={reviewFacts}
              pullRequestsAvailable={pullRequestsAvailable}
              pullRequestError={pullRequestError}
              reviewError={reviewError}
              reviewRefreshing={reviewRefreshing}
              onRefreshReview={() => void refreshReviewState(true)}
              knowledgeRefresh={knowledgeRefresh}
              // Branches with a session that is actually running. A finished
              // session's branch is history; a live one is a branch that can
              // still collide with another being worked right now.
              sessionBranches={Array.from(new Set(
                activeProject.sessions
                  .filter((session) => session.status === "running" || session.status === "waiting")
                  .map((session) => session.branch)
                  .filter(Boolean),
              ))}
              // Opened as a tab on this screen, not a folder and not a jump
              // to the run workspace: you are already looking at what needs
              // attention, and the diff is why.
              // Keyed by branch, since that is what a review row knows about
              // itself — a task may have been worked by several sessions.
              // What the sessions on each task reported spending. Absent
              // where the CLI said nothing, which is most of them today —
              // shown as unknown rather than filled in with a guess.
              usageByTask={Object.fromEntries(
                projectTasks.map((task) => {
                  const usages = pitwall.sessions
                    .filter((item) => item.taskId === task.id)
                    .map((item) => sessionUsage[item.id])
                    .filter(Boolean);
                  return [task.id, totalUsage(usages)];
                }),
              )}
              checksByTask={Object.fromEntries(projectTasks.map((task) => [task.id, taskValidation(task)]))}
              checkingTaskIds={projectTasks.filter(taskValidationRunning).map((task) => task.id)}
              attentionTaskIds={pitwall.sessions.filter((session) => session.projectId === activeProject.id && (activeProject.sessions.find((item) => item.id === session.id)?.status === "waiting" || councilOutputLooksGated(session.id))).map((session) => session.taskId)}
              onRunValidation={(task) => void runTaskValidation(task)}
              onSelectSession={(session) => void selectSession(session)}
              onOpenBranch={() => track("branch_diff_opened", { surface: "review" })}
              onCancelTask={cancelTask}
              tasks={projectTasks}
              activeTask={activeTask}
              focusReviewTaskId={reviewFocusTaskId}
              sessions={activeProject.sessions}
              contextEntries={projectContextEntries}
              selectedContextIds={selectedContextIds}
              activity={projectActivity}
              runCountByTask={runCountByTask}
              providerLabel={(provider) => provider === "council" ? "Council" : getProviderLabel(provider)}
              onNewTask={() => setCreateTaskOpen(true)}
              trackerSyncMinutes={(() => {
                const last = trackerSyncedAt[activeProject.id];
                if (!last || !boardSyncMsRef.current) return null;
                return Math.max(0, Math.ceil((last + boardSyncMsRef.current - trackerNow) / 60_000));
              })()}
              onSyncTasks={() => {
                if (trackerSyncing) return;
                setTrackerSyncing(true);
                void syncTrackerSources(activeProject.id, { manual: true }).finally(() => setTrackerSyncing(false));
              }}
              syncingTasks={trackerSyncing}
              onImportTasks={() => {
                setMcpTaskImportOpen(true);
                void Promise.all(providerRegistry.map((provider) => refreshMcp(provider.id)));
              }}
              onSelectTask={selectMissionTask}
              onOpenTask={setTaskDetail}
              hasSession={(task) => Boolean(sessionForTask(task))}
              onOpenSession={(task) => {
                const session = sessionForTask(task);
                if (!session) return;
                void selectSession(session);
                setWorkspaceSection("work");
                setWorkbenchTab("terminal");
              }}
              onStartTask={(task) => {
                setDraftTaskId(task.id);
                if ((runCountByTask[task.id] ?? 0) > 0) selectMissionTask(task);
                else setStartTaskOpen(true);
              }}
              onStartTasks={(tasks) => {
                setBulkStartTasks(tasks);
                const assigned = tasks.find((task) => task.assignedAgent && task.assignedAgent !== "council")?.assignedAgent;
                if (assigned) selectDraftAgent(agentFromProviderId(assigned));
              }}
              onDeleteTasks={setTasksPendingDelete}
              onMoveTask={moveTaskToColumn}
              onClearColumn={(column, tasks) => setColumnPendingClear({ column, tasks })}
              onCompleteTask={(task) => completeActiveTask(task)}
              onRequestChanges={requestTaskChanges}
              onOpenWork={() => setWorkspaceSection("work")}
              onNewContext={() => setCreateContextOpen(true)}
              onToggleContext={(id, checked) => {
                setSelectedContextIds((current) =>
                  checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id),
                );
              }}
              onOpenGitHub={() => setGitHubAuthOpen(true)}
              overseer={pitwall.projects.find((item) => item.id === activeProject.id)?.overseer}
              hermesReady={agentChecks.Hermes?.status === "ready"}
              hermesModels={(agentOptions.find((option) => option.agent === "Hermes")?.models ?? []).map((model) => ({ value: model.value, label: model.label }))}
              onChangeOverseer={(next) => updateProjectRecord(activeProject.id, { overseer: next })}
              githubLogin={githubAuthStatus?.configured ? githubAuthStatus.login ?? null : null}
              repositoryHost={repositoryHost}
              requestNoun={requestNoun}
              onOpenConnections={() => {
                setConnectionsProvider(null);
                setWorkspaceSection("connections");
              }}
              onOpenProject={() => window.pitwall?.openPath(activeProject.path)}
              editorLabel={preferredEditor?.name ?? "Finder"}
              previewByTask={previewByTask}
              onOpenTaskEditor={openTaskInEditor}
              onOpenTaskPullRequest={openTaskPullRequest}
              onCreateTaskRequest={startTaskRequest}
              onOpenTaskPreview={openTaskPreview}
            />
          ) : null}
    </>
  );

  return (
    <main
      className={`dk-shell${inspectorShown ? "" : " is-inspector-hidden"}`}
      data-section={baseSection}
      style={filesShown ? ({ "--inspector-w": `${filesWidth}px` } as React.CSSProperties) : undefined}
    >
      <TaskSidebar
        groups={sidebarGroups}
        selectedRowId={sidebarSessionRowId || sidebarSelection}
        attentionBySession={sidebarAttention}
        projects={projects}
        notificationCounts={Object.fromEntries(Object.entries(projectNotifications).map(([id, notification]) => [id, notification?.count ?? 0]))}
        projectFilter={sidebarProjectFilter}
        view={workspaceSection === "tasks" ? "board" : "now"}
        automationsOpen={workspaceSection === "schedule" || workspaceSection === "watch"}
        automationsWaiting={watchState.findings.filter((finding) => finding.state === "ready").length}
        hermesStatus={{ ...hermesStatusLine(hermesState), open: workspaceSection === "hermes", onOpen: () => setWorkspaceSection("hermes") }}
        extensionsOpen={workspaceSection === "extensions"}
        settingsOpen={workspaceSection === "connections"}
        agentsNeedingSetup={providerReadiness.needsSetup}
        theme={theme}
        updateState={updateState}
        onProjectFilter={(projectId) => {
          setSidebarProjectFilter(projectId);
          const project = projects.find((item) => item.id === projectId);
          if (!project) return;
          // Picking the open project shows its board, as clicking it always did.
          if (project.id === activeProject.id) {
            if (["work", "home", "connections", "extensions"].includes(workspaceSection)) setWorkspaceSection("tasks");
          } else selectProject(project);
        }}
        onAddProject={addProject}
        onRemoveProject={removeProject}
        onDescribeProject={() => setCreateProjectFlowOpen(true)}
        onView={(view) => setWorkspaceSection(view === "board" ? "tasks" : "work")}
        onSelectRow={openSidebarRow}
        onDeleteSession={(row) => {
          const session = projects.flatMap((project) => project.sessions).find((item) => item.id === row.sessionId);
          if (session) setSessionPendingDelete(session);
        }}
        // The row as its session: the same path a loose session takes, other projects included.
        onOpenSession={(row) => openSidebarRow({ ...row, kind: "session" })}
        onDeleteCouncil={(row) => {
          const run = pitwall.councilRuns.find((item) => item.id === row.councilRunId);
          if (run) setCouncilPendingDelete(run);
        }}
        onNewWork={() => { setDraftInstruction(""); setCreateSessionOpen(true); }}
        onSearch={() => openPalette("commands")}
        onOpenAutomations={openAutomations}
        onOpenExtensions={() => setWorkspaceSection("extensions")}
        onOpenSettings={() => { setConnectionsProvider(null); setWorkspaceSection("connections"); }}
        onOpenAgents={() => { setConnectionsProvider(null); setWorkspaceSection("connections"); }}
        onToggleTheme={() => setThemePreference(theme === "dark" ? "light" : "dark")}
      />

      <section className="dk-workspace">
        {baseSection === "home" ? null : (
        <WorkspaceHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          actions={
            <>
              {githubActivationPrompt === activeProject.id && activeProject.id ? (
                <button
                  type="button"
                  className="dk-btn dk-btn--sm dk-btn--attention"
                  onClick={() => {
                    setConnectionsProvider(null);
                    setConnectionsOpen(true);
                  }}
                  title={repositoryHost?.kind === "gitlab"
                    ? `${activeProject.name} is on GitLab, and nothing on this Mac can sign in to it yet. Add an account here.`
                    : `${activeProject.name} has no GitHub account of its own, so it uses whichever account is active on this Mac and anything else can change it. Add one here.`}
                >
                  Add {repositoryHost?.label ?? "GitHub"} account
                </button>
              ) : null}
              {updateState && ["available", "downloading", "ready", "error", "blocked"].includes(updateState.status) ? (
                <button
                  type="button"
                  className={`dk-btn dk-btn--sm${updateState.status === "ready" || updateState.status === "available" ? " dk-btn--primary" : updateState.status === "error" || updateState.status === "blocked" ? " dk-btn--attention" : ""}`}
                  disabled={updateState.status === "downloading"}
                  title={updateState.message}
                  onClick={() => {
                    if (updateState.status === "ready") void window.pitwall?.installUpdate?.();
                    else if (updateState.status === "available") void window.pitwall?.downloadUpdate?.();
                    // Nothing to retry when the install itself is the problem.
                    else if (updateState.status === "blocked") window.pitwall?.openPath?.("/Applications");
                    else void window.pitwall?.checkForUpdates?.();
                  }}
                >
                  {updateState.status === "ready"
                    ? "Restart to update"
                    : updateState.status === "downloading"
                      ? `${updateState.progress}%`
                      : updateState.status === "blocked"
                        ? "Cannot update"
                        : updateState.status === "error"
                          ? "Retry update"
                          : `Update ${updateState.availableVersion ?? ""}`}
                </button>
              ) : null}
              {licenceChipLabel(licence) ? (
                <button type="button" className={`dk-btn dk-btn--sm${licence.canStartWork ? "" : " dk-btn--attention"}`} onClick={() => setLicenceOpen(true)} title={licence.message}>
                  {licenceChipLabel(licence)}
                </button>
              ) : null}
              {baseSection === "work" && hasSelectedSession && !councilSessionIds.has(selectedSession.id) && workbenchTab !== "council" ? (
                <SessionSwap
                  key={selectedSession.id}
                  agent={selectedSession.agent}
                  model={selectedSession.model}
                  options={councilSwapOptions}
                  busy={screenBusyFor(selectedSession.id) === true}
                  onSwap={(agent, model) => void swapSessionAgent(selectedSession, agent, model)}
                />
              ) : null}
              {baseSection === "work" && hasSelectedSession && !councilSessionIds.has(selectedSession.id) && workbenchTab !== "council" ? (
                <SessionReviewer
                  key={`reviewer-${selectedSession.id}`}
                  current={(() => {
                    const taskId = pitwall.sessions.find((item) => item.id === selectedSession.id)?.taskId;
                    const pair = taskId ? pitwall.tasks.find((item) => item.id === taskId)?.pair : undefined;
                    return pair ? pairReviewerLabel(pair.reviewer) : null;
                  })()}
                  options={automationModelOptions}
                  onAttach={(choice) => void attachReviewer(selectedSession, choice)}
                  onRemove={() => detachReviewer(selectedSession)}
                />
              ) : null}
              {baseSection === "connections" || baseSection === "extensions" ? null : (
                <>
                  <button
                    type="button"
                    className={`dk-icon-button${workspaceSection === "context" ? " is-current" : ""}`}
                    onClick={() => setWorkspaceSection("context")}
                    aria-label="Memory"
                    title={`What Pitwall knows about ${activeProject.name}`}
                  >
                    <BookOpen size={16} aria-hidden="true" />
                  </button>
                  <Dropdown
                    className="dk-more-menu"
                    ariaLabel="More"
                    value=""
                    triggerLabel="⋯"
                    options={[
                      { value: "overview", label: "Overview" },
                      { value: "review", label: "Review queue", hint: reviewQueueCount ? String(reviewQueueCount) : undefined },
                      { value: "activity", label: "Activity" },
                      { value: "folder", label: "Open folder" },
                    ]}
                    onChange={(value) => {
                      if (value === "folder") window.pitwall?.openPath(activeProject.path);
                      else setWorkspaceSection(value as WorkspaceSection);
                    }}
                  />
                </>
              )}
              <NotificationsMenu
                notifications={notifications}
                soundEnabled={notificationSoundEnabled}
                onToggleSound={() => setNotificationSoundEnabled((enabled) => !enabled)}
                onJump={(item) => {
                  setNotifications((list) => list.map((entry) => (entry.id === item.id ? { ...entry, seen: true } : entry)));
                  jumpTo(item.target);
                }}
                onMarkAllSeen={() => setNotifications((list) => list.map((entry) => ({ ...entry, seen: true })))}
              />
            </>
          }
        />
        )}

        {updateState?.status === "blocked" && (
          <div className="dk-banner is-warn" role="status">
            <Download size={16} aria-hidden="true" />
            <p>{updateState.message}</p>
            <button type="button" className="dk-btn dk-btn--sm" onClick={() => window.pitwall?.openPath?.("/Applications")}>
              Open Applications
            </button>
          </div>
        )}

        {!licence.canStartWork && (
          <div className="dk-banner is-warn" role="status">
            <ShieldCheck size={16} aria-hidden="true" />
            <p>{licence.message}</p>
            <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" onClick={() => setLicenceOpen(true)}>Subscribe</button>
          </div>
        )}

        {/* Rendered into the document body rather than here.
            It is `position: fixed`, which means "against the window" only while
            no ancestor has a transform — and the shell it sat in has one for
            the first fifth of a second of every launch, plus `overflow:
            hidden`. For that moment a notice was positioned against the shell
            and clipped by it, which is exactly when the one about restored
            sessions arrives. Out here nothing can capture it. */}
        {systemNotice ? createPortal((
          <div className={`dk-toast is-${systemNotice.tone}`} role={systemNotice.tone === "error" ? "alert" : "status"}>
            {systemNotice.tone === "error" ? <AlertTriangle size={16} aria-hidden="true" /> : <CircleDot size={16} aria-hidden="true" />}
            <div>
              <strong>{systemNotice.title}</strong>
              <span>{systemNotice.message}</span>
              {systemNotice.action === "hermes-sign-in" ? (
                <button
                  type="button"
                  className="dk-btn dk-btn--sm dk-btn--primary dk-toast-action"
                  onClick={() => {
                    setSystemNoticeNow({ tone: "warn", title: "Signing Hermes in…", message: "Starting Hermes's sign-in. Your browser opens to approve it." });
                    void window.pitwall?.hermesSignIn?.();
                  }}
                >
                  Sign in to Hermes
                </button>
              ) : systemNotice.target ? (
                <button
                  type="button"
                  className="dk-btn dk-btn--sm dk-toast-action"
                  onClick={() => {
                    const target = systemNotice.target!;
                    setNotifications((list) => list.map((item) => (item.target === target ? { ...item, seen: true } : item)));
                    jumpTo(target);
                  }}
                >
                  {jumpLabel(systemNotice.target)}
                </button>
              ) : null}
            </div>
            <button type="button" className="dk-icon-btn dk-icon-btn--sm" onClick={() => setSystemNoticeNow(null)} title="Dismiss" aria-label="Dismiss status message">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ), document.body) : null}

        <section className="dk-content">
          <UpdateBanner
            state={updateState}
            workingCount={allSessions.filter((session) => session.status === "running").length}
            onRestart={() => void window.pitwall?.installUpdate?.()}
          />
          {renderSection(baseSection)}

          <section className={`dk-workbench${baseSection === "work" ? "" : " dk-hidden"}`}>
            <div className="dk-workbench-bar">
              {(["terminal", "changes", "editor", "council"] as WorkbenchTab[]).map((tab) => (
                <button
                  type="button"
                  className={workbenchTab === tab ? "is-current" : undefined}
                  aria-pressed={workbenchTab === tab}
                  key={tab}
                  onClick={() => setWorkbenchTab(tab)}
                >
                  {tab === "terminal" && <Terminal size={14} aria-hidden="true" />}
                  {tab === "changes" && <FileDiff size={14} aria-hidden="true" />}
                  {tab === "editor" && <Command size={14} aria-hidden="true" />}
                  {tab === "council" && <Boxes size={14} aria-hidden="true" />}
                  {tab === "terminal" ? "Terminal" : tab === "changes" ? "Changes" : tab === "editor" ? "Editor" : "Council"}
                  {tab === "changes" && liveChangeCount > 0 && <span className="dk-tab-count">{liveChangeCount}</span>}
                  {/* Said where the feature is opened, not buried in a changelog:
                      Council is the least proven thing here and the most
                      expensive to run. */}
                  {tab === "council" && ALPHA_FEATURES.council && (
                    <span className="dk-badge dk-badge--amber" title="Council is in alpha — it works, and it is the least proven part of Pitwall">Alpha</span>
                  )}
                  {tab === "council" && councilSessions.length > 0 && (
                    <span className="dk-tab-count">{councilSessions.length}</span>
                  )}
                </button>
              ))}
              <span className="dk-spacer" />
              {/* The session's own controls share Zed's one tab bar rather than a row of their own. */}
              <div className="dk-toolbar dk-workbench-tools">
                {/* The project's local server, when one has printed its address.
                    It sits with the sessions because that is what produced it,
                    and it is one click rather than a tab — the URL is already
                    clickable in the terminal that printed it. */}
                {previewInput && (
                  sessionPreviews.length > 1 ? (
                    <details className="dk-menu">
                      <summary className="dk-btn dk-btn--sm" title="Open a task development preview">
                        <ExternalLink size={14} aria-hidden="true" />
                        {selectedSessionPreview?.label.split(" · ")[0] || "Task preview"}
                        <span className="dk-mono dk-faint">{formatServerLabel(previewInput)}</span>
                        <ChevronDown size={13} aria-hidden="true" />
                      </summary>
                      <div className="dk-popover dk-menu-popover">
                        {sessionPreviews.map((preview) => (
                          <button type="button" className="dk-menu-item" key={preview.sessionId} onClick={(event) => {
                            event.currentTarget.closest("details")?.removeAttribute("open");
                            void openProjectPreview(preview.url, preview.taskId || undefined);
                          }}>
                            <span className="dk-row-label">{preview.label.split(" · ")[0]}</span>
                            <span className="dk-mono dk-faint">{formatServerLabel(preview.url)}</span>
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <button
                      type="button"
                      className="dk-btn dk-btn--sm"
                      onClick={() => void openProjectPreview(previewInput, selectedSessionPreview?.taskId || undefined)}
                      title={`Open ${previewInput} in your browser`}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      {selectedSessionPreview?.label.split(" · ")[0] || workTask?.identifier || "Project preview"}
                      <span className="dk-mono dk-faint">{formatServerLabel(previewInput)}</span>
                    </button>
                  )
                )}
                {filesPanelEnabled && hasSelectedSession && workbenchTab !== "council" ? (
                  <button
                    type="button"
                    className={`dk-btn dk-btn--sm dk-btn--ghost${filesOpen ? " is-pressed" : ""}`}
                    aria-pressed={filesOpen}
                    onClick={() => setFilesOpen((open) => !open)}
                    title={`Files in this worktree (${filesShortcutLabel()})`}
                  >
                    <FolderTree size={14} aria-hidden="true" />
                    Files
                  </button>
                ) : null}
                {activeProject.sessions.length > 1 && (
                  <button
                    type="button"
                    className="dk-btn dk-btn--sm dk-btn--ghost"
                    onClick={() => setAllSessionsOpen(true)}
                    title="Show all open sessions"
                  >
                    <LayoutGrid size={14} aria-hidden="true" />
                    All sessions
                    <span className="dk-badge">{activeProject.sessions.length}</span>
                  </button>
                )}
                <details
                  className="dk-menu dk-project-menu"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.currentTarget.removeAttribute("open");
                    event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
                  }}
                >
                  <summary className="dk-btn dk-btn--sm dk-btn--ghost">
                    <Settings2 size={14} aria-hidden="true" />
                    Project
                    {mcpAttention ? <span className="dk-count">{mcpAttention}</span> : null}
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <div className="dk-popover dk-menu-popover">
                    <button type="button" className="dk-menu-item" onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      setWorkspaceSection("tasks");
                    }}>
                      <span className="dk-row-label">Tasks</span>
                      <span className="dk-faint">{boardTasks.length}</span>
                    </button>
                    <button type="button" className="dk-menu-item" onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      setWorkspaceSection("context");
                    }}>
                      <span className="dk-row-label">Memory</span>
                      <span className="dk-faint">{selectedContextIds.length}</span>
                    </button>
                    <button type="button" className="dk-menu-item" onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      setMcpManagerOpen(true);
                    }}>
                      <span className="dk-row-label">MCP servers</span>
                      {mcpAttention ? <span className="dk-count">{mcpAttention}</span> : <span className="dk-faint">Manage</span>}
                    </button>
                    <button type="button" className="dk-menu-item" onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      setWorkspaceSection("activity");
                    }}>
                      <span className="dk-row-label">Activity</span>
                      <span className="dk-faint">{projectActivity.length}</span>
                    </button>
                  </div>
                </details>
              </div>
              {workbenchTab === "terminal" ? (
                <TerminalTypographyControls
                  fontFamily={terminalFontFamily}
                  fontSize={terminalFontSize}
                  onFontFamilyChange={setTerminalFontFamily}
                  onFontSizeChange={setTerminalFontSize}
                />
              ) : null}
              {workbenchTab === "terminal" && activeBroadcastSessions.length > 1 ? (
                <button className="dk-btn dk-btn--sm dk-btn--ghost dk-workbench-send" type="button" onClick={() => setBroadcastOpen(true)}>
                  <Send size={14} aria-hidden="true" />
                  Send to all
                  <span className="dk-tab-count">{activeBroadcastSessions.length}</span>
                </button>
              ) : null}
            </div>

            {/* The council takes the whole floor. Frame 7c has a thread and
                four live panes across the pane's full width; a session rail
                beside them is 236px the panes cannot spare, and it lists the
                same members the panes already show. */}
            {/* The session of work waiting on a decision: the decision is here too. */}
            {workbenchTab === "terminal" && hasSelectedSession && selectedSessionTask?.status === "review" ? (
              <div className="dk-review-strip" role="status">
                <span className="dk-review-strip-text">
                  <strong>Ready for your review</strong>
                  {selectedSessionTask.pair?.outcome ? <span>{selectedSessionTask.pair.outcome}</span> : <span>Talk to the agent here, or send it back from Review.</span>}
                </span>
                <button
                  type="button"
                  className="dk-btn dk-btn--sm"
                  onClick={() => {
                    setReviewFocusTaskId(selectedSessionTask.id);
                    setWorkspaceSection("review");
                  }}
                >
                  Review changes
                </button>
                <button type="button" className="dk-btn dk-btn--sm dk-btn--primary" onClick={() => completeActiveTask(selectedSessionTask)}>
                  Approve
                </button>
              </div>
            ) : null}
            <div className={`dk-workbench-body${workbenchTab === "council" ? " is-council" : ""}`}>
            <div className={`dk-pane${workbenchTab === "terminal" ? " is-active" : ""}${selectedPair && pairView === "reviewer" ? " shows-reviewer" : ""}${selectedPair && pairView === "split" ? " shows-split" : ""}`}>
              {allSessions.filter((session) => mountedSessionIds.includes(session.id)).map((session) => (
                  <div
                    className={`dk-terminal${session.id === selectedSession.id ? " is-active" : ""}`}
                    key={session.id}
                  >
                    {/* No second title. The run header above already says
                        what this is and which agent has it; this band repeated
                        the agent's name and the task's, in a pane whose whole
                        content is the CLI saying the same thing again. What is
                        left is the controls, on one line. */}
                    <div className="dk-terminal-bar">
                      {/* With no list beside the terminal, its bar says which
                          session this is and is the way to the others. */}
                      <button
                        type="button"
                        className="dk-terminal-switch"
                        onClick={() => setAllSessionsOpen(true)}
                        title={shortcutLabel("Switch session (⌘J)")}
                      >
                        <span className="dk-terminal-name">{session.name || session.branch}</span>
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                      {session.id === selectedSession.id && selectedPair ? (
                        <div className="dk-pair-tabs" role="tablist" aria-label="Pair">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={pairView === "implementer"}
                            className={pairView === "implementer" ? "is-current" : undefined}
                            onClick={() => setPairView("implementer")}
                          >
                            Implementer
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={pairView === "reviewer"}
                            className={pairView === "reviewer" ? "is-current" : undefined}
                            onClick={() => setPairView("reviewer")}
                          >
                            Reviewer
                            {selectedPair.state === "reviewing" ? <span className="dk-pair-tab-dot" aria-label="reviewing" /> : null}
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={pairView === "split"}
                            className={pairView === "split" ? "is-current" : undefined}
                            onClick={() => setPairView("split")}
                            title="Implementer and reviewer, side by side"
                          >
                            Side by side
                          </button>
                        </div>
                      ) : null}
                      <span className="dk-spacer" />
                      <div className="dk-toolbar">
                        {(restoredTerminalLinesBySession[session.id]?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            className="dk-btn dk-btn--sm dk-btn--ghost"
                            onClick={() => setTranscriptSession(session)}
                            title="Open terminal output saved before Pitwall closed"
                          >
                            <ScrollText size={13} aria-hidden="true" />
                            Transcript
                          </button>
                        )}
                        {/* No Terminal/Chat switch on a single session. The
                            CLI draws its own conversation, and Pitwall's
                            re-reading of the same record beside it was a
                            second, worse copy of what is already on screen —
                            with a toggle above it asking which copy you meant.
                            The transcript button still opens what was saved
                            before Pitwall closed, which the terminal cannot
                            show. */}
                        {surfaceFor(session) === "terminal" && (
                          <button type="button" className="dk-btn dk-btn--sm dk-btn--ghost" onClick={() => void ensureAgentTerminal(session)}>
                            {terminalAttachedBySession[session.id] ? "Attached" : "Attach CLI"}
                          </button>
                        )}
                        <span className="dk-mono dk-faint dk-terminal-command">{getBootCommand(agentOptions, session.agent, session.model) || session.agent}</span>
                      </div>
                    </div>
                    {/* Both stay mounted. Unmounting the one being left is
                        what made switching feel like starting over: the
                        terminal lost its scrollback and the chat its
                        transcript, for a change that is only about which one
                        you are looking at. */}
                    <div className="dk-surfaces">
                    <div className={`dk-surface${surfaceFor(session) === "terminal" ? "" : " is-hidden"}`}>
                    <LiveTerminalView
                      ref={terminalRefFor(session.id)}
                      sessionId={session.id}
                      active={workbenchTab === "terminal" && session.id === selectedSession.id}
                      fontFamily={terminalFontFamily}
                      fontSize={terminalFontSize}
                      store={terminalLinesStore}
                      placeholder={[
                        `$ ${getBootCommand(agentOptions, session.agent, session.model) || "terminal"}`,
                        `Session ${session.name} ready`,
                      ]}
                      onInput={(data) => {
                        // A pane answering its CLI is not you clicking into it.
                        const reply = isTerminalReply(data);
                        if (!reply && session.id !== selectedSession.id) {
                          setSelectedSessionId(session.id);
                        }
                        void (async () => {
                          const attached = terminalAttachedBySession[session.id] || (await ensureAgentTerminal(session));
                          if (attached) {
                            await window.pitwall?.writeTerminal?.({
                              sessionId: session.id,
                              data,
                            });
                            if (!reply && data.trim()) markSessionRunning(session.id);
                          } else {
                            appendTerminalLine(session.id, `${session.agent} CLI could not attach`);
                          }
                        })();
                      }}
                      onResize={(cols, rows) => recordTerminalSize(session.id, cols, rows, true)}
                      ptySize={ptySize[session.id]}
                      // Read as the pane prints, not when the app last rendered: a
                      // stale count made a full buffer look replaced, and the pane
                      // reset and replayed itself every frame.
                      droppedFor={droppedForSession}
                      replayPreamble={replayPreambleFor}
                    />
                    </div>
                    <div className={`dk-surface${surfaceFor(session) === "conversation" ? "" : " is-hidden"}`}>
                      <SessionConversation
                        sessionId={session.id}
                        agent={session.agent}
                        cwd={session.worktreePath || activeProject.path}
                        nativeSessionId={session.nativeSessionId}
                        active={
                          workbenchTab === "terminal" &&
                          session.id === selectedSession.id &&
                          surfaceFor(session) === "conversation"
                        }
                        work={session.id === selectedSession.id ? sessionWork : null}
                        pendingMenu={session.id === selectedSession.id ? selectedScreen.menu : null}
                        onChooseMenuOption={(menu, choice) => answerMenuForSession(session.id, menu, choice)}
                        onAnswerInTerminal={() => switchAgentSurface(session, "terminal")}
                      />
                    </div>
                    </div>

                    {/* The Council thread has always had one of these, and a
                        session's thread is the same thing: you read the
                        conversation, and you answer it without leaving. It goes
                        into the same PTY the terminal shows, so the turn lands
                        in one conversation and appears on both surfaces. */}
                    <div
                      className={`dk-composer-slot${surfaceFor(session) === "conversation" ? "" : " is-hidden"}`}
                    >
                      <TerminalComposer
                        sessionId={session.id}
                        sessionName={session.name}
                        agentLabel={`${session.agent} · ${session.model}`}
                        onFocusTerminal={() => {
                          switchAgentSurface(session, "terminal");
                          terminalHandlesRef.current[session.id]?.focus();
                        }}
                        onSubmit={(text) => {
                          void (async () => {
                            const attached =
                              terminalAttachedBySession[session.id] || (await ensureAgentTerminal(session));
                            if (attached) await sendTerminalPrompt(session.id, text);
                            else {
                              setSystemNotice({
                                tone: "error",
                                title: "The CLI is not running",
                                message: `${session.name} could not take that turn.`,
                              });
                            }
                          })();
                        }}
                      />
                    </div>
                  </div>
                ))}
              {!hasSelectedSession && (
                <div className="dk-work-empty">
                  <div className="dk-empty">
                    <span>{activeTask?.identifier ? `Task ${activeTask.identifier}` : "Workspace ready"}</span>
                    <strong>{activeTask?.title ?? "What should Pitwall work on?"}</strong>
                    <p>
                      {activeTask
                        ? "Start the task with an agent, or open a new session for exploratory work."
                        : "Define an outcome and Pitwall will prepare the agent, context, and working branch."}
                    </p>
                    <div className="dk-toolbar">
                      <button
                        type="button"
                        className="dk-btn dk-btn--primary"
                        onClick={() => {
                          if (!activeTask) {
                            setCreateTaskOpen(true);
                          } else if (taskStartSessions.length > 0) {
                            selectMissionTask(activeTask);
                          } else {
                            setStartTaskOpen(true);
                          }
                        }}
                      >
                        <Play size={15} aria-hidden="true" />
                        {!activeTask ? "Create a task" : taskStartSessions.length > 0 ? "Open task session" : "Start task"}
                      </button>
                      <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setWorkbenchTab("editor")}>
                        Open project in {preferredEditor?.name ?? "Finder"}
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {selectedPair ? (
                <PairReviewerPane
                  hidden={pairView === "implementer"}
                  pair={selectedPair}
                  implementerLabel={selectedSession.agent}
                  implementerWorking={selectedSession.status === "running"}
                  store={terminalLinesStore}
                  droppedFor={droppedForSession}
                  replayPreamble={replayPreambleFor}
                  visible={workbenchTab === "terminal" && baseSection === "work" && pairView !== "implementer"}
                  fontFamily={terminalFontFamily}
                  fontSize={terminalFontSize}
                  onOpenReview={() => setWorkspaceSection("review")}
                />
              ) : null}
            </div>


            <div className={`dk-pane${workbenchTab === "council" ? " is-active" : ""}`}>
              <CouncilGrid
                active={workbenchTab === "council"}
                ptySize={ptySize}
                hasRun={Boolean(activeCouncilRun) && councilSessions.length > 0}
                mode={activeCouncilMode}
                name={
                  activeCouncilRun?.name ??
                  (activeCouncilRun
                    ? formatCouncilRunName(
                        pitwall.tasks.find((task) => task.id === activeCouncilRun.taskId)?.title ?? "Untitled task",
                        activeCouncilMode,
                      )
                    : undefined)
                }
                sessions={councilSessions}
                gateBySession={councilGateBySession}
                relayBySession={relayBySession}
                relayRun={relayRunState[activeCouncilRunId]}
                summary={activeCouncilRun ? {
                  objective: activeRelay?.task.title ?? pitwall.tasks.find((task) => task.id === activeCouncilRun.taskId)?.title ?? "Council task",
                  description: activeRelay?.task.description,
                  workingSet: activeRelay?.workingSet,
                  decisions: activeRelay?.workingSet.decisions,
                  evidence: activeRelay?.evidence,
                  verification: activeRelay?.verification ? {
                    attempt: activeRelay.verification.attempts,
                    verdict: activeRelay.verification.verdict,
                    pending: activeRelay.verification.pending,
                  } : undefined,
                  currentAssignment: activeRelay?.currentMemberId ? {
                    member: activeRelay.members.find((member) => member.memberId === activeRelay.currentMemberId)?.roleLabel ?? activeRelay.currentMemberId,
                    directive: activeRelay.currentAssignment,
                  } : undefined,
                  contextReceipts: Object.values(contextReceipts).filter((receipt) => receipt.runId === activeCouncilRunId),
                  status: relayRunState[activeCouncilRunId]?.note || activeCouncilRun.status,
                } : undefined}
                memberWork={councilMemberWork}
                // The thread's ingredients are read off the run itself.
                // relayRunState changes on every routing decision, so this
                // re-reads with fresh contents; the run lives in a ref because
                // it is written from callbacks, and a ref changing is invisible
                // to React on its own.
                routes={relayRunRef.current[activeCouncilRunId]?.routes ?? []}
                thread={relayRunRef.current[activeCouncilRunId]?.messages ?? []}
                relayMembers={relayRunRef.current[activeCouncilRunId]?.members ?? []}
                currentMemberId={relayRunRef.current[activeCouncilRunId]?.currentMemberId}
                onOpenMember={(sessionId) => {
                  const session = councilSessions.find((item) => item.id === sessionId);
                  if (session) void selectSession(session);
                }}
                onHandoff={(session) => void handoffCouncilStage(session)}
                onToggleRelayAuto={(auto) => setRelayAuto(activeCouncilRunId, auto)}
                onExtendTurns={(extraTurns) => extendRelayTurns(activeCouncilRunId, extraTurns)}
                onExtendBudget={(extraHours) => extendRelayBudget(activeCouncilRunId, extraHours)}
                nextTasks={projectTasks.filter(
                  (item) => item.id !== activeCouncilRun?.taskId
                    && item.status !== "completed"
                    && item.status !== "cancelled",
                )}
                onStartAnotherTask={(taskId) => {
                  const task = projectTasks.find((item) => item.id === taskId);
                  if (task) void startAnotherCouncilTask(activeCouncilRunId, task);
                }}
                onUpdateConfig={(patch) => updateRelayConfig(activeCouncilRunId, patch)}
                onAdoptCouncil={() => void adoptLegacyCouncil(activeCouncilRunId)}
                linesStore={terminalLinesStore}
                terminalFontFamily={terminalFontFamily}
                terminalFontSize={terminalFontSize}
                onTerminalFontFamilyChange={setTerminalFontFamily}
                onTerminalFontSizeChange={setTerminalFontSize}
                bootCommand={(agent, model) => getBootCommand(agentOptions, agent, model)}
                canStart={true}
                sharedMessage={councilSharedMessage}
                broadcasting={councilBroadcasting}
                conductorMessage={conductorMessage}
                conductorLog={conductorLogByRun[activeCouncilRunId] ?? []}
                conductorDirectives={relayRunState[activeCouncilRunId]?.directives ?? []}
                conductorBusy={conductorBusy}
                conductorStatus={conductorStatus}
                onConductorMessageChange={setConductorMessage}
                onAskConductor={(question) => void askConductorQuestion(question)}
                onInstructConductor={(instruction) => void instructConductor(instruction)}
                onForceReroute={() => void forceConductorReroute()}
                onSendAll={sendCouncilPrompt}
                onSharedMessageChange={setCouncilSharedMessage}
                onBroadcast={(scope) => void broadcastCouncilMessage(scope)}
                onStopAll={() => void stopCouncil()}
                onPause={() => pauseCouncil()}
                onResume={() => resumeCouncil()}
                onStopSession={(session) => runSessionAction(session, "stop")}
                attachedBySession={terminalAttachedBySession}
                onRestartSession={(session) => {
                  void (async () => {
                    appendTerminalLine(session.id, "Restarting…", { informational: true });
                    terminalAttachedRef.current[session.id] = false;
                    // Not resumed: the CLI exited, so there is no conversation
                    // left to pick up — only the files the council keeps.
                    const started = await ensureAgentTerminal(session, { resume: false });
                    if (!started) {
                      setCouncilGate(session.id, "That agent would not start. Swap the seat to another one, or check it is installed.");
                      return;
                    }
                    setCouncilGate(session.id, null);
                  })();
                }}
                droppedBySession={droppedChunksRef.current}
                replayPreamble={replayPreambleFor}
                swapOptions={councilSwapOptions}
                onSwapMember={(session, agent, model) => void swapCouncilMember(session.id, agent, model)}
                onDeleteSession={setSessionPendingDelete}
                onSendSession={(session) => void sendCouncilToSession(session)}
                onInput={(session, data) => {
                  void (async () => {
                    const attached =
                      terminalAttachedBySession[session.id] || (await ensureAgentTerminal(session));
                    if (attached) {
                      await window.pitwall?.writeTerminal?.({ sessionId: session.id, data });
                      if (data.trim() && !isTerminalReply(data)) markSessionRunning(session.id);
                    }
                  })();
                }}
                onResize={(session, cols, rows) => {
                  recordTerminalSize(session.id, cols, rows);
                }}
                onSynthesize={() => void synthesizeCouncil()}
                onStart={() => openCouncilSetup("council")}
              />
            </div>

            <div className={`dk-pane dk-pane--changes${workbenchTab === "changes" ? " is-active" : ""}`}>
              {hasSelectedSession && workbenchTab === "changes" ? (
                <LiveChanges
                  sessionId={selectedSession.id}
                  projectPath={editorWorkspacePath}
                  branch={selectedSession.branch}
                  summary={liveChanges}
                  focusPath={liveChangesFocus}
                />
              ) : null}
            </div>

            <div className={`dk-pane${workbenchTab === "editor" ? " is-active" : ""}`}>
              <div className="dk-editor-launch">
                <div className="dk-card dk-card--pad dk-editor-card">
                  <span className="dk-label">Project</span>
                  <strong className="dk-title">{activeProject.name}</strong>
                  <span className="dk-mono dk-faint" title={editorWorkspacePath}>
                    {editorWorkspacePath.length > 58
                      ? `${editorWorkspacePath.slice(0, 26)}…${editorWorkspacePath.slice(-28)}`
                      : editorWorkspacePath}
                  </span>
                  {selectedSession.branch && <span className="dk-badge dk-mono">{selectedSession.branch}</span>}

                  <button
                    type="button"
                    className="dk-btn dk-btn--primary dk-btn--lg"
                    onClick={() => void openProjectInEditor()}
                    disabled={openingEditor || !editorWorkspacePath}
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                    {openingEditor ? "Opening" : preferredEditor ? `Open in ${preferredEditor.name}` : "Reveal in Finder"}
                  </button>

                  {installedEditors.length > 0 && (
                    <div className="dk-field">
                      <span className="dk-label">Editor</span>
                      <Dropdown
                        value={editorChoice || preferredEditor?.id || ""}
                        onChange={chooseEditor}
                        ariaLabel="Editor to open projects in"
                        options={[
                          ...installedEditors.map((editor) => ({ value: editor.id, label: editor.name })),
                          { value: REVEAL_IN_FINDER, label: "Reveal in Finder" },
                        ]}
                      />
                    </div>
                  )}

                  {/* Only ever the outcome of something the user just did — an
                      editor that opened needs no commentary. */}
                  {editorStatus && <span className="dk-hint">{editorStatus}</span>}

                  <p className="dk-hint">
                    {installedEditors.length > 0
                      ? "Pitwall opens the project in your own editor rather than shipping one of its own."
                      : "No supported editor found. Install one — VS Code, Cursor, Zed, Sublime — and it shows up here."}
                  </p>
                </div>
              </div>
            </div>
            </div>
          </section>
          {sheetOpen ? (
            <Sheet
              title={SECTION_TITLES[workspaceSection] ?? ""}
              onClose={() => setWorkspaceSection(sheetBase)}
              actions={
                <>
              {workspaceSection === "connections" ? (
                <>
                  <div className="dk-segmented" role="group" aria-label="Theme">
                    {THEME_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={colorTheme === option.value ? "is-current" : undefined}
                        aria-pressed={colorTheme === option.value}
                        title={option.hint}
                        onClick={() => setColorTheme(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {colorTheme === "pitwall" ? (
                    <div className="dk-segmented" role="group" aria-label="Appearance">
                      {(["light", "dark", "system"] as const).map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={themePreference === value ? "is-current" : undefined}
                          aria-pressed={themePreference === value}
                          onClick={() => setThemePreference(value)}
                        >
                          {value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {workspaceSection === "schedule" || workspaceSection === "watch" ? (
                <div className="dk-segmented" role="tablist" aria-label="Automations">
                  {(["schedule", "watch"] as const).map((section) => (
                    <button
                      type="button"
                      key={section}
                      role="tab"
                      aria-selected={workspaceSection === section}
                      className={workspaceSection === section ? "is-current" : undefined}
                      onClick={() => setWorkspaceSection(section)}
                    >
                      {section === "schedule" ? "Schedules" : "Watches"}
                      {section === "watch" && readyWatchFindings > 0 ? <span className="dk-tab-count is-attention">{readyWatchFindings}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
                </>
              }
            >
              {renderSection(workspaceSection)}
            </Sheet>
          ) : null}
        </section>
      </section>

      {filesShown ? (
        <aside className="inspector dk-files-aside">
          <PanelResizer width={filesWidth} onResize={setFilesWidth} />
          <FilesPanel
            root={editorWorkspacePath}
            openRequest={filesRequest}
            editorName={editorChoice === REVEAL_IN_FINDER ? null : preferredEditor?.name ?? null}
            onOpenExternal={(filePath) => void openProjectInEditor(`${editorWorkspacePath.replace(/\/$/, "")}/${filePath}`)}
            onAskAgent={(reference) => {
              track("ask_agent_used", { surface: "files" });
              const sessionId = selectedSession.id;
              setWorkbenchTab("terminal");
              void window.pitwall?.writeTerminal?.({ sessionId, data: reference }).then(() => {
                terminalHandlesRef.current[sessionId]?.focus();
              });
            }}
            onClose={() => setFilesOpen(false)}
          />
        </aside>
      ) : inspectorSection ? (
      <WorkspaceInspector
        section={inspectorSection}
        project={activeProject}
        activeTask={workTask}
        selectedSession={hasSelectedSession ? selectedSession : undefined}
        assignedAgentLabel={
          workTask?.assignedAgent === "council"
            ? "Council"
            : workTask?.assignedAgent
              ? getProviderLabel(workTask.assignedAgent)
              : ""
        }
        runCount={workTask ? runCountByTask[workTask.id] ?? 0 : 0}
        contextCount={selectedContextEntries.length}
        taskRuns={inspectorTaskRuns}
        liveChanges={hasSelectedSession ? liveChanges : null}
        onOpenChanges={(filePath) => {
          setWorkspaceSection("work");
          setLiveChangesFocus(filePath);
          setWorkbenchTab("changes");
        }}
        // A session parked on a sign-in or approval prompt looks identical to
        // a working one in scrollback, and will sit there until noticed.
        needsInput={hasSelectedSession ? councilOutputLooksGated(selectedSession.id) : false}
        onOpenWork={() => {
          setWorkspaceSection("work");
          if (workTask) selectMissionTask(workTask);
        }}
        onHandoff={() => createHandoff("codex")}
        onCouncil={() => openCouncilSetup("council")}
        onCompare={() => openCouncilSetup("compare")}
        onReview={() => {
          if (workTask) moveTaskToReview(workTask);
        }}
        onComplete={() => {
          if (workTask) completeActiveTask(workTask);
        }}
      />
      ) : null}

      {taskPendingCompletion ? (
        <CompleteTaskModal
          key={taskPendingCompletion.id}
          task={taskPendingCompletion}
          result={taskValidation(taskPendingCompletion)}
          running={taskValidationRunning(taskPendingCompletion)}
          onRun={() => void runTaskValidation(taskPendingCompletion)}
          onClose={() => setTaskPendingCompletion(null)}
          onConfirm={(override) => completeActiveTask(taskPendingCompletion, override)}
        />
      ) : null}

      {paletteOpen && (() => {
        const results = paletteMode === "files"
          ? quickOpenFiles.map((filePath) => ({ id: filePath, title: basename(filePath), hint: filePath, run: () => openFileInEditor(filePath) }))
          : searchPalette(paletteActions, paletteQuery).map((action) => ({ id: action.id, title: action.title, hint: action.hint ?? action.group, run: () => { setPaletteOpen(false); action.run(); } }));
        const selected = Math.min(paletteIndex, Math.max(results.length - 1, 0));
        return (
        <div className="dk-backdrop dk-palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div
            className="dk-palette"
            role="dialog"
            aria-modal="true"
            aria-label={paletteMode === "files" ? "Go to file" : "Command palette"}
            onClick={(event) => event.stopPropagation()}
          >
            <label className="dk-palette-input">
              {paletteMode === "files" ? <Search size={15} aria-hidden="true" /> : <Command size={15} aria-hidden="true" />}
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => {
                  setPaletteQuery(event.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setPaletteOpen(false);
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (results.length === 0) return;
                    const next = (selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
                    setPaletteIndex(next);
                    document.querySelector(`.dk-palette-row[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    results[selected]?.run();
                  }
                }}
                placeholder={paletteMode === "files" ? "Go to file" : "Search projects, tasks and commands"}
                aria-label={paletteMode === "files" ? "Go to file" : "Search commands"}
                aria-activedescendant={results[selected] ? `palette-row-${selected}` : undefined}
              />
              <kbd className="dk-kbd">esc</kbd>
            </label>
            <div className="dk-palette-results" role="listbox" aria-label="Results">
              {results.map((result, index) => (
                <button
                  type="button"
                  className={`dk-palette-row${index === selected ? " is-selected" : ""}`}
                  key={result.id}
                  id={`palette-row-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selected}
                  onMouseMove={() => { if (index !== selected) setPaletteIndex(index); }}
                  onClick={result.run}
                >
                  {paletteMode === "files" ? <FolderOpen size={14} aria-hidden="true" /> : <Zap size={14} aria-hidden="true" />}
                  <span>{result.title}</span>
                  <small>{result.hint}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        );
      })()}

      <BroadcastMessageModal
        open={broadcastOpen}
        sessions={activeBroadcastSessions}
        taskLabel={(session) => {
          const run = pitwall.sessions.find((item) => item.id === session.id);
          const task = run ? projectTasks.find((item) => item.id === run.taskId) : undefined;
          return task ? `${task.identifier || "Task"} · ${task.title}` : session.name;
        }}
        sending={broadcastSending}
        onClose={() => {
          if (!broadcastSending) setBroadcastOpen(false);
        }}
        onSend={(message) => void broadcastSessionMessage(message)}
      />

      <UnfinishedWorktreesModal
        open={worktreeAudit.open}
        worktrees={worktreeAudit.worktrees}
        error={worktreeAudit.error}
        busyPath={worktreeAudit.busyPath}
        onOpen={(worktree) => void window.pitwall?.openPath?.(worktree.path)}
        onRemove={(worktree) => void removeAuditedWorktree(worktree)}
        onClose={() => setWorktreeAudit((current) => ({ ...current, open: false }))}
      />

      {createTaskOpen && (
        <div className="dk-backdrop" onClick={() => setCreateTaskOpen(false)}>
          <div
            className="dk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dk-dialog-header">
              <div>
                <h2 className="dk-dialog-title" id="new-task-title">New task</h2>
                <p className="dk-dialog-desc">Describe the work. Agents get it in full, and its ID becomes the branch name.</p>
              </div>
              <button type="button" className="dk-icon-btn" onClick={() => setCreateTaskOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="dk-dialog-body">
              <div className="dk-new-task-row">
                <label className="dk-field dk-new-task-id">
                  {/* The qualifier sits with the helper copy under the value,
                      not in the label — a label that wraps beside a one-line
                      field reads as two fields. */}
                  <span className="dk-label">Task ID</span>
                  <input
                    className="dk-input dk-mono"
                    value={draftTaskIdentifier}
                    onChange={(event) => {
                      setDraftTaskIdentifier(event.target.value.toLowerCase());
                      setTaskFormError("");
                    }}
                    placeholder="web-427"
                    autoFocus
                    required
                    aria-invalid={Boolean(taskFormError)}
                    aria-describedby="task-id-help"
                  />
                </label>
                <label className="dk-field dk-new-task-title">
                  <span className="dk-label">Title</span>
                  <input className="dk-input" value={draftTaskTitle} onChange={(event) => setDraftTaskTitle(event.target.value)} />
                </label>
              </div>
              <small
                id="task-id-help"
                className={taskFormError || (draftTaskIdentifier && validateTaskIdentifier(draftTaskIdentifier)) ? "dk-error" : "dk-hint"}
              >
                {taskFormError ||
                  (draftTaskIdentifier && validateTaskIdentifier(draftTaskIdentifier)) ||
                  `Required. Becomes the branch ${normalizeTaskIdentifier(draftTaskIdentifier) || "task-id"}.`}
              </small>

              <label className="dk-field">
                <span className="dk-label">Description</span>
                <textarea
                  className="dk-textarea"
                  rows={6}
                  value={draftTaskDescription}
                  onChange={(event) => setDraftTaskDescription(event.target.value)}
                  placeholder="Scope, constraints, expected behaviour, and review notes"
                />
              </label>
              <TaskImageAttachments
                draftId={draftTaskAttachmentId.current}
                images={draftTaskImages}
                onChange={setDraftTaskImages}
              />

              <div className="dk-new-task-row">
                <div className="dk-field">
                  <span className="dk-label">Priority</span>
                  <Dropdown
                    value={draftTaskPriority}
                    onChange={(value) => setDraftTaskPriority(value as PitwallTaskPriority)}
                    ariaLabel="Priority"
                    options={(["low", "medium", "high", "urgent"] as PitwallTaskPriority[]).map((priority) => ({
                      value: priority,
                      label: priority.charAt(0).toUpperCase() + priority.slice(1),
                    }))}
                  />
                </div>
                <div className="dk-field">
                  <span className="dk-label">Assign to</span>
                  <Dropdown
                    value={draftTaskAgent}
                    onChange={(value) => {
                      if (value === "council") {
                        setDraftTaskAgent("council");
                        return;
                      }
                      const providerId = value as PitwallProviderId;
                      setDraftTaskAgent(providerId);
                      setDraftAgent(agentFromProviderId(providerId));
                    }}
                    ariaLabel="Assign to"
                    options={[
                      ...providerRegistry.filter((provider) => canImplement(provider.agent)).map((provider) => ({ value: provider.id, label: provider.displayName })),
                      { value: "council", label: "Council", hint: "Alpha · all agents, in a relay" },
                    ]}
                  />
                </div>
              </div>
            </div>

            <div className="dk-dialog-footer">
              <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setCreateTaskOpen(false)}>Cancel</button>
              <button
                type="button"
                className="dk-btn dk-btn--primary"
                onClick={createProjectTask}
                disabled={Boolean(validateTaskIdentifier(draftTaskIdentifier))}
              >
                <Plus size={15} aria-hidden="true" />
                Create task
              </button>
            </div>
          </div>
        </div>
      )}

      <McpTaskImportModal
        open={mcpTaskImportOpen}
        projectId={activeProject.id}
        projectPath={activeProject.path}
        sources={mcpTaskSources}
        existingIdentities={importedTaskIdentities}
        onClose={() => setMcpTaskImportOpen(false)}
        onOpenConnections={(provider = "claude") => {
          setMcpTaskImportOpen(false);
          setConnectionsProvider(provider);
          setWorkspaceSection("connections");
        }}
        onAuthenticate={(server) => {
          setMcpProvider(server.provider);
          clearMcpNotice();
          setMcpAuthServer(server);
        }}
        onImport={importMcpTasks}
        onScopeSaved={(source) => void refreshMcp(source.provider as PitwallProviderId)}
      />

      {createContextOpen && (
        <div className="dk-backdrop" onClick={() => setCreateContextOpen(false)}>
          <div
            className="dk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-note-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dk-dialog-header">
              <div>
                <h2 className="dk-dialog-title" id="new-note-title">New note</h2>
                <p className="dk-dialog-desc">A project fact every agent gets, so none of them has to rediscover it.</p>
              </div>
              <button type="button" className="dk-icon-btn" onClick={() => setCreateContextOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="dk-dialog-body">
              <label className="dk-field">
                <span className="dk-label">Title</span>
                <input className="dk-input" value={draftContextTitle} onChange={(event) => setDraftContextTitle(event.target.value)} autoFocus />
              </label>
              <div className="dk-field">
                <span className="dk-label">Category</span>
                <Dropdown
                  value={draftContextCategory}
                  onChange={(value) => setDraftContextCategory(value as PitwallContextEntry["category"])}
                  ariaLabel="Category"
                  options={(["architecture", "coding-standards", "database", "api", "project-goals", "decision", "testing", "security", "notes"] as PitwallContextEntry["category"][]).map((category) => ({
                    value: category,
                    label: category === "api" ? "API" : (category.charAt(0).toUpperCase() + category.slice(1)).replace(/-/g, " "),
                  }))}
                />
              </div>
              <label className="dk-field">
                <span className="dk-label">Content</span>
                <textarea
                  className="dk-textarea"
                  rows={6}
                  value={draftContextContent}
                  onChange={(event) => setDraftContextContent(event.target.value)}
                  placeholder="The exact fact, rule, decision, or constraint agents should receive."
                />
              </label>
            </div>
            <div className="dk-dialog-footer">
              <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setCreateContextOpen(false)}>Cancel</button>
              <button type="button" className="dk-btn dk-btn--primary" onClick={createContextEntry}>
                <Plus size={15} aria-hidden="true" />
                Add note
              </button>
            </div>
          </div>
        </div>
      )}

      <TaskStartModal
        open={startTaskOpen}
        task={activeTask}
        sessions={taskStartSessions}
        starting={Boolean(startingTaskId)}
        onClose={() => {
          if (!startingTaskId) setStartTaskOpen(false);
        }}
        onStart={chooseTaskDestination}
      />

      <TaskDetailModal
        task={inspectedTask}
        runCount={inspectedTask ? runCountByTask[inspectedTask.id] ?? 0 : 0}
        providerLabel={inspectedTask?.assignedAgent === "council" ? "Council" : inspectedTask?.assignedAgent ? getProviderLabel(inspectedTask.assignedAgent) : ""}
        onClose={() => setTaskDetail(null)}
        onOpenWork={() => {
          if (inspectedTask) selectMissionTask(inspectedTask);
          setTaskDetail(null);
        }}
        onStart={() => {
          if (!inspectedTask) return;
          setDraftTaskId(inspectedTask.id);
          setTaskDetail(null);
          setStartTaskOpen(true);
        }}
      />

      <BulkTaskStartModal
        tasks={bulkStartTasks}
        agentOptions={implementerOptions}
        agent={draftAgent}
        models={draftProvider.models}
        model={draftModel}
        sessionType={draftSessionType}
        starting={bulkStartingCount}
        running={bulkStarting}
        cancelling={bulkCancelling}
        onAgentChange={selectDraftAgent}
        onModelChange={setDraftModel}
        onRoleChange={setDraftSessionType}
        onClose={cancelSelectedTaskSessions}
        onStart={() => void startSelectedTaskSessions()}
      />

      <LicenceModal
        open={licenceOpen}
        licence={licence}
        hasKey={hasKey}
        checkoutUrl={checkoutUrl}
        onActivate={activateLicence}
        onClear={clearLicence}
        onOpenCheckout={(url) => {
          track("checkout_opened");
          void window.pitwall?.openExternalUrl?.(url);
        }}
        onClose={() => setLicenceOpen(false)}
      />

      <OnboardingModal
        open={onboardingOpen}
        hasProjects={projects.length > 0}
        analyticsEnabled={analyticsEnabled}
        onAnalyticsChange={(enabled) => {
          setAnalyticsEnabled(enabled);
          void window.pitwall?.analyticsState?.({ enabled });
        }}
        agents={providerOptions.map((provider) => ({
          name: provider.agent,
          command: provider.command,
          loginCommand: provider.loginCommand,
          installCommand: getProviderById(providerIdFromAgent(provider.agent))?.installCommand,
          installDocs: getProviderById(providerIdFromAgent(provider.agent))?.installDocs,
          status: agentChecks[provider.agent]?.status ?? "unknown",
          message: agentChecks[provider.agent]?.message ?? "Checking…",
        }))}
        onAddProject={() => {
          writeStored("pitwall-onboarded", "yes");
          track("onboarding_completed");
          setOnboardingOpen(false);
          void addProject();
        }}
        onClose={() => {
          writeStored("pitwall-onboarded", "yes");
          track("onboarding_completed");
          setOnboardingOpen(false);
        }}
      />

      <InstallAgentModal
        provider={(() => {
          if (installEntry) {
            return {
              id: installEntry.id,
              displayName: installEntry.name,
              command: installEntry.command,
              installCommand: installEntry.installCommand,
              installDocs: installEntry.docs,
            };
          }
          const definition = getProviderById(installProviderId);
          return definition
            ? {
                id: definition.id,
                displayName: definition.displayName,
                command: definition.command,
                installCommand: definition.installCommand,
                installDocs: definition.installDocs,
              }
            : null;
        })()}
        onClose={() => { setInstallProviderId(""); setInstallEntry(null); }}
        onInstalled={() => void refreshAgentChecks()}
      />

      <AddAgentModal
        open={addAgentOpen}
        onClose={() => {
          setAddAgentOpen(false);
          if (addAgentFromSession) setCreateSessionOpen(true);
        }}
        onSave={(input) => handleSaveCustomAgent(input, addAgentFromSession)}
      />

      <CreateProjectFlowModal
        open={createProjectFlowOpen}
        busy={createProjectFlowBusy}
        error={createProjectFlowError}
        agentChecks={agentChecks}
        onClose={() => {
          setCreateProjectFlowOpen(false);
          setCreateProjectFlowError("");
        }}
        onCreate={(draft) => void createDescribedProject(draft)}
      />

      <CouncilSetupModal
        open={councilSetupOpen}
        agentOptions={implementerOptions}
        mode={councilSetupMode}
        agentChecks={agentChecks}
        tasks={boardTasks}
        activeTaskId={activeTask?.id ?? ""}
        onClose={() => setCouncilSetupOpen(false)}
        onStart={(councilMembers, conductor, taskId) => {
          setCouncilSetupOpen(false);
          const chosen = projectTasks.find((item) => item.id === taskId);
          void startCouncilMode(
            councilMembers,
            councilSetupMode,
            chosen ? { task: chosen } : undefined,
            conductor,
          );
        }}
      />

      <AllSessionsModal
        open={allSessionsOpen}
        selectedId={selectedSession.id}
        groups={
          [
            { label: "Sessions", sessions: regularSessions },
            { label: "Council", sessions: councilChipSessions },
          ] as SessionGroup[]
        }
        onOpen={(session) => {
          setAllSessionsOpen(false);
          void selectSession(session);
          setWorkbenchTab("terminal");
        }}
        onDelete={(session) => {
          setAllSessionsOpen(false);
          setSessionPendingDelete(session);
        }}
        onClose={() => setAllSessionsOpen(false)}
      />

      <DeleteSessionModal
        session={sessionPendingDelete}
        deleting={Boolean(deletingSessionId)}
        onCancel={() => {
          if (!deletingSessionId) setSessionPendingDelete(null);
        }}
        onConfirm={() => {
          if (sessionPendingDelete) void deleteSession(sessionPendingDelete);
        }}
      />

      <SessionTranscriptModal
        session={transcriptSession}
        chunks={transcriptSession ? restoredTerminalLinesBySession[transcriptSession.id] ?? [] : []}
        cwd={transcriptSession?.worktreePath || activeProject.path}
        onClose={() => setTranscriptSession(null)}
      />

      {columnPendingClear ? (
        <div className="dk-backdrop" onClick={() => setColumnPendingClear(null)}>
          <section
            className="dk-dialog dk-dialog--narrow"
            ref={clearColumnDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-column-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dk-dialog-header">
              <div>
                <h2 className="dk-dialog-title" id="clear-column-title">
                  Clear {columnPendingClear.column ? `“${columnPendingClear.column}”` : "the whole board"}?
                </h2>
                <p className="dk-dialog-desc">
                  Removes {columnPendingClear.tasks.length}{" "}
                  {columnPendingClear.tasks.length === 1 ? "task" : "tasks"} from Pitwall. Tickets in the source tracker
                  are not touched, and anything already imported can be imported again.
                </p>
              </div>
            </div>
            <div className="dk-dialog-footer">
              <button type="button" className="dk-btn dk-btn--ghost" onClick={() => setColumnPendingClear(null)}>
                Cancel
              </button>
              <button
                className="dk-btn dk-btn--primary dk-btn--danger"
                type="button"
                onClick={() => {
                  const ids = new Set(columnPendingClear.tasks.map((task) => task.id));
                  setPitwall((current) => ({ ...current, tasks: current.tasks.filter((task) => !ids.has(task.id)) }));
                  setColumnPendingClear(null);
                }}
              >
                Clear {columnPendingClear.tasks.length}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <DeleteCouncilModal
        name={
          councilPendingDelete
            ? councilPendingDelete.name ??
              formatCouncilRunName(
                pitwall.tasks.find((task) => task.id === councilPendingDelete.taskId)?.title ?? "Untitled task",
                "council",
              )
            : null
        }
        sessionCount={councilPendingDelete?.responses.length ?? 0}
        deleting={Boolean(deletingCouncilRunId)}
        onCancel={() => {
          if (!deletingCouncilRunId) setCouncilPendingDelete(null);
        }}
        onConfirm={() => {
          if (councilPendingDelete) void deleteCouncilRun(councilPendingDelete);
        }}
      />

      <DeleteTaskModal
        task={taskPendingDelete}
        queued={Math.max(0, tasksPendingDelete.length - 1)}
        sessionCount={
          taskPendingDelete
            ? pitwall.sessions.filter((session) => session.taskId === taskPendingDelete.id).length
            : 0
        }
        councilCount={
          taskPendingDelete
            ? pitwall.councilRuns.filter((run) => run.taskId === taskPendingDelete.id).length +
              pitwall.compareRuns.filter((run) => run.taskId === taskPendingDelete.id).length
            : 0
        }
        deleting={Boolean(deletingTaskId)}
        onCancel={() => {
          if (!deletingTaskId) setTasksPendingDelete([]);
        }}
        onConfirm={() => {
          if (taskPendingDelete) void deleteTask(taskPendingDelete);
        }}
      />

      <ConnectionsModal
        open={connectionsOpen}
        projectName={activeProject.name}
        githubLogin={githubAuthStatus?.configured ? githubAuthStatus.login ?? null : null}
        repositoryHost={repositoryHost}
        checks={agentChecks}
        mcpByProvider={mcpByProvider}
        focusedProvider={connectionsProvider}
        refreshing={checkingAgents || refreshingProviderModels}
        onClose={() => setConnectionsOpen(false)}
        onGitHub={() => {
          setConnectionsOpen(false);
          setGitHubAuthNotice("");
          setGitHubAuthOpen(true);
        }}
        onProvider={(provider) => {
          const definition = getProviderById(provider);
          if (!definition) return;
          setDraftAgent(definition.agent);
          setDraftModel(providerOptions.find((item) => item.agent === definition.agent)?.models[0]?.label ?? "Auto");
          setConnectionsOpen(false);
          setCreateSessionOpen(true);
        }}
        onMcp={(provider) => {
          setConnectionsOpen(false);
          setMcpProvider(provider);
          setMissionOpen(true);
          void refreshMcp(provider);
        }}
        onRefresh={() => {
          void Promise.all([refreshAgentChecks(), refreshProviderModels(true)]);
        }}
      />

      <CreateRequestModal
        draft={requestDraft}
        busy={requestBusy}
        error={requestError}
        writing={requestWriting}
        written={requestWritten}
        writeError={requestWriteError}
        onRewrite={() => { if (requestDraft) void writeTaskRequest(requestDraft); }}
        onStopWriting={() => {
          requestWriteToken.current += 1;
          setRequestWriting(false);
        }}
        onCreate={(input) => void createTaskRequest(input)}
        onClose={() => {
          if (requestBusy) return;
          requestWriteToken.current += 1;
          setRequestWriting(false);
          setRequestDraft(null);
        }}
      />

      <GitHubAuthModal
        open={githubAuthOpen}
        projectName={activeProject.name}
        host={repositoryHost ?? GITHUB_WORDS}
        status={githubAuthStatus}
        accounts={githubAccounts}
        accountsLoading={githubAccountsLoading}
        busy={githubAuthBusy}
        notice={githubAuthNotice}
        onRemember={(input) => void rememberGitHubAuth(input)}
        onForget={() => void forgetGitHubAuth()}
        onClose={() => {
          if (!githubAuthBusy) setGitHubAuthOpen(false);
        }}
      />

      {mcpManagerOpen ? (
        <div className="dk-backdrop" onClick={() => setMcpManagerOpen(false)}>
          <div
            ref={mcpManagerRef}
            className="dk-dialog dk-dialog--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-manager-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dk-dialog-header">
              <div>
                <h2 className="dk-dialog-title" id="mcp-manager-title">MCP servers</h2>
                <p className="dk-dialog-desc">The tools {activeProject.name}'s agents can reach, per agent.</p>
              </div>
              <button type="button" className="dk-icon-btn" onClick={() => setMcpManagerOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="dk-dialog-body">
            <McpPanel
              activeProjectId={activeProject.id}
              mcpProvider={mcpProvider}
              setMcpProvider={setMcpProvider}
              mcpByProvider={mcpByProvider}
              mcpLoading={mcpLoading}
              mcpBusy={mcpBusy}
              mcpAuthBusy={mcpAuthBusy}
              mcpNotice={mcpNotice}
              mcpNoticeTone={mcpNoticeTone}
              onAdd={() => setAddMcpOpen(true)}
              onRefresh={refreshMcp}
              onRemove={removeMcp}
              onAuth={(server) => {
                clearMcpNotice();
                setMcpAuthServer(server);
              }}
              onUseInSession={(provider) => {
                setDraftAgent(agentFromProviderId(provider));
                setCreateSessionOpen(true);
                setMcpManagerOpen(false);
              }}
            />
            </div>
          </div>
        </div>
      ) : null}

      <AddMcpModal
        open={addMcpOpen}
        providerLabel={getProviderLabel(mcpProvider)}
        showScope={mcpProvider === "claude" || mcpProvider === "gemini"}
        onClose={() => setAddMcpOpen(false)}
        onSubmit={addMcp}
      />

      <McpAuthModal
        open={Boolean(mcpAuthServer)}
        projectName={activeProject.name}
        providerLabel={getProviderLabel(mcpProvider)}
        server={mcpAuthServer}
        profile={
          mcpAuthServer
            ? mcpByProvider[mcpProvider]?.authProfiles?.find((profile) => profile.name === mcpAuthServer.name) ?? null
            : null
        }
        busy={Boolean(mcpAuthServer && mcpAuthBusy === mcpAuthServer.name)}
        notice={mcpNotice}
        noticeTone={mcpNoticeTone}
        signInUrl={mcpAuthUrl}
        onConnect={() => {
          if (mcpAuthServer) void connectMcpAuth(mcpAuthServer);
        }}
        onCancel={() => {
          if (mcpAuthServer) void cancelMcpAuth(mcpAuthServer);
        }}
        onOpenUrl={(url) => void window.pitwall?.openExternalUrl?.(url)}
        onForget={() => {
          if (mcpAuthServer) void forgetMcpAuth(mcpAuthServer);
        }}
        onClose={() => setMcpAuthServer(null)}
      />

      <CreateSessionModal
        open={createSessionOpen}
        agentOptions={implementerOptions}
        agentChecks={agentChecks}
        checkingAgents={checkingAgents}
        draftAgent={draftAgent}
        draftModels={draftProvider.models}
        draftModel={draftModel}
        draftTaskId={draftTaskId}
        draftInstruction={draftInstruction}
        draftSessionType={draftSessionType}
        draftBootCommand={draftBootCommand}
        draftAutoApprove={draftAutoApprove}
        onAutoApproveChange={setDraftAutoApprove}
        modelSource={draftProvider.modelSource}
        modelError={draftProvider.modelError}
        modelsLoading={refreshingProviderModels}
        createDisabled={draftCheck?.status === "missing"}
        creating={creatingSession}
        projectTasks={boardTasks}
        contextEntries={selectedContextEntries}
        selectedContextIds={selectedContextIds}
        onSelectAgent={selectDraftAgent}
        onInstructionChange={setDraftInstruction}
        onRemoveCustomAgent={removeCustomAgent}
        onAddAgent={() => {
          setCreateSessionOpen(false);
          setAddAgentFromSession(true);
          setAddAgentOpen(true);
        }}
        onTaskChange={setDraftTaskId}
        draftPair={draftPair}
        onPairChange={setDraftPair}
        pairRounds={projectOverseer(activeProject.id)?.rounds}
        onCouncil={() => { setCreateSessionOpen(false); openCouncilSetup("council"); }}
        onCompare={() => { setCreateSessionOpen(false); openCouncilSetup("compare"); }}
        onRoleChange={setDraftSessionType}
        onModelChange={setDraftModel}
        onRefreshModels={() => void refreshAllModels()}
        onToggleContext={(id, checked) =>
          setSelectedContextIds((current) =>
            checked ? [...current, id] : current.filter((item) => item !== id),
          )
        }
        onCreate={() => {
          if (creatingSession) return;
          setCreatingSession(true);
          const pairing = draftPair && draftTaskId ? { taskId: draftTaskId, value: draftPair } : null;
          void createAgentSession({
            autoApprove: draftAutoApprove,
            instruction: draftInstruction,
          })
            .then((session) => {
              if (!session || !pairing) return;
              const [reviewer, rounds] = pairing.value.split(":");
              track("pair_started", { agent: reviewer, turns: Number(rounds) || 3 });
              setPitwall((current) => ({
                ...current,
                tasks: current.tasks.map((task) => task.id === pairing.taskId
                  ? { ...task, pair: { reviewer: toPairReviewer(reviewer), maxRounds: Number(rounds) || 3, round: 0, state: "implementing" } }
                  : task),
              }));
            })
            .finally(() => setCreatingSession(false));
        }}
        onClose={() => {
          if (creatingSession) return;
          pendingTaskStartRef.current = null;
          setCreateSessionOpen(false);
        }}
      />

      {VOICE_ENABLED ? (
      <VoiceHud
        state={voice.state}
        enabled={voice.enabled}
        available={voice.available}
        partial={voice.partial}
        settling={voice.settling}
        level={voice.level}
        confirmation={voice.confirmation}
        error={voice.error}
        log={voice.log}
        onToggle={() => void (voice.enabled ? voice.stop() : voice.start({ wakeWords: ["pitwall", "pit wall"] }))}
        onPushToTalk={() => void voice.listenOnce()}
        onConfirm={() => void voice.confirm()}
        onCancelConfirmation={() => void voice.cancelConfirmation()}
        onStopSpeaking={() => void voice.stopSpeaking()}
        onEndTurn={() => void voice.endTurn()}
        onSubmitText={(text) => void voice.submitText(text)}
        onDismissError={voice.dismissError}
      />
      ) : null}
    </main>
  );
}
