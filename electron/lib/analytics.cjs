const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

/**
 * Anonymous product analytics.
 *
 * Pitwall runs on other people's proprietary code: their repositories, ticket
 * titles, prompts and terminal output. So the rule here is counts, never
 * content — and it is enforced rather than remembered. Both the event names and
 * the property keys are allowlisted below; anything not on those lists is
 * dropped before it can reach the network, so a future call site cannot leak a
 * path or a title by writing one extra field.
 *
 * Everything is best-effort. Analytics that can fail a launch, block a click or
 * throw into a handler is worse than no analytics at all.
 */

/**
 * The questions worth answering, and nothing else.
 *
 * Six of these told us people arrived and started something, and nothing about
 * whether any of it worked — which is the only question an alpha actually has.
 * The additions are all outcomes: did the session finish, did the review get
 * accepted, did the council reach an answer, did the update install.
 *
 * Every one is still a count. Adding an event is cheap; adding a *property*
 * that could carry a path or a title is not, which is why the allowlist below
 * did not grow to accommodate any of these.
 */
const EVENTS = new Set([
  // ── Arriving ──────────────────────────────────────────────────────────
  "app_launched",
  "onboarding_completed",
  "project_added",
  "update_installed",
  "update_failed",

  // ── Getting an agent working ──────────────────────────────────────────
  // The marketplace journey was invisible: we could see that somebody arrived
  // and never started a session, and nothing about which step between the two
  // lost them.
  "agent_install_started",
  "agent_installed",
  "agent_install_failed",
  "model_pulled",
  "model_pull_cancelled",
  "model_removed",

  // ── Starting work ─────────────────────────────────────────────────────
  "task_created",
  "task_imported",
  "session_started",
  "session_launch_failed",
  "council_started",
  "compare_started",

  // ── Whether it worked ─────────────────────────────────────────────────
  "session_completed",
  "session_failed",
  "session_stopped",
  "task_reviewed",
  "change_requested",
  "pull_request_opened",
  "pull_request_created",
  "branch_diff_opened",

  // ── Inside a council ──────────────────────────────────────────────────
  // A council is the reason this app exists and it reported two facts: that it
  // started and that it stopped. Nothing about whether the members converged,
  // how many turns that took, or whether anyone read the result.
  "council_turn_completed",
  "council_debate_completed",
  "council_member_swapped",
  "council_verification_failed",
  "council_finished",
  "council_stopped",

  // ── Where people get stuck ────────────────────────────────────────────
  // The most valuable thing an alpha can count. A pane blocked on a trust
  // dialog, a sign-in, or a CLI offering to update itself is somebody deciding
  // whether this product works, and it left no trace at all.
  "agent_gate_hit",
  "agent_gate_cleared",

  // ── Whether the agents got what they needed ───────────────────────────
  "extension_installed",
  "mcp_server_added",

  // ── Paying ────────────────────────────────────────────────────────────
  "licence_required",
  "checkout_opened",

  // ── Where people go, and when they leave ──────────────────────────────
  // Broad by design: which screen, not what is on it.
  "app_resumed",
  "app_closed",
  "section_viewed",
  "session_opened",
  "files_opened",
  "file_saved",
  "ask_agent_used",
  "pair_started",
  "pair_finished",
  "watch_added",
  "watch_action_approved",
  "update_offered",
  "update_restart_clicked",
  // A CLI changed version and Pitwall checked it still starts.
  "cli_updated",
]);

/**
 * Property keys that cannot identify a person or a codebase.
 *
 * No paths, names, titles, branches, URLs or prompts — none of those appear
 * here, which is what makes the allowlist a guarantee instead of a convention.
 */
const PROPERTIES = new Set([
  "app_version",
  "os_version",
  "agent",
  "provider",
  "source_kind",
  "count",
  "surface",
  "mode",
  /** "finished" | "stopped" | "failed" — never a reason, which would be text. */
  "outcome",
  /** How long something took, in whole seconds. */
  "seconds",
  /** "plugin" | "skill" | "mcp" — what was installed, not which one. */
  "kind",
  /** Which seat in a council: architect, implementer, qa, reviewer, … */
  "role",
  /** Why a pane is blocked: trust, signin, update, consent. Never its text. */
  "gate_kind",
  /** Turns a council took, so "did it converge" becomes answerable. */
  "turns",
  /** How many members a council had. */
  "members",
  /** Whether the run had permission prompts switched off. */
  "auto_approve",
  /** Whether the model runs on this machine rather than through someone's API. */
  "local",
]);

/**
 * Agents we ship or catalogue, by name.
 *
 * `agent` used to be sent as whatever string the call site had, and an agent
 * added through "Add agent" is named by the person adding it. So a field in a
 * module promising "counts, never content" was carrying content, and would
 * have carried a client's name the first time somebody typed one. Anything not
 * on this list is reported as "custom", which still answers the only question
 * the property exists for: which agents people actually use.
 */
const KNOWN_AGENTS = new Set([
  "claude", "codex", "gemini", "grok", "kimi", "hermes",
  "opencode", "qwen", "qwen-code", "crush", "copilot", "continue", "cline",
  "goose", "aider", "ollama", "cursor-agent", "droid", "amp", "auggie",
  "qodo", "forge", "codebuff", "octofriend", "iflow", "kiro-cli",
]);

/** Enumerated property values. Anything else is clamped rather than sent. */
const ENUMS = {
  gate_kind: new Set(["trust", "signin", "update", "consent", "unknown"]),
  role: new Set(["architect", "implementer", "qa", "reviewer", "debugger", "researcher", "compare"]),
  kind: new Set(["plugin", "skill", "mcp", "extension", "review-requested", "ci-failed", "my-request-comments", "ticket-assigned", "custom"]),
  mode: new Set(["council", "compare"]),
  source_kind: new Set(["mcp", "local", "github", "linear", "jira"]),
  outcome: new Set(["finished", "stopped", "failed", "paused", "accepted", "rejected", "cancelled"]),
  /** Which screen: the app's own section names, never a page's content. */
  surface: new Set(["home", "overview", "tasks", "work", "review", "schedule", "watch", "context", "activity", "connections", "extensions", "files", "update"]),
};

const MAX_STRING = 64;

function sanitize(properties = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTIES.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean") clean[key] = value;
    else if (typeof value === "string" && value) clean[key] = clampValue(key, value);
  }
  return clean;
}

/**
 * A string property reduced to something that cannot carry content.
 *
 * Free strings used to pass through with nothing but a length cap, which is
 * not a guarantee — it is a hope that no call site ever puts a name in one.
 * Now every string property is either a known agent or a member of a fixed
 * set, and anything else becomes "custom" or "other".
 */
function clampValue(key, value) {
  const text = value.trim().toLowerCase().slice(0, MAX_STRING);
  if (key === "agent" || key === "provider") return KNOWN_AGENTS.has(text) ? text : "custom";
  const allowed = ENUMS[key];
  if (allowed) return allowed.has(text) ? text : "other";
  return text;
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed.installId === "string") return parsed;
  } catch {
    // A first run, or a file someone edited by hand. Either way, start over.
  }
  return null;
}

/**
 * @param apiKey  PostHog project key. Absent means analytics never runs — which
 *                is what a fork, a dev build and a self-built binary all get.
 */
function createAnalytics({
  filePath,
  apiKey = "",
  host = "https://eu.i.posthog.com",
  appVersion = "0.0.0",
  osVersion = "",
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
} = {}) {
  let state = filePath ? readState(filePath) : null;
  if (!state) {
    // The identifier is random and stored beside the app's own data. Not a
    // hardware id, not a hostname, nothing derived from the machine — it says
    // "the same install as last time" and nothing more.
    state = { installId: randomUUID(), enabled: true, decided: false };
    write();
  } else if (!state.decided && !state.enabled) {
    // On unless someone turns it off, as the privacy policy describes. Installs
    // from when it shipped off had never been asked; a choice made in Settings
    // since is recorded as `decided` and kept.
    state = { ...state, enabled: true, decided: false };
    write();
  }

  function write() {
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // Unwritable settings are not worth failing a launch over.
    }
  }

  return {
    isEnabled: () => Boolean(state.enabled),
    installId: () => state.installId,
    setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      state.decided = true;
      write();
      return state.enabled;
    },
    async capture(event, properties = {}) {
      if (!state.enabled || !apiKey || !EVENTS.has(event) || typeof fetchImpl !== "function") return false;
      const body = {
        api_key: apiKey,
        event,
        distinct_id: state.installId,
        timestamp: now(),
        properties: { ...sanitize(properties), app_version: appVersion, os_version: osVersion },
      };
      try {
        const response = await fetchImpl(`${host}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(4000),
        });
        return response?.ok !== false;
      } catch {
        return false;   // never let a dropped event surface as a failure
      }
    },
  };
}

module.exports = { createAnalytics, EVENTS, PROPERTIES, KNOWN_AGENTS, ENUMS };
