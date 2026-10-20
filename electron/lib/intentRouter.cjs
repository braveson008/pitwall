/**
 * Turns a sentence into a capability call.
 *
 * This reuses the mechanism `council:route` already proved out: a headless
 * `claude -p --output-format json` invocation with the mutating tools denied.
 * The router is asked to *choose*, never to act, so denying Bash/Edit/Write
 * makes "it only routes" a property of how it is run rather than of how well
 * it follows instructions. It also means voice needs no API key and no new
 * dependency — it rides the CLI auth the user already has.
 *
 * The parsing half is kept pure and separate from the spawning half so the
 * failure modes that actually bite (a model wrapping JSON in prose, or
 * inventing a capability) are unit-testable without a subprocess.
 */

const { matchFastIntent } = require("./fastIntent.cjs");

const WAKE_PREFIX = /^\s*(?:hey\s+|ok(?:ay)?\s+)?(?:pit\s?wall|brave(?:li|ly|lee))\b[\s,.:;!?—–-]*/i;

/**
 * Strip the wake word off the front of an utterance. The transcriber hears
 * "Pitwall, run the tests" as one string, but the router should reason about
 * "run the tests" — leaving the name in biases it toward talking *about*
 * Pitwall instead of acting.
 */
function normalizeTranscript(transcript) {
  if (typeof transcript !== "string") return "";
  return transcript.replace(WAKE_PREFIX, "").trim();
}

const ROUTER_RULES = [
  "Choose exactly one capability that best matches the request, and fill in its parameters.",
  "Prefer a specific capability over assistant.answer. Only use assistant.answer when no capability fits or the user asked something that needs no action.",
  "Never invent a capability name. Use one from the list verbatim.",
  "Resolve vague references using the context: 'this project', 'the tests', 'that file' refer to what is currently active.",
  "Slugify spoken names where a parameter needs an identifier (branch names, file paths).",
  "Keep `say` to one short spoken sentence. It is read aloud, so no markdown, no code, no lists.",
  "If the request is ambiguous enough that acting could be wrong, use assistant.answer to ask a clarifying question instead of guessing.",
];

function buildRouterPrompt({ transcript, tools, context = {}, history = [] }) {
  const contextLines = [
    context.projectName ? `Active project: ${context.projectName}` : null,
    context.projectPath ? `Project path: ${context.projectPath}` : null,
    context.branch ? `Git branch: ${context.branch}` : null,
    context.dirty !== undefined ? `Uncommitted changes: ${context.dirty ? "yes" : "no"}` : null,
    context.openFile ? `File open in the editor: ${context.openFile}` : null,
    context.activeSession ? `Active agent session: ${context.activeSession}` : null,
    context.runningSessions?.length ? `Running sessions: ${context.runningSessions.join(", ")}` : null,
    context.projects?.length ? `Known projects: ${context.projects.join(", ")}` : null,
    context.focusedApp ? `Frontmost application: ${context.focusedApp}` : null,
  ].filter(Boolean);

  const recent = history
    .slice(-4)
    .map((turn) => `- User said "${turn.transcript}" and you chose ${turn.capabilityId}`)
    .join("\n");

  return [
    "You are the intent router for Pitwall, a voice-controlled development assistant.",
    "You translate one spoken request into one capability call. You do not do the work yourself.",
    "",
    "## Capabilities",
    JSON.stringify(tools, null, 2),
    "",
    contextLines.length ? `## Current context\n${contextLines.join("\n")}` : "",
    recent ? `\n## Recent turns\n${recent}` : "",
    "",
    "## Rules",
    ROUTER_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n"),
    "",
    "## Output",
    'Reply with JSON only, no prose and no code fence: {"capabilityId": "...", "params": { ... }, "say": "..."}',
    "`say` is optional and is spoken before the action runs.",
    "",
    "## The request",
    JSON.stringify(transcript),
  ]
    .filter((section) => section !== "")
    .join("\n");
}

/**
 * Pull the intent out of whatever the model actually returned. Models drift
 * toward fenced blocks and friendly preambles even when told not to, and
 * failing the turn over formatting would make the assistant feel broken for a
 * reason the user cannot see or fix.
 */
function parseRouterReply(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "The router returned nothing." };
  }

  const candidates = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (typeof parsed.capabilityId !== "string" || !parsed.capabilityId.trim()) continue;
    // Params must be a bag of named arguments. A string here means the model
    // answered in prose, and coercing that into arguments would be a guess.
    if (parsed.params !== undefined && (typeof parsed.params !== "object" || parsed.params === null || Array.isArray(parsed.params))) {
      return { ok: false, error: "The router returned params that were not an object." };
    }
    return {
      ok: true,
      intent: {
        capabilityId: parsed.capabilityId.trim(),
        params: parsed.params || {},
        say: typeof parsed.say === "string" ? parsed.say.trim() : "",
      },
    };
  }

  return { ok: false, error: "The router did not return a usable decision." };
}

/**
 * Run a transcript through the router. `runConductor` is injected so this can
 * be pointed at any provider — it takes a prompt and returns `{ ok, raw }`.
 */
async function routeIntent({ transcript, registry, context, history, runConductor, fastPath = true }) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { ok: false, error: "Nothing was said." };

  // The common case — a short, formulaic command — is decidable locally, and
  // the model hop costs ~5s of silence. Only unambiguous, parameterless,
  // non-destructive matches get this treatment; see fastIntent.cjs.
  if (fastPath) {
    const local = matchFastIntent(normalized, registry.list());
    if (local && registry.get(local.capabilityId)) {
      return {
        ok: true,
        intent: { capabilityId: local.capabilityId, params: local.params, say: local.say },
        transcript: normalized,
        via: "local",
        confidence: local.confidence,
        costUsd: 0,
      };
    }
  }

  const prompt = buildRouterPrompt({
    transcript: normalized,
    tools: registry.toToolSchema(),
    context,
    history,
  });

  const reply = await runConductor(prompt);
  if (!reply?.ok) {
    return { ok: false, error: reply?.error || "The router could not be reached.", transcript: normalized };
  }

  const parsed = parseRouterReply(reply.raw);
  if (!parsed.ok) return { ...parsed, transcript: normalized };

  // A hallucinated capability is caught here rather than at dispatch so the
  // spoken error can name the real problem.
  if (!registry.get(parsed.intent.capabilityId)) {
    return {
      ok: false,
      error: `I don't have a way to do that (${parsed.intent.capabilityId}).`,
      transcript: normalized,
    };
  }

  return { ok: true, intent: parsed.intent, transcript: normalized, costUsd: reply.costUsd ?? null };
}

module.exports = { normalizeTranscript, buildRouterPrompt, parseRouterReply, routeIntent, WAKE_PREFIX };
