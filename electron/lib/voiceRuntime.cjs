/**
 * Assembles the voice stack and exposes it over IPC.
 *
 * `main.cjs` is already 3k lines, and `ARCHITECTURE.md` calls for splitting it
 * by domain rather than continuing to grow it, so voice arrives as one module
 * that main wires up in a few lines. Everything privileged it needs — the
 * shell helpers, the git runner, the test runner — is injected rather than
 * re-implemented, so there is exactly one definition of "run a git command"
 * in the app.
 */

const fs = require("node:fs");
const path = require("node:path");

const { createCapabilityRegistry } = require("./capabilityRegistry.cjs");
const { createCapabilityCatalog } = require("./capabilityCatalog.cjs");
const { createOsControl, remoteToWebUrl, matchApplication } = require("./osControl.cjs");
const { resolveApp, bestChannel, describeReach } = require("./appDirectory.cjs");
const { buildPickTaskPrompt, parsePickedTask, describePickedTask } = require("./trackerTasks.cjs");
const { createScreenContext } = require("./screenContext.cjs");
const { createMemoryStore } = require("./memoryStore.cjs");
const { createVoiceOrchestrator } = require("./voiceOrchestrator.cjs");
const { VoiceSidecar, resolveSidecarPath } = require("./voiceSidecar.cjs");
const { routeIntent } = require("./intentRouter.cjs");
const {
  PRESETS,
  DEFAULT_PRESET,
  describeVoiceQuality,
  pickDefaultVoice,
  rankVoices,
  toSidecarConfig,
} = require("./voicePresets.cjs");

const RENDERER_CALL_TIMEOUT_MS = 25_000;

/**
 * How long the user must stop speaking before the utterance is treated as
 * finished. The daemon requires the microphone to be quiet *and* the transcript
 * to have stopped changing for this whole window, and it is that second
 * condition — not a generous timeout — which stops trailing words being cut
 * off. Three seconds was covering for the routing latency that used to follow
 * it; with routing usually instant, the wait is what the user feels.
 */
const DEFAULT_SILENCE_TIMEOUT = 1.5;

function observerBinaryPath(options = {}) {
  const candidates = [
    process.env.BRAVELI_VOICE_OBSERVER,
    options.resourcesPath ? path.join(options.resourcesPath, "voice", "braveli-observe") : null,
    path.join(__dirname, "..", "voice", "bin", "braveli-observe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Next.
    }
  }
  return null;
}

/**
 * The git capabilities, as a factory so they can be exercised against a real
 * repository in tests.
 *
 * The undo handlers are the reason this is not an inline object any more: each
 * one refuses in situations where reversing would destroy work rather than
 * restore it, and a refusal that has never been executed is a comment, not a
 * safeguard.
 */
function createGitCapabilities({ runGit, runConductor, osControl, projectPathFrom }) {
  const git = {
    async status(context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      const result = await runGit(["status", "--porcelain=v1", "--branch"], cwd);
      if (!result.ok) return { ok: false, error: result.stderr.trim(), speak: "That project isn't a git repository." };

      const lines = result.stdout.split("\n").filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("##")) || "";
      const branch = branchLine.replace(/^##\s*/, "").split("...")[0].trim() || "unknown";
      const changes = lines.filter((line) => !line.startsWith("##"));
      const staged = changes.filter((line) => line[0] !== " " && line[0] !== "?").length;
      const modified = changes.filter((line) => line[1] === "M" || line[1] === "D").length;
      const untracked = changes.filter((line) => line.startsWith("??")).length;

      const parts = [];
      if (staged) parts.push(`${staged} staged`);
      if (modified) parts.push(`${modified} modified`);
      if (untracked) parts.push(`${untracked} untracked`);

      return {
        ok: true,
        branch,
        staged,
        modified,
        untracked,
        files: changes.slice(0, 40).map((line) => line.slice(3)),
        speak: changes.length
          ? `You're on ${branch} with ${parts.join(", ")}.`
          : `You're on ${branch} with a clean working tree.`,
      };
    },

    async diff(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      const args = ["diff", "--stat"];
      if (params.path) args.push("--", params.path);
      const stat = await runGit(args, cwd);
      if (!stat.ok) return { ok: false, error: stat.stderr.trim(), speak: "I couldn't read the diff." };
      if (!stat.stdout.trim()) return { ok: true, speak: "Nothing has changed since the last commit." };

      const full = await runGit(params.path ? ["diff", "--", params.path] : ["diff"], cwd);
      const summary = await runConductor(
        [
          "Summarize this git diff for someone listening, not reading. One to three sentences. No markdown, no file lists longer than three names.",
          "",
          stat.stdout,
          "",
          (full.stdout || "").slice(0, 12_000),
        ].join("\n"),
      );

      return {
        ok: true,
        stat: stat.stdout.trim(),
        speak: summary?.ok ? summary.raw.trim() : stat.stdout.trim().split("\n").pop(),
      };
    },

    async createBranch(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      // Spoken branch names arrive as prose. Slugify here so the shape of the
      // branch does not depend on how carefully the user enunciated.
      const name = params.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9/_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (!name) return { ok: false, speak: "That isn't a usable branch name." };

      // Captured before the checkout so the branch can be undone back to
      // wherever the user actually was, rather than to a guess like "main".
      const from = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

      const result = await runGit(["checkout", "-b", name], cwd);
      if (!result.ok) return { ok: false, error: result.stderr.trim(), speak: `I couldn't create ${name}. ${result.stderr.trim().split("\n")[0]}` };
      return {
        ok: true,
        branch: name,
        previousBranch: from.ok ? from.stdout.trim() : null,
        speak: `Created and switched to ${name}.`,
      };
    },

    /**
     * Delete a just-created branch and go back.
     *
     * Refuses whenever the branch stopped being empty or the user moved off it,
     * because at that point "undo" would be discarding work rather than
     * reversing a mistake. `git branch -d` (never `-D`) is the second line of
     * defence: it fails rather than dropping unmerged commits.
     */
    async undoCreateBranch(record, context) {
      const cwd = projectPathFrom(context);
      const name = record.result?.branch;
      const previous = record.result?.previousBranch;
      if (!cwd || !name) return { ok: false, speak: "I can't tell which branch to remove." };
      if (!previous) return { ok: false, speak: `I don't know which branch you were on before ${name}, so I've left it alone.` };

      const current = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      if (!current.ok || current.stdout.trim() !== name) {
        return { ok: false, speak: `You're not on ${name} any more, so I've left it alone.` };
      }

      const [tip, base] = await Promise.all([
        runGit(["rev-parse", name], cwd),
        runGit(["rev-parse", previous], cwd),
      ]);
      if (tip.ok && base.ok && tip.stdout.trim() !== base.stdout.trim()) {
        return { ok: false, speak: `${name} has commits on it now, so I've left it alone.` };
      }

      const back = await runGit(["checkout", previous], cwd);
      if (!back.ok) return { ok: false, error: back.stderr.trim(), speak: `I couldn't switch back to ${previous}.` };

      const removed = await runGit(["branch", "-d", name], cwd);
      if (!removed.ok) {
        return { ok: false, error: removed.stderr.trim(), speak: `You're back on ${previous}, but I couldn't delete ${name}.` };
      }
      return { ok: true, speak: `Deleted ${name}. You're back on ${previous}.` };
    },

    async commit(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      if (params.all !== false) {
        const staged = await runGit(["add", "-u"], cwd);
        if (!staged.ok) return { ok: false, error: staged.stderr.trim(), speak: "I couldn't stage your changes." };
      }
      const result = await runGit(["commit", "-m", params.message], cwd);
      if (!result.ok) {
        const reason = (result.stdout + result.stderr).includes("nothing to commit")
          ? "There was nothing to commit."
          : result.stderr.trim().split("\n")[0] || "The commit failed.";
        return { ok: false, error: reason, speak: reason };
      }
      const head = await runGit(["rev-parse", "HEAD"], cwd);
      return { ok: true, sha: head.ok ? head.stdout.trim() : null, speak: "Committed." };
    },

    /**
     * Reverse a commit with `git reset --soft`, which puts the working tree
     * back exactly as it was: changes staged, nothing lost.
     *
     * Three refusals, each one a case where resetting would destroy rather than
     * restore:
     *
     *  - HEAD moved. Something was committed after this, and `HEAD~1` no longer
     *    means the commit the user is talking about.
     *  - The commit is on a remote. Undoing it now needs a force push, which
     *    can erase work that was never this user's to erase.
     *  - It is the repository's first commit, so there is no parent to reset
     *    to. Deleting the root commit is a different and much sharper
     *    operation, and it is not what "undo that" should reach for.
     */
    async undoCommit(record, context) {
      const cwd = projectPathFrom(context);
      const sha = record.result?.sha;
      if (!cwd) return { ok: false, speak: "There's no active project." };
      if (!sha) return { ok: false, speak: "I don't have a record of which commit to undo." };

      const head = await runGit(["rev-parse", "HEAD"], cwd);
      if (!head.ok || head.stdout.trim() !== sha) {
        return { ok: false, speak: "Something has been committed since then, so I've left history alone." };
      }

      const remote = await runGit(["branch", "--remotes", "--contains", sha], cwd);
      if (remote.ok && remote.stdout.trim()) {
        return {
          ok: false,
          speak: "That commit has already been pushed. Undoing it would need a force push, so I've left it alone.",
        };
      }

      const parent = await runGit(["rev-parse", "--verify", `${sha}^`], cwd);
      if (!parent.ok) {
        return { ok: false, speak: "That's the first commit in the repository, so there's nothing to reset back to." };
      }

      const reset = await runGit(["reset", "--soft", "HEAD~1"], cwd);
      if (!reset.ok) return { ok: false, error: reset.stderr.trim(), speak: "I couldn't undo the commit." };
      return { ok: true, speak: "Undid the commit. Your changes are still staged." };
    },

    async push(context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      let result = await runGit(["push"], cwd);
      if (!result.ok && /has no upstream branch/i.test(result.stderr)) {
        result = await runGit(["push", "--set-upstream", "origin", "HEAD"], cwd);
      }
      if (!result.ok) {
        return { ok: false, error: result.stderr.trim(), speak: `The push failed. ${result.stderr.trim().split("\n")[0]}` };
      }
      return { ok: true, speak: "Pushed." };
    },

    async openRemote(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };

      const result = await runGit(["remote", "get-url", "origin"], cwd);
      if (!result.ok || !result.stdout.trim()) {
        return { ok: false, error: "no remote", speak: "This project has no remote to open." };
      }

      const url = remoteToWebUrl(result.stdout.trim());
      if (!url) return { ok: false, error: "unparseable remote", speak: "I couldn't work out the web address for this repo." };

      return osControl.openUrl({ url, browser: params.browser }, context);
    },

    async discardChanges(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      // Tracked files only. Deleting untracked files would take work git never
      // saw a copy of, which is unrecoverable in a way `git restore` is not.
      const target = params.path ? [params.path] : ["."];
      const result = await runGit(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...target], cwd);
      if (!result.ok) return { ok: false, error: result.stderr.trim(), speak: "I couldn't discard those changes." };
      return {
        ok: true,
        speak: params.path
          ? `Discarded your changes to ${params.path}. Untracked files were left alone.`
          : "Discarded your changes to tracked files. Untracked files were left alone.",
      };
    },
  };
  return git;
}

function createVoiceRuntime(deps) {
  const {
    ipcMain,
    getMainWindow,
    userDataPath,
    resourcesPath,
    runGit,
    runConductor,
    runProjectTests,
    listMcpServers,
    resolveProjectFile,
    shellEscape,
    log = () => {},
  } = deps;

  const memory = createMemoryStore(path.join(userDataPath, "voice-memory.json"));
  const sidecar = new VoiceSidecar({ resourcesPath });
  const registry = createCapabilityRegistry();

  // ------------------------------------------------------------ renderer calls

  const rendererCalls = new Map();
  let rendererCallSequence = 0;

  function callRenderer(capabilityId, params, context = {}) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return Promise.resolve({ ok: false, error: "Pitwall's window isn't open." });
    }

    const id = `rc-${++rendererCallSequence}`;
    return new Promise((resolve) => {
      // A renderer that never answers must not wedge the conversation — the
      // user is standing there waiting for a reply out loud.
      const timer = setTimeout(() => {
        rendererCalls.delete(id);
        resolve({ ok: false, error: `${capabilityId} timed out.` });
      }, RENDERER_CALL_TIMEOUT_MS);
      timer.unref?.();

      rendererCalls.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      const boundParams = capabilityId === "session.delete" ? {
        ...params,
        expectedProjectId: context.projectId ?? null,
        expectedProjectPath: context.projectPath ?? null,
        expectedSessionId: context.activeSessionId ?? null,
        expectedSessions: (context.sessions ?? []).map(({ id, name }) => ({ id, name })),
      } : params;
      window.webContents.send("voice:renderer-call", { id, capabilityId, params: boundParams });
    });
  }

  ipcMain.on("voice:renderer-result", (_event, payload) => {
    const resolver = rendererCalls.get(payload?.id);
    if (!resolver) return;
    rendererCalls.delete(payload.id);
    resolver(payload?.result ?? { ok: false, error: "The renderer returned nothing." });
  });

  const osControl = createOsControl();

  function projectPathFrom(context) {
    return context?.projectPath || null;
  }

  const git = createGitCapabilities({ runGit, runConductor, osControl, projectPathFrom });

  // ------------------------------------------------------------- work trackers

  /** Sites we know the address of, for trackers with no MCP server and no app. */
  const TRACKER_SITES = {
    linear: "https://linear.app",
    jira: "https://id.atlassian.com/login",
    github: "https://github.com/issues/assigned",
    gitlab: "https://gitlab.com/dashboard/issues",
    asana: "https://app.asana.com",
    trello: "https://trello.com",
    notion: "https://notion.so",
    sentry: "https://sentry.io",
  };

  async function resolveTracker(spoken, context) {
    const listed = typeof listMcpServers === "function"
      ? await listMcpServers("claude", projectPathFrom(context)).catch(() => null)
      : null;
    return resolveApp(spoken, {
      mcpServers: listed?.servers || [],
      installedApps: await osControl.listApplications().catch(() => []),
      sites: TRACKER_SITES,
      matchApplication,
    });
  }

  const tracker = {
    /**
     * Find the user's current work item and, by default, start a session on it.
     *
     * Degrades honestly rather than failing: with an MCP server it can answer
     * the question; with only the app installed it opens the app and says
     * plainly that it cannot read tickets. Both are useful; pretending the
     * second is the first is not.
     */
    async pickTask(params, context) {
      const source = String(params.source || "").trim();
      const resolved = await resolveTracker(source, context);
      if (!resolved) {
        return { ok: false, speak: `I don't know how to reach ${source || "that tracker"}.` };
      }

      const channel = bestChannel(resolved);
      if (!channel) {
        return { ok: false, speak: describeReach(resolved) };
      }

      // No MCP server: Pitwall can put the tracker in front of the user but
      // cannot read it. Saying so is the whole answer — opening a window and
      // reporting success would look like the request had been fulfilled.
      if (channel.kind !== "mcp") {
        const opened = channel.kind === "app"
          ? await osControl.launchApp({ name: channel.app }, context)
          : await osControl.openUrl({ url: channel.url }, context);
        return {
          ok: opened.ok !== false,
          openedOnly: true,
          speak: `${describeReach(resolved)} I've opened it — tell me which item to work on and I'll start a session.`,
        };
      }

      const reply = await runConductor(buildPickTaskPrompt({ source: resolved.name, hint: params.hint }), {
        mcpServer: channel.server,
        cwd: projectPathFrom(context),
      });
      if (!reply?.ok) {
        return { ok: false, speak: `I couldn't reach ${resolved.name}. ${reply?.error || ""}`.trim() };
      }

      const picked = parsePickedTask(reply.raw);
      if (!picked.ok) return { ok: false, speak: picked.why };

      const spokenTask = describePickedTask(picked.task, { source: resolved.name });
      if (params.startSession === false) {
        return { ok: true, task: picked.task, speak: spokenTask };
      }

      // Both this capability and session.start are guarded, so composing them
      // widens nothing. The ticket travels as the session's task — data the
      // agent is asked to work on — and never as instructions to the router.
      const started = await callRenderer("session.start", {
        task: { title: picked.task.title, description: picked.task.description || "", externalId: picked.task.id || "" },
        agent: params.agent,
      });
      if (!started?.ok) {
        return { ok: true, task: picked.task, speak: `${spokenTask} I couldn't start a session on it: ${started?.error || "the window didn't respond"}.` };
      }
      return {
        ok: true,
        task: picked.task,
        speak: `${spokenTask} I've started ${started.agent ? `a ${started.agent}` : "a"} session on it.`,
      };
    },
  };


  // ---------------------------------------------------------------- project

  const project = {
    async summarize(context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };

      const facts = [`Project directory: ${cwd}`];
      try {
        const manifest = JSON.parse(await fs.promises.readFile(path.join(cwd, "package.json"), "utf8"));
        facts.push(`Name: ${manifest.name}`, `Description: ${manifest.description || "(none)"}`);
        if (manifest.scripts) facts.push(`Scripts: ${Object.keys(manifest.scripts).join(", ")}`);
        const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
        if (dependencies.length) facts.push(`Dependencies: ${dependencies.slice(0, 40).join(", ")}`);
      } catch {
        facts.push("No package.json — this is not a Node project.");
      }

      try {
        const entries = await fs.promises.readdir(cwd, { withFileTypes: true });
        facts.push(
          `Top-level entries: ${entries
            .filter((entry) => !entry.name.startsWith("."))
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .slice(0, 40)
            .join(", ")}`,
        );
      } catch {
        // Directory listing is a nicety, not a requirement.
      }

      for (const readme of ["README.md", "readme.md", "ARCHITECTURE.md"]) {
        try {
          const contents = await fs.promises.readFile(path.join(cwd, readme), "utf8");
          facts.push(`${readme}:\n${contents.slice(0, 4000)}`);
          break;
        } catch {
          // Try the next candidate.
        }
      }

      const status = await git.status(context);
      if (status.ok) facts.push(`Git: on ${status.branch}, ${status.modified} modified, ${status.untracked} untracked`);

      const reply = await runConductor(
        [
          "Describe this software project to its developer, out loud. Say what it is, what it is built with, and how it is run.",
          "Two to four sentences. No markdown, no lists, no code.",
          "",
          facts.join("\n"),
        ].join("\n"),
      );

      if (!reply?.ok) return { ok: false, error: reply?.error, speak: "I couldn't summarize the project." };
      return { ok: true, speak: reply.raw.trim() };
    },

    async readFile(params, context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };
      let target;
      try {
        // Reuse main's resolver so voice cannot reach outside the project by a
        // path the rest of the app would have rejected.
        ({ target } = resolveProjectFile(cwd, params.path));
      } catch (error) {
        return { ok: false, error: error.message, speak: "That path is outside the project." };
      }

      let contents;
      try {
        contents = await fs.promises.readFile(target, "utf8");
      } catch {
        return { ok: false, error: "not found", speak: `I couldn't find ${params.path}.` };
      }

      const lines = contents.split("\n").slice(0, params.maxLines || 400);
      const reply = await runConductor(
        [
          `Explain what this file does, out loud, in two or three sentences. No markdown, no code. File: ${params.path}`,
          "",
          lines.join("\n").slice(0, 16_000),
        ].join("\n"),
      );

      return {
        ok: true,
        path: params.path,
        lineCount: contents.split("\n").length,
        speak: reply?.ok ? reply.raw.trim() : `${params.path} is ${contents.split("\n").length} lines long.`,
      };
    },
  };

  // ------------------------------------------------------------------ tests

  const tests = {
    async run(context) {
      const cwd = projectPathFrom(context);
      if (!cwd) return { ok: false, speak: "There's no active project." };

      const result = await runProjectTests({ projectPath: cwd });
      if (!result.ran) {
        return { ok: true, ran: false, speak: "This project doesn't declare a test command." };
      }

      const output = result.output || "";
      if (result.timedOut) {
        return { ok: false, speak: "The test run timed out after five minutes." };
      }
      if (result.passed) {
        const headline = output.split("\n").filter((line) => /pass|✓|ok\b/i.test(line)).slice(-1)[0];
        return { ok: true, passed: true, speak: `Tests passed. ${headline ? headline.trim() : ""}`.trim() };
      }

      const reply = await runConductor(
        [
          "The user's tests just failed. Say what failed and the most likely cause, out loud, in two or three sentences. No markdown.",
          "",
          output.slice(-8000),
        ].join("\n"),
      );

      return {
        ok: true,
        passed: false,
        speak: reply?.ok ? `Tests failed. ${reply.raw.trim()}` : "The tests failed, but I couldn't read the output.",
      };
    },
  };

  // ----------------------------------------------------------------- memory

  const memoryCapabilities = {
    async resume(params, context) {
      const snapshot = memory.snapshotFor(params.when);
      if (!snapshot) {
        return { ok: true, speak: "I don't have a record of what you were working on yet." };
      }

      const described = [
        snapshot.projectName ? `the ${snapshot.projectName} project` : null,
        snapshot.branch ? `on branch ${snapshot.branch}` : null,
        snapshot.openFiles?.length ? `with ${snapshot.openFiles[0]} open` : null,
      ]
        .filter(Boolean)
        .join(", ");

      if (params.restore === false) {
        return { ok: true, snapshot, speak: `Last time you were working on ${described}.` };
      }

      const restored = await callRenderer("memory.restore", snapshot);
      if (!restored?.ok) {
        return { ok: true, snapshot, speak: `Last time you were on ${described}, but I couldn't reopen it. ${restored?.error || ""}`.trim() };
      }
      return { ok: true, snapshot, speak: `Picking up ${described}.` };
    },

    recall(params) {
      const hits = memory.recall(params.query);
      if (!hits.length) return { ok: true, speak: "I don't have anything recorded about that." };
      return {
        ok: true,
        notes: hits,
        speak: hits.length === 1 ? hits[0].note : `${hits[0].note} I also have ${hits.length - 1} related notes.`,
      };
    },

    remember(params, context) {
      const entry = memory.remember({ note: params.note, kind: params.kind, projectId: context?.projectId || null });
      // The id comes back so the note can be forgotten again if the assistant
      // misheard what it was told to write down.
      return entry ? { ok: true, entryId: entry.id, speak: "Noted." } : { ok: false, speak: "There was nothing to remember." };
    },

    forgetNote(record) {
      const entryId = record.result?.entryId;
      if (!entryId) return { ok: false, speak: "I don't have a record of which note to forget." };
      return memory.forget(entryId)
        ? { ok: true, speak: "Forgotten." }
        : { ok: false, speak: "That note is already gone." };
    },
  };

  // ----------------------------------------------------------- registration

  const screen = createScreenContext({
    runConductor,
    observerPath: () => observerBinaryPath({ resourcesPath }),
  });

  registry.defineAll(
    createCapabilityCatalog({
      git,
      project,
      tests,
      os: osControl,
      memory: memoryCapabilities,
      screen,
      tracker,
      callRenderer,
      answer: (params) => ({ ok: true, speak: params.reply }),
    }),
  );

  // ----------------------------------------------------------- orchestration

  function emitToRenderer(event) {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send("voice:event", event);
  }

  async function getContext() {
    const fromRenderer = await callRenderer("context.snapshot", {});
    const base = fromRenderer?.ok ? fromRenderer : {};
    // The renderer knows what is on screen; git knows what is on disk. Neither
    // alone is enough to resolve "this project" or "what's changed".
    if (base.projectPath) {
      const status = await git.status(base).catch(() => null);
      if (status?.ok) {
        base.branch = status.branch;
        base.dirty = status.modified + status.staged + status.untracked > 0;
      }
    }
    base.callRenderer = callRenderer;
    return base;
  }

  const orchestrator = createVoiceOrchestrator({
    sidecar,
    registry,
    router: { route: (input) => routeIntent({ ...input, runConductor }) },
    memory,
    getContext,
    emit: emitToRenderer,
    log,
  });

  sidecar.on("event", (event) => orchestrator.onSidecarEvent(event));
  sidecar.on("stderr", (line) => log(`[voice] ${line}`));
  sidecar.on("restarted", () => {
    // The daemon came back; resume listening only if the user had it on.
    if (orchestrator.getStatus().enabled) sidecar.startListening();
  });

  // -------------------------------------------------------------------- IPC

  // -------------------------------------------------------- voice selection

  const settingsFile = path.join(userDataPath, "voice-settings.json");

  function readSettings() {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      return {
        voiceIdentifier: typeof parsed.voiceIdentifier === "string" ? parsed.voiceIdentifier : null,
        preset: PRESETS[parsed.preset] ? parsed.preset : DEFAULT_PRESET,
        silenceTimeout: Number(parsed.silenceTimeout) || DEFAULT_SILENCE_TIMEOUT,
        locale: typeof parsed.locale === "string" ? parsed.locale : "en-US",
        wakeWords: Array.isArray(parsed.wakeWords) && parsed.wakeWords.length ? parsed.wakeWords : undefined,
      };
    } catch {
      return { voiceIdentifier: null, preset: DEFAULT_PRESET, silenceTimeout: DEFAULT_SILENCE_TIMEOUT, locale: "en-US" };
    }
  }

  function writeSettings(patch) {
    const next = { ...readSettings(), ...patch };
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    } catch {
      // A preference that cannot be saved still applies to this session.
    }
    return next;
  }

  /** The daemon only reports its voices asynchronously, so this awaits one reply. */
  function requestVoiceList(timeoutMs = 4000) {
    return new Promise((resolve) => {
      if (!sidecar.getState().running) {
        const started = sidecar.start();
        if (!started.ok) {
          resolve({ ok: false, error: started.error, voices: [] });
          return;
        }
      }
      const timer = setTimeout(() => {
        sidecar.off("event", listener);
        resolve({ ok: false, error: "The voice engine did not answer.", voices: [] });
      }, timeoutMs);
      timer.unref?.();

      const listener = (event) => {
        if (event.type !== "voices") return;
        clearTimeout(timer);
        sidecar.off("event", listener);
        resolve({ ok: true, voices: event.voices || [] });
      };
      sidecar.on("event", listener);
      sidecar.requestVoices();
    });
  }

  /** Push the saved voice + delivery settings to the daemon. */
  function applyVoiceSettings(settings = readSettings()) {
    return sidecar.configure({
      ...toSidecarConfig(settings),
      silenceTimeout: settings.silenceTimeout,
      ...(settings.wakeWords ? { wakeWords: settings.wakeWords } : {}),
    });
  }

  ipcMain.handle("voice:list-voices", async () => {
    const listed = await requestVoiceList();
    const settings = readSettings();
    const ranked = rankVoices(listed.voices, { locale: settings.locale });
    const quality = describeVoiceQuality(listed.voices);

    // With no explicit choice, the best-ranked installed voice is used — so a
    // premium voice downloaded later is picked up without any configuration.
    const selected = settings.voiceIdentifier || pickDefaultVoice(listed.voices, { locale: settings.locale })?.identifier || "";

    return {
      ok: listed.ok,
      error: listed.error,
      voices: ranked,
      selected,
      presets: Object.values(PRESETS),
      preset: settings.preset,
      silenceTimeout: settings.silenceTimeout,
      quality,
    };
  });

  ipcMain.handle("voice:set-voice", async (_event, payload) => {
    const settings = writeSettings({
      ...(payload?.voiceIdentifier !== undefined ? { voiceIdentifier: payload.voiceIdentifier || null } : {}),
      ...(payload?.preset ? { preset: payload.preset } : {}),
      ...(payload?.silenceTimeout !== undefined ? { silenceTimeout: Number(payload.silenceTimeout) || DEFAULT_SILENCE_TIMEOUT } : {}),
    });
    applyVoiceSettings(settings);
    return { ok: true, settings };
  });

  ipcMain.handle("voice:preview-voice", async (_event, payload) => {
    if (!sidecar.getState().running) {
      const started = sidecar.start();
      if (!started.ok) return started;
    }
    const preset = PRESETS[payload?.preset] || PRESETS[readSettings().preset];
    return sidecar.send({
      type: "preview",
      voice: payload?.voiceIdentifier || readSettings().voiceIdentifier || undefined,
      speechRate: preset.rate,
      pitch: preset.pitch,
      volume: preset.volume,
      text: payload?.text,
    });
  });

  ipcMain.handle("voice:start", async (_event, payload) => {
    const settings = readSettings();
    // Ensure a voice is chosen before the first word is spoken; picking one
    // after the daemon has started would change voice mid-conversation.
    if (!settings.voiceIdentifier) {
      const listed = await requestVoiceList();
      const best = pickDefaultVoice(listed.voices, { locale: settings.locale });
      if (best) writeSettings({ voiceIdentifier: best.identifier });
    }
    const result = orchestrator.start({ ...toSidecarConfig(readSettings()), ...(payload || {}) });
    applyVoiceSettings();
    return result;
  });
  ipcMain.handle("voice:stop", async () => orchestrator.stop());
  ipcMain.handle("voice:listen-once", async () => orchestrator.listenOnce());
  ipcMain.handle("voice:submit-text", async (_event, payload) => orchestrator.submitText(payload?.text || ""));
  ipcMain.handle("voice:confirm", async () => orchestrator.confirm());
  ipcMain.handle("voice:cancel-confirmation", async () => {
    orchestrator.cancelConfirmation();
    return { ok: true };
  });
  ipcMain.handle("voice:end-turn", async () => orchestrator.endTurn());
  ipcMain.handle("voice:stop-speaking", async () => {
    orchestrator.stopSpeaking();
    return { ok: true };
  });
  ipcMain.handle("voice:status", async () => ({
    ok: true,
    ...orchestrator.getStatus(),
    engineBuilt: Boolean(resolveSidecarPath({ resourcesPath })),
    observerBuilt: Boolean(observerBinaryPath({ resourcesPath })),
  }));
  ipcMain.handle("voice:capabilities", async () => ({ ok: true, capabilities: registry.list() }));
  ipcMain.handle("voice:run-capability", async (_event, payload) => {
    // The command palette and any future caller use the identical door, which
    // is what keeps the risk tiers meaningful rather than voice-only.
    const context = await getContext();
    return registry.dispatch(
      { capabilityId: payload?.capabilityId, params: payload?.params, confirmationId: payload?.confirmationId },
      context,
    );
  });
  ipcMain.handle("voice:remember", async (_event, payload) => {
    const entry = memory.remember({ note: payload?.note, kind: payload?.kind });
    return entry ? { ok: true, entry } : { ok: false, error: "Nothing to remember." };
  });
  ipcMain.handle("voice:history", async () => ({ ok: true, snapshots: memory.history({ limit: 20 }) }));

  return {
    registry,
    orchestrator,
    memory,
    sidecar,
    stop() {
      sidecar.stop();
    },
  };
}

module.exports = { createVoiceRuntime, observerBinaryPath, createGitCapabilities };
