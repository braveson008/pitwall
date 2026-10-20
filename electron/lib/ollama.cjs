/**
 * Ollama, without the errands.
 *
 * Installing the binary is the easy part and Pitwall already does it. What
 * makes local models a chore is everything after: the server has to be
 * running, a model has to be pulled before it answers anything, and the
 * failure when either is missing arrives inside whichever agent you pointed
 * at it — as a connection refused, or a 404 naming a model you thought you
 * had. Neither says "start Ollama" or "pull that first".
 *
 * So the three states are asked about directly, and each has one action.
 */

const DEFAULT_HOST = "http://127.0.0.1:11434";

/**
 * A model name Pitwall is willing to pass to `ollama pull`.
 *
 * Names look like `qwen3-coder:30b` or `library/llama3.3`. Anything else is
 * refused rather than escaped: this string reaches a spawned process, and the
 * cost of being wrong is somebody else's shell.
 */
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?(:[a-zA-Z0-9._-]+)?$/;

function isModelName(name) {
  const value = String(name || "").trim();
  return value.length > 0 && value.length <= 128 && MODEL_NAME.test(value);
}

/**
 * What `/api/tags` returned, as a plain list.
 *
 * Ollama reports sizes in bytes and modification times as timestamps; neither
 * is interesting until you are deciding what to delete, so only the name and
 * a human-sized figure come through.
 */
function parseModels(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return models
    .map((model) => ({
      name: String(model?.name || model?.model || "").trim(),
      size: Number(model?.size) || 0,
      parameters: String(model?.details?.parameter_size || "").trim(),
    }))
    .filter((model) => model.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What `/api/show` says about one model.
 *
 * Two facts matter, and one of them decides whether the model can be offered
 * at all.
 *
 * `tools` is the deciding one. An agent session is a loop of reading files and
 * running commands, which the model drives by calling tools; a model that
 * cannot call them will hold a conversation and change nothing. Offering it as
 * an agent produces a session that looks fine and accomplishes nothing, which
 * is worse than not offering it.
 *
 * The context length is the other. A harness that does not know it assumes a
 * conservative default and compacts the conversation far earlier than the
 * model requires — a 256k model driven as if it were 8k. Where a bridge lets
 * the figure be configured, Pitwall writes the real one rather than leaving it
 * to be guessed.
 */
/**
 * The context Ollama will actually serve for a loaded model.
 *
 * `/api/show` reports what the *model* supports — `qwen3moe.context_length` is
 * 262144 for qwen3-coder:30b. Ollama serves whatever `num_ctx` it loaded with,
 * which is 4096 by default and 32768 on a machine with OLLAMA_CONTEXT_LENGTH
 * set. Those are not the same number and the difference is not cosmetic.
 *
 * Pitwall wrote the model's figure into the harness's config, so Qwen Code
 * believed it had 262k and built prompts to match. Ollama truncated them at
 * 32k, dropping the *oldest* tokens — which is where the system prompt and the
 * tool definitions live. The model lost its tools mid-conversation and started
 * printing tool calls as plain text instead of making them, then looped:
 * "let me read the file", no result, "let me read the file".
 *
 * Nothing in that failure names a cause. The pane just fills with XML.
 */
function servedContextLength(psPayload, modelName) {
  const models = Array.isArray(psPayload?.models) ? psPayload.models : [];
  const name = String(modelName || "").trim();
  const entry = models.find((item) => String(item?.name || "").trim() === name)
    || models.find((item) => String(item?.model || "").trim() === name);
  return Number(entry?.context_length) || 0;
}

/**
 * What to tell a harness its context window is.
 *
 * The smaller of the two, because the harness will fill whatever it is told
 * and Ollama enforces its own number silently. When the model is not loaded
 * there is nothing to measure, and this returns 0 — the caller writes no
 * figure at all rather than the model's theoretical one. `providers.ts` has
 * the rule and it holds here: a wrong value is worse than a blank.
 */
function usableContextLength(declared, served) {
  const model = Number(declared) || 0;
  const ollama = Number(served) || 0;
  if (!ollama) return 0;
  if (!model) return ollama;
  return Math.min(model, ollama);
}

function modelFacts(payload) {
  const info = payload?.model_info && typeof payload.model_info === "object" ? payload.model_info : {};
  // The key is namespaced by architecture — `qwen3moe.context_length`,
  // `llama.context_length` — so it is found by suffix rather than by knowing
  // every architecture that exists.
  const contextEntry = Object.entries(info).find(([key]) => key.endsWith(".context_length"));
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities.map(String) : [];
  return {
    contextLength: Number(contextEntry?.[1]) || 0,
    capabilities,
    tools: capabilities.includes("tools"),
    architecture: String(info["general.architecture"] || "").trim(),
  };
}

/** Bytes as something a person reads: `4.7 GB`. */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * The one sentence that says what to do next.
 *
 * Three states, in the order they have to be fixed: no binary, a binary with
 * nothing serving, a server with no models. Reporting them in any other order
 * sends somebody to pull a model against a server that is not running.
 */
function ollamaGuidance({ installed, serving, modelCount }) {
  if (!installed) {
    return { state: "missing", message: "Ollama is not installed yet." };
  }
  if (!serving) {
    return {
      state: "stopped",
      message: "Ollama is installed but nothing is answering on its port. Start it to pull or run models.",
    };
  }
  if (!modelCount) {
    return {
      state: "empty",
      message: "Ollama is running with no models pulled. An agent pointed at it now would get a 404.",
    };
  }
  return { state: "ready", message: "" };
}

module.exports = {
  servedContextLength,
  usableContextLength,
  modelFacts, DEFAULT_HOST, isModelName, parseModels, formatSize, ollamaGuidance };
