/**
 * Saying "no, not that" to an assistant that just did the wrong thing.
 *
 * Speech recognition mishears, and the router sometimes picks the wrong
 * capability from a right transcript. Both failures land the same way: the
 * assistant confidently does something the user did not ask for. Until now the
 * only recourse was to phrase the whole request again from scratch, which is
 * exactly the moment a person is least inclined to be patient with the feature.
 *
 * Two different repairs, deliberately kept separate:
 *
 *   - A **correction** says what was actually meant. It re-routes; it does not
 *     reverse anything. "No, I meant run the tests" after a wrong `git.status`
 *     needs no undo — the status did nothing.
 *   - An **undo** reverses the last action and says nothing about what to do
 *     instead.
 *
 * Folding them together — quietly undoing on every correction — would make the
 * assistant's behaviour depend on a judgement call the user cannot see. Two
 * plain phrases with two plain meanings is the more usable design, and in a
 * voice interface predictability beats cleverness.
 */

/**
 * An undo request must be the *whole* utterance.
 *
 * "Undo that" is an undo; "undo the changes in App.tsx" is a request about
 * specific files that the router should handle properly. Matching a bare
 * phrase rather than a leading keyword is what keeps those apart.
 */
const UNDO_PATTERNS = [
  /^(?:no[\s,]+)?(?:please\s+)?undo(?:\s+(?:that|it|this|the\s+last\s+(?:one|thing|action)))?$/i,
  /^(?:please\s+)?(?:take|roll)\s+(?:that|it)\s+back$/i,
  /^(?:no[\s,]+)?(?:revert|reverse)\s+(?:that|it)$/i,
  /^(?:never\s*mind|nevermind|scratch\s+that)[\s,]+undo(?:\s+(?:that|it))?$/i,
];

/** Is this utterance asking to reverse the last action, and nothing else? */
function parseUndoRequest(transcript) {
  const phrase = String(transcript || "").trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (!phrase) return false;
  return UNDO_PATTERNS.some((pattern) => pattern.test(phrase));
}

/**
 * The ways people restate a request they were misheard on.
 *
 * Ordered longest-first so "no, I meant" is stripped as one phrase rather than
 * leaving "I meant" behind.
 */

/**
 * The polite scaffolding around a restated request — "that you", "you to" —
 * which belongs to the correction rather than to the instruction inside it.
 * Without this, "no, I wanted you to commit this" re-routes as "you to commit
 * this" and misses the local matcher it was supposed to hit.
 */
const ADDRESSED_TO_ASSISTANT = "(?:that\\s+you\\s+(?:to\\s+)?|you\\s+to\\s+)?";

const CORRECTION_PATTERNS = [
  new RegExp(`^no[\\s,]+(?:not\\s+that[\\s,]+)?(?:i\\s+)?(?:meant|said|wanted|want|asked\\s+(?:for|to))\\s+${ADDRESSED_TO_ASSISTANT}(.+)$`, "i"),
  new RegExp(`^(?:i\\s+)?(?:meant|said)\\s+${ADDRESSED_TO_ASSISTANT}(.+)$`, "i"),
  /^actually[\s,]+(.+)$/i,
  /^no[\s,]+(?:not\s+that[\s,]+)?(.+)$/i,
];

/**
 * A "correction" that only talks *about* the previous turn is a complaint, not
 * an instruction. "No, that's wrong" says nothing about what to do instead, and
 * routing "that's wrong" as a request would answer a complaint by guessing —
 * the failure mode this whole module exists to fix.
 */
const NON_INSTRUCTIONS = [
  /^(?:that|it|this|wrong|no|nope|nothing|stop|not\s+that)$/i,
  // "that's wrong", "that isn't it", "that's not what I said"
  /^(?:that|it|this)(?:'s|s|\s+is|\s+was|\s+isn'?t|\s+is\s+not|\s+wasn'?t)?\s*(?:not\s+)?(?:it|right|wrong|correct|what\s+i\s+(?:said|meant|asked(?:\s+for)?))?\s*$/i,
  /^not\s+what\s+i\s+(?:said|meant|asked)/i,
];

const isComplaint = (text) => NON_INSTRUCTIONS.some((pattern) => pattern.test(text));

/**
 * Pull the real request out of a correction, or null if this isn't one.
 *
 * The extracted text is re-routed exactly as if it had been said on its own,
 * which is also why the strip is worth doing at all: "no, I meant run the
 * tests" reaches the model, while "run the tests" is matched locally in
 * microseconds. Repairing a misroute is the moment latency is least welcome.
 */
function parseCorrection(transcript) {
  const phrase = String(transcript || "").trim().replace(/\s+/g, " ");
  if (!phrase) return null;

  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(phrase);
    if (!match) continue;
    const corrected = match[1].trim().replace(/^[,\s]+/, "");
    if (corrected.length < 2) continue;
    if (isComplaint(corrected.replace(/[.!?]+$/, ""))) return null;
    return { corrected, original: phrase };
  }
  return null;
}

module.exports = {
  parseUndoRequest,
  parseCorrection,
  UNDO_PATTERNS,
  CORRECTION_PATTERNS,
};
