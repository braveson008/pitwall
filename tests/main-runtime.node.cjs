const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRuntimeJournal } = require("../electron/lib/runtimeJournal.cjs");
const {
  applyInitialPromptLaunch,
  applyNativeSessionLaunch,
  claudeProjectDirectory,
  findLatestClaudeSessionId,
} = require("../electron/lib/nativeSessions.cjs");
const {
  attachmentDirectory,
  stageTerminalImageData,
  stageTerminalImagePaths,
} = require("../electron/lib/terminalAttachments.cjs");
const { createGitHubCredentialStore } = require("../electron/lib/githubCredentials.cjs");
const {
  parseGhAccounts,
  parseGitHubRemote,
  resolveAccountActivation,
  tokenFromGitHubRemote,
} = require("../electron/lib/githubAuth.cjs");
const {
  claudeMcpConfig,
  codexMcpArgs,
  createMcpAuthProfileStore,
  kimiMcpConfig,
  mergeMcpAuthProfiles,
  borrowedTrackerServers,
} = require("../electron/lib/mcpAuthProfiles.cjs");
const { runPtyShell, stripTerminalOutput, summarizeCommandFailure } = require("../electron/lib/ptyCommand.cjs");
const { normalizePreviewUrl } = require("../electron/lib/preview.cjs");
const { resolveNewProjectPath } = require("../electron/lib/projectFolder.cjs");
const {
  claudeCompletionArgs,
  codexCompletionArgs,
  curlCompletionCommand,
  isCodexSideTurn,
  completionEndpoint,
  geminiCompletionSettings,
  grokCompletionHooks,
  kimiCompletionConfig,
  normalizeAgentProvider,
  terminalCompletionSignal,
} = require("../electron/lib/agentNotifications.cjs");
const { isManagedWorktree, managedWorktreePath, parseWorktreeList, resolveWorktreeTarget } = require("../electron/lib/worktrees.cjs");
const { parseKimiMcpList } = require("../electron/lib/mcpParse.cjs");
const {
  compareVersions,
  getProviderCompatibility,
  parseCliVersion,
  supportsNativeLaunchOptions,
} = require("../electron/lib/providerCompatibility.cjs");

test("provider compatibility gates native hooks by installed CLI version", () => {
  assert.equal(parseCliVersion("gemini 0.26.1"), "0.26.1");
  assert.equal(parseCliVersion("kimi, version 1.45.0-beta.1"), "1.45.0");
  assert.equal(compareVersions("1.20.0", "1.19.9"), 1);
  assert.equal(getProviderCompatibility("gemini", "0.25.0").completionMode, "fallback");
  assert.equal(getProviderCompatibility("gemini", "0.26.0").completionEvent, "AfterAgent");
  assert.equal(getProviderCompatibility("kimi", "1.45.0").completionMode, "native");
  assert.equal(getProviderCompatibility("custom-agent", "1.0.0").completionMode, "fallback");
  assert.equal(getProviderCompatibility("claude", null, false).completionMode, "unavailable");
  assert.equal(supportsNativeLaunchOptions("claude", "--settings <file-or-json>"), true);
  assert.equal(supportsNativeLaunchOptions("claude", "--model <name>"), false);
  assert.equal(supportsNativeLaunchOptions("codex", "  -c, --config <key=value>"), true);
  assert.equal(supportsNativeLaunchOptions("kimi", "--config-file PATH"), true);
});

test("Kimi MCP output preserves transport and authentication state", () => {
  assert.deepEqual(
    parseKimiMcpList(
      "MCP config file: /tmp/mcp.json\nlinear (http): https://mcp.linear.app/mcp [authorization required - run: kimi mcp auth linear]\nfiles (stdio): npx -y server .\n",
    ),
    [
      { name: "linear", target: "https://mcp.linear.app/mcp", transport: "HTTP", status: "needs-auth", statusText: "authorization required - run: kimi mcp auth linear" },
      { name: "files", target: "npx -y server .", transport: "STDIO", status: "configured", statusText: "Configured" },
    ],
  );
});

test("runtime journal reports only interrupted resources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-journal-"));
  const file = path.join(root, "runtime-state.json");
  const first = createRuntimeJournal(file);
  assert.equal(first.beginStartup().recovered, false);
  first.registerTerminal({
    sessionId: "session-a",
    projectId: "project-a",
    projectPath: "/tmp/a",
    agent: "Claude",
    nativeSessionId: "11111111-1111-4111-8111-111111111111",
  });

  const afterCrash = createRuntimeJournal(file);
  const recovery = afterCrash.beginStartup();
  assert.equal(recovery.recovered, true);
  assert.deepEqual(recovery.terminals.map((item) => item.sessionId), ["session-a"]);
  assert.equal(recovery.terminals[0].nativeSessionId, "11111111-1111-4111-8111-111111111111");
  afterCrash.registerTerminal({ sessionId: "session-a", projectId: "project-a", projectPath: "/tmp/a", agent: "Codex" });
  afterCrash.markCleanShutdown();

  const cleanRestart = createRuntimeJournal(file);
  const restored = cleanRestart.beginStartup();
  assert.equal(restored.recovered, false);
  assert.equal(restored.restorable, true);
  assert.deepEqual(restored.terminals.map((item) => item.sessionId), ["session-a"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Claude sessions use stable native ids and migrate the latest worktree conversation", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-claude-session-"));
  const cwd = path.join(home, "project with spaces");
  const directory = claudeProjectDirectory(cwd, home);
  const older = "11111111-1111-4111-8111-111111111111";
  const latest = "22222222-2222-4222-8222-222222222222";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${older}.jsonl`), "{}\n");
  fs.writeFileSync(path.join(directory, `${latest}.jsonl`), "{}\n");
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(directory, `${older}.jsonl`), now - 10, now - 10);
  fs.utimesSync(path.join(directory, `${latest}.jsonl`), now, now);

  assert.equal(findLatestClaudeSessionId(cwd, home), latest);
  assert.deepEqual(
    applyNativeSessionLaunch(
      { command: "claude", args: ["--model", "opus"], display: "claude --model opus" },
      { agent: "Claude", sessionName: "Implementation", nativeSessionId: older },
      cwd,
      home,
    ),
    {
      command: "claude",
      args: ["--session-id", older, "--name", "Implementation", "--model", "opus"],
      display: `claude --session-id ${older} --name Implementation --model opus`,
      nativeSessionId: older,
      nativeSessionMode: "create",
    },
  );
  const migrated = applyNativeSessionLaunch(
    { command: "claude", args: [], display: "claude" },
    { agent: "Claude", resumeSession: true },
    cwd,
    home,
  );
  assert.equal(migrated.nativeSessionId, latest);
  assert.deepEqual(migrated.args, ["--resume", latest]);
  assert.equal(migrated.nativeSessionMode, "resume");
  fs.rmSync(home, { recursive: true, force: true });
});

test("Claude and Codex receive their first task as a launch argument without exposing it in the display command", () => {
  const prompt = "Work on task WEB-815: fix the results page.";
  for (const agent of ["Claude", "Codex"]) {
    const launch = applyInitialPromptLaunch(
      { command: agent.toLowerCase(), args: ["--model", "test"], display: `${agent.toLowerCase()} --model test` },
      { agent, initialPrompt: prompt },
    );
    assert.deepEqual(launch.args, ["--model", "test", prompt]);
    assert.equal(launch.display.includes(prompt), false);
    assert.equal(launch.initialPromptMode, "argument");
  }

  const custom = applyInitialPromptLaunch(
    { command: "/bin/zsh", args: ["-f"], display: "/bin/zsh -f" },
    { agent: "Smoke Shell", initialPrompt: prompt },
  );
  assert.deepEqual(custom.args, ["-f"]);
  assert.equal(custom.initialPromptMode, "terminal");
});

test("terminal images are copied out of temporary paths and clipboard data is persisted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-terminal-images-"));
  const source = path.join(root, "ephemeral-source", "NSIRD-test", "Screenshot with spaces.png");
  const storage = path.join(root, "user-data", "terminal-attachments");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const selected = await stageTerminalImagePaths({
    rootDirectory: storage,
    sessionId: "session/a",
    paths: [source],
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.paths.length, 1);
  assert.equal(path.dirname(selected.paths[0]), attachmentDirectory(storage, "session/a"));
  fs.rmSync(source, { force: true });
  assert.deepEqual(fs.readFileSync(selected.paths[0]), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const pasted = await stageTerminalImageData({
    rootDirectory: storage,
    sessionId: "session/a",
    images: [{
      name: "clipboard-shot",
      type: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }],
  });
  assert.equal(pasted.ok, true);
  assert.equal(pasted.paths.length, 1);
  assert.match(pasted.paths[0], /clipboard-shot\.png$/);
  assert.deepEqual(fs.readFileSync(pasted.paths[0]), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const rejected = await stageTerminalImagePaths({
    rootDirectory: storage,
    sessionId: "session/a",
    paths: [path.join(root, "not-an-image.txt")],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.paths.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("project GitHub tokens are encrypted and resolved without exposing them in status", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-github-auth-"));
  const file = path.join(root, "github-credentials.json");
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, ""),
  };
  const store = createGitHubCredentialStore(file, encryption);
  const status = store.remember({
    projectId: "project-a",
    projectPath: "/tmp/a",
    host: "github.com",
    login: "octocat",
    token: "github-secret-token",
  });

  assert.equal(status.configured, true);
  assert.equal(status.login, "octocat");
  assert.equal("token" in status, false);
  assert.equal(fs.readFileSync(file, "utf8").includes("github-secret-token"), false);
  const environment = store.getEnvironment({ projectId: "project-a" });
  assert.equal(environment.GH_TOKEN, "github-secret-token");
  assert.equal(environment.GITHUB_TOKEN, "github-secret-token");
  assert.equal(environment.PITWALL_GITHUB_TOKEN, "github-secret-token");
  assert.equal(environment.GIT_CONFIG_KEY_0, "credential.https://github.com.helper");
  assert.equal(environment.GIT_CONFIG_VALUE_0, "");
  assert.match(environment.GIT_CONFIG_VALUE_1, /PITWALL_GITHUB_TOKEN/);
  const credential = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\npath=owner/repository.git\n\n",
    encoding: "utf8",
    env: { ...process.env, ...environment, GIT_TERMINAL_PROMPT: "0" },
  });
  assert.equal(credential.status, 0);
  assert.match(credential.stdout, /username=x-access-token/);
  assert.match(credential.stdout, /password=github-secret-token/);
  store.remember({
    projectId: "project-b",
    projectPath: "/tmp/b",
    host: "github.com",
    login: "hubot",
    token: "different-project-token",
    source: "manual",
  });
  assert.equal(store.getEnvironment({ projectId: "project-a" }).GH_TOKEN, "github-secret-token");
  assert.equal(store.getEnvironment({ projectId: "project-b" }).GH_TOKEN, "different-project-token");
  assert.equal(store.getStatus({ projectId: "project-b" }).login, "hubot");
  assert.equal(store.getStatus({ projectId: "project-b" }).source, "manual");
  assert.equal(store.forget({ projectId: "project-a" }).configured, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("GitHub remotes and stored gh accounts retain repository identity", () => {
  assert.deepEqual(parseGitHubRemote("git@github.com:acme-co/web-app.git"), {
    host: "github.com",
    repository: "acme-co/web-app",
    protocol: "ssh",
  });
  assert.deepEqual(parseGitHubRemote("https://github.example.com/acme-co/web-app.git"), {
    host: "github.example.com",
    repository: "acme-co/web-app",
    protocol: "https",
  });
  const credentialRemote = "https://someone:secret-token@github.com/acme-co/web-app.git";
  assert.deepEqual(parseGitHubRemote(credentialRemote), {
    host: "github.com",
    repository: "acme-co/web-app",
    protocol: "https",
  });
  assert.equal(tokenFromGitHubRemote(credentialRemote), "secret-token");
  assert.equal(JSON.stringify(parseGitHubRemote(credentialRemote)).includes("secret-token"), false);
  assert.deepEqual(
    parseGhAccounts(
      JSON.stringify({
        hosts: {
          "github.com": [
            { state: "success", active: false, login: "teammate" },
            { state: "failed", active: true, login: "expired-user" },
          ],
        },
      }),
      "github.com",
    ),
    [{ login: "teammate", active: false }],
  );
});

test("MCP OAuth bindings stay isolated by project and provider alias", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-mcp-auth-"));
  const file = path.join(root, "mcp-auth-profiles.json");
  const store = createMcpAuthProfileStore(file);
  const first = store.upsert({
    projectId: "project-a",
    projectPath: "/tmp/a",
    provider: "claude",
    name: "figma",
    target: "https://mcp.figma.com/mcp",
    transport: "HTTP",
  });
  const second = store.upsert({
    projectId: "project-b",
    projectPath: "/tmp/b",
    provider: "claude",
    name: "figma",
    target: "https://mcp.figma.com/mcp",
    transport: "HTTP",
  });
  assert.notEqual(first.alias, second.alias);
  assert.deepEqual(claudeMcpConfig([first]), {
    mcpServers: {
      [first.alias]: { type: "http", url: "https://mcp.figma.com/mcp" },
    },
  });
  const codexArgs = codexMcpArgs([{ ...first, provider: "codex", name: "jira" }]);
  assert.equal(codexArgs.includes(`mcp_servers.${first.alias}.url="https://mcp.figma.com/mcp"`), true);
  assert.equal(codexArgs.includes("mcp_servers.jira.enabled=false"), true);
  assert.deepEqual(kimiMcpConfig([{ ...first, provider: "kimi" }]), {
    mcpServers: {
      [first.alias]: { url: first.target, transport: "http", auth: "oauth" },
    },
  });
  assert.equal(store.markAuthenticated({ projectId: "project-a", provider: "claude", name: "figma" }).authenticatedAt !== null, true);
  assert.equal(createMcpAuthProfileStore(file).list({ projectId: "project-a" })[0].authenticatedAt !== null, true);
  assert.equal(store.setScope({ projectId: "project-a", provider: "claude", name: "figma", scope: "  SHOP  " }).scope, "SHOP");
  store.upsert({ projectId: "project-a", projectPath: "/tmp/a", provider: "claude", name: "figma", target: "https://mcp.figma.com/mcp" });
  assert.equal(createMcpAuthProfileStore(file).list({ projectId: "project-a" })[0].scope, "SHOP");
  assert.equal(store.list({ projectId: "project-b" })[0].scope, undefined);
  assert.equal(store.forget({ projectId: "project-a", provider: "claude", name: "figma" }), true);
  assert.equal(store.list({ projectId: "project-a" }).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("an MCP alias stored by an older version is kept, never regenerated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-mcp-legacy-"));
  const file = path.join(root, "mcp-auth-profiles.json");
  const legacy = {
    provider: "claude",
    name: "linear",
    alias: "braveli_linear_3eb8a846c6",
    target: "https://mcp.linear.app/mcp",
    transport: "HTTP",
    authenticatedAt: "2026-08-20T00:00:00.000Z",
  };
  fs.writeFileSync(file, JSON.stringify({ version: 1, projects: { "project-a": { projectId: "project-a", projectPath: "/tmp/a", bindings: [legacy] } } }));
  const store = createMcpAuthProfileStore(file);
  const again = store.upsert({ projectId: "project-a", projectPath: "/tmp/a", provider: "claude", name: "linear", target: legacy.target });
  assert.equal(again.alias, legacy.alias);
  assert.equal(again.authenticatedAt, legacy.authenticatedAt);
  assert.equal(createMcpAuthProfileStore(file).list({ projectId: "project-a" })[0].alias, legacy.alias);
  // A different server is a different login, and gets an alias of its own.
  const moved = store.upsert({ projectId: "project-a", projectPath: "/tmp/a", provider: "claude", name: "linear", target: "https://mcp.linear.app/sse" });
  assert.match(moved.alias, /^pitwall_linear_[0-9a-f]{10}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("authenticated project MCP profiles use the live private-alias status", () => {
  const discovered = [
    { name: "linear", target: "https://mcp.linear.app/mcp", transport: "HTTP", status: "needs-auth", statusText: "Needs authentication" },
    { name: "pitwall_linear_private", target: "https://mcp.linear.app/mcp", transport: "HTTP", status: "connected", statusText: "Connected" },
    { name: "figma", target: "https://mcp.figma.com/mcp", transport: "HTTP", status: "connected", statusText: "Connected" },
  ];
  const profiles = [{
    name: "linear",
    alias: "pitwall_linear_private",
    target: "https://mcp.linear.app/mcp",
    transport: "http",
    authenticatedAt: "2026-08-17T00:00:00.000Z",
  }];
  assert.deepEqual(mergeMcpAuthProfiles(discovered, profiles), [
    { name: "linear", target: "https://mcp.linear.app/mcp", transport: "HTTP", status: "connected", statusText: "Connected" },
    { name: "figma", target: "https://mcp.figma.com/mcp", transport: "HTTP", status: "connected", statusText: "Connected" },
  ]);
});

test("agents never see a tracker logged in for another project", () => {
  const servers = [
    { name: "atlassian", target: "https://mcp.atlassian.com/v2/mcp", transport: "HTTP" },
    { name: "pitwall_atlassian_mine", target: "https://mcp.atlassian.com/v2/mcp", transport: "HTTP" },
    { name: "pitwall_linear_other", target: "https://mcp.linear.app/mcp", transport: "HTTP" },
    { name: "figma", target: "https://mcp.figma.com/mcp", transport: "HTTP" },
    { name: "jira-local", target: "npx jira-server", transport: "STDIO" },
  ];
  const bindings = [{ name: "atlassian", alias: "pitwall_atlassian_mine" }];
  assert.deepEqual(borrowedTrackerServers(servers, bindings), ["atlassian", "pitwall_linear_other"]);
  assert.deepEqual(borrowedTrackerServers(servers, []), ["atlassian", "pitwall_atlassian_mine", "pitwall_linear_other"]);
});

test("interactive OAuth commands run inside a PTY and preserve actionable failures", async () => {
  const fakePty = {
    spawn(_shell, _args, options) {
      let onData = () => {};
      let onExit = () => {};
      setImmediate(() => {
        onData("\u001b[31mWaiting for browser authentication\u001b[0m\r\n");
        onExit({ exitCode: 0, signal: 0 });
      });
      return {
        onData(listener) {
          onData = listener;
        },
        onExit(listener) {
          onExit = listener;
        },
        kill() {},
        options,
      };
    },
  };
  const result = await runPtyShell(fakePty, "provider mcp login project_alias", {
    cwd: "/tmp/project",
    env: { PATH: "/usr/bin" },
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(stripTerminalOutput(result.stdout), "Waiting for browser authentication");
  assert.equal(
    summarizeCommandFailure({ stderr: "", stdout: "Starting authentication\nToken exchange was rejected" }),
    "Starting authentication Token exchange was rejected",
  );
});

test("managed worktree paths stay below the Pitwall worktree root", () => {
  const target = managedWorktreePath("/tmp/profile", "/tmp/project", "codex/task-auth");
  assert.equal(isManagedWorktree("/tmp/profile", "/tmp/project", target), true);
  assert.equal(isManagedWorktree("/tmp/profile", "/tmp/project", "/tmp/project"), false);
});

test("git worktree porcelain output is parsed without display heuristics", () => {
  const parsed = parseWorktreeList(
    "worktree /tmp/main\nHEAD abc123\nbranch refs/heads/main\n\nworktree /tmp/task\nHEAD def456\nbranch refs/heads/task/auth\n\n",
  );
  assert.deepEqual(parsed.map(({ path: worktreePath, branch }) => ({ path: worktreePath, branch })), [
    { path: "/tmp/main", branch: "main" },
    { path: "/tmp/task", branch: "task/auth" },
  ]);
});

test("an occupied worktree directory is reused instead of dead-ending the session", () => {
  // The directory is named from a slug of the branch at creation time, but the
  // branch inside it can be renamed or switched afterwards. Looking it up by
  // exact branch then finds nothing while the path is taken, which used to be
  // an error with no way forward.
  const worktrees = [
    { path: "/repo", branch: "main", detached: false },
    { path: "/wt/web-702", branch: "web-702-699-integration", detached: false },
  ];

  assert.deepEqual(
    resolveWorktreeTarget({ branch: "web-702", worktrees, targetPath: "/wt/web-702", targetExists: true }),
    { action: "reuse", path: "/wt/web-702", branch: "web-702-699-integration", requestedBranch: "web-702" },
  );

  // An exact branch match wins, and keeps whatever path that worktree lives at.
  assert.deepEqual(
    resolveWorktreeTarget({ branch: "web-702-699-integration", worktrees, targetPath: "/wt/other", targetExists: false }),
    { action: "reuse", path: "/wt/web-702", branch: "web-702-699-integration", requestedBranch: "web-702-699-integration" },
  );

  assert.deepEqual(
    resolveWorktreeTarget({ branch: "web-999", worktrees, targetPath: "/wt/web-999", targetExists: false }),
    { action: "create", path: "/wt/web-999", branch: "web-999", requestedBranch: "web-999" },
  );
});

test("a directory that is not a checkout cannot be reused, and says so", () => {
  const worktrees = [{ path: "/repo", branch: "main", detached: false }];
  const result = resolveWorktreeTarget({ branch: "web-702", worktrees, targetPath: "/wt/web-702", targetExists: true });
  assert.equal(result.action, "blocked");
  assert.match(result.reason, /not a Git worktree/);
  assert.match(result.reason, /\/wt\/web-702/);
});

test("worktree paths are compared as paths, not as strings", () => {
  const worktrees = [{ path: "/wt/web-702/", branch: "feature", detached: false }];
  assert.equal(
    resolveWorktreeTarget({ branch: "web-702", worktrees, targetPath: "/wt/./web-702", targetExists: true }).action,
    "reuse",
  );
});

test("a detached worktree at the target path is reported as detached, not as a branch", () => {
  const worktrees = [{ path: "/wt/web-702", branch: "", detached: true }];
  const result = resolveWorktreeTarget({ branch: "web-702", worktrees, targetPath: "/wt/web-702", targetExists: true });
  assert.equal(result.action, "reuse");
  assert.equal(result.branch, "");
  assert.equal(result.detached, true);
});

test("opening a project selects the GitHub account that project belongs to", () => {
  const accounts = [
    { login: "someone_work", active: true },
    { login: "braveson008", active: false },
  ];

  // The account is on the machine but not the active one: the project uses it
  // through its own token, and the machine's active account is not switched.
  assert.deepEqual(
    resolveAccountActivation({ record: { login: "braveson008", hasToken: true }, accounts }),
    { action: "scoped", login: "braveson008" },
  );

  // Already active: the same, so opening projects never churns the machine's login.
  assert.deepEqual(
    resolveAccountActivation({ record: { login: "someone_work", hasToken: true }, accounts }),
    { action: "scoped", login: "someone_work" },
  );
});

test("an account Pitwall holds a token for but the machine does not know is logged in first", () => {
  const result = resolveAccountActivation({
    record: { login: "someone-else", hasToken: true },
    accounts: [{ login: "braveson008", active: true }],
  });
  assert.deepEqual(result, { action: "login", login: "someone-else" });
});

test("a project with no credential is left alone and asked about", () => {
  // Changing the machine's account without knowing which one the project wants
  // is the behaviour this feature exists to stop.
  assert.deepEqual(
    resolveAccountActivation({ record: null, accounts: [{ login: "braveson008", active: true }] }),
    { action: "prompt", reason: "unconfigured" },
  );

  // Nothing to switch to and nothing to log in with.
  assert.deepEqual(
    resolveAccountActivation({ record: { login: "ghost", hasToken: false }, accounts: [] }),
    { action: "prompt", reason: "unusable" },
  );
});

test("a credential the user refused is still refused", () => {
  // markRejected means Pitwall stands aside and lets the agent's own login be
  // used; taking over the machine's account would override that.
  assert.deepEqual(
    resolveAccountActivation({
      record: { login: "braveson008", hasToken: true, rejectedAt: "2026-09-01T00:00:00.000Z" },
      accounts: [{ login: "other", active: true }],
    }),
    { action: "none", reason: "rejected" },
  );
});

test("preview URLs are normalized before they reach the browser", () => {
  assert.equal(normalizePreviewUrl("localhost:5173/app"), "http://localhost:5173/app");
  assert.equal(normalizePreviewUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizePreviewUrl("exp://192.168.1.20:8081"), "exp://192.168.1.20:8081");
  // shell.openExternal hands the URL to the OS, so anything that is not HTTP(S)
  // has to be refused here rather than by whatever would handle the scheme.
  assert.throws(() => normalizePreviewUrl("file:///tmp/index.html"), /HTTP, HTTPS, and Expo/);
  assert.throws(() => normalizePreviewUrl("  "), /Enter a preview URL/);
});

test("agent completion adapters preserve provider-native lifecycle signals", () => {
  const endpoint = completionEndpoint({
    port: 43123,
    token: "secret-token",
    projectId: "project a",
    sessionId: "session/one",
    provider: "claude",
  });
  assert.match(endpoint, /^http:\/\/127\.0\.0\.1:43123\/agent-complete\?/);
  assert.match(endpoint, /projectId=project\+a/);
  assert.match(endpoint, /sessionId=session%2Fone/);

  const claudeSettings = JSON.parse(claudeCompletionArgs(endpoint)[1]);
  assert.equal(claudeSettings.hooks.Stop[0].hooks[0].url, endpoint);

  const codexArgs = codexCompletionArgs(endpoint);
  assert.deepEqual(codexArgs.slice(0, 1), ["-c"]);
  assert.match(codexArgs[1], /^notify=/);
  assert.match(codexArgs[1], /agent-complete/);

  const gemini = geminiCompletionSettings({ hooks: { BeforeAgent: [{ hooks: [] }] } }, endpoint);
  assert.equal(gemini.hooks.BeforeAgent.length, 1);
  assert.equal(gemini.hooks.AfterAgent[0].hooks[0].name, "pitwall-turn-complete");

  const kimi = kimiCompletionConfig('default_model = "kimi-for-coding"\n', endpoint);
  assert.match(kimi, /\[\[hooks\]\]\nevent = "Stop"/);
  assert.match(kimi, /default_model = "kimi-for-coding"/);

  assert.equal(grokCompletionHooks(endpoint).hooks.Stop[0].hooks[0].type, "http");
});

test("Codex's own title-writing turn is not taken for the agent finishing", () => {
  const real = { type: "agent-turn-complete", "thread-id": "a", "input-messages": ["Reply with the single word ok."], "last-assistant-message": "ok" };
  const title = {
    type: "agent-turn-complete",
    "thread-id": "b",
    "input-messages": ["Generate a concise, single-line task title of at most 36 characters and under five words"],
    "last-assistant-message": '{"title":"Reply ok"}',
  };
  assert.equal(isCodexSideTurn(real), false);
  assert.equal(isCodexSideTurn(title), true);
  assert.equal(isCodexSideTurn({ ...title, "input-messages": ["Reworded by a later Codex"] }), true);
  assert.equal(isCodexSideTurn({ ...real, "last-assistant-message": '{"title":"x","body":"real json answer"}' }), false);
});

test("shell completion hooks deliver the whole endpoint, not the part before the first &", async () => {
  const http = require("node:http");
  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { received.push({ url: request.url, body }); response.writeHead(204).end(); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = completionEndpoint({ port: server.address().port, token: "t0k", projectId: "p1", sessionId: "s1", provider: "codex" });
  const run = (file, args, input) => new Promise((resolve) => {
    const child = require("node:child_process").execFile(file, args, () => resolve());
    if (input) child.stdin.end(input);
  });
  try {
    const notify = JSON.parse(codexCompletionArgs(endpoint)[1].slice("notify=".length));
    await run(notify[0], [...notify.slice(1), '{"type":"agent-turn-complete"}']);
    await run("/bin/sh", ["-c", curlCompletionCommand(endpoint)], '{"hook":"stop"}');
    assert.equal(received.length, 2);
    for (const { url } of received) {
      const query = new URL(url, "http://127.0.0.1").searchParams;
      assert.deepEqual([query.get("token"), query.get("projectId"), query.get("sessionId"), query.get("provider")], ["t0k", "p1", "s1", "codex"]);
    }
    assert.equal(received[0].body, '{"type":"agent-turn-complete"}');
  } finally {
    server.close();
  }
});

test("completion adapters detect built-ins, Kimi custom agents, and terminal protocols", () => {
  assert.equal(normalizeAgentProvider({ agent: "Claude" }, { command: "claude" }), "claude");
  assert.equal(normalizeAgentProvider({ agent: "Kimi K3" }, { command: "/opt/bin/kimi" }), "kimi");
  assert.equal(normalizeAgentProvider({ agent: "Local" }, { command: "/bin/zsh" }), "custom");
  assert.equal(terminalCompletionSignal("\u001b]777;notify;Grok;Turn complete\u001b\\", "grok"), true);
  assert.equal(terminalCompletionSignal("\u001b]9;4;0;0\u0007", "grok"), true);
  assert.equal(terminalCompletionSignal("\u0007", "custom"), false);
});

test("new project folders resolve inside the chosen parent or are rejected", () => {
  const parent = path.join(os.tmpdir(), "pitwall-parent");

  const ok = resolveNewProjectPath({ parentPath: parent, folderName: "my-todo-app" });
  assert.equal(ok.ok, true);
  assert.equal(ok.path, path.join(parent, "my-todo-app"));
  assert.equal(ok.parent, parent);

  // A crafted name must never escape the directory the user picked.
  for (const folderName of ["../escape", "..", "a/b", "/etc", "./x", ".hidden", "Upper", "has space", ""]) {
    const result = resolveNewProjectPath({ parentPath: parent, folderName });
    assert.equal(result.ok, false, `expected ${JSON.stringify(folderName)} to be rejected`);
    assert.ok(result.error);
  }

  assert.equal(resolveNewProjectPath({ parentPath: "", folderName: "app" }).ok, false);
  assert.equal(resolveNewProjectPath({ parentPath: "   ", folderName: "app" }).ok, false);

  // 64 characters is the limit; 65 is not.
  assert.equal(resolveNewProjectPath({ parentPath: parent, folderName: "a".repeat(64) }).ok, true);
  assert.equal(resolveNewProjectPath({ parentPath: parent, folderName: "a".repeat(65) }).ok, false);

  // expandHome is applied to the parent before resolution.
  const expanded = resolveNewProjectPath({
    parentPath: "~/Projects",
    folderName: "app",
    expandHome: (value) => value.replace(/^~/, "/Users/test"),
  });
  assert.equal(expanded.path, path.join("/Users/test/Projects", "app"));
});
