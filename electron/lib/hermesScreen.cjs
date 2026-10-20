"use strict";

/**
 * What a Hermes session is stuck on, read from its screen.
 *
 * Hermes asks some questions on stdin before its own prompt exists, and
 * reports a model it cannot use as a line of text, after which the session
 * sits there looking alive. Neither reaches Pitwall any other way.
 *
 * Wording checked against Hermes 0.21.5 (pm/extras.py and its provider errors).
 */

const OPTIONAL_FEATURE = /needs Hermes' optional '([\w.-]+)' feature, which isn't installed yet\.\s*Install it now\? \[Y\/n\]/;
const NO_CREDITS = /requires available credits|Billing or credits exhausted|balance is too low to use paid models/i;
const MODEL_MISSING = /Model '([^']+)' isn't available|HTTP 404: Model '([^']+)' not found/i;
const BROKEN_INSTALL = /no dependency environment is committed for this install|run `hermes pm repair`/i;
// Hermes's login to its provider is gone, e.g. a refresh token another copy
// of the login already used: nothing it is asked will reach the model.
const SIGNED_OUT = /No access token found for [\w .-]+ login|refresh token (?:is terminally invalid|was already rejected)/i;

/**
 * @returns {{ kind: "optional-feature", feature: string }
 *   | { kind: "no-credits" }
 *   | { kind: "model-missing", model: string }
 *   | { kind: "broken-install" }
 *   | { kind: "signed-out", command: string }
 *   | null}
 */
function readHermesScreen(text) {
  const value = String(text || "");
  if (BROKEN_INSTALL.test(value)) return { kind: "broken-install" };
  if (SIGNED_OUT.test(value)) {
    // Hermes names the command, profile included; `hermes model` when it does not.
    const command = value.match(/Run `(hermes[^`]*?(?:model|auth add [\w-]+))` to re-authenticate/)?.[1] || "hermes model";
    return { kind: "signed-out", command };
  }
  const feature = value.match(OPTIONAL_FEATURE);
  if (feature) return { kind: "optional-feature", feature: feature[1] };
  // Credits first: a paid model with no balance is reported as a 404 as well.
  if (NO_CREDITS.test(value)) return { kind: "no-credits" };
  const missing = value.match(MODEL_MISSING);
  if (missing) return { kind: "model-missing", model: missing[1] || missing[2] };
  return null;
}

/** The notice Pitwall shows for what it read. */
function describeHermesScreen(found) {
  if (found?.kind === "optional-feature") {
    return { tone: "info", title: "Setting up Hermes", message: `Hermes is installing its optional “${found.feature}” feature. This happens once; the session continues when it is done.` };
  }
  if (found?.kind === "broken-install") {
    return { tone: "error", title: "Hermes needs a repair", message: "Hermes could not load its own dependencies and stopped. Run `hermes pm repair` in a terminal, then start the session again." };
  }
  if (found?.kind === "signed-out") {
    return {
      tone: "error",
      title: "Hermes is signed out",
      message: "Hermes lost its sign-in to Nous, so it cannot review or learn. Sign in once and every project reconnects.",
      action: "hermes-sign-in",
    };
  }
  if (found?.kind === "no-credits") {
    return { tone: "error", title: "Hermes needs a different model", message: "The model Hermes is using needs credits, and there are none on the account. Pick a free model, or run `hermes model` in a terminal to choose another." };
  }
  if (found?.kind === "model-missing") {
    return { tone: "error", title: "Hermes needs a different model", message: `“${found.model}” is no longer offered by its provider, so Hermes cannot answer. Pick another model, or run \`hermes model\` in a terminal.` };
  }
  return null;
}

/**
 * The last thing Hermes said in a session, from `hermes sessions export
 * --format jsonl --session-id <id> -`. The screen has it too, but wrapped to
 * the terminal's width and boxed; a reviewer's JSON verdict does not survive
 * that.
 */
// Rows Hermes writes itself to close a turn that failed: a transcript boundary,
// never the model's answer (agent/turn_failure_copy.py).
const FAILED_TURN_NOTICES = new Set([
  "Your request was not processed. Send it again if you still want me to carry it out.",
  "This turn did not complete. Some actions may already have run; verify their effects before resending.",
]);

function lastHermesReply(exportJsonl) {
  let reply = "";
  for (const line of String(exportJsonl || "").split("\n")) {
    if (!line.trim()) continue;
    let session;
    try {
      session = JSON.parse(line);
    } catch {
      continue;
    }
    for (const message of Array.isArray(session?.messages) ? session.messages : []) {
      if (message?.role !== "assistant" || typeof message.content !== "string" || !message.content.trim()) continue;
      // A failed turn ends the session's story there: what came before it is
      // not this turn's answer either.
      reply = message.display_kind === "failed_turn" || FAILED_TURN_NOTICES.has(message.content.trim()) ? "" : message.content;
    }
  }
  return reply.trim();
}

module.exports = { readHermesScreen, describeHermesScreen, lastHermesReply };
