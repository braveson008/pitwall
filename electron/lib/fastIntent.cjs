/**
 * Answers the easy utterances without a model round-trip.
 *
 * ## Why this exists
 *
 * Routing every sentence through `claude -p` costs about five seconds, and
 * measurement shows almost none of that is thinking: a one-word prompt takes
 * ~4.5s, the full 4.4k-token router prompt ~5.2s. The cost is per-invocation
 * session bootstrap, so it cannot be tuned away with a smaller prompt or a
 * faster model — a cheaper model measured *slower*. Stacked on the endpoint
 * timer, the user stops speaking and then waits in silence for eight seconds,
 * which is what "it isn't answering" actually was.
 *
 * Most spoken commands are short and formulaic — "what's changed", "run the
 * tests", "push this". Those are decidable here, in microseconds, against the
 * examples the catalog already carries. Anything else falls through to the
 * model, which is still the right tool for real language.
 *
 * ## Why it is allowed to be dumb
 *
 * A miss costs five seconds; a wrong match does the wrong thing. So this is
 * built to abstain rather than to guess, and three rules make abstaining the
 * default rather than a matter of tuning:
 *
 *   1. Destructive capabilities are never matched here. "Discard my changes"
 *      and "what's changed" are one stemmer away from each other, and the
 *      exclusion — not the scoring — is what makes that safe.
 *   2. Capabilities needing parameters are never matched here. Filling a branch
 *      name or a commit message from a bag of tokens is exactly the guess this
 *      is trying to avoid.
 *   3. A match must both clear a threshold and beat the runner-up by a margin.
 *      Two capabilities scoring alike means the utterance was ambiguous, and
 *      ambiguity belongs to the model.
 *
 * Deliberately no stemming and no fuzzy matching. Both raise recall by making
 * near-misses collide, and a near-miss here is a wrong action.
 */

const DESTRUCTIVE = "destructive";

/** Accept only a clearly best match... */
const DEFAULT_THRESHOLD = 0.6;
/** ...that is also clearly better than whatever came second. */
const DEFAULT_MARGIN = 0.15;

/**
 * Words that carry no intent. Stripping them is what lets "what's changed" and
 * "what has changed" score identically against the same example.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its",
  "i", "im", "ive", "id", "me", "my", "mine", "we", "our", "you", "your",
  "is", "are", "am", "was", "were", "be", "been", "being", "do", "does",
  "did", "done", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "have", "has", "had", "get", "got",
  "what", "whats", "which", "who", "whom", "when", "where", "why", "how",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "about",
  "and", "or", "but", "so", "then", "there", "here", "now",
  "please", "hey", "ok", "okay", "just", "some", "any", "all",
  "up", "out", "into", "over",
]);

/** Lowercase, drop punctuation, collapse whitespace. Apostrophes are removed
 * rather than expanded so "what's" and "whats" reduce to the same token. */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(text) {
  return normalize(text)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}

/**
 * Jaccard overlap of content words. Symmetric on purpose: "run the tests"
 * should match the example "run the tests" perfectly, while "run the tests on
 * the login page in watch mode" should not — the extra words are meaning this
 * matcher is not entitled to interpret.
 */
function similarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Is this capability safe to decide locally? Anything requiring parameters or
 * carrying destructive risk is the model's problem by construction.
 */
function isFastPathEligible(capability) {
  if (!capability || capability.risk === DESTRUCTIVE) return false;
  const required = capability.params?.required;
  if (Array.isArray(required) && required.length > 0) return false;
  return Array.isArray(capability.examples) && capability.examples.length > 0;
}

/**
 * Best local guess at what was said, or null to defer to the model.
 *
 * `capabilities` is `registry.list()` — id, risk, params and examples, which is
 * everything the decision needs and nothing that would let it act.
 */
function matchFastIntent(transcript, capabilities, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const spoken = contentTokens(transcript);
  // Nothing but filler ("do it", "please"). There is no content to match on,
  // and a confident match here would be an accident.
  if (!spoken.length) return null;

  let best = null;
  let runnerUp = 0;

  for (const capability of capabilities || []) {
    if (!isFastPathEligible(capability)) continue;

    let score = 0;
    for (const example of capability.examples) {
      score = Math.max(score, similarity(spoken, contentTokens(example)));
      if (score === 1) break;
    }
    if (score <= 0) continue;

    if (!best || score > best.score) {
      if (best) runnerUp = Math.max(runnerUp, best.score);
      best = { capabilityId: capability.id, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // No confident parameterless match. Before giving up on the local path, try
  // the commands whose parameter is a span of the utterance itself — those are
  // most of what a person actually says out loud.
  const ambiguous = best && best.score - runnerUp < margin;
  if (!best || best.score < threshold || ambiguous) {
    return matchSlotIntent(transcript, capabilities);
  }

  return { capabilityId: best.capabilityId, params: {}, say: "", confidence: best.score };
}

module.exports = {
  matchFastIntent,
  isFastPathEligible,
  normalize,
  contentTokens,
  similarity,
  STOPWORDS,
  DEFAULT_THRESHOLD,
  DEFAULT_MARGIN,
};

// ------------------------------------------------------------- filled slots

/**
 * Commands whose parameter is simply what the user said.
 *
 * The matcher above deliberately refuses any capability with a required
 * parameter, because inventing one from a bag of tokens is the guess this
 * whole module exists to avoid. That left eleven of twenty-nine capabilities —
 * and the useful ones — paying a five-second model hop: commit, open, switch
 * project, branch, tell the agent, remember, recall.
 *
 * Most of those parameters are not inferred at all. They are a literal tail of
 * the utterance: the words after "commit … saying", after "remember that",
 * after "tell it to". Copying a span the user spoke is not guessing, so it can
 * be done here.
 *
 * ## What is deliberately left to the model
 *
 * "Open X" is ambiguous between a file and an application, and picking one
 * would be exactly the coin-flip this module refuses. So `open` only matches a
 * file when the tail actually looks like a filename, and only matches an app
 * under an unambiguous verb. Everything else falls through — a miss costs five
 * seconds, a wrong match opens the wrong thing.
 *
 * ## Why resolution downstream makes this safe
 *
 * A spoken file name, project name or branch name is not used raw. The
 * capabilities already resolve them: `editor.open_file` and `project.switch`
 * match against what actually exists and refuse when nothing does, and
 * `git.create_branch` slugifies prose. This layer only has to identify *which*
 * capability and hand over the span; being wrong about the span's contents is
 * already handled.
 */
const SLOT_PATTERNS = [
  // Verbatim text — the parameter is prose the user dictated.
  {
    capabilityId: "git.commit",
    param: "message",
    // "commit this" on its own has no message and must reach the model, which
    // can write one from the diff. Only an explicit message matches here.
    patterns: [
      /^commit\s+(?:this|these|it|everything|all)?\s*(?:with\s+(?:the\s+)?(?:commit\s+)?message|saying|as|message)\s+(.+)$/i,
    ],
  },
  {
    capabilityId: "memory.remember",
    param: "note",
    patterns: [
      /^(?:remember|make\s+a\s+note|note)\s+(?:that\s+)?(.+)$/i,
    ],
  },
  {
    capabilityId: "memory.recall",
    param: "query",
    patterns: [
      /^(?:what\s+did\s+we\s+(?:decide|say|agree)\s+(?:about|on)|remind\s+me\s+(?:about|why|how|what))\s+(.+)$/i,
    ],
  },
  {
    capabilityId: "session.send",
    param: "message",
    patterns: [
      /^(?:tell|ask)\s+(?:it|the\s+agent|the\s+session)\s+to\s+(.+)$/i,
    ],
  },
  {
    capabilityId: "git.create_branch",
    param: "name",
    // The capability slugifies prose, so the raw span is safe to pass.
    patterns: [
      /^(?:start|create|make|cut)\s+(?:a\s+)?(?:new\s+)?branch\s+(?:called|named|for)\s+(.+)$/i,
    ],
  },

  {
    capabilityId: "tracker.pick_task",
    param: "source",
    // Anchored at the end on purpose. "Pick up my latest Linear ticket with
    // Claude Code" also names an agent, and this can only fill one parameter —
    // matching it here would silently drop the agent the user asked for, so
    // anything past the noun falls through to the model.
    patterns: [
      /^(?:pick\s+up|grab|start\s+on|work\s+on)\s+(?:my\s+)?(?:latest|next|newest|most\s+recent|last)\s+([a-z][a-z0-9]*)\s+(?:ticket|task|issue|item)$/i,
    ],
  },

  // Resolved names — handed over raw, matched downstream against what exists.
  {
    capabilityId: "project.switch",
    param: "name",
    patterns: [/^(?:switch|change|move)\s+to\s+(?:the\s+)?(.+?)(?:\s+project)?$/i],
  },
  {
    capabilityId: "editor.open_file",
    param: "path",
    // Only when the tail actually looks like a file: an extension or a path
    // separator. "Open Figma" must not become a file lookup.
    patterns: [
      /^(?:open|show\s+me)\s+(?:the\s+)?(?:file\s+)?([^\s]*[/][^\s]*|[^\s]+\.[a-z0-9]{1,6})$/i,
      /^open\s+the\s+file\s+(.+)$/i,
    ],
  },
  {
    capabilityId: "os.launch_app",
    param: "name",
    // "launch" is unambiguous; bare "open" is not, and is left to the model.
    patterns: [
      /^(?:launch|boot\s+up)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i,
      /^open\s+the\s+(.+?)\s+app$/i,
    ],
  },
];

/** Trailing politeness and punctuation that is not part of the value. */
function cleanSlot(value) {
  return String(value || "")
    .trim()
    .replace(/\s+(please|thanks|thank\s+you)$/i, "")
    .replace(/[\s,.!?]+$/, "")
    .trim();
}

/**
 * Match an utterance whose parameter is a span of itself.
 *
 * Returns null unless the capability exists, is not destructive, and the
 * extracted span is substantial enough to be a real value rather than a
 * leftover filler word.
 */
function matchSlotIntent(transcript, capabilities) {
  // Deliberately not `normalize()`. That strips punctuation, which would turn
  // "App.tsx" into "app tsx" — destroying the very extension the file pattern
  // keys on — and lowercase a commit message before it was ever captured. The
  // patterns are case-insensitive, so matching against the original text costs
  // nothing and keeps the captured span exactly as it was spoken.
  const phrase = String(transcript || "").trim().replace(/\s+/g, " ");
  if (!phrase) return null;

  for (const slot of SLOT_PATTERNS) {
    const capability = (capabilities || []).find((item) => item.id === slot.capabilityId);
    // Same refusal as the exact matcher: a destructive action is never decided
    // by a regular expression.
    if (!capability || capability.risk === DESTRUCTIVE) continue;

    for (const pattern of slot.patterns) {
      const match = pattern.exec(phrase);
      if (!match) continue;
      const value = cleanSlot(match[1]);
      // Too short to be a real value — "remember that" with nothing after it.
      if (value.length < 2) continue;
      // A value made only of filler is a mis-parse, not a parameter.
      if (!contentTokens(value).length) continue;
      return {
        capabilityId: slot.capabilityId,
        params: { [slot.param]: value },
        say: "",
        confidence: 1,
        slot: slot.param,
      };
    }
  }
  return null;
}

module.exports.SLOT_PATTERNS = SLOT_PATTERNS;
module.exports.matchSlotIntent = matchSlotIntent;
module.exports.cleanSlot = cleanSlot;
