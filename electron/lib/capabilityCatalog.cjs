/**
 * Everything Pitwall can be asked to do, in one list.
 *
 * Each entry carries its own natural-language description and spoken examples,
 * because those are not comments — they are the prompt the intent router reads
 * when deciding which capability a sentence meant. Editing the description
 * changes behaviour, so it is kept next to the handler rather than in a prompt
 * file somewhere else.
 *
 * ## Where a capability runs
 *
 * Pitwall's workspace state (projects, sessions, tasks, the open editor) lives
 * in the renderer, while the filesystem, git and the OS live in main. Rather
 * than migrate all that state up front, every capability declares a `surface`:
 *
 *   - `main`     — runs here, against the deps injected below.
 *   - `renderer` — forwarded to the React app, which owns the state, and
 *                  awaited. `callRenderer` is the one seam for that.
 *
 * A caller cannot tell the difference, which is the point: when state does
 * eventually move into main, only the `surface` field changes.
 *
 * ## What is deliberately absent
 *
 * There is no `os.run_shell`, no `git.run`, no "execute this command" escape
 * hatch. Every capability takes typed parameters. That omission is the entire
 * safety story — with a generic shell capability present, the risk tiers below
 * would be decoration.
 */

const { RISK } = require("./capabilityRegistry.cjs");

const IDENTIFIER = "[A-Za-z][A-Za-z0-9_.-]*";

function text(description, extra = {}) {
  return { type: "string", minLength: 1, maxLength: 4000, description, ...extra };
}

/**
 * Build the full capability list. Every dependency is injected so the catalog
 * can be exercised in tests without Electron, a filesystem, or a microphone.
 */
function createCapabilityCatalog(deps) {
  const { git, project, tests, os: osControl, memory, screen, tracker, callRenderer, answer } = deps;

  /** A renderer-surface capability: the React app owns the state, so it acts. */
  const viaRenderer = (id) => (params, context) => callRenderer(id, params, context);

  return [
    // ---------------------------------------------------------------- projects
    {
      id: "project.list",
      title: "List projects",
      surface: "renderer",
      risk: RISK.SAFE,
      description: "List the projects in the workspace, with which one is active.",
      examples: ["what projects do I have", "list my projects"],
      params: { type: "object", properties: {} },
      handler: viaRenderer("project.list"),
      speak: (result) =>
        result.projects?.length
          ? `You have ${result.projects.length} projects. ${result.activeName ? `${result.activeName} is active.` : ""}`
          : "There are no projects in the workspace yet.",
    },
    {
      id: "project.switch",
      title: "Switch project",
      surface: "renderer",
      risk: RISK.GUARDED,
      description:
        "Make a different project active. Match the spoken name loosely against the project list — 'the frontend one' should find a project named 'frontend'.",
      examples: ["switch to the frontend project", "open Pitwall", "work on the API repo"],
      params: {
        type: "object",
        properties: { name: text("The project name as the user said it.") },
        required: ["name"],
      },
      handler: viaRenderer("project.switch"),
      summarize: (params) => `Switch to ${params.name}`,
      speak: (result) => (result.name ? `Switched to ${result.name}.` : "I couldn't find that project."),
    },
    {
      id: "project.summarize",
      title: "Summarize the project",
      surface: "main",
      risk: RISK.SAFE,
      description:
        "Describe what the active project is: its stack, structure, scripts and current git state. Use for 'what is this project' or 'summarize this repo'.",
      examples: ["summarize this project", "what is this repo", "explain this codebase"],
      params: { type: "object", properties: {} },
      handler: (params, context) => project.summarize(context),
      progress: { afterMs: 10_000, say: "Still reading through the project." },
    },

    // ------------------------------------------------------------------ editor
    {
      id: "editor.open_file",
      title: "Open a file",
      surface: "renderer",
      risk: RISK.GUARDED,
      description: "Open a file in the editor. The path may be partial — 'the app component' should match src/App.tsx.",
      examples: ["open App.tsx", "show me the main process file", "open the package json"],
      params: {
        type: "object",
        properties: { path: text("A file path or a partial description of one.") },
        required: ["path"],
      },
      handler: viaRenderer("editor.open_file"),
      summarize: (params) => `Open ${params.path}`,
      speak: (result) => (result.path ? `Opened ${result.path}.` : "I couldn't find that file."),
    },
    {
      id: "editor.read_file",
      title: "Read a file",
      surface: "main",
      risk: RISK.SAFE,
      description: "Read a file's contents so they can be explained out loud. Read-only.",
      examples: ["what's in the config file", "read the readme"],
      params: {
        type: "object",
        properties: {
          path: text("Path relative to the project root."),
          maxLines: { type: "integer", minimum: 1, maximum: 2000, default: 400 },
        },
        required: ["path"],
      },
      handler: (params, context) => project.readFile(params, context),
    },

    // --------------------------------------------------------------------- git
    {
      id: "git.status",
      title: "Check git status",
      surface: "main",
      risk: RISK.SAFE,
      description: "Report the current branch and which files are modified, staged or untracked.",
      examples: ["what's changed", "git status", "what branch am I on", "do I have uncommitted work"],
      params: { type: "object", properties: {} },
      handler: (params, context) => git.status(context),
    },
    {
      id: "git.diff",
      title: "Show the diff",
      surface: "main",
      risk: RISK.SAFE,
      description: "Read the working-tree diff, optionally for one file, so it can be summarized out loud.",
      examples: ["what did I change", "show me the diff", "what's different in App.tsx"],
      params: {
        type: "object",
        properties: { path: text("Limit the diff to this file.", { minLength: 0 }) },
      },
      handler: (params, context) => git.diff(params, context),
    },
    {
      id: "git.create_branch",
      title: "Create a branch",
      surface: "main",
      risk: RISK.GUARDED,
      description: "Create and check out a new git branch.",
      examples: ["start a new branch for the login fix", "create a branch called voice-assistant"],
      params: {
        type: "object",
        properties: { name: text("Branch name. Slugify spoken words: 'login fix' becomes 'login-fix'.") },
        required: ["name"],
      },
      handler: (params, context) => git.createBranch(params, context),
      summarize: (params) => `Create branch ${params.name}`,
      undo: {
        summarize: (_params, result) => `creating ${result?.branch}`,
        handler: (record, context) => git.undoCreateBranch(record, context),
      },
    },
    {
      id: "git.commit",
      title: "Commit changes",
      surface: "main",
      risk: RISK.GUARDED,
      description: "Stage tracked changes and commit them with a message.",
      examples: ["commit this", "commit with message fix the parser"],
      params: {
        type: "object",
        properties: {
          message: text("The commit message.", { maxLength: 500 }),
          all: { type: "boolean", default: true, description: "Stage all tracked modifications first." },
        },
        required: ["message"],
      },
      handler: (params, context) => git.commit(params, context),
      summarize: (params) => `Commit with message "${params.message}"`,
      undo: {
        summarize: (params) => `the commit "${params.message}"`,
        handler: (record, context) => git.undoCommit(record, context),
      },
    },
    {
      id: "git.push",
      title: "Push the branch",
      surface: "main",
      risk: RISK.GUARDED,
      description: "Push the current branch to its remote. Never force-pushes.",
      examples: ["push this", "push my branch"],
      params: { type: "object", properties: {} },
      handler: (params, context) => git.push(context),
      summarize: () => "Push the current branch",
    },
    {
      id: "git.discard_changes",
      title: "Discard uncommitted changes",
      surface: "main",
      risk: RISK.DESTRUCTIVE,
      description:
        "Throw away uncommitted changes in the working tree. This permanently loses work and must always be confirmed.",
      examples: ["discard my changes", "reset the working tree", "undo everything since the last commit"],
      params: {
        type: "object",
        properties: { path: text("Limit to one file. Omit to discard everything.", { minLength: 0 }) },
      },
      handler: (params, context) => git.discardChanges(params, context),
      confirm: (params) =>
        params.path
          ? `This permanently discards your uncommitted changes to ${params.path}. Say yes to confirm.`
          : "This permanently discards every uncommitted change in the project. Say yes to confirm.",
    },

    // ------------------------------------------------------------------- tests
    {
      id: "tests.run",
      title: "Run the tests",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Run the project's own test command, as declared in its package manifest. Reports pass or fail and the first failures.",
      examples: ["run the tests", "do the tests pass", "run the test suite"],
      params: { type: "object", properties: {} },
      handler: (params, context) => tests.run(context),
      summarize: () => "Run the project's tests",
      // A suite is the one thing a user will genuinely wait a minute for, and
      // the one where silence is most easily mistaken for a crash.
      progress: { afterMs: 12_000, say: "Still running the tests. I'll tell you how they go." },
    },

    // ------------------------------------------------------- sessions & agents
    {
      id: "session.start",
      title: "Start an agent session",
      surface: "renderer",
      risk: RISK.GUARDED,
      description:
        "Start a coding-agent session in the active project and optionally give it an opening task. Use for 'start working on X'.",
      examples: [
        "start working on the login bug",
        "start a Claude session",
        "get Codex working on the parser",
      ],
      params: {
        type: "object",
        properties: {
          agent: {
            type: "string",
            description: "Which agent CLI to use. Omit to use the default.",
            maxLength: 40,
          },
          task: text("What the agent should work on.", { minLength: 0 }),
        },
      },
      handler: viaRenderer("session.start"),
      summarize: (params) => `Start ${params.agent || "an agent"} session${params.task ? ` on: ${params.task}` : ""}`,
      speak: (result) => result.message || "Session started.",
    },
    {
      id: "session.send",
      title: "Send a message to the running agent",
      surface: "renderer",
      risk: RISK.GUARDED,
      description:
        "Type something into the active agent session, as though the user had typed it. Use for follow-up instructions to an agent that is already running.",
      examples: ["tell it to add tests", "ask the agent to explain that", "say yes to the agent"],
      params: {
        type: "object",
        properties: { message: text("Exactly what to send to the agent.") },
        required: ["message"],
      },
      handler: viaRenderer("session.send"),
      summarize: (params) => `Send "${params.message}" to the active session`,
      speak: () => "Sent.",
    },
    {
      id: "session.stop",
      title: "Stop the running agent",
      surface: "renderer",
      risk: RISK.GUARDED,
      description: "Stop the active agent session's process. The session and its transcript are kept.",
      examples: ["stop the agent", "cancel that", "stop what it's doing"],
      params: { type: "object", properties: {} },
      handler: viaRenderer("session.stop"),
      summarize: () => "Stop the active agent session",
      speak: () => "Stopped.",
    },
    {
      id: "session.delete",
      title: "Delete a session",
      surface: "renderer",
      risk: RISK.DESTRUCTIVE,
      description: "Permanently delete an agent session and its transcript.",
      examples: ["delete this session", "remove that session"],
      params: { type: "object", properties: { name: text("Which session, as the user described it.", { minLength: 0 }) } },
      handler: viaRenderer("session.delete"),
      confirm: (params) =>
        `This permanently deletes ${params.name ? `the ${params.name} session` : "the active session"} and its transcript. Say yes to confirm.`,
    },
    {
      id: "council.start",
      title: "Convene a council",
      surface: "renderer",
      risk: RISK.GUARDED,
      description:
        "Put several agents on the same problem — 'council' runs them as a relay that build on each other, 'compare' runs them independently on the same question.",
      examples: [
        "get a council opinion on this design",
        "ask all the agents what they think",
        "compare how the agents would fix this",
      ],
      params: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["council", "compare"], default: "council" },
          task: text("The question or task to put to the group.", { minLength: 0 }),
        },
      },
      handler: viaRenderer("council.start"),
      summarize: (params) => `Start a ${params.mode || "council"} run`,
      speak: (result) => result.message || "Council started.",
    },
    {
      id: "tracker.pick_task",
      title: "Pick up a tracker item",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Find the user's most recently updated open work item in a tracker (Linear, Jira, GitHub Issues, Asana, and so on) and start an agent session on it. " +
        "Use whenever the user names a tracker and asks to pick up, start, or work on their latest, next, or assigned task. " +
        "The tracker name is whatever they said; do not translate it.",
      examples: [
        "pick up my latest Linear ticket",
        "start on my next Jira task with Claude Code",
        "grab my most recent GitHub issue and start working on it",
        "what's my latest Linear ticket",
      ],
      params: {
        type: "object",
        properties: {
          source: text("The tracker as the user named it: linear, jira, github, asana.", { maxLength: 60 }),
          agent: text("Which agent to start the session with, if the user named one.", { maxLength: 60, minLength: 0 }),
          hint: text("Anything the user said about which item they mean.", { maxLength: 200, minLength: 0 }),
          startSession: {
            type: "boolean",
            default: true,
            description: "False when the user only asked what the item is, rather than to start work on it.",
          },
        },
        required: ["source"],
      },
      handler: (params, context) => tracker.pickTask(params, context),
      summarize: (params) => `Pick up the latest ${params.source} item`,
      // Querying a tracker over MCP is a network round-trip through a model.
      progress: { afterMs: 9_000, say: "Still looking that up." },
    },
    {
      id: "task.start",
      title: "Start work on a task",
      surface: "renderer",
      risk: RISK.GUARDED,
      description:
        "Begin work on a tracked task by its identifier or title, creating it first if it does not exist. Ticket-style identifiers such as 'PROJ-123' or 'ticket 999' should be passed through as the identifier.",
      examples: ["start working on ticket 999", "pick up PROJ-123", "begin the search refactor task"],
      params: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            maxLength: 64,
            pattern: `^${IDENTIFIER}$`,
            description: "Ticket identifier such as PROJ-123, if the user gave one.",
          },
          title: text("What the task is about.", { minLength: 0 }),
        },
      },
      handler: viaRenderer("task.start"),
      summarize: (params) => `Start work on ${params.identifier || params.title || "the task"}`,
      speak: (result) => result.message || "Started.",
    },

    // ------------------------------------------------------------ what I'm on
    {
      id: "context.describe_screen",
      title: "Describe what is on screen",
      surface: "main",
      risk: RISK.SAFE,
      description:
        "Work out what the user is currently looking at and explain it. Prefers Pitwall's own state and the accessibility tree; falls back to a screenshot only when neither is available.",
      examples: ["what am I looking at", "what's on my screen", "what is this"],
      params: {
        type: "object",
        properties: {
          allowScreenshot: {
            type: "boolean",
            default: true,
            description: "Permit the screenshot fallback when structured data is unavailable.",
          },
        },
      },
      handler: (params, context) => screen.describe(params, context),
      progress: { afterMs: 8_000, say: "Still working out what you're looking at." },
    },
    {
      id: "context.explain_error",
      title: "Explain the current error",
      surface: "main",
      risk: RISK.SAFE,
      description:
        "Find the most recent error — in an agent terminal, a test run, or the focused window — and explain what it means and what would fix it.",
      examples: ["why is this failing", "explain this error", "what does that error mean"],
      params: { type: "object", properties: {} },
      handler: (params, context) => screen.explainError(params, context),
    },

    // ------------------------------------------------------------ the computer
    {
      id: "os.launch_app",
      title: "Launch an application",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Open a macOS application by name, optionally with the active project. Use for 'open VS Code', 'open Figma', 'open Slack'.",
      examples: ["open VS Code", "launch Figma", "open Slack", "open the browser"],
      params: {
        type: "object",
        properties: {
          name: text("The application name as spoken.", { maxLength: 120 }),
          withProject: {
            type: "boolean",
            default: false,
            description: "Open the active project folder in that application.",
          },
        },
        required: ["name"],
      },
      handler: (params, context) => osControl.launchApp(params, context),
      summarize: (params) => `Open ${params.name}`,
      speak: (result) => (result.opened ? `Opened ${result.opened}.` : "I couldn't find that application."),
    },
    {
      id: "os.open_url",
      title: "Open a web page",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Open a web page, optionally in a named browser. Use this — not os.launch_app — whenever the user names a site or a page, even if they also name a browser. 'Open the GitHub page in Chrome' means this capability with url 'github.com' and browser 'Chrome'. os.launch_app only opens an application with no page.",
      examples: [
        "open github in chrome",
        "open the figma page",
        "open stack overflow",
        "open localhost 3000 in the browser",
      ],
      params: {
        type: "object",
        properties: {
          url: text("The page to open. A bare domain like 'github.com' is fine.", { maxLength: 2000 }),
          browser: text("Which browser, if the user named one.", { minLength: 0, maxLength: 120 }),
        },
        required: ["url"],
      },
      handler: (params, context) => osControl.openUrl(params, context),
      summarize: (params) => `Open ${params.url}${params.browser ? ` in ${params.browser}` : ""}`,
    },
    {
      id: "git.open_remote",
      title: "Open the project on GitHub",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Open the active project's own repository page in a browser, resolved from its git remote. Use when the user means *this* project's GitHub or GitLab page rather than the site in general.",
      examples: [
        "open this project on github",
        "show me the repo online",
        "open the github page for this repo",
      ],
      params: {
        type: "object",
        properties: { browser: text("Which browser, if the user named one.", { minLength: 0, maxLength: 120 }) },
      },
      handler: (params, context) => git.openRemote(params, context),
      summarize: () => "Open the repository page",
    },
    {
      id: "os.reveal_path",
      title: "Reveal a path in Finder",
      surface: "main",
      risk: RISK.GUARDED,
      description: "Show a file or folder from the active project in Finder.",
      examples: ["show me that in Finder", "reveal the build folder"],
      params: {
        type: "object",
        properties: { path: text("Path relative to the project root.", { minLength: 0 }) },
      },
      handler: (params, context) => osControl.revealPath(params, context),
      summarize: (params) => `Reveal ${params.path || "the project"} in Finder`,
    },
    {
      id: "os.open_terminal",
      title: "Open a terminal",
      surface: "renderer",
      risk: RISK.GUARDED,
      description: "Open Pitwall's integrated terminal on the active project.",
      examples: ["open a terminal", "give me a shell"],
      params: { type: "object", properties: {} },
      handler: viaRenderer("os.open_terminal"),
      summarize: () => "Open a terminal",
      speak: () => "Terminal open.",
    },

    // ------------------------------------------------------------------ memory
    {
      id: "memory.resume",
      title: "Resume previous work",
      surface: "main",
      risk: RISK.GUARDED,
      description:
        "Restore the development context from an earlier session — the project, branch, open files and running sessions — and describe what was in progress.",
      examples: ["continue yesterday's work", "pick up where I left off", "what was I doing on Friday"],
      params: {
        type: "object",
        properties: {
          when: text("How the user referred to the moment, e.g. 'yesterday' or 'Friday'.", { minLength: 0 }),
          restore: {
            type: "boolean",
            default: true,
            description: "Actually reopen the project and files, rather than only describing them.",
          },
        },
      },
      handler: (params, context) => memory.resume(params, context),
      summarize: (params) => `Restore the workspace from ${params.when || "the last session"}`,
    },
    {
      id: "memory.recall",
      title: "Recall something remembered",
      surface: "main",
      risk: RISK.SAFE,
      description: "Look up notes, decisions and history Pitwall has recorded about the user's work.",
      examples: ["what did we decide about the database", "remind me why we did that", "what was that branch called"],
      params: {
        type: "object",
        properties: { query: text("What to look for.") },
        required: ["query"],
      },
      handler: (params, context) => memory.recall(params, context),
    },
    {
      id: "memory.remember",
      title: "Remember something",
      surface: "main",
      risk: RISK.SAFE,
      description: "Record a decision, preference or note for later recall.",
      examples: ["remember that we're using Postgres", "make a note that the API is rate limited"],
      params: {
        type: "object",
        properties: {
          note: text("What to remember, written as a standalone fact."),
          kind: { type: "string", enum: ["decision", "preference", "note"], default: "note" },
        },
        required: ["note"],
      },
      handler: (params, context) => memory.remember(params, context),
      speak: () => "Noted.",
      undo: {
        summarize: (params) => `the note "${params.note}"`,
        handler: (record, context) => memory.forgetNote(record, context),
      },
    },

    // -------------------------------------------------------------------- meta
    {
      id: "assistant.answer",
      title: "Answer without acting",
      surface: "main",
      risk: RISK.SAFE,
      description:
        "Speak an answer when the user asked a question that needs no action, or when no other capability fits. Prefer a real capability whenever one applies.",
      examples: ["what does this function do", "how do I run this", "thanks"],
      params: {
        type: "object",
        properties: { reply: text("What to say back, in one or two spoken sentences.", { maxLength: 1200 }) },
        required: ["reply"],
      },
      handler: (params, context) => (answer ? answer(params, context) : { ok: true, speak: params.reply }),
    },
  ];
}

module.exports = { createCapabilityCatalog };
