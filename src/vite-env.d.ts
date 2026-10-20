/// <reference types="vite/client" />

/** The licence record as it crosses IPC. Mirrors `LicenceRecord` in lib/licence. */
type BraveliLicenceRecord = {
  installedAt: string;
  key?: string;
  verifiedAt?: string;
  active?: boolean;
  activeUntil?: string | null;
};

/** One file the agent touched while working on a task. */
interface BraveliChangedFile {
  path: string;
  /** Where a rename came from, otherwise null. */
  from: string | null;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "typechange" | "conflicted";
  binary: boolean;
  additions: number;
  deletions: number;
  /** Written but never added to git, so invisible to `git diff`. */
  untracked?: boolean;
}

/** What a session's agent changed since it started, pushed as it happens. */
interface BraveliLiveChanges {
  sessionId: string;
  ok: boolean;
  error?: string;
  /** When the starting point was taken: the session's start, or the last "Keep all". */
  since?: number;
  files: BraveliChangedFile[];
  truncated?: boolean;
  additions: number;
  deletions: number;
}

interface BraveliChangeset {
  ok: boolean;
  error?: string;
  /** The commit the branch left the base at; the patches are taken from here. */
  base?: string;
  /** The branch that commit was found on — discovered, not the one configured. */
  baseBranch?: string;
  worktreePath?: string;
  files: BraveliChangedFile[];
  /**
   * Files git is not tracking: Pitwall's own transcripts, a tool's output
   * directory, anything else nobody committed. Reported separately and left
   * out of the totals, because nothing uncommitted can reach a pull request —
   * and a review that disagrees with the PR it is about is worse than useless.
   */
  untrackedFiles?: BraveliChangedFile[];
  additions: number;
  deletions: number;
}

type PitwallCloudVault = "signed-out" | "off" | "needs-setup" | "needs-join" | "ready" | "unreachable";

interface PitwallCloudSyncStatus {
  state: "off" | "idle" | "syncing" | "offline" | "error" | "quota";
  lastSyncedAt?: string | null;
  pending?: number;
  error?: string | null;
  heldDeletions?: number;
  unreadable?: number;
}

interface PitwallCloudStatus {
  vault: PitwallCloudVault;
  sync: PitwallCloudSyncStatus;
  deviceName: string;
  email: string | null;
  usage?: { bytes: number; quota: number };
}

interface PitwallCloudLease {
  mine: boolean;
  holder: string;
  expiresAt: string;
  handoffRequested: boolean;
  handoffToMe: boolean;
}

interface PitwallCloudJoinRequest {
  link_id: string;
  name: string | null;
  platform: string | null;
  state: string;
  created_at: string;
}

interface PitwallCloudDevice {
  id: string;
  name: string | null;
  platform: string | null;
  approved_at: string | null;
  last_seen: string | null;
  current: boolean;
}

interface BraveliApi {
  platform?: string;
  setWindowChrome?: (payload: { dark: boolean }) => Promise<{ ok: boolean; error?: string }>;
  inspectProjectKnowledge?: (payload: import("./domain/projectKnowledge").ProjectKnowledgeLocation) => Promise<import("./domain/projectKnowledge").ProjectKnowledgeSnapshot>;
  learnProjectKnowledge?: (payload: import("./domain/projectKnowledge").ProjectKnowledgeLocation & { files?: string[] }) => Promise<import("./domain/projectKnowledge").ProjectKnowledgeSnapshot>;
  rememberProjectKnowledge?: (payload: import("./domain/projectKnowledge").ProjectKnowledgeLocation & { runId?: string; observations: import("./domain/projectKnowledge").KnowledgeObservation[] }) => Promise<import("./domain/projectKnowledge").KnowledgeMutationResult>;
  updateProjectKnowledge?: (payload: import("./domain/projectKnowledge").KnowledgeUpdateInput) => Promise<import("./domain/projectKnowledge").KnowledgeMutationResult>;
  prepareProjectContext?: (payload: import("./domain/projectKnowledge").PrepareKnowledgeInput) => Promise<import("./domain/projectKnowledge").PrepareKnowledgeResult>;
  markContextReceipt?: (payload: { projectPath: string; id: string; status: "delivered" | "failed"; error?: string }) => Promise<{ ok: boolean; receipt?: import("./domain/projectKnowledge").DeliveryReceipt; error?: string }>;
  chooseProjectDirectory: () => Promise<string | null>;
  createProjectDirectory: (payload: {
    parentPath: string;
    folderName: string;
    brief: string;
  }) => Promise<{ ok: boolean; path?: string; repository?: boolean; warning?: string; error?: string }>;
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  /** Opens a URL in the user's browser. The main process normalises it first. */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  listProjectFiles: (projectPath: string) => Promise<{
    ok: boolean;
    files: string[];
    error?: string;
  }>;
  readProjectFile: (payload: {
    projectPath: string;
    filePath: string;
  }) => Promise<{
    ok: boolean;
    path?: string;
    content?: string;
    error?: string;
  }>;
  writeProjectFile: (payload: {
    projectPath: string;
    filePath: string;
    content: string;
  }) => Promise<{
    ok: boolean;
    path?: string;
    content?: string;
    formatted?: boolean;
    formatter?: string;
    formatterWarnings?: string[];
    error?: string;
  }>;
  getGitStatus: (projectPath: string) => Promise<{
    ok: boolean;
    branch: string;
    changes: GitChange[];
    error?: string;
  }>;
  getGitDiff: (payload: {
    projectPath: string;
    filePath: string;
  }) => Promise<{
    ok: boolean;
    diff: string;
    error?: string;
  }>;
  runValidation?: (payload: { projectPath: string; branch: string; only?: string[]; timeoutMs?: number; reuseUnchanged?: boolean }) => Promise<{
    ok: boolean;
    /** The checkout was unchanged since the last run, whose result this is. */
    reused?: boolean;
    result: {
      ok: boolean;
      ranAt: string;
      revision?: string;
      worktreeDirty?: boolean;
      checks: Array<{ name: string; command: string; ok: boolean; output: string; skipped: boolean; durationMs: number }>;
    };
  }>;
  planValidation?: (payload: { projectPath: string; branch: string }) => Promise<{
    ok: boolean;
    checks: Array<{ name: string; command: string; script: string; skipped: boolean }>;
  }>;
  catalogueLive?: (payload: { entries: Array<{ id: string; installCommand?: string; docs: string }> }) => Promise<{
    ok: boolean;
    live: Record<string, {
      version: string;
      downloads: string;
      activity: string;
      stale: boolean;
      publisherMatches: boolean | null;
    }>;
  }>;
  ollamaStatus?: () => Promise<{
    ok: boolean;
    installed: boolean;
    serving: boolean;
    models: Array<{ name: string; size: number; parameters: string }>;
    state: "missing" | "stopped" | "empty" | "ready";
    message: string;
  }>;
  ollamaBridgeStatus?: (payload: { models: string[] }) => Promise<{
    ok: boolean;
    state: "no-models" | "needs-agent" | "ready";
    message: string;
    agents?: string[];
    suggestion?: string;
  }>;
  connectOllamaAgent?: (payload: { agentId: string; model: string; models?: string[] }) => Promise<{
    ok: boolean;
    error?: string;
    configPath?: string;
    agent?: { name: string; command: string; args: string; models: string; modelDiscoveryCommand: string; login: string };
  }>;
  ollamaLocalAgent?: () => Promise<{
    ok: boolean;
    reason?: string;
    /** Tool-capable models Ollama has pulled, regardless of any harness. */
    pulled?: number;
    option: {
      id: string;
      name: string;
      command: string;
      args: string;
      bridgeId: string;
      models: Array<{ label: string; value: string }>;
      needsConfig: boolean;
    } | null;
  }>;
  /** Pushes a branch and opens a pull request for it. Used by scheduled runs. */
  openPullRequest?: (payload: {
    projectPath: string;
    worktreePath?: string;
    branch: string;
    /** The task's key, for a branch name the repository accepts if it refuses this one. */
    ticket?: string;
    baseBranch?: string;
    /** Written title and description; without them the commits' own words are used. */
    title?: string;
    body?: string;
    draft?: boolean;
    /** Commit these paths in the worktree first, with this message. */
    commit?: { message: string; paths: string[] };
  }) => Promise<{ ok: boolean; url?: string; pushed?: boolean; existed?: boolean; branch?: string; renamedFrom?: string; number?: number; error?: string }>;
  /** A request's prose written from the actual change, by a read-only model call. */
  writeRequest?: (payload: {
    projectPath: string;
    worktreePath?: string;
    baseBranch?: string;
    requestNoun?: string;
    task: { identifier?: string; title: string; description?: string };
  }) => Promise<{
    ok: boolean;
    summary?: string;
    changes?: string[];
    testing?: string[];
    commitSubject?: string;
    commitBody?: string;
    error?: string;
  }>;
  listWatches?: () => Promise<WatchState & { ok: boolean }>;
  setWatch?: (payload: { projectId: string; projectPath: string; enabled: boolean }) => Promise<{ ok: boolean; watch?: WatchRecord; error?: string }>;
  addWatch?: (payload: { projectId: string; projectPath: string; kind: WatchKind; config?: WatchConfig; intervalSeconds?: number }) => Promise<{ ok: boolean; watch?: WatchRecord; error?: string }>;
  updateWatch?: (payload: { watchId: string; enabled?: boolean; config?: WatchConfig; intervalSeconds?: number }) => Promise<{ ok: boolean; watch?: WatchRecord; error?: string }>;
  removeWatch?: (payload: { watchId: string }) => Promise<{ ok: boolean }>;
  resolveWatchFinding?: (payload: { findingId: string; url?: string }) => Promise<{ ok: boolean; error?: string }>;
  reviseWatchFinding?: (payload: { findingId: string; instruction: string; current: unknown }) => Promise<{ ok: boolean; error?: string }>;
  approveWatchFix?: (payload: { findingId: string; fix: { commit: boolean; commitMessage: string; replies: WatchReply[] } }) => Promise<{ ok: boolean; url?: string; warning?: string; error?: string }>;
  checkWatchesNow?: (payload: { projectId?: string }) => Promise<WatchState & { ok: boolean }>;
  retryWatchFinding?: (payload: { findingId: string }) => Promise<{ ok: boolean; error?: string }>;
  dismissWatchFinding?: (payload: { findingId: string }) => Promise<{ ok: boolean; error?: string }>;
  postWatchReview?: (payload: { findingId: string; review?: WatchReview; approveOnly?: boolean }) => Promise<{ ok: boolean; url?: string; warning?: string; error?: string }>;
  onWatchChanged?: (handler: (state: WatchState) => void) => () => void;
  /** One review round of a pair session, by the reviewer it was set up with. */
  listFiles?: (payload: { root: string }) => Promise<{ ok: boolean; files: string[]; truncated?: boolean; error?: string }>;
  onCliChecked?: (callback: (payload: { agent: string; from: string; to: string; result: { status: string; kind?: string; detail: string }; notice: { tone: "info" | "warn" | "error"; title: string; message: string } }) => void) => () => void;
  onAgentNotice?: (callback: (payload: { notice: { tone: "info" | "warn" | "error"; title: string; message: string; action?: "hermes-sign-in" } | null; modelsChanged?: boolean; retiredModel?: string; replacementModel?: string; replacementLabel?: string }) => void) => () => void;
  hermesSignIn?: () => Promise<{ ok: boolean; already?: boolean }>;
  onAutomationNotice?: (callback: (payload: { title: string; body: string; target: import("./lib/notifications").NotificationTarget }) => void) => () => void;
  onNavigate?: (callback: (payload: { section?: string; target?: import("./lib/notifications").NotificationTarget }) => void) => () => void;
  getAutomationSettings?: () => Promise<{ ok: boolean; settings: AutomationSettings | null }>;
  setAutomationSettings?: (patch: Partial<{ models: Partial<AutomationSettings["models"]>; boardSyncMinutes: number }>) => Promise<{ ok: boolean; settings: AutomationSettings | null }>;
  showNotification?: (payload: { title: string; body: string; target: import("./lib/notifications").NotificationTarget }) => Promise<{ ok: boolean }>;
  onHermesSignInState?: (callback: (state: { state: "approve"; code: string; url: string } | { state: "done" } | { state: "failed"; message: string }) => void) => () => void;
  onSessionNativeId?: (callback: (payload: { sessionId: string; nativeSessionId: string; nativeSessionStarted?: boolean }) => void) => () => void;
  fileChanges?: (payload: { root: string }) => Promise<{ ok: boolean; changes: { path: string; kind: string }[] }>;
  readFile?: (payload: { root: string; path: string }) => Promise<{ ok: boolean; content?: string; hash?: string; size?: number; binary?: boolean; tooLarge?: boolean; error?: string }>;
  writeFile?: (payload: { root: string; path: string; content: string; hash: string }) => Promise<{ ok: boolean; hash?: string; conflict?: boolean; error?: string }>;
  watchFile?: (payload: { root: string; path: string }) => Promise<{ ok: boolean }>;
  unwatchFile?: () => Promise<{ ok: boolean }>;
  onFileChanged?: (callback: (payload: { root: string; path: string }) => void) => () => void;
  pairPrepare?: (payload: { projectPath: string; worktreePath: string; baseBranch: string; round: number; maxRounds: number; task: { identifier?: string; title: string; description?: string } }) => Promise<{ ok: boolean; prompt?: string; worktree?: string; error?: string }>;
  pairVerdict?: (payload: { raw: string; reviewer: string; round: number; maxRounds: number }) => Promise<{ ok: boolean; verdict?: "approve" | "request_changes"; summary?: string; comments?: { path: string; line: number; body: string }[]; outcome?: string; feedback?: string; error?: string }>;
  overseerObserve?: (payload: {
    kind: "task-finished" | "decision";
    projectId: string;
    projectPath: string;
    worktreePath?: string;
    baseBranch?: string;
    model?: string;
    task: { identifier?: string; title?: string; description?: string };
    agent?: string;
    summary?: string;
    review?: { verdict?: string; summary?: string };
    decision?: { action: "approved" | "merged" | "sent-back" | "rejected"; comment?: string };
  }) => Promise<{ ok: boolean; reply?: string; error?: string }>;
  /** What a request for a branch would contain. */
  requestContext?: (payload: { projectPath: string; worktreePath?: string; baseBranch?: string }) => Promise<{
    ok: boolean;
    branch?: string;
    commits?: string[];
    files?: string[];
    /** Changed files not yet committed, which cannot reach the request. */
    uncommitted?: number;
    uncommittedFiles?: Array<{ path: string; state: "added" | "modified" | "deleted" | "renamed" }>;
    template?: string;
    kind?: CodeHostKind;
    requestNoun?: string;
    cliInstalled?: boolean;
    error?: string;
  }>;
  listSchedule?: () => Promise<{ ok: boolean; jobs: ScheduleJob[]; error?: string }>;
  saveScheduleJob?: (payload: Partial<ScheduleJob>) => Promise<{ ok: boolean; job?: ScheduleJob; error?: string }>;
  deleteScheduleJob?: (payload: { id: string }) => Promise<{ ok: boolean; error?: string }>;
  recordScheduleRun?: (payload: { id: string; entry: ScheduleRun }) => Promise<{ ok: boolean; run?: ScheduleRun; error?: string }>;
  /** Tells main the renderer can run a job; a fire before this is held, not dropped. */
  scheduleReady?: () => Promise<{ ok: boolean }>;
  onScheduleFire?: (callback: (payload: { job: ScheduleJob }) => void) => () => void;
  /** Every branch's review facts in one call. See electron/lib/reviewState.cjs. */
  reviewState?: (payload: { projectId?: string; projectPath: string; baseBranch?: string; branches?: string[]; tickets?: Record<string, string> }) => Promise<ReviewStateResult>;
  branchTree?: (payload: {
    projectPath: string;
    baseBranch?: string;
    /** Branches with a live agent session, so the view can say which are being worked. */
    sessionBranches?: string[];
  }) => Promise<{
    ok: boolean;
    error?: string;
    trunk: string;
    branches: Array<{
      name: string;
      sha: string;
      committedAt: string;
      subject: string;
      merged: boolean;
      hasSession: boolean;
      branchAhead: number;
      trunkAhead: number;
      files: string[];
      worktreePath?: string;
      state: "merged" | "working" | "empty" | "drifted" | "ahead";
      note: string;
    }>;
    overlaps: Array<{ branches: [string, string]; files: string[] }>;
    omitted?: number;
  }>;
  branchChanges?: (payload: { projectPath: string; branch: string; trunk: string }) => Promise<{
    ok: boolean;
    error?: string;
    base?: string;
    /** The trunk actually used, discovered rather than taken from the caller. */
    trunk?: string;
    /** The ref this branch actually forked from, which is often not the trunk. */
    forkedFrom?: string;
    files: BraveliChangedFile[];
    additions: number;
    deletions: number;
  }>;
  branchFileDiff?: (payload: { projectPath: string; branch: string; base: string; filePath: string }) => Promise<{
    ok: boolean;
    diff: string;
    error?: string;
  }>;
  ollamaServe?: () => Promise<{ ok: boolean; alreadyRunning?: boolean; error?: string }>;
  ollamaPull?: (payload: { model: string }) => Promise<{ ok: boolean; exitCode?: number; error?: string; cancelled?: boolean }>;
  ollamaPullCancel?: (payload: { model: string }) => Promise<{ ok: boolean; error?: string }>;
  ollamaRemove?: (payload: { model: string }) => Promise<{ ok: boolean; error?: string }>;
  /** What a context window costs on this machine, and what is set today. */
  ollamaTuning?: (payload: { model: string }) => Promise<{
    ok: boolean;
    error?: string;
    model?: string;
    totalMemoryBytes?: number;
    modelBytes?: number;
    bytesPerToken?: number;
    /** False when the cost is estimated from the embedding width rather than measured dimensions. */
    exact?: boolean;
    declaredMax?: number;
    maxForMemory?: number;
    choices?: Array<{ tokens: number; cacheBytes: number; totalBytes: number; fits: boolean; tight: boolean }>;
    recommended?: number;
    servedContext?: number;
    residentBytes?: number;
    saved?: { context: number; keepAlive: string };
    keepAliveChoices?: Array<{ value: string; label: string; hint?: string }>;
    contextSteps?: number[];
  }>;
  /** Applies a window and reports what Ollama actually served, not what was asked for. */
  ollamaTune?: (payload: { model: string; context?: number; keepAlive?: string }) => Promise<{
    ok: boolean;
    error?: string;
    requested?: number;
    served?: number;
    residentBytes?: number;
    /** Ollama served less than was asked for, silently, which it does. */
    short?: boolean;
  }>;
  onOllamaPullOutput?: (handler: (data: { model: string; chunk: string }) => void) => () => void;
  whichCommands?: (payload: { commands: string[] }) => Promise<{ ok: boolean; found: Record<string, boolean> }>;
  planAgentInstall?: (payload: { installCommand: string; installDocs: string }) => Promise<{
    action: "run" | "copy" | "docs" | "none";
    command?: string;
    docs?: string;
    reason?: string;
    tool?: string;
  }>;
  installAgent?: (payload: {
    providerId: string;
    installCommand: string;
    installDocs: string;
    verifyCommand: string;
  }) => Promise<{ ok: boolean; message?: string; error?: string; exitCode?: number }>;
  /** Streams the install's output while it runs. Returns an unsubscribe. */
  sendAgentInstallInput?: (payload: { providerId: string; data: string }) => Promise<{ ok: boolean }>;
  resizeAgentInstall?: (payload: { providerId: string; cols: number; rows: number }) => Promise<{ ok: boolean }>;
  onAgentInstallOutput?: (handler: (data: { providerId: string; chunk: string }) => void) => () => void;
  subscribeLiveChanges?: (payload: { sessionId: string; projectPath: string }) => Promise<{ ok: boolean; error?: string }>;
  unsubscribeLiveChanges?: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
  onLiveChanges?: (handler: (summary: BraveliLiveChanges) => void) => () => void;
  getLiveFileDiff?: (payload: { sessionId: string; file: BraveliChangedFile }) => Promise<{ ok: boolean; diff: string; hunks: string[]; error?: string }>;
  revertLiveChange?: (payload: { sessionId: string; file: BraveliChangedFile; hunk?: string }) => Promise<{ ok: boolean; error?: string }>;
  keepLiveChange?: (payload: { sessionId: string; file?: BraveliChangedFile }) => Promise<{ ok: boolean; error?: string }>;
  getTaskChangeset: (payload: {
    projectPath: string;
    branch: string;
    baseBranch: string;
  }) => Promise<BraveliChangeset>;
  getTaskFileDiff: (payload: {
    projectPath: string;
    branch: string;
    base: string;
    filePath: string;
    untracked?: boolean;
  }) => Promise<{ ok: boolean; diff: string; error?: string }>;
  listWorktrees: (projectPath: string) => Promise<{
    ok: boolean;
    worktrees: Array<{ path: string; branch: string; head: string; bare: boolean; detached: boolean }>;
    error?: string;
  }>;
  ensureWorktree: (payload: {
    projectPath: string;
    branch: string;
    baseBranch?: string;
    /** A session's own worktree: kept as it is if it exists, recreated if it was removed. */
    worktreePath?: string;
    /** The session's ticket, for restoring onto a branch the agent named itself. */
    ticket?: string;
  }) => Promise<{
    ok: boolean;
    path?: string;
    /** The branch the checkout is actually on, which a reused worktree may not share with the request. */
    branch?: string;
    requestedBranch?: string;
    detached?: boolean;
    reused?: boolean;
    error?: string;
  }>;
  removeWorktree: (payload: {
    projectPath: string;
    worktreePath: string;
    force?: boolean;
    /** Remove only if nothing runs in it, nothing is uncommitted and every commit is on a remote. */
    onlyIfSafe?: boolean;
  }) => Promise<{
    ok: boolean;
    removed?: boolean;
    missing?: boolean;
    blockers?: Array<"live" | "dirty" | "unpushed">;
    dirty?: number;
    unpushed?: number;
    /** The branch the worktree held, which the agent may have renamed. */
    branch?: string;
    path?: string;
    error?: string;
  }>;
  auditWorktrees: (payload: { projectPath: string }) => Promise<{
    ok: boolean;
    worktrees: WorktreeAudit[];
    error?: string;
  }>;
  setKnownProjects: (payload: { projectPaths: string[] }) => Promise<{ ok: boolean }>;
  getRuntimeRecovery: () => Promise<RuntimeRecovery>;
  acknowledgeRuntimeRecovery: (payload: { sessionIds: string[] }) => Promise<{ ok: boolean; error?: string }>;
  getAppVersion: () => Promise<{
    version: string;
    packaged: boolean;
    installation: { ok: boolean; reason?: string; message?: string };
  }>;
  getLicence: () => Promise<{
    record: BraveliLicenceRecord | null;
    checkoutUrl: string;
    enforced?: boolean;
  }>;
  activateLicence: (payload: { key: string }) => Promise<{
    ok: boolean;
    active?: boolean;
    reason?: string;
    record: BraveliLicenceRecord | null;
  }>;
  verifyLicence: () => Promise<{ record: BraveliLicenceRecord | null; reason?: string }>;
  clearLicence: () => Promise<{ record: BraveliLicenceRecord | null }>;
  creditsState: () => Promise<PitwallCreditsState>;
  creditsSignInStart: (payload: { email: string }) => Promise<PitwallGatewayReply<{ ok: true; email: string }>>;
  creditsSignInVerify: (payload: { email: string; code: string }) => Promise<PitwallGatewayReply<unknown> & { persisted?: boolean; state?: PitwallCreditsState }>;
  creditsSignOut: () => Promise<{ ok: true; state: PitwallCreditsState }>;
  cloudStatus?: () => Promise<PitwallCloudStatus>;
  cloudSetUp?: () => Promise<{ ok: boolean; recoveryKey?: string; message?: string }>;
  cloudJoinWithRecovery?: (payload: { recoveryKey: string }) => Promise<{ ok: boolean; code?: string; message?: string }>;
  cloudReset?: () => Promise<{ ok: boolean; recoveryKey?: string; message?: string }>;
  cloudTurnOff?: () => Promise<{ ok: boolean }>;
  cloudSyncNow?: () => Promise<{ ok: boolean }>;
  cloudHeldDeletions?: (payload: { action: "confirm" | "restore" }) => Promise<{ ok: boolean }>;
  cloudDevices?: () => Promise<{ ok: boolean; data?: { devices: PitwallCloudDevice[] } }>;
  cloudRemoveDevice?: (payload: { id: string }) => Promise<{ ok: boolean }>;
  cloudPushSnapshot?: (snapshot: import("./lib/cloudSnapshot").CloudRendererSnapshot) => void;
  onCloudApply?: (callback: (batch: { generation: number; changes: import("./lib/cloudApply").CloudChange[] }) => void) => () => void;
  onCloudStatus?: (callback: (status: PitwallCloudSyncStatus) => void) => () => void;
  cloudRequestJoin?: () => Promise<{ ok: boolean; message?: string }>;
  cloudRetryCheckout?: (payload: { projectId: string }) => Promise<{ ok: boolean }>;
  cloudContinueHere?: (payload: { taskId: string }) => Promise<{ ok: boolean; answered?: boolean; savedAt?: string | null; message?: string }>;
  cloudRefreshLeases?: () => Promise<{ ok: boolean }>;
  onCloudRenameProject?: (callback: (rename: { from: string; to: string }) => void) => () => void;
  onCloudLeases?: (callback: (leases: Record<string, PitwallCloudLease>) => void) => () => void;
  onCloudNotice?: (callback: (notice: { tone: "info" | "warn" | "error"; title: string; message: string }) => void) => () => void;
  onCloudProjectReady?: (callback: (event: { projectId: string; name?: string; state: "cloning" | "ready" | "failed"; path?: string; action?: "clone" | "adopt"; code?: string; message?: string }) => void) => () => void;
  cloudCancelJoin?: () => Promise<{ ok: boolean }>;
  cloudConfirmJoinHere?: () => Promise<{ state: string; message?: string }>;
  cloudCheckJoinRequests?: () => Promise<{ ok: boolean }>;
  cloudApproveJoin?: (payload: { linkId: string }) => Promise<{ ok: boolean; code?: string; message?: string }>;
  cloudConfirmJoin?: (payload: { linkId: string }) => Promise<{ ok: boolean; message?: string }>;
  cloudDenyJoin?: (payload: { linkId: string }) => Promise<{ ok: boolean }>;
  onCloudJoinState?: (callback: (state: { state: string; code?: string; message?: string }) => void) => () => void;
  onCloudJoinRequests?: (callback: (requests: PitwallCloudJoinRequest[]) => void) => () => void;
  creditsAccount: () => Promise<PitwallGatewayReply<PitwallAccount>>;
  creditsPlans: () => Promise<PitwallGatewayReply<{ plans: PitwallPlan[]; checkout_available: boolean; markup_percent: number }>>;
  creditsModels: () => Promise<PitwallGatewayReply<{ data: Array<{ id: string; owned_by: string; endpoints: string[] }> }>>;
  creditsSetCap: (payload: { usd: number }) => Promise<PitwallGatewayReply<{ ok: true; overage_cap_usd: number }>>;
  creditsDevActivate: (payload: { plan: string }) => Promise<PitwallGatewayReply<{ ok: true; plan: string }>>;
  onCreditsRefused: (callback: (payload: { sessionId: string; reason: "exhausted" | "no-plan" | "signed-out" }) => void) => () => void;
  captureEvent: (event: string, properties?: Record<string, string | number | boolean>) => Promise<{ ok: boolean }>;
  analyticsState: (payload?: { enabled?: boolean }) => Promise<{ ok: boolean; enabled: boolean }>;
  getGitHubAuth: (payload: ProjectIdentity) => Promise<GitHubAuthResult>;
  listGitHubAccounts: (payload: ProjectIdentity) => Promise<GitHubAccountsResult>;
  /** Points the machine's gh at the account this project belongs to. Never fatal. */
  activateGitHubAccount: (payload: ProjectIdentity) => Promise<{
    ok: boolean;
    /** "scoped": the project uses its own token per command; nothing global changed. */
    action: "none" | "scoped" | "login" | "logged-in" | "prompt";
    login?: string;
    host?: string;
    kind?: CodeHostKind;
    reason?: string;
    error?: string;
  }>;
  rememberGitHubAuth: (
    payload: ProjectIdentity & { login?: string; token?: string; source?: "gh" | "remote" },
  ) => Promise<GitHubAuthResult>;
  forgetGitHubAuth: (payload: ProjectIdentity) => Promise<GitHubAuthResult>;
  readSessionConversation: (payload: {
    sessionId: string;
    agent: string;
    cwd: string;
    nativeSessionId?: string;
  }) => Promise<{
    ok: boolean;
    agent: string;
    sessionId?: string;
    /** Claude's protocol records, reduced by the renderer. */
    records: unknown[];
    /** Codex's rollout, already reduced — it is not that protocol. */
    entries: unknown[];
    found: boolean;
    message?: string;
    error?: string;
  }>;
  writeSessionHandoff: (payload: {
    cwd: string;
    fromAgent: string;
    toAgent: string;
    nativeSessionId?: string;
    task?: { identifier?: string; title: string; description?: string };
  }) => Promise<{ ok: boolean; file?: string; turns?: number; error?: string }>;
  listAgentExtensions: (payload: { provider: string }) => Promise<AgentExtensions>;
  searchMcpRegistry: (payload: { query: string }) => Promise<{
    ok: boolean;
    servers: RegistryMcpServer[];
    error?: string;
  }>;
  installMcpServer: (payload: {
    provider: string;
    entry: RegistryMcpServer;
    projectPath?: string;
  }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  changeAgentExtension: (payload: {
    provider: string;
    pluginId: string;
    action: "install" | "remove";
  }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateStatus: (callback: (state: UpdateState) => void) => () => void;
  /** The editors installed on this machine, in preference order. */
  listEditors: () => Promise<{
    ok: boolean;
    editors: Array<{ id: string; name: string; viaCli: boolean }>;
  }>;
  /** Opens a project folder (or one file) in the user's own editor. */
  openFileInEditor: (payload: {
    projectPath: string;
    branch: string;
    filePath: string;
    line?: number;
    editorId?: string;
  }) => Promise<{ ok: boolean; revealed?: boolean; error?: string; editor?: { id: string; name: string } }>;
  openInEditor: (payload: { projectPath: string; editorId?: string }) => Promise<{
    ok: boolean;
    editor?: { id: string; name: string };
    /** True when no editor was available and the folder was revealed instead. */
    revealed?: boolean;
    error?: string;
  }>;
  getPullRequest: (payload: { projectPath: string }) => Promise<PullRequestResult>;
  /** Which service the project's origin lives on. */
  getCodeHost?: (payload: { projectPath: string }) => Promise<CodeHostInfo>;
  listProviders: (payload?: { refresh?: boolean }) => Promise<{
    ok: boolean;
    providers: Array<{
      id: string;
      displayName: string;
      command: string;
      loginCommand: string;
      supportedModels: Array<{ label: string; value: string }>;
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
    }>;
  }>;
  discoverCustomAgentModels: (payload: {
    command: string;
    discoveryArgs?: string[];
  }) => Promise<{
    ok: boolean;
    supportedModels: Array<{ label: string; value: string }>;
    modelSource: string;
    modelError: string | null;
  }>;
  listMcpServers: (payload: {
    provider: string;
    projectId?: string;
    projectPath: string;
  }) => Promise<McpListResult>;
  listMcpTasks: (payload: {
    projectId: string;
    projectPath: string;
    provider: string;
    source: string;
    target?: string;
    query?: string;
  }) => Promise<{
    ok: boolean;
    tasks: McpTaskCandidate[];
    source?: string;
    provider?: string;
    costUsd?: number | null;
    error?: string;
  }>;
  addMcpServer: (payload: {
    provider: string;
    projectPath: string;
    projectId?: string;
    name: string;
    transport: "stdio" | "http" | "sse";
    target: string;
    args?: string[];
    env?: string[];
    headers?: string[];
    scope?: "local" | "project" | "user";
    auth?: "none" | "oauth";
  }) => Promise<{ ok: boolean; message?: string; raw?: string; error?: string }>;
  removeMcpServer: (payload: {
    provider: string;
    projectPath: string;
    projectId?: string;
    name: string;
    scope?: "local" | "project" | "user";
  }) => Promise<{ ok: boolean; message?: string; raw?: string; error?: string }>;
  cancelMcpAuth?: (payload: { projectPath: string; provider: string; name: string }) => Promise<{ ok: boolean; running?: boolean }>;
  onMcpAuthUrl?: (handler: (event: { projectPath: string; provider: string; name: string; url: string }) => void) => () => void;
  connectMcpAuth: (payload: McpAuthPayload) => Promise<{
    ok: boolean;
    /** You stopped it before the browser came back. */
    cancelled?: boolean;
    profile?: McpAuthProfile;
    message?: string;
    error?: string;
  }>;
  forgetMcpAuth: (payload: Pick<McpAuthPayload, "projectId" | "projectPath" | "provider" | "name">) => Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
  setMcpTaskScope: (payload: Pick<McpAuthPayload, "projectId" | "projectPath" | "provider" | "name"> & { scope: string }) => Promise<{
    ok: boolean;
    scope?: string;
    error?: string;
  }>;
  trustProject: (payload: {
    provider: string;
    projectPath: string;
      /** Also record that Claude's bypass disclaimer is accepted, for this folder. */
    autoApprove?: boolean;
  }) => Promise<{ ok: boolean; trusted: boolean; changed?: boolean; message?: string; error?: string }>;
  routeCouncilTurn: (payload: {
    agent?: string;
    model?: string;
    projectPath: string;
    prompt: string;
    timeoutMs?: number;
  }) => Promise<{ ok: boolean; raw?: string; error?: string; costUsd?: number | null }>;
  getTerminalSize: (sessionId: string) => Promise<{ ok: boolean; cols?: number; rows?: number; error?: string }>;
  getProjectTestCommand: (payload: { projectPath: string }) => Promise<{ ok: boolean; command: string | null }>;
  runProjectTests: (payload: {
    projectPath: string;
    command?: string | null;
    timeoutMs?: number;
  }) => Promise<{
    ok: boolean;
    ran: boolean;
    command?: string;
    passed?: boolean;
    timedOut?: boolean;
    output?: string;
  }>;
  checkAgent: (agent: string) => Promise<{
    agent: string;
    command: string;
    installed: boolean;
    authenticated: boolean | null;
    status: "ready" | "missing" | "needs-login" | "unknown";
    message: string;
    version: string | null;
    completionMode: "native" | "fallback" | "unavailable";
    completionEvent: string | null;
    completionMessage: string;
    mcpSupport: boolean;
    projectMcpAuth: "isolated" | "provider-managed" | "none";
  }>;
  launchSession: (payload: {
    projectId: string;
    projectPath: string;
    sessionId: string;
    sessionName: string;
    agent: string;
    model: string;
    command?: string;
    args?: string[];
    /** Per-agent launch flags the renderer resolved, e.g. its unattended mode. */
    extraArgs?: string[];
    nativeSessionId?: string;
    resumeSession?: boolean;
    initialPrompt?: string;
  }) => Promise<{
    ok: boolean;
    pid?: number;
    command?: string;
    cwd?: string;
    error?: string;
    nativeSessionId?: string | null;
    nativeSessionMode?: "none" | "custom" | "create" | "resume" | "continue";
    initialPromptMode?: "none" | "argument" | "terminal";
    at: string;
  }>;
  releaseTaskRuntime: (payload: { projectId: string; taskId?: string }) => Promise<{ ok: boolean; released?: boolean; error?: string }>;
  allocateTaskRuntime: (payload: {
    projectId: string;
    taskId: string;
    taskIdentifier?: string;
    taskTitle?: string;
    sessionId: string;
  }) => Promise<{
    ok: boolean;
    previewPort?: number;
    mobileRuntimeId?: string;
    mobileDeviceName?: string;
    error?: string;
  }>;
  startTerminal: (payload: {
    /** Launches a pair's read-only, offline reviewer; main decides its flags. */
    pairReviewer?: "claude" | "codex" | "hermes";
    projectId: string;
    projectPath: string;
    /** The project's own checkout, when projectPath is a worktree of it. */
    projectRoot?: string;
    /** Why the session's worktree could not be made here, if it could not. */
    workspaceProblem?: string;
    sessionId: string;
    sessionName: string;
    agent: string;
    model: string;
    command?: string;
    args?: string[];
    /** Per-agent launch flags the renderer resolved, e.g. its unattended mode. */
    extraArgs?: string[];
    nativeSessionId?: string;
    resumeSession?: boolean;
    initialPrompt?: string;
    /** Run on Pitwall credits; main refuses rather than falls back to the person's login. */
    billing?: "credits";
    taskId?: string;
    taskIdentifier?: string;
    taskTitle?: string;
    taskRuntime?: {
      previewPort: number;
      mobileRuntimeId: string;
      mobileDeviceName: string;
    };
    cols?: number;
    rows?: number;
  }) => Promise<{
    ok: boolean;
    pid?: number;
    command?: string;
    cwd?: string;
    error?: string;
    nativeSessionId?: string | null;
    nativeSessionMode?: "none" | "custom" | "create" | "resume" | "continue";
    initialPromptMode?: "none" | "argument" | "terminal";
    taskRuntime?: {
      previewPort: number;
      mobileRuntimeId: string;
      mobileDeviceName: string;
    } | null;
    at: string;
  }>;
  chooseTerminalImages: (payload: { sessionId: string }) => Promise<TerminalAttachmentResult>;
  stageTerminalImages: (payload: { sessionId: string; paths: string[] }) => Promise<TerminalAttachmentResult>;
  stageTerminalImageData: (payload: {
    sessionId: string;
    images: Array<{ name: string; type: string; data: Uint8Array }>;
  }) => Promise<TerminalAttachmentResult>;
  getPathForFile: (file: File) => string;
  writeTerminal: (payload: {
    sessionId: string;
    data: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  resizeTerminal: (payload: {
    sessionId: string;
    cols: number;
    rows: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  /** A session's saved conversation, oldest first. */
  readAgentTranscript: (payload: {
    projectPath?: string;
    claudeSessionId?: string;
  }) => Promise<{ ok: boolean; records: unknown[]; claudeSessionId?: string; error?: string }>;
  /** Follows the conversation the session's terminal is writing. */
  startAgentMirror: (payload: {
    sessionId: string;
    projectPath?: string;
    claudeSessionId?: string;
  }) => Promise<{ ok: boolean; claudeSessionId?: string; error?: string }>;
  stopAgentMirror: (sessionId: string) => Promise<{ ok: boolean }>;
  /** Stops the PTY behind a session without ending the session itself. */
  /** Fires when a session's process exits, so stale attach state can be cleared. */
  onTerminalClosed: (handler: (payload: { sessionId: string; exitCode?: number; stopped?: boolean }) => void) => () => void;
  detachTerminal: (sessionId: string) => Promise<{ ok: boolean; detached?: boolean; error?: string }>;
  startAgentStream: (payload: {
    sessionId: string;
    projectId?: string;
    projectPath?: string;
    model?: string;
    permissionMode?: string;
    resumeSessionId?: string;
  }) => Promise<{ ok: boolean; pid?: number; cwd?: string; reused?: boolean; resumedSessionId?: string; error?: string }>;
  sendAgentStreamTurn: (payload: { sessionId: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  stopAgentStream: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  /** One frame of the agent's protocol: a parsed event, a diagnostic, or an exit. */
  onAgentStreamEvent: (callback: (payload: {
    sessionId: string;
    event?: unknown;
    /** The conversation so far, oldest first. */
    history?: unknown[];
    /** The conversation moved to a different session; start the view over. */
    reset?: boolean;
    /** What the follower is doing, so a stalled one is visibly stalled. */
    status?: { claudeSessionId: string; records: number; at: number };
    noise?: string;
    exit?: number;
  }) => void) => () => void;
  reportLongTask?: (durationMs: number) => void;
  onTerminalData: (callback: (payload: {
    sessionId: string;
    data: string;
  }) => void) => () => void;
  onAgentCompleted: (callback: (payload: AgentCompletionEvent) => void) => () => void;
  runSessionAction: (payload: {
    projectId: string;
    sessionId: string;
    action: string;
  }) => Promise<{ ok: boolean; id: string; action: string; at: string; error?: string }>;

  startVoice: (payload?: VoiceConfig) => Promise<{ ok: boolean; error?: string }>;
  stopVoice: () => Promise<{ ok: boolean }>;
  voiceListenOnce: () => Promise<{ ok: boolean; error?: string }>;
  submitVoiceText: (payload: { text: string }) => Promise<CapabilityResult>;
  confirmVoiceAction: () => Promise<CapabilityResult>;
  cancelVoiceConfirmation: () => Promise<{ ok: boolean }>;
  stopVoiceSpeaking: () => Promise<{ ok: boolean }>;
  endVoiceTurn: () => Promise<{ ok: boolean }>;
  getVoiceStatus: () => Promise<VoiceStatus>;
  listVoices: () => Promise<VoiceCatalog>;
  setVoice: (payload: {
    voiceIdentifier?: string | null;
    preset?: string;
    silenceTimeout?: number;
  }) => Promise<{ ok: boolean }>;
  previewVoice: (payload: { voiceIdentifier?: string; preset?: string; text?: string }) => Promise<{ ok: boolean }>;
  listCapabilities: () => Promise<{ ok: boolean; capabilities: CapabilityDescriptor[] }>;
  runCapability: (payload: {
    capabilityId: string;
    params?: Record<string, unknown>;
    confirmationId?: string;
  }) => Promise<CapabilityResult>;
  rememberNote: (payload: { note: string; kind?: string }) => Promise<{ ok: boolean }>;
  getVoiceHistory: () => Promise<{ ok: boolean; snapshots: VoiceSnapshot[] }>;
  onVoiceEvent: (callback: (event: VoiceEvent) => void) => () => void;
  onVoiceRendererCall: (
    callback: (payload: { id: string; capabilityId: string; params: Record<string, unknown> }) => void,
  ) => () => void;
  respondToVoiceCall: (payload: { id: string; result: unknown }) => void;
}

type VoiceRisk = "safe" | "guarded" | "destructive";

type VoiceState =
  | "off"
  | "listening"
  | "capturing"
  | "thinking"
  | "working"
  | "speaking"
  | "awaiting_confirmation";

interface VoiceConfig {
  wakeWords?: string[];
  locale?: string;
  voice?: string;
  speechRate?: number;
  silenceTimeout?: number;
  bargeIn?: boolean;
}

interface CapabilityDescriptor {
  id: string;
  title: string;
  description: string;
  examples: string[];
  risk: VoiceRisk;
  params: Record<string, unknown>;
}

interface CapabilityResult {
  ok: boolean;
  code?: string;
  capabilityId?: string;
  error?: string;
  speak?: string;
  confirmation?: { id: string; question: string; capabilityId: string };
  [key: string]: unknown;
}

interface VoiceSnapshot {
  at: string;
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
  branch: string | null;
  openFiles: string[];
  sessions: Array<{ id: string; agent: string; name: string }>;
  task: string | null;
}

interface VoiceStatus {
  ok: boolean;
  state: VoiceState;
  enabled: boolean;
  lastTranscript: string;
  pendingConfirmation: { id: string; question: string; capabilityId: string } | null;
  engine: { running: boolean; mode: string; speaking: boolean; granted: boolean | null; available: boolean; lastError: string | null };
  history: Array<{ transcript: string; capabilityId: string }>;
  engineBuilt: boolean;
  observerBuilt: boolean;
}

interface VoiceOption {
  identifier: string;
  name: string;
  language: string;
  quality: "default" | "enhanced" | "premium";
  score: number;
}

interface VoicePreset {
  id: string;
  label: string;
  description: string;
  rate: number;
  pitch: number;
  volume: number;
}

interface VoiceCatalog {
  ok: boolean;
  error?: string;
  voices: VoiceOption[];
  selected: string;
  presets: VoicePreset[];
  preset: string;
  silenceTimeout: number;
  quality: { best: string; needsDownload: boolean; message: string };
}

type VoiceEvent =
  | { type: "voice:state"; state: VoiceState; enabled: boolean; transcript?: string; capabilityId?: string }
  | { type: "voice:settling"; seconds: number | null }
  | { type: "voice:ready"; granted: boolean; backend: string; onDevice: boolean }
  | { type: "voice:wake" }
  | { type: "voice:partial"; text: string }
  | { type: "voice:heard"; text: string }
  | { type: "voice:intent"; intent: { capabilityId: string; params: Record<string, unknown>; say: string }; transcript: string }
  | { type: "voice:result"; result: CapabilityResult }
  | { type: "voice:say"; text: string }
  | { type: "voice:confirmation"; confirmation: { id: string; question: string; capabilityId: string } | null }
  | { type: "voice:level"; rms: number; speaking: boolean }
  | { type: "voice:barge_in" }
  | { type: "voice:engine_idle" }
  | { type: "voice:error"; message: string; fatal: boolean };

interface AgentCompletionEvent {
  projectId: string;
  sessionId: string;
  sessionName: string;
  agent: string;
  provider: string;
  status: "completed" | "failed";
  reason: "turn-complete" | "terminal-notification" | "process-exit" | string;
  summary: string;
  at: string;
}

interface TerminalAttachmentResult {
  ok: boolean;
  paths: string[];
  error?: string;
}

interface Window {
  braveli?: BraveliApi;
}

interface ProjectIdentity {
  projectId: string;
  projectPath: string;
}

type CodeHostKind = "github" | "gitlab" | "bitbucket" | "other";

interface CodeHostInfo {
  ok: boolean;
  kind?: CodeHostKind;
  /** "GitHub", "GitLab", "Bitbucket" or "Git host". */
  label?: string;
  host?: string;
  repository?: string;
  /** The CLI Pitwall drives for this host, if any. */
  cli?: "gh" | "glab" | null;
  cliInstalled?: boolean;
  /** "pull request" or "merge request". */
  requestNoun?: string;
  requestShort?: string;
  error?: string;
}

interface GitHubAuthResult {
  ok: boolean;
  configured?: boolean;
  encryptionAvailable?: boolean;
  host?: string;
  kind?: CodeHostKind;
  login?: string;
  source?: "gh" | "manual" | "remote";
  repositoryAccess?: boolean;
  updatedAt?: string | null;
  error?: string;
}

interface GitHubAccountOption {
  login: string;
  active: boolean;
  source: "gh" | "remote";
  repositoryAccess: boolean;
}

interface GitHubAccountsResult {
  ok: boolean;
  accounts: GitHubAccountOption[];
  host?: string;
  repository?: string;
  protocol?: string;
  hasEmbeddedCredential?: boolean;
  kind?: CodeHostKind;
  error?: string;
}


interface RuntimeRecovery {
  recovered: boolean;
  restorable: boolean;
  interrupted: boolean;
  detectedAt?: string;
  terminals: Array<{
    sessionId: string;
    projectId: string;
    projectPath: string;
    sessionName: string;
    agent: string;
    model: string;
    nativeSessionId?: string;
    startedAt: string;
  }>;
  workbenches: Array<{ projectId: string; projectPath: string; startedAt: string }>;
  /** Sessions whose terminal main owns right now. */
  live?: string[];
}

interface UpdateState {
  /**
   * `blocked` means the install cannot be replaced — running from a disk image,
   * or from the read-only copy macOS makes for a quarantined app. Distinct from
   * `error`, which is worth retrying; this one needs somebody to move the app.
   */
  status:
    | "disabled"
    | "current"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "error"
    | "blocked";
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string;
}

/** A managed worktree, and what it still holds that no remote has. */
interface WorktreeAudit {
  path: string;
  branch: string;
  live: boolean;
  dirty: number;
  unpushed: number;
  error?: string;
}

interface PullRequestResult {
  ok: boolean;
  found: boolean;
  url?: string;
  number?: number;
  title?: string;
  state?: string;
  headRefName?: string;
  baseRefName?: string;
  kind?: CodeHostKind;
  requestNoun?: string;
  /** The host has no CLI Pitwall can ask; `newUrl` is its "new request" page. */
  unsupported?: boolean;
  host?: string;
  newUrl?: string;
  error?: string;
}

/** One attempt at a scheduled job. A skip is recorded, but is not a run. */
interface ScheduleRun {
  at: string;
  outcome: "ok" | "blocked" | "failed" | "running" | "skipped" | "missed";
  reason?: string;
  /** The task this run created, so the next fire can tell whether it is still going. */
  taskId?: string;
  branch?: string;
  pullRequestUrl?: string;
}

/** Work Pitwall starts by itself, once a day at a time you chose. */
interface ScheduleJob {
  id: string;
  hour: number;
  minute: number;
  prompt: string;
  projectId: string;
  /** The agent this booking runs with, pinned when it was booked. */
  agent: string;
  /** Weekdays it runs on, 0 = Sunday. Empty means every day. */
  days?: number[];
  /** Hours between runs through the day. 0 or absent means it runs once. */
  everyHours?: number;
  /** Minutes past midnight a repeat stops at. 0 means the end of the day. */
  untilMinutes?: number;
  /** When it last really ran, as an instant — a date cannot answer an hourly booking. */
  lastRunAt?: number;
  enabled: boolean;
  /** Local calendar date of the last real run. Empty until one happens. */
  lastRunDate: string;
  /** Newest first, capped. */
  history: ScheduleRun[];
}

/** One pull request as `gh pr list` reports it, validated. */
interface ReviewPullRequest {
  headRefName: string;
  /** "open", "closed" or "merged", lower-cased. */
  state: string;
  number?: number;
  /** Empty when gh gave a url that could not be used. */
  url: string;
  title: string;
}

/** What the repository says about one branch behind a review card. */
interface ReviewBranchFacts {
  exists: boolean;
  merged: boolean;
  branchAhead: number;
  /** How far the trunk has moved since this branch forked. */
  trunkAhead: number;
  /** Whether the branch ever carried a commit of its own, from its reflog. */
  hasOwnCommits: boolean;
  /** Uncommitted files in the branch's worktree. */
  dirty: number;
  pullRequest: ReviewPullRequest | null;
}

interface ReviewStateResult {
  ok: boolean;
  facts: Record<string, ReviewBranchFacts>;
  /** False when gh is missing or signed out: local facts only. */
  pullRequestsAvailable: boolean; pullRequestError?: string;
  requestNoun?: string;
  error?: string;
}

type McpServerStatus = "connected" | "failed" | "pending" | "needs-auth" | "configured";

interface McpServerInfo {
  name: string;
  target: string;
  transport: string;
  status: McpServerStatus;
  statusText: string;
}

interface McpTaskSource extends McpServerInfo {
  provider: string;
  key: string;
  label: string;
  importSupported: boolean;
  scope?: string;
}

interface McpAuthProfile {
  provider: string;
  name: string;
  alias: string;
  target: string;
  transport: string;
  authenticatedAt: string | null;
  scope?: string;
  updatedAt: string;
}

interface McpAuthPayload {
  projectId: string;
  projectPath: string;
  provider: string;
  name: string;
  target: string;
  transport: string;
}

interface McpListResult {
  ok: boolean;
  provider: string;
  installed: boolean;
  supported: boolean;
  servers: McpServerInfo[];
  authProfiles?: McpAuthProfile[];
  raw?: string;
  message?: string;
  error?: string;
}

interface McpTaskCandidate {
  id?: string;
  title: string;
  description?: string;
  url?: string;
  /** The tracker's own column, spelled its way: "Ready for QA", not "in review". */
  status?: string;
  /**
   * The sprint, cycle or milestone it is scheduled into — or "Backlog".
   *
   * Without it a sprint and a backlog arrive as one undifferentiated list, and
   * the only way to tell work due this week from work three weeks out is to
   * open every item.
   */
  group?: string;
  updatedAt?: string;
}

interface GitChange {
  path: string;
  originalPath?: string;
  status: string;
  kind: string;
  additions?: number | null;
  deletions?: number | null;
}

interface VscodeExtensionManifest {
  id: string;
  name: string;
  displayName: string;
  version: string;
  publisher: string;
  description: string;
  extensionPath: string;
  main: string;
  browser: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string; category?: string }>;
    languages: unknown[];
    snippets: unknown[];
    themes: unknown[];
  };
  canRunInHost: boolean;
}

interface ExtensionHostLog {
  level: "info" | "warn" | "error";
  message: string;
  extensionId?: string;
}

interface VscodeWorkbenchLog {
  projectPath: string;
  stream: "stdout" | "stderr" | "exit";
  message: string;
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: {
      key?: string;
      className?: string;
      src?: string;
      partition?: string;
      allowpopups?: string;
      webpreferences?: string;
    };
  }
}

/**
 * What one agent CLI can install.
 *
 * Skills and MCP servers are listed separately because that is how people look
 * for them, but neither is installable on its own — both ship inside a plugin,
 * and every row carries the plugin that would bring it.
 */
interface AgentExtensions {
  ok: boolean;
  provider: string;
  /** Whether the CLI is on PATH at all. */
  installed: boolean;
  /** Whether that CLI has a plugin system Pitwall can drive. */
  supported: boolean;
  plugins: AgentPlugin[];
  skills: AgentSkill[];
  mcpServers: AgentPluginMcp[];
  message?: string;
  error?: string;
}

interface AgentPluginComponent {
  name: string;
  /** Tokens added to every session, and tokens paid each time it fires. */
  alwaysOn: number | null;
  onInvoke: number | null;
}

interface AgentPlugin {
  pluginId: string;
  name: string;
  marketplace: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  installs: number | null;
  installed: boolean;
  enabled: boolean;
  /** Codex marks some catalogue entries as not installable from here. */
  installable?: boolean;
  needsAuth?: boolean;
  tokens?: { alwaysOn: number | null; onInvoke: number | null } | null;
  components?: Record<string, AgentPluginComponent[]>;
}

interface AgentSkill {
  name: string;
  pluginId: string;
  pluginName: string;
  marketplace: string;
  installed: boolean;
  enabled: boolean;
  alwaysOn: number | null;
  onInvoke: number | null;
  /** How many skills arrive with it, since installing one installs them all. */
  siblings: number;
}

interface AgentPluginMcp {
  name: string;
  pluginId: string;
  pluginName: string;
  marketplace: string;
  installed: boolean;
  viaPlugin: boolean;
}

/**
 * One server published to the MCP registry.
 *
 * `publisher` is carried separately and shown, because the registry holds no
 * install counts, ratings or verification flags — who published it is the only
 * way to tell the real thing from a fork of it.
 */
interface RegistryMcpServer {
  id: string;
  name: string;
  publisher: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  launch: {
    kind: "remote" | "package";
    transport: "http" | "sse" | "stdio";
    url?: string;
    command?: string;
    args?: string[];
    env?: Array<{ name: string; description: string; secret: boolean }>;
  } | null;
  /** False when Pitwall cannot build a command for it — a container image, say. */
  installable: boolean;
  /** It will need secrets set before it will actually run. */
  needsEnv: boolean;
  /** The npm package behind it, when it is one. */
  npmPackage?: string | null;
  /**
   * Weekly npm downloads.
   *
   * The nearest thing to a rating that exists: the MCP registry publishes no
   * stars, no reviews and no install counts. Absent means not known — never zero.
   */
  weeklyDownloads?: number;
}

type WatchVerdict = "approve" | "comment" | "request_changes";

interface WatchReview {
  verdict: WatchVerdict;
  summary: string;
  comments: Array<{ path: string; line: number; body: string }>;
}

type WatchKind = "review-requested" | "custom" | "ci-failed" | "my-request-comments" | "ticket-assigned";

interface AutomationSettings {
  models: { tracker: string; review: string; fix: string; writer: string };
  /** 0 when the board does not re-read its tracker by itself. */
  boardSyncMinutes: number;
}

interface WatchConfig {
  /** Custom: what a request must be to be reviewed, and what to look at. */
  condition?: string;
  focus?: string;
  /** Ticket-assigned: the tracker, as imports name it. */
  provider?: string;
  source?: string;
  target?: string;
  /** The model this watch runs on, over the automation default; empty for the default. */
  model?: string;
}

/** A comment on your request, and the reply drafted for it. */
interface WatchReply {
  id: string;
  discussionId?: string;
  kind: "line" | "general";
  author: string;
  body: string;
  path: string;
  line: number;
  reply: string;
}

interface WatchProposal {
  /** Fixes: what was wrong and what changed, the patch, and the message to commit it with. */
  summary?: string;
  patch?: string;
  commitMessage?: string;
  replies?: WatchReply[];
  failing?: Array<{ name: string; url: string }>;
  /** Tickets: the drafted plan. */
  plan?: string;
}

interface WatchRecord {
  id: string;
  projectId: string;
  projectPath: string;
  kind: WatchKind;
  config?: WatchConfig;
  /** How often it looks, when chosen; otherwise its kind's default. */
  intervalSeconds?: number;
  enabled: boolean;
  createdAt: number;
  lastCheckedAt: number;
  lastError: string;
}

/** A request Pitwall was asked to review, and where its review stands. */
interface WatchFinding {
  id: string;
  key: string;
  watchId: string;
  projectId: string;
  kind?: WatchKind;
  ref?: string | number;
  payload?: {
    failing?: Array<{ name: string; url: string }>;
    comments?: Array<Omit<WatchReply, "reply">>;
    ticket?: { id?: string; title: string; description?: string; url?: string; status?: string; group?: string; updatedAt?: string };
    source?: { provider: string; name: string; target: string };
  } | null;
  proposal?: WatchProposal | null;
  number: number;
  title: string;
  url: string;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  draft: boolean;
  description: string;
  state: "queued" | "reviewing" | "ready" | "posted" | "dismissed" | "failed" | "skipped";
  review: WatchReview | null;
  error: string;
  foundAt: number;
  updatedAt: number;
  postedUrl: string;
  reviewedSha: string;
  /** What you and the agent said about this draft, oldest first. */
  conversation?: Array<{ role: "you" | "agent"; text: string; at: number; failed?: boolean }>;
  /** The agent is making a change you asked for. */
  revising?: boolean;
  /** Bumped each time a change you asked for lands. */
  revision?: number;
}

interface WatchState {
  watches: WatchRecord[];
  findings: WatchFinding[];
}

interface PitwallCreditsState {
  /** A gateway is configured in this build. */
  available: boolean;
  /** The gateway is on this Mac, so plans can be activated without paying. */
  dev: boolean;
  signedIn: boolean;
  email: string;
}

type PitwallGatewayReply<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string; retryAfter?: number };

interface PitwallPlan {
  id: string;
  name: string;
  price_usd: number;
  allowance_usd: number;
}

interface PitwallAccount {
  email: string | null;
  plan: string | null;
  active: boolean;
  overage_cap_usd: number;
  period: { start: string; end: string } | null;
  allowance_usd?: number;
  used_usd?: number;
  overage_usd?: number;
  remaining_usd?: number;
  by_model: Array<{ model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
}
