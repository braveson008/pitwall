/**
 * The tuning loop, against whatever Ollama is actually running.
 *
 * The arithmetic has unit tests. What those cannot check is the thing that
 * caused the bug: Ollama does not refuse a context it cannot honour, it serves
 * a smaller one silently. So this asks for a window, then reads back what was
 * actually loaded, and asserts the two are reconciled rather than assumed.
 *
 * Skipped when Ollama is not running, since it is a fact about a machine.
 */
import assert from "node:assert/strict";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tuning = require(path.join(root, "electron/lib/modelTuning.cjs"));
const { servedContextLength, usableContextLength, modelFacts } = require(path.join(root, "electron/lib/ollama.cjs"));

const HOST = "http://127.0.0.1:11434";
const reachable = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
if (!reachable) {
  console.log("  --  Ollama is not running; tuning smoke test skipped.");
  process.exit(0);
}

const tags = await fetch(`${HOST}/api/tags`).then((r) => r.json());
const model = (tags.models || [])[0];
if (!model) {
  console.log("  --  No models pulled; tuning smoke test skipped.");
  process.exit(0);
}

const show = await fetch(`${HOST}/api/show`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: model.name }),
}).then((r) => r.json());

// The cost is computed from the model's own dimensions, so it must be a real
// number for a real model rather than a fallback.
const perToken = tuning.kvBytesPerToken(show.model_info || {});
assert.ok(perToken > 0, "no per-token cost could be derived from the model");
console.log(`  OK  ${model.name}: ${(perToken / 1024).toFixed(0)} KB per token of context`);

const facts = modelFacts(show);
const choices = tuning.contextChoices({
  totalMemoryBytes: os.totalmem(),
  modelBytes: model.size,
  bytesPerToken: perToken,
  declaredMax: facts.contextLength,
});
assert.ok(choices.length > 0, "no context choices were offered");
assert.ok(choices.every((c) => c.tokens <= facts.contextLength), "offered a window the model cannot do");
const recommended = tuning.recommendedContext(choices);
assert.ok(recommended > 0, "nothing was recommended on a machine that can run this model");
console.log(`  OK  recommends ${tuning.formatContext(recommended)} on ${tuning.gb(os.totalmem())} of memory`);

// The reconciliation. Ask for the recommendation, then read what was served.
const before = await fetch(`${HOST}/api/ps`).then((r) => r.json());
const servedBefore = servedContextLength(before, model.name);

await fetch(`${HOST}/api/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: model.name, prompt: "", keep_alive: "5m", options: { num_ctx: recommended } }),
  signal: AbortSignal.timeout(300_000),
}).then((r) => r.text());

const after = await fetch(`${HOST}/api/ps`).then((r) => r.json());
const servedAfter = servedContextLength(after, model.name);
assert.ok(servedAfter > 0, "nothing is loaded after a load request");
console.log(`  OK  asked for ${tuning.formatContext(recommended)}, Ollama served ${tuning.formatContext(servedAfter)} (was ${tuning.formatContext(servedBefore) || "unloaded"})`);

// The rule the harness config depends on: never tell it more than is served.
const told = usableContextLength(facts.contextLength, servedAfter);
assert.ok(told <= servedAfter, `would tell the harness ${told} while Ollama serves ${servedAfter}`);
assert.ok(told <= facts.contextLength, "would exceed the model's own maximum");
console.log(`  OK  the harness would be told ${tuning.formatContext(told)}, never the model's ${tuning.formatContext(facts.contextLength)}`);

// The estimate has to match the machine, or the whole panel is decoration.
const predicted = model.size + perToken * servedAfter;
const loaded = (after.models || []).find((m) => m.name === model.name)?.size || 0;
const drift = Math.abs(predicted - loaded) / loaded;
assert.ok(drift < 0.15, `estimate off by ${(drift * 100).toFixed(0)}%: predicted ${tuning.gb(predicted)}, actually ${tuning.gb(loaded)}`);
console.log(`  OK  predicted ${tuning.gb(predicted)} resident, Ollama reports ${tuning.gb(loaded)}`);

console.log("Pitwall model tuning smoke test passed.");
