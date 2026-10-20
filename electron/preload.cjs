const { contextBridge, ipcRenderer, webUtils } = require("electron");

// The platform as an attribute on <html>, set before the app renders, so the
// stylesheet can keep the right corner free of Windows' caption buttons and
// drop the Mac's traffic-light inset without a flash of the wrong layout.
function markPlatform() {
  if (document.documentElement) document.documentElement.dataset.platform = process.platform;
}
markPlatform();
window.addEventListener("DOMContentLoaded", markPlatform);

contextBridge.exposeInMainWorld("braveli", {
  platform: process.platform,
  setWindowChrome: (payload) => ipcRenderer.invoke("window:chrome", payload),
  chooseProjectDirectory: () => ipcRenderer.invoke("project:choose-directory"),
  createProjectDirectory: (payload) => ipcRenderer.invoke("project:create-directory", payload),
  openPath: (targetPath) => ipcRenderer.invoke("project:open-path", targetPath),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),
  listProjectFiles: (projectPath) => ipcRenderer.invoke("project:list-files", projectPath),
  readProjectFile: (payload) => ipcRenderer.invoke("project:read-file", payload),
  writeProjectFile: (payload) => ipcRenderer.invoke("project:write-file", payload),
  getGitStatus: (projectPath) => ipcRenderer.invoke("git:status", projectPath),
  getGitDiff: (payload) => ipcRenderer.invoke("git:diff", payload),
  whichCommands: (payload) => ipcRenderer.invoke("agents:which", payload),
  runValidation: (payload) => ipcRenderer.invoke("validation:run", payload),
  planValidation: (payload) => ipcRenderer.invoke("validation:plan", payload),
  catalogueLive: (payload) => ipcRenderer.invoke("catalogue:live", payload),
  ollamaStatus: () => ipcRenderer.invoke("ollama:status"),
  ollamaBridgeStatus: (payload) => ipcRenderer.invoke("ollama:bridge-status", payload),
  connectOllamaAgent: (payload) => ipcRenderer.invoke("ollama:connect-agent", payload),
  ollamaLocalAgent: () => ipcRenderer.invoke("ollama:local-agent"),
  branchTree: (payload) => ipcRenderer.invoke("git:branch-tree", payload),
  reviewState: (payload) => ipcRenderer.invoke("git:review-state", payload),

  // Jobs Pitwall starts by itself. The renderer reads and writes the schedule
  // and runs the jobs; the main process only decides when one is due.
  openPullRequest: (payload) => ipcRenderer.invoke("git:open-pull-request", payload),
  requestContext: (payload) => ipcRenderer.invoke("git:request-context", payload),
  writeRequest: (payload) => ipcRenderer.invoke("git:write-request", payload),
  pairPrepare: (payload) => ipcRenderer.invoke("pair:prepare", payload),
  pairVerdict: (payload) => ipcRenderer.invoke("pair:verdict", payload),
  overseerObserve: (payload) => ipcRenderer.invoke("overseer:observe", payload),
  listFiles: (payload) => ipcRenderer.invoke("files:list", payload),
  readFile: (payload) => ipcRenderer.invoke("files:read", payload),
  fileChanges: (payload) => ipcRenderer.invoke("files:status", payload),
  onCliChecked: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cli:checked", listener);
    return () => ipcRenderer.removeListener("cli:checked", listener);
  },
  onAgentNotice: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:notice", listener);
    return () => ipcRenderer.removeListener("agent:notice", listener);
  },
  onSessionNativeId: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("session:native-id", listener);
    return () => ipcRenderer.removeListener("session:native-id", listener);
  },
  writeFile: (payload) => ipcRenderer.invoke("files:write", payload),
  watchFile: (payload) => ipcRenderer.invoke("files:watch", payload),
  unwatchFile: () => ipcRenderer.invoke("files:unwatch"),
  onFileChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("files:changed", listener);
    return () => ipcRenderer.removeListener("files:changed", listener);
  },
  listWatches: () => ipcRenderer.invoke("watch:list"),
  setWatch: (payload) => ipcRenderer.invoke("watch:set", payload),
  addWatch: (payload) => ipcRenderer.invoke("watch:add", payload),
  updateWatch: (payload) => ipcRenderer.invoke("watch:update", payload),
  removeWatch: (payload) => ipcRenderer.invoke("watch:remove", payload),
  resolveWatchFinding: (payload) => ipcRenderer.invoke("watch:resolve", payload),
  checkWatchesNow: (payload) => ipcRenderer.invoke("watch:check-now", payload),
  showNotification: (payload) => ipcRenderer.invoke("notify:show", payload),
  getAutomationSettings: () => ipcRenderer.invoke("automation-settings:get"),
  setAutomationSettings: (patch) => ipcRenderer.invoke("automation-settings:set", patch),
  retryWatchFinding: (payload) => ipcRenderer.invoke("watch:retry", payload),
  dismissWatchFinding: (payload) => ipcRenderer.invoke("watch:dismiss", payload),
  postWatchReview: (payload) => ipcRenderer.invoke("watch:post", payload),
  approveWatchFix: (payload) => ipcRenderer.invoke("watch:post", payload),
  reviseWatchFinding: (payload) => ipcRenderer.invoke("watch:revise", payload),
  onAutomationNotice: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("automation:notice", listener);
    return () => ipcRenderer.removeListener("automation:notice", listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:navigate", listener);
    return () => ipcRenderer.removeListener("app:navigate", listener);
  },
  onWatchChanged: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("watch:changed", listener);
    return () => ipcRenderer.removeListener("watch:changed", listener);
  },
  listSchedule: () => ipcRenderer.invoke("schedule:list"),
  saveScheduleJob: (payload) => ipcRenderer.invoke("schedule:save", payload),
  deleteScheduleJob: (payload) => ipcRenderer.invoke("schedule:delete", payload),
  recordScheduleRun: (payload) => ipcRenderer.invoke("schedule:record", payload),
  scheduleReady: () => ipcRenderer.invoke("schedule:ready"),
  onScheduleFire: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("schedule:fire", listener);
    return () => ipcRenderer.removeListener("schedule:fire", listener);
  },
  branchChanges: (payload) => ipcRenderer.invoke("git:branch-changes", payload),
  branchFileDiff: (payload) => ipcRenderer.invoke("git:branch-file-diff", payload),
  ollamaServe: () => ipcRenderer.invoke("ollama:serve"),
  ollamaPull: (payload) => ipcRenderer.invoke("ollama:pull", payload),
  ollamaPullCancel: (payload) => ipcRenderer.invoke("ollama:pull-cancel", payload),
  ollamaTuning: (payload) => ipcRenderer.invoke("ollama:tuning", payload),
  ollamaTune: (payload) => ipcRenderer.invoke("ollama:tune", payload),
  ollamaRemove: (payload) => ipcRenderer.invoke("ollama:remove", payload),
  onOllamaPullOutput: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("ollama:pull-output", listener);
    return () => ipcRenderer.removeListener("ollama:pull-output", listener);
  },
  planAgentInstall: (payload) => ipcRenderer.invoke("agents:install-plan", payload),
  installAgent: (payload) => ipcRenderer.invoke("agents:install", payload),
  sendAgentInstallInput: (payload) => ipcRenderer.invoke("agents:install-input", payload),
  resizeAgentInstall: (payload) => ipcRenderer.invoke("agents:install-resize", payload),
  onAgentInstallOutput: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("agents:install-output", listener);
    return () => ipcRenderer.removeListener("agents:install-output", listener);
  },
  subscribeLiveChanges: (payload) => ipcRenderer.invoke("live-changes:subscribe", payload),
  unsubscribeLiveChanges: (payload) => ipcRenderer.invoke("live-changes:unsubscribe", payload),
  onLiveChanges: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on("live-changes:update", listener);
    return () => ipcRenderer.removeListener("live-changes:update", listener);
  },
  getLiveFileDiff: (payload) => ipcRenderer.invoke("live-changes:file-diff", payload),
  revertLiveChange: (payload) => ipcRenderer.invoke("live-changes:revert", payload),
  keepLiveChange: (payload) => ipcRenderer.invoke("live-changes:keep", payload),
  getTaskChangeset: (payload) => ipcRenderer.invoke("git:task-changeset", payload),
  getTaskFileDiff: (payload) => ipcRenderer.invoke("git:task-file-diff", payload),
  listWorktrees: (projectPath) => ipcRenderer.invoke("git:worktree-list", projectPath),
  ensureWorktree: (payload) => ipcRenderer.invoke("git:worktree-ensure", payload),
  removeWorktree: (payload) => ipcRenderer.invoke("git:worktree-remove", payload),
  auditWorktrees: (payload) => ipcRenderer.invoke("git:worktree-audit", payload),
  setKnownProjects: (payload) => ipcRenderer.invoke("worktrees:known-projects", payload),
  getRuntimeRecovery: () => ipcRenderer.invoke("runtime:recovery"),
  acknowledgeRuntimeRecovery: (payload) => ipcRenderer.invoke("runtime:acknowledge-recovery", payload),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  getLicence: () => ipcRenderer.invoke("licence:get"),
  activateLicence: (payload) => ipcRenderer.invoke("licence:activate", payload),
  verifyLicence: () => ipcRenderer.invoke("licence:verify"),
  clearLicence: () => ipcRenderer.invoke("licence:clear"),
  hermesSignIn: () => ipcRenderer.invoke("hermes:sign-in"),
  onHermesSignInState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("hermes:sign-in-state", listener);
    return () => ipcRenderer.removeListener("hermes:sign-in-state", listener);
  },
  creditsState: () => ipcRenderer.invoke("credits:state"),
  creditsSignInStart: (payload) => ipcRenderer.invoke("credits:sign-in-start", payload),
  creditsSignInVerify: (payload) => ipcRenderer.invoke("credits:sign-in-verify", payload),
  creditsSignOut: () => ipcRenderer.invoke("credits:sign-out"),
  cloudStatus: () => ipcRenderer.invoke("cloud:status"),
  cloudSetUp: () => ipcRenderer.invoke("cloud:set-up"),
  cloudJoinWithRecovery: (payload) => ipcRenderer.invoke("cloud:join-recovery", payload),
  cloudReset: () => ipcRenderer.invoke("cloud:reset"),
  cloudTurnOff: () => ipcRenderer.invoke("cloud:turn-off"),
  cloudSyncNow: () => ipcRenderer.invoke("cloud:sync-now"),
  cloudHeldDeletions: (payload) => ipcRenderer.invoke("cloud:held-deletions", payload),
  cloudDevices: () => ipcRenderer.invoke("cloud:devices"),
  cloudRemoveDevice: (payload) => ipcRenderer.invoke("cloud:remove-device", payload),
  cloudPushSnapshot: (snapshot) => ipcRenderer.send("cloud:push-snapshot", snapshot),
  cloudRequestJoin: () => ipcRenderer.invoke("cloud:join-request"),
  cloudCancelJoin: () => ipcRenderer.invoke("cloud:join-cancel"),
  cloudConfirmJoinHere: () => ipcRenderer.invoke("cloud:join-confirm"),
  cloudCheckJoinRequests: () => ipcRenderer.invoke("cloud:join-requests"),
  cloudApproveJoin: (payload) => ipcRenderer.invoke("cloud:approve-join", payload),
  cloudConfirmJoin: (payload) => ipcRenderer.invoke("cloud:confirm-join", payload),
  cloudDenyJoin: (payload) => ipcRenderer.invoke("cloud:deny-join", payload),
  cloudRetryCheckout: (payload) => ipcRenderer.invoke("cloud:retry-checkout", payload),
  cloudContinueHere: (payload) => ipcRenderer.invoke("cloud:continue-here", payload),
  cloudRefreshLeases: () => ipcRenderer.invoke("cloud:leases"),
  onCloudRenameProject: (callback) => {
    const listener = (_event, rename) => callback(rename);
    ipcRenderer.on("cloud:rename-project", listener);
    return () => ipcRenderer.removeListener("cloud:rename-project", listener);
  },
  onCloudLeases: (callback) => {
    const listener = (_event, leases) => callback(leases);
    ipcRenderer.on("cloud:leases", listener);
    return () => ipcRenderer.removeListener("cloud:leases", listener);
  },
  onCloudNotice: (callback) => {
    const listener = (_event, notice) => callback(notice);
    ipcRenderer.on("cloud:notice", listener);
    return () => ipcRenderer.removeListener("cloud:notice", listener);
  },
  onCloudProjectReady: (callback) => {
    const listener = (_event, event) => callback(event);
    ipcRenderer.on("cloud:project-ready", listener);
    return () => ipcRenderer.removeListener("cloud:project-ready", listener);
  },
  onCloudJoinState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("cloud:join-state", listener);
    return () => ipcRenderer.removeListener("cloud:join-state", listener);
  },
  onCloudJoinRequests: (callback) => {
    const listener = (_event, requests) => callback(requests);
    ipcRenderer.on("cloud:join-requests", listener);
    return () => ipcRenderer.removeListener("cloud:join-requests", listener);
  },
  onCloudApply: (callback) => {
    const listener = (_event, batch) => callback(batch);
    ipcRenderer.on("cloud:apply", listener);
    return () => ipcRenderer.removeListener("cloud:apply", listener);
  },
  onCloudStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("cloud:status", listener);
    return () => ipcRenderer.removeListener("cloud:status", listener);
  },
  creditsAccount: () => ipcRenderer.invoke("credits:account"),
  creditsPlans: () => ipcRenderer.invoke("credits:plans"),
  creditsModels: () => ipcRenderer.invoke("credits:models"),
  creditsSetCap: (payload) => ipcRenderer.invoke("credits:set-cap", payload),
  creditsDevActivate: (payload) => ipcRenderer.invoke("credits:dev-activate", payload),
  onCreditsRefused: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("credits:refused", listener);
    return () => ipcRenderer.removeListener("credits:refused", listener);
  },
  captureEvent: (event, properties) => ipcRenderer.invoke("analytics:capture", { event, properties }),
  analyticsState: (payload) => ipcRenderer.invoke("analytics:state", payload),
  getGitHubAuth: (payload) => ipcRenderer.invoke("github-auth:status", payload),
  listGitHubAccounts: (payload) => ipcRenderer.invoke("github-auth:accounts", payload),
  activateGitHubAccount: (payload) => ipcRenderer.invoke("github-auth:activate", payload),
  rememberGitHubAuth: (payload) => ipcRenderer.invoke("github-auth:remember", payload),
  forgetGitHubAuth: (payload) => ipcRenderer.invoke("github-auth:forget", payload),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
  listEditors: () => ipcRenderer.invoke("editor:list"),
  openInEditor: (payload) => ipcRenderer.invoke("editor:open", payload),
  openFileInEditor: (payload) => ipcRenderer.invoke("editor:open-file", payload),
  getPullRequest: (payload) => ipcRenderer.invoke("git:pull-request", payload),
  getCodeHost: (payload) => ipcRenderer.invoke("git:code-host", payload),
  listProviders: (payload) => ipcRenderer.invoke("provider:list", payload),
  discoverCustomAgentModels: (payload) => ipcRenderer.invoke("provider:discover-custom-models", payload),
  listMcpServers: (payload) => ipcRenderer.invoke("mcp:list", payload),
  listMcpTasks: (payload) => ipcRenderer.invoke("mcp:list-task-candidates", payload),
  addMcpServer: (payload) => ipcRenderer.invoke("mcp:add", payload),
  removeMcpServer: (payload) => ipcRenderer.invoke("mcp:remove", payload),
  connectMcpAuth: (payload) => ipcRenderer.invoke("mcp:auth-connect", payload),
  cancelMcpAuth: (payload) => ipcRenderer.invoke("mcp:auth-cancel", payload),
  onMcpAuthUrl: (handler) => {
    const listener = (_event, value) => handler(value);
    ipcRenderer.on("mcp:auth-url", listener);
    return () => ipcRenderer.removeListener("mcp:auth-url", listener);
  },
  forgetMcpAuth: (payload) => ipcRenderer.invoke("mcp:auth-forget", payload),
  setMcpTaskScope: (payload) => ipcRenderer.invoke("mcp:set-task-scope", payload),
  trustProject: (payload) => ipcRenderer.invoke("project:trust", payload),
  inspectProjectKnowledge: (payload) => ipcRenderer.invoke("knowledge:inspect", payload),
  learnProjectKnowledge: (payload) => ipcRenderer.invoke("knowledge:learn", payload),
  rememberProjectKnowledge: (payload) => ipcRenderer.invoke("knowledge:remember", payload),
  updateProjectKnowledge: (payload) => ipcRenderer.invoke("knowledge:update", payload),
  prepareProjectContext: (payload) => ipcRenderer.invoke("knowledge:prepare", payload),
  markContextReceipt: (payload) => ipcRenderer.invoke("knowledge:receipt", payload),
  routeCouncilTurn: (payload) => ipcRenderer.invoke("council:route", payload),
  getProjectTestCommand: (payload) => ipcRenderer.invoke("project:test-command", payload),
  runProjectTests: (payload) => ipcRenderer.invoke("project:run-tests", payload),
  checkAgent: (agent) => ipcRenderer.invoke("agent:check", agent),
  releaseTaskRuntime: (payload) => ipcRenderer.invoke("task-runtime:release", payload),
  allocateTaskRuntime: (payload) => ipcRenderer.invoke("task-runtime:allocate", payload),
  launchSession: (payload) => ipcRenderer.invoke("session:launch", payload),
  startTerminal: (payload) => ipcRenderer.invoke("terminal:start", payload),
  chooseTerminalImages: (payload) => ipcRenderer.invoke("terminal:choose-images", payload),
  stageTerminalImages: (payload) => ipcRenderer.invoke("terminal:stage-images", payload),
  stageTerminalImageData: (payload) => ipcRenderer.invoke("terminal:stage-image-data", payload),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  writeTerminal: (payload) => ipcRenderer.invoke("terminal:write", payload),
  getTerminalSize: (sessionId) => ipcRenderer.invoke("terminal:size", sessionId),
  resizeTerminal: (payload) => ipcRenderer.invoke("terminal:resize", payload),
  readAgentTranscript: (payload) => ipcRenderer.invoke("agent-transcript:read", payload),
  startAgentMirror: (payload) => ipcRenderer.invoke("agent-mirror:start", payload),
  stopAgentMirror: (sessionId) => ipcRenderer.invoke("agent-mirror:stop", sessionId),
  detachTerminal: (sessionId) => ipcRenderer.invoke("terminal:detach", sessionId),
  onAgentStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
  },
  onTerminalClosed: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:closed", listener);
    return () => ipcRenderer.removeListener("terminal:closed", listener);
  },
  reportLongTask: (durationMs) => ipcRenderer.send("diagnostics:long-task", { durationMs }),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onAgentCompleted: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:completed", listener);
    return () => ipcRenderer.removeListener("agent:completed", listener);
  },
  runSessionAction: (payload) => ipcRenderer.invoke("session:action", payload),

  // What an agent CLI can install, and installing it. Both go through the CLI
  // the agent already ships, so nothing here is a second source of truth.
  readSessionConversation: (payload) => ipcRenderer.invoke("session:conversation", payload),
  writeSessionHandoff: (payload) => ipcRenderer.invoke("session:handoff", payload),
  listAgentExtensions: (payload) => ipcRenderer.invoke("extensions:list", payload),
  searchMcpRegistry: (payload) => ipcRenderer.invoke("mcp:registry-search", payload),
  installMcpServer: (payload) => ipcRenderer.invoke("mcp:install-server", payload),
  changeAgentExtension: (payload) => ipcRenderer.invoke("extensions:change", payload),

  // Voice. Every entry is a request the renderer makes or a stream it reads —
  // the microphone, the recogniser and the capability handlers all stay in the
  // main process, so nothing here widens what the page itself can do.
  startVoice: (payload) => ipcRenderer.invoke("voice:start", payload),
  stopVoice: () => ipcRenderer.invoke("voice:stop"),
  voiceListenOnce: () => ipcRenderer.invoke("voice:listen-once"),
  submitVoiceText: (payload) => ipcRenderer.invoke("voice:submit-text", payload),
  confirmVoiceAction: () => ipcRenderer.invoke("voice:confirm"),
  cancelVoiceConfirmation: () => ipcRenderer.invoke("voice:cancel-confirmation"),
  stopVoiceSpeaking: () => ipcRenderer.invoke("voice:stop-speaking"),
  endVoiceTurn: () => ipcRenderer.invoke("voice:end-turn"),
  getVoiceStatus: () => ipcRenderer.invoke("voice:status"),
  listVoices: () => ipcRenderer.invoke("voice:list-voices"),
  setVoice: (payload) => ipcRenderer.invoke("voice:set-voice", payload),
  previewVoice: (payload) => ipcRenderer.invoke("voice:preview-voice", payload),
  listCapabilities: () => ipcRenderer.invoke("voice:capabilities"),
  runCapability: (payload) => ipcRenderer.invoke("voice:run-capability", payload),
  rememberNote: (payload) => ipcRenderer.invoke("voice:remember", payload),
  getVoiceHistory: () => ipcRenderer.invoke("voice:history"),
  onVoiceEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("voice:event", listener);
    return () => ipcRenderer.removeListener("voice:event", listener);
  },
  // Capabilities whose state lives in the React app are executed here and the
  // result is sent back. The renderer answers requests; it never initiates.
  onVoiceRendererCall: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("voice:renderer-call", listener);
    return () => ipcRenderer.removeListener("voice:renderer-call", listener);
  },
  respondToVoiceCall: (payload) => ipcRenderer.send("voice:renderer-result", payload),
});
