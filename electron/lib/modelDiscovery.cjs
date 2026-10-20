const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function uniqueModels(models) {
  const seen = new Set();
  return models.filter((model) => {
    const value = String(model?.value || "").trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function parseCodexModelsCache(input) {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(payload?.models)) return [];

  return uniqueModels(
    payload.models
      .filter((model) => model?.slug && model.visibility !== "hide")
      .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
      .map((model) => ({
        label: String(model.display_name || model.slug),
        value: String(model.slug),
      })),
  );
}

function parseJsonModels(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  return uniqueModels(
    candidates.flatMap((candidate) => {
      if (typeof candidate === "string") {
        const value = candidate.trim();
        return value ? [{ label: value, value }] : [];
      }

      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate.slug || candidate.id || candidate.model_id || candidate.model || candidate.name;
      if (!value) return [];
      return [{
        label: String(candidate.display_name || candidate.displayName || candidate.label || candidate.name || value),
        value: String(value),
      }];
    }),
  );
}

function parseCliModelOutput(output) {
  const clean = String(output || "").replace(ANSI_PATTERN, "").trim();
  if (!clean) return [];

  try {
    const fromJson = parseJsonModels(JSON.parse(clean));
    if (fromJson.length) return fromJson;
  } catch {
    // Some CLIs only expose a human-readable model list.
  }

  const modelPattern = /\b(?:claude|codex|gemini|gpt|grok)[-_:][a-z0-9][a-z0-9._:-]*\b/i;
  return uniqueModels(
    clean.split(/\r?\n/).flatMap((line) => {
      const match = line.match(modelPattern);
      if (!match) return [];
      const value = match[0].replace(/[,:;]$/, "");
      return [{ label: value, value }];
    }),
  );
}

function parseCustomModelOutput(output) {
  const strictModels = parseCliModelOutput(output);
  if (strictModels.length) return strictModels;

  const clean = String(output || "").replace(ANSI_PATTERN, "").trim();
  if (!clean) return [];

  try {
    const fromJson = parseJsonModels(JSON.parse(clean));
    if (fromJson.length) return fromJson;
  } catch {
    // Fall through to the common one-model-per-line CLI format.
  }

  const ignored = new Set(["available", "default", "id", "model", "models", "name", "value"]);
  return uniqueModels(
    clean.split(/\r?\n/).flatMap((line) => {
      const candidate = line
        .trim()
        .replace(/^(?:[-*•✓✔]|\d+[.)])\s*/, "")
        .split(/\s{2,}|\t/)[0]
        .trim()
        .replace(/[,:;]$/, "");
      if (!candidate || ignored.has(candidate.toLowerCase())) return [];
      if (!/^[a-z0-9][a-z0-9._:/\-[\]]{1,119}$/i.test(candidate)) return [];
      return [{ label: candidate, value: candidate }];
    }),
  );
}

function parseClaudeHelpModels(output) {
  const clean = String(output || "").replace(ANSI_PATTERN, "").replace(/\s+/g, " ");
  const modelOptionIndex = clean.indexOf("--model <model>");
  if (modelOptionIndex < 0) return [];

  const description = clean.slice(modelOptionIndex, modelOptionIndex + 700);
  const aliasesEnd = description.indexOf("or a model's full name");
  const aliasDescription = aliasesEnd >= 0 ? description.slice(0, aliasesEnd) : description;
  const aliases = [...aliasDescription.matchAll(/'([^']+)'/g)].map((match) => match[1].trim()).filter(Boolean);

  return uniqueModels(aliases.map((value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    value,
  })));
}

function formatClaudeModelLabel(value) {
  const normalized = String(value || "").trim();
  const longContext = normalized.endsWith("[1m]");
  const withoutContext = normalized.replace(/\[1m\]$/, "");
  const match = withoutContext.match(/^claude-(fable|opus|sonnet|haiku)-(.+)$/i);
  if (!match) return normalized;

  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const version = match[2]
    .replace(/-(\d{8})$/, "")
    .replace(/-/g, ".");
  return `${family} ${version}${longContext ? " · 1M context" : ""}`;
}

function parseClaudeRuntimeModels(payload) {
  if (!payload || typeof payload !== "object") return [];

  const candidates = [];
  for (const option of payload.additionalModelOptionsCache || []) {
    if (option?.value) candidates.push(String(option.value));
  }

  const severityByModel = payload.cachedGrowthBookFeatures?.tengu_auto_mode_config?.severityByModel;
  if (severityByModel && typeof severityByModel === "object") {
    candidates.push(...Object.keys(severityByModel));
  }

  for (const slot of Object.values(payload.clientDataCacheSlots || {})) {
    if (slot?.model) candidates.push(String(slot.model));
  }

  const familyRank = { fable: 0, opus: 1, sonnet: 2, haiku: 3 };
  return uniqueModels(
    candidates
      .filter((value) => /^claude-(?:fable|opus|sonnet|haiku)-/i.test(value))
      .map((value) => ({ label: formatClaudeModelLabel(value), value }))
      .sort((a, b) => {
        const aFamily = a.value.match(/^claude-([^-]+)/i)?.[1]?.toLowerCase() || "";
        const bFamily = b.value.match(/^claude-([^-]+)/i)?.[1]?.toLowerCase() || "";
        const familyDelta = (familyRank[aFamily] ?? 99) - (familyRank[bFamily] ?? 99);
        if (familyDelta) return familyDelta;
        const contextDelta = Number(a.value.endsWith("[1m]")) - Number(b.value.endsWith("[1m]"));
        return contextDelta || b.value.localeCompare(a.value, undefined, { numeric: true });
      }),
  );
}

/**
 * The models Hermes can use with the provider it is configured for, read from
 * the caches Hermes keeps itself.
 *
 * On Nous Portal the free models come first and say so, and paid ones say they
 * need credits: an account with no balance is common, and a paid model on it
 * fails in a way that looks like a hang. Other providers list their catalog.
 *
 * @param {{ provider: string, defaultModel?: string, recommended?: object, catalog?: object }} input
 */
function parseHermesModels({ provider, defaultModel = "", recommended = null, catalog = null, unavailable = [] }) {
  const id = String(provider || "").trim();
  const marked = (value, label) => (value === defaultModel ? `${label} · your default` : label);
  const named = (model) => String(model.displayName && model.displayName !== model.modelName ? model.displayName : model.modelName).replace(/\s*\(free\)\s*$/i, "");
  const models = [];
  if (id === "nous") {
    const portal = recommended && Object.values(recommended)[0]?.data;
    for (const model of portal?.freeRecommendedModels ?? []) {
      if (model?.modelName) models.push({ value: String(model.modelName), label: marked(String(model.modelName), `${named(model)} · free`) });
    }
    for (const model of portal?.paidRecommendedModels ?? []) {
      if (model?.modelName) models.push({ value: String(model.modelName), label: marked(String(model.modelName), `${named(model)} · needs credits`) });
    }
  }
  for (const model of catalog?.providers?.[id]?.models ?? []) {
    if (!model?.id) continue;
    const value = String(model.id);
    const note = id === "nous" ? " · needs credits" : "";
    models.push({ value, label: marked(value, `${value}${note}`) });
  }
  // Hermes's caches outlive a model its provider has retired; one Hermes
  // reported as gone is not offered again.
  const gone = new Set(unavailable);
  return uniqueModels(models).filter((model) => !gone.has(model.value));
}

module.exports = {
  parseHermesModels,
  formatClaudeModelLabel,
  parseClaudeHelpModels,
  parseClaudeRuntimeModels,
  parseCliModelOutput,
  parseCustomModelOutput,
  parseCodexModelsCache,
  parseJsonModels,
  uniqueModels,
};
