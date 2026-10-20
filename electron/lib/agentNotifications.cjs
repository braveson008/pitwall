const { isWindows } = require("./platform.cjs");
const path = require("node:path");

const COMPLETION_TEXT = /\b(?:agent|task|turn)?\s*(?:complete|completed|finished|done)\b/i;

function normalizeAgentProvider(payload = {}, launch = {}) {
  const command = path.basename(String(launch.command || payload.command || "")).toLowerCase();
  const agent = String(payload.agent || "").trim().toLowerCase();
  const signature = `${command} ${agent}`;

  if (command === "claude" || agent === "claude") return "claude";
  if (command === "codex" || agent === "codex") return "codex";
  if (command === "gemini" || agent === "gemini") return "gemini";
  if (command === "grok" || agent === "grok" || agent === "grok build") return "grok";
  if (/\bkimi(?:-cli)?\b/.test(signature)) return "kimi";
  if (command === "hermes" || agent === "hermes") return "hermes";
  return "custom";
}

function completionEndpoint({ port, token, projectId, sessionId, provider }) {
  const endpoint = new URL(`http://127.0.0.1:${port}/agent-complete`);
  endpoint.searchParams.set("token", token);
  endpoint.searchParams.set("projectId", projectId || "");
  endpoint.searchParams.set("sessionId", sessionId || "");
  endpoint.searchParams.set("provider", provider || "custom");
  return endpoint.toString();
}

/**
 * Posting the completion to Pitwall, from inside the agent's own hook.
 *
 * An absolute `/usr/bin/curl` on a Mac, because a hook runs with whatever PATH
 * the CLI had and that is the one place it is guaranteed to be. Windows 10 and
 * later ship curl in System32, which is always on PATH, so the bare name is
 * both correct and the only portable spelling — and the null device and the
 * "never fail" idiom are spelled differently there.
 */
// The endpoint is quoted because its query is joined with `&`, which a shell
// reads as "run in the background" — unquoted, everything after the token was
// dropped and no completion could be matched to its session.
function curlCompletionCommand(endpoint) {
  if (isWindows) {
    return `curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary @- "${endpoint}" >NUL 2>&1`;
  }
  return `/usr/bin/curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary @- '${endpoint}' >/dev/null 2>&1 || true`;
}

function claudeCompletionArgs(endpoint) {
  return [
    "--settings",
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "http",
                url: endpoint,
                timeout: 5,
              },
            ],
          },
        ],
      },
    }),
  ];
}

/**
 * Codex takes its notifier as an argv array and appends the event JSON as the
 * last argument, which is why this is a shell invocation with `$1` rather than
 * a curl call: curl has no way to take a body as a positional argument.
 *
 * NOT YET VERIFIED ON WINDOWS. `cmd` does not substitute `%1` inside a `/c`
 * string the way a batch file does, so the appended argument is spelled here
 * the way PowerShell takes it — `$args[0]` — which is the only one of the two
 * that can receive it. Worth watching on the first Windows run: the failure
 * mode is a completion that never arrives, which looks like an agent that
 * finished quietly.
 */
/**
 * Codex runs a second, hidden turn in its own thread to title the session, and
 * notifies for it like any other. Taken as the agent finishing, it would mark a
 * member done mid-turn and nudge it. Recognised by its fixed prompt, or by a
 * reply that is nothing but a title, in case the prompt is reworded.
 */
function isCodexSideTurn(body = {}) {
  const inputs = Array.isArray(body["input-messages"]) ? body["input-messages"] : [];
  if (inputs.some((message) => /^Generate a concise, single-line task title/i.test(String(message)))) return true;
  try {
    const reply = JSON.parse(String(body["last-assistant-message"] ?? ""));
    return Boolean(reply) && typeof reply === "object" && !Array.isArray(reply) &&
      Object.keys(reply).length === 1 && typeof reply.title === "string";
  } catch {
    return false;
  }
}

function codexCompletionArgs(endpoint) {
  // Codex appends the event JSON as the last argument. On Windows curl.exe
  // (built in since Windows 10 1803) is started directly with --data-binary
  // last, so the JSON becomes its value: no shell to parse it, nothing to
  // inject into. A PowerShell -Command line would have taken the JSON as more
  // script text instead.
  const command = isWindows
    ? [
      "curl.exe",
      "-fsS",
      "--max-time",
      "2",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "--url",
      endpoint,
      "-o",
      "NUL",
      "--data-binary",
    ]
    : [
      "/bin/sh",
      "-c",
      `/usr/bin/curl -fsS --max-time 2 -X POST -H Content-Type:application/json --data-binary \"$1\" '${endpoint}' >/dev/null 2>&1 || true`,
      "braveli",
    ];
  return ["-c", `notify=${JSON.stringify(command)}`];
}

function geminiCompletionSettings(baseSettings, endpoint) {
  const base = baseSettings && typeof baseSettings === "object" && !Array.isArray(baseSettings)
    ? baseSettings
    : {};
  const hooks = base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)
    ? base.hooks
    : {};
  const afterAgent = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : [];

  return {
    ...base,
    hooks: {
      ...hooks,
      AfterAgent: [
        ...afterAgent,
        {
          matcher: "*",
          hooks: [
            {
              name: "braveli-turn-complete",
              type: "command",
              command: curlCompletionCommand(endpoint),
              timeout: 5,
            },
          ],
        },
      ],
    },
  };
}

function kimiCompletionConfig(baseConfig, endpoint) {
  const prefix = String(baseConfig || "").trimEnd();
  const hook = [
    "[[hooks]]",
    'event = "Stop"',
    `command = '''${curlCompletionCommand(endpoint)}'''`,
    "timeout = 5",
  ].join("\n");
  return `${prefix}${prefix ? "\n\n" : ""}${hook}\n`;
}

function grokCompletionHooks(endpoint) {
  return {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "http",
              url: endpoint,
              timeout: 5,
            },
          ],
        },
      ],
    },
  };
}

function terminalCompletionSignal(data, provider = "custom") {
  const value = String(data || "");
  const notifications = [
    ...value.matchAll(/\u001b\]9;(?!4;)([^\u0007]*)\u0007/g),
    ...value.matchAll(/\u001b\]99;([^\u001b]*)\u001b\\/g),
    ...value.matchAll(/\u001b\]777;notify;([^\u001b]*)\u001b\\/g),
  ];
  if (notifications.some((match) => COMPLETION_TEXT.test(match[1] || ""))) return true;
  return provider === "grok" && value.includes("\u001b]9;4;0;0\u0007");
}

module.exports = {
  claudeCompletionArgs,
  codexCompletionArgs,
  completionEndpoint,
  curlCompletionCommand,
  isCodexSideTurn,
  geminiCompletionSettings,
  grokCompletionHooks,
  kimiCompletionConfig,
  normalizeAgentProvider,
  terminalCompletionSignal,
};
