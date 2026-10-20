/**
 * Fitting a local model to the machine it is running on.
 *
 * The context window is the setting that matters and the one nobody can guess.
 * It is not a preference: it is a memory allocation. Every token of context
 * costs key/value cache on top of the model's own weights, and asking for more
 * than the machine has does not fail loudly — Ollama quietly serves less than
 * it was asked for, and the harness talking to it never finds out.
 *
 * That gap is what made a working model look broken: told it had 262k when
 * Ollama served 32k, a council member filled the window, had its prompt
 * truncated from the front, lost the tool definitions that lived there, and
 * spent the rest of the session printing tool calls as plain text.
 *
 * So this file does arithmetic rather than offering a slider between "low" and
 * "high". The numbers below are checked against the model's own metadata, and
 * the result is verified against what Ollama actually loaded rather than
 * assumed from what it was asked for.
 */

/** Bytes per element in the KV cache. Ollama's default cache type is fp16. */
const KV_ELEMENT_BYTES = 2;

/**
 * Memory one token of context costs, from the model's own dimensions.
 *
 * Each layer holds a key and a value for every KV head:
 *
 *   layers × (key_length + value_length) × kv_heads × bytes_per_element
 *
 * For qwen3-coder:30b that is 48 × 256 × 4 × 2 = 98,304 bytes per token, which
 * predicts 3.22 GB for 32k of extra context. Measured on an M3 Pro, growing
 * that model from 32k to 64k moved it from 22.0 GB to 25.0 GB. The formula is
 * therefore right to within the rounding in Ollama's own reporting, and is
 * preferred to a per-model guess for exactly that reason.
 */
function kvBytesPerToken(modelInfo = {}) {
  const find = (suffix) => {
    const entry = Object.entries(modelInfo).find(([key]) => key.endsWith(suffix));
    return Number(entry?.[1]) || 0;
  };
  const layers = find(".block_count");
  const kvHeads = find(".attention.head_count_kv") || find(".attention.head_count");
  const keyLength = find(".attention.key_length");
  const valueLength = find(".attention.value_length");

  if (layers && kvHeads && keyLength && valueLength) {
    return layers * (keyLength + valueLength) * kvHeads * KV_ELEMENT_BYTES;
  }

  // Not every architecture publishes all four. Rather than invent a number,
  // derive from the embedding width, which every model reports — less exact,
  // and honest about being an estimate through `exact: false` below.
  const embedding = find(".embedding_length");
  if (layers && embedding) return layers * embedding * 2 * KV_ELEMENT_BYTES;
  return 0;
}

/** Whether the cost above came from the real dimensions or a fallback. */
function kvEstimateIsExact(modelInfo = {}) {
  const has = (suffix) => Object.keys(modelInfo).some((key) => key.endsWith(suffix));
  return (
    has(".block_count") &&
    (has(".attention.head_count_kv") || has(".attention.head_count")) &&
    has(".attention.key_length") &&
    has(".attention.value_length")
  );
}

/**
 * How much memory a model may use.
 *
 * Apple's unified memory lets the GPU address most of RAM but not all of it;
 * the rest is the operating system, the browser somebody has open, and Pitwall
 * itself. Three quarters is the working figure Metal reports as its default
 * limit, and leaving a quarter is what keeps a machine usable while a 30B
 * model is resident rather than swapping.
 */
const USABLE_MEMORY_FRACTION = 0.75;

function usableMemoryBytes(totalMemoryBytes) {
  return Math.max(0, Math.floor((Number(totalMemoryBytes) || 0) * USABLE_MEMORY_FRACTION));
}

/**
 * The largest context that fits, given the weights and the machine.
 *
 * Rounded down to a whole 1024 because a window is quoted in thousands and a
 * figure like 106,433 reads as precision nobody has.
 */
function maxContextForMemory({ totalMemoryBytes, modelBytes, bytesPerToken, declaredMax = 0 }) {
  const perToken = Number(bytesPerToken) || 0;
  if (!perToken) return 0;
  const spare = usableMemoryBytes(totalMemoryBytes) - (Number(modelBytes) || 0);
  if (spare <= 0) return 0;
  const fits = Math.floor(spare / perToken / 1024) * 1024;
  const ceiling = Number(declaredMax) || 0;
  return ceiling ? Math.min(fits, ceiling) : fits;
}

/** Windows worth offering. Anything above the model's own maximum is dropped. */
const CONTEXT_STEPS = [8192, 16384, 32768, 65536, 131072, 262144];

/**
 * The choices to show, each with what it costs and whether it fits.
 *
 * A window that will not fit is listed rather than hidden. It is the user's
 * machine and they may know something this arithmetic does not — a smaller
 * cache type, a model that offloads differently — so the honest thing is to
 * say what is expected to happen and let them decide.
 */
function contextChoices({ totalMemoryBytes, modelBytes, bytesPerToken, declaredMax = 0 }) {
  const perToken = Number(bytesPerToken) || 0;
  const usable = usableMemoryBytes(totalMemoryBytes);
  const ceiling = Number(declaredMax) || 0;
  return CONTEXT_STEPS.filter((tokens) => !ceiling || tokens <= ceiling).map((tokens) => {
    const cacheBytes = perToken * tokens;
    const totalBytes = (Number(modelBytes) || 0) + cacheBytes;
    // "Tight" is the band where it loads and the machine stops being pleasant
    // to use. Worth a different word from "will not fit".
    const fits = perToken > 0 && totalBytes <= usable;
    const tight = fits && totalBytes > usable * 0.85;
    return { tokens, cacheBytes, totalBytes, fits, tight };
  });
}

/**
 * What to pick when nobody has picked.
 *
 * The largest offered window that is not in the tight band — headroom matters
 * more than the last doubling, because the failure it avoids is the machine
 * swapping rather than the model refusing to load.
 */
function recommendedContext(choices) {
  const comfortable = choices.filter((choice) => choice.fits && !choice.tight);
  if (comfortable.length) return comfortable[comfortable.length - 1].tokens;
  const anyFit = choices.filter((choice) => choice.fits);
  return anyFit.length ? anyFit[anyFit.length - 1].tokens : 0;
}

/** How long a model stays resident once loaded. */
const KEEP_ALIVE_CHOICES = [
  { value: "5m", label: "5 minutes", hint: "frees memory between sessions" },
  { value: "30m", label: "30 minutes", hint: "default" },
  { value: "2h", label: "2 hours" },
  // Reloading a 19 GB model costs the better part of a minute every time a
  // council hands over, which is the case this exists for.
  { value: "-1", label: "Until Ollama restarts", hint: "no reload between turns" },
];

function isKeepAlive(value) {
  return KEEP_ALIVE_CHOICES.some((choice) => choice.value === String(value));
}

/** Bytes as gigabytes, the unit every number here lands in. */
function gb(bytes) {
  const value = (Number(bytes) || 0) / 1e9;
  return value >= 10 ? `${Math.round(value)} GB` : `${value.toFixed(1)} GB`;
}

/** A window as people say it: 32k, 128k. */
function formatContext(tokens) {
  const value = Number(tokens) || 0;
  if (!value) return "";
  return value >= 1024 ? `${Math.round(value / 1024)}k` : String(value);
}

module.exports = {
  KV_ELEMENT_BYTES,
  CONTEXT_STEPS,
  KEEP_ALIVE_CHOICES,
  USABLE_MEMORY_FRACTION,
  kvBytesPerToken,
  kvEstimateIsExact,
  usableMemoryBytes,
  maxContextForMemory,
  contextChoices,
  recommendedContext,
  isKeepAlive,
  gb,
  formatContext,
};
