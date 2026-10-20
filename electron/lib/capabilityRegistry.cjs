/**
 * The capability registry: the single place where "something Pitwall can do"
 * is defined, and the single door every caller goes through to do it.
 *
 * The point of this module is that voice is not special. A spoken request, a
 * command-palette click, and (later) an agent tool call all end up in
 * `dispatch`, so the safety rules, the argument validation, and the spoken
 * summaries are written once and cannot be bypassed by adding a new front end.
 *
 * Two properties are load-bearing and should survive any refactor:
 *
 *  1. Capabilities take *typed parameters*, never a model-authored command
 *     string. The router chooses `git.commit({ message })`; it never composes
 *     a shell line. That is what keeps "the model can't run rm -rf" a fact
 *     about the architecture instead of a hope about the prompt.
 *
 *  2. The risk tier lives in the capability definition, not in the caller's
 *     request. Nothing a model emits can lower it, and confirmation is
 *     enforced here rather than in whichever UI happened to ask.
 */

const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { validateParams } = require("./capabilitySchema.cjs");

const RISK = Object.freeze({ SAFE: "safe", GUARDED: "guarded", DESTRUCTIVE: "destructive" });
const RISK_ORDER = Object.freeze({ safe: 0, guarded: 1, destructive: 2 });

const DEFAULT_CONFIRMATION_TTL_MS = 90_000;

/**
 * How long "undo that" stays meaningful.
 *
 * Undo is a reflex — it follows the mistake by seconds. Ten minutes later the
 * user has done other work, and reversing something from before it is more
 * likely to destroy that work than to help.
 */
const DEFAULT_UNDO_WINDOW_MS = 5 * 60_000;

/**
 * Routine work runs; anything that can lose data asks first. This mirrors the
 * product requirement directly so the policy is legible rather than implied.
 */
const DEFAULT_POLICY = Object.freeze({
  autoApproveUpTo: RISK.GUARDED,
  confirmationTtlMs: DEFAULT_CONFIRMATION_TTL_MS,
  undoWindowMs: DEFAULT_UNDO_WINDOW_MS,
});

function isKnownRisk(risk) {
  return Object.prototype.hasOwnProperty.call(RISK_ORDER, risk);
}

function actionContext(capabilityId, context, { undo = false } = {}) {
  const identity = {
    projectId: context.projectId ?? null,
    projectPath: context.projectPath ?? null,
  };
  if (capabilityId.startsWith("git.") && !undo) identity.branch = context.branch ?? null;
  if (capabilityId.startsWith("session.")) {
    identity.activeSessionId = context.activeSessionId ?? null;
    identity.activeSession = context.activeSession ?? null;
    identity.sessions = (context.sessions ?? []).map(({ id, name }) => ({ id, name }));
  }
  return structuredClone(identity);
}

function createCapabilityRegistry(options = {}) {
  const capabilities = new Map();
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const newId = typeof options.newId === "function" ? options.newId : () => randomUUID();

  // Exactly one confirmation may be outstanding. Allowing a queue would mean a
  // bare "yes" is ambiguous, and an ambiguous "yes" in an always-listening
  // assistant is a way to delete the wrong thing.
  let pending = null;

  // Likewise exactly one undoable action. "Undo that" refers to the last thing
  // that happened; a stack would make it refer to something the user would
  // have to count backwards to name.
  let undoable = null;

  function define(capability) {
    const problems = describeDefinitionProblems(capability, capabilities);
    if (problems.length) {
      throw new Error(`Invalid capability "${capability?.id ?? "(unnamed)"}": ${problems.join("; ")}`);
    }
    capabilities.set(capability.id, Object.freeze({ ...capability }));
    return capability.id;
  }

  function defineAll(list) {
    for (const capability of list) define(capability);
    return capabilities.size;
  }

  function get(id) {
    return capabilities.get(id) || null;
  }

  function list() {
    return Array.from(capabilities.values()).map((capability) => ({
      id: capability.id,
      title: capability.title,
      description: capability.description,
      examples: capability.examples || [],
      risk: capability.risk,
      params: capability.params || { type: "object", properties: {} },
    }));
  }

  /**
   * The registry rendered as tool definitions for the intent router. The
   * description and examples are written once, in the catalog, and are what
   * the model actually reasons over — so they are documentation for humans and
   * the prompt for the model at the same time.
   */
  function toToolSchema() {
    return list().map((capability) => ({
      name: capability.id,
      description: [
        capability.description,
        capability.examples.length
          ? `Spoken examples: ${capability.examples.map((example) => `"${example}"`).join(", ")}`
          : "",
        capability.risk === RISK.DESTRUCTIVE
          ? "This action is destructive and will require the user to confirm out loud."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      input_schema: capability.params || { type: "object", properties: {} },
    }));
  }

  function requiresConfirmation(capability) {
    return RISK_ORDER[capability.risk] > RISK_ORDER[policy.autoApproveUpTo];
  }

  function describe(capability, params) {
    if (typeof capability.summarize !== "function") return capability.title;
    try {
      return capability.summarize(params) || capability.title;
    } catch {
      return capability.title;
    }
  }

  function expirePending() {
    if (pending && pending.expiresAt <= now()) pending = null;
  }

  function getPendingConfirmation() {
    expirePending();
    if (!pending) return null;
    return {
      id: pending.id,
      capabilityId: pending.capabilityId,
      question: pending.question,
      expiresAt: pending.expiresAt,
    };
  }

  function cancelPendingConfirmation() {
    const had = Boolean(getPendingConfirmation());
    pending = null;
    return had;
  }

  /**
   * Run a capability. `context` carries the live handles (windows, project
   * state, child processes) that handlers need; it is supplied by the host and
   * never by the caller proposing the action.
   */
  async function dispatch(request, context = {}) {
    const capability = capabilities.get(request?.capabilityId);
    if (!capability) {
      return { ok: false, error: `Unknown capability "${request?.capabilityId}"`, code: "unknown_capability" };
    }

    const validated = validateParams(capability.params, request?.params);
    if (!validated.ok) {
      return {
        ok: false,
        error: `Invalid arguments: ${validated.errors.join("; ")}`,
        code: "invalid_params",
        errors: validated.errors,
      };
    }

    let params = validated.value;

    if (requiresConfirmation(capability) && !request?.confirmationId) {
      const question = capability.confirm
        ? capability.confirm(params)
        : `${describe(capability, params)}. Should I go ahead?`;
      pending = {
        id: newId(),
        capabilityId: capability.id,
        params: structuredClone(params),
        context: actionContext(capability.id, context),
        question,
        expiresAt: now() + policy.confirmationTtlMs,
      };
      return {
        ok: false,
        code: "confirmation_required",
        confirmation: { id: pending.id, question, capabilityId: capability.id },
        speak: question,
      };
    }

    if (request?.confirmationId) {
      expirePending();
      // The confirmation must match the exact pending action. This is what
      // stops an overheard "yes" from approving something the user never
      // heard proposed.
      if (!pending || pending.id !== request.confirmationId) {
        return { ok: false, error: "That confirmation has expired.", code: "confirmation_expired" };
      }
      if (pending.capabilityId !== capability.id) {
        return { ok: false, error: "Confirmation does not match the pending action.", code: "confirmation_mismatch" };
      }
      if (!isDeepStrictEqual(pending.params, params) ||
          !isDeepStrictEqual(pending.context, actionContext(capability.id, context))) {
        return { ok: false, error: "The action or its target changed. Please request it again.", code: "confirmation_mismatch" };
      }
      params = pending.params;
      pending = null;
    }

    const undoContext = actionContext(capability.id, context, { undo: true });
    try {
      const result = await capability.handler(params, context);
      const outcome = result && typeof result === "object" ? result : { ok: true };
      if (outcome.ok === false) {
        return {
          ...outcome,
          ok: false,
          capabilityId: capability.id,
          speak: outcome.speak || outcome.error || `${capability.title} failed.`,
        };
      }
      rememberUndo(capability, params, outcome, undoContext);
      return {
        ...outcome,
        ok: true,
        capabilityId: capability.id,
        undoable: Boolean(undoable && undoable.capabilityId === capability.id),
        speak: outcome.speak || speakFor(capability, params, outcome),
      };
    } catch (error) {
      const message = error?.message || String(error);
      return {
        ok: false,
        code: "handler_threw",
        capabilityId: capability.id,
        error: message,
        speak: `${capability.title} failed: ${message}`,
      };
    }
  }

  // ------------------------------------------------------------------- undo

  /**
   * Undo is a declared property of a capability, never a generic mechanism.
   *
   * The alternative — a universal "undo" that tries to work out how to reverse
   * whatever just ran — is a promise the system cannot keep. `git.push` cannot
   * be undone without force-pushing over work that may not be yours;
   * `session.send` cannot be unsent, because the agent has already read it and
   * may already be acting on it. A capability that cannot honestly be reversed
   * declares nothing here, and the user is told so plainly rather than being
   * given a button that quietly does the wrong thing.
   *
   * A capability that *can* be reversed supplies `undo.handler`, and that
   * handler is responsible for checking that the world has not moved on —
   * resetting a commit that has since been pushed is not an undo, it is a
   * second, worse mistake. The registry only guarantees that the handler is
   * given exactly what the original run produced, and only within a window
   * where "that" still unambiguously means this action.
   */
  function rememberUndo(capability, params, outcome, context) {
    if (!capability.undo) {
      // An action with no undo still clears the previous one. Otherwise "undo
      // that" after a commit-then-status would silently skip past the status
      // and reverse the commit — reversing something other than the last
      // thing that happened is exactly what the single-slot rule prevents.
      undoable = null;
      return;
    }
    undoable = {
      capabilityId: capability.id,
      params: structuredClone(params),
      result: outcome,
      context,
      summary: capability.undo.summarize?.(params, outcome) || `undo ${describe(capability, params)}`,
      expiresAt: now() + policy.undoWindowMs,
    };
  }

  function expireUndoable() {
    if (undoable && undoable.expiresAt <= now()) undoable = null;
  }

  /** What "undo that" would currently reverse, or null if nothing. */
  function getUndoable() {
    expireUndoable();
    if (!undoable) return null;
    return { capabilityId: undoable.capabilityId, summary: undoable.summary, expiresAt: undoable.expiresAt };
  }

  /**
   * Reverse the last undoable action.
   *
   * Consumed on attempt rather than on success: a failed undo has already told
   * the user why, and leaving it armed invites a second "undo" that means
   * something different from the first.
   */
  async function undoLast(context = {}) {
    expireUndoable();
    const record = undoable;
    undoable = null;

    if (!record) {
      return { ok: false, code: "nothing_to_undo", speak: "There's nothing for me to undo." };
    }

    const capability = capabilities.get(record.capabilityId);
    if (!capability?.undo) {
      return { ok: false, code: "nothing_to_undo", speak: "There's nothing for me to undo." };
    }

    if (!isDeepStrictEqual(record.context, actionContext(capability.id, context, { undo: true }))) {
      return { ok: false, code: "undo_context_changed", speak: "The active project or session changed. I won't undo work in a different target." };
    }

    try {
      const result = await capability.undo.handler(record, context);
      const outcome = result && typeof result === "object" ? result : { ok: true };
      return {
        ...outcome,
        ok: outcome.ok !== false,
        capabilityId: record.capabilityId,
        undone: outcome.ok !== false,
        speak: outcome.speak || (outcome.ok !== false ? `Undone: ${record.summary}.` : "I couldn't undo that."),
      };
    } catch (error) {
      const message = error?.message || String(error);
      return {
        ok: false,
        code: "undo_threw",
        capabilityId: record.capabilityId,
        error: message,
        speak: `I couldn't undo that: ${message}`,
      };
    }
  }

  function speakFor(capability, params, result) {
    if (typeof capability.speak !== "function") return describe(capability, params);
    try {
      return capability.speak(result, params) || describe(capability, params);
    } catch {
      return describe(capability, params);
    }
  }

  return {
    RISK,
    define,
    defineAll,
    get,
    list,
    toToolSchema,
    dispatch,
    requiresConfirmation,
    getPendingConfirmation,
    cancelPendingConfirmation,
    getUndoable,
    undoLast,
    describe,
    get size() {
      return capabilities.size;
    },
    get policy() {
      return { ...policy };
    },
  };
}

function describeDefinitionProblems(capability, existing) {
  const problems = [];
  if (!capability || typeof capability !== "object") return ["definition must be an object"];
  if (typeof capability.id !== "string" || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(capability.id)) {
    problems.push("id must look like \"domain.action\"");
  } else if (existing.has(capability.id)) {
    problems.push("id is already registered");
  }
  if (typeof capability.title !== "string" || !capability.title.trim()) problems.push("title is required");
  if (typeof capability.description !== "string" || !capability.description.trim()) {
    problems.push("description is required (the router reads it to choose this capability)");
  }
  if (!isKnownRisk(capability.risk)) problems.push("risk must be safe, guarded, or destructive");
  if (typeof capability.handler !== "function") problems.push("handler must be a function");
  if (capability.params && typeof capability.params !== "object") problems.push("params must be a JSON Schema object");
  if (capability.progress !== undefined) {
    // A typo here fails silently — the capability simply never reassures — so
    // it is caught at definition time instead.
    if (typeof capability.progress !== "object" || typeof capability.progress.say !== "string" || !capability.progress.say.trim()) {
      problems.push("progress must be an object with a non-empty say string");
    }
  }
  if (capability.undo !== undefined) {
    // Declaring `undo` without a handler would make the capability advertise a
    // reversal it cannot perform, which is worse than declaring nothing.
    if (typeof capability.undo !== "object" || typeof capability.undo.handler !== "function") {
      problems.push("undo must be an object with a handler function");
    }
  }
  return problems;
}

module.exports = {
  createCapabilityRegistry,
  RISK,
  RISK_ORDER,
  DEFAULT_POLICY,
  DEFAULT_UNDO_WINDOW_MS,
};
