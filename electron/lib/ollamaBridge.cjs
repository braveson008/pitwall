/**
 * Making a pulled Ollama model usable.
 *
 * A model on port 11434 is not an agent. Pitwall starts sessions, and a
 * session needs a CLI that can read files, run commands and edit code —
 * `ollama run` is a chat prompt and cannot touch a repository. So Pitwall
 * could install Ollama, pull a 30B coder model, show it sitting there, and
 * offer no way to use it for anything. That is the gap this closes.
 *
 * The bridge is an agent CLI that speaks to an OpenAI-compatible endpoint,
 * pointed at Ollama's. OpenCode is the default because it is MIT, provider
 * agnostic by design, and the most installed of the agents Pitwall knows.
 *
 * ## Why the config is merged rather than written
 *
 * `~/.config/opencode/opencode.json` belongs to the user. They may have
 * providers, keys and preferences in it that have nothing to do with Pitwall,
 * and a feature that helpfully replaces that file to add one entry has done
 * more damage than the problem it solved. Everything here merges, keeps what
 * it does not understand, and touches one key.
 */

const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

/**
 * Agents that can be pointed at a local model, best first.
 *
 * Two shapes, and the difference decides how much setup a model needs.
 *
 * A `flags` bridge needs nothing but the right argv — no file is written, no
 * state is left behind, and a pulled model works the moment it exists. A
 * `config` bridge has to have a provider merged into a file it owns first,
 * which is somebody's configuration being edited and therefore a deliberate
 * act rather than something that happens on discovery.
 *
 * That is why only `flags` bridges are offered automatically. Every entry
 * here was checked against its own documentation; the flags are not guesses,
 * and the comments say what each one is preventing.
 */
const BRIDGE_AGENTS = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    kind: "flags",
    licence: "Apache-2.0",
    mcp: true,
    // Open source, but published by a company that sells inference, and its
    // normal mode signs in to that company's account.
    vendor: "OpenAI",
    vendorNeutral: false,
    /**
     * `--oss` selects the local provider. The two overrides are not tuning.
     *
     * Codex defaults to a high reasoning effort and asks for thinking output.
     * Local coder models mostly cannot produce it, and the failure is not a
     * clean refusal — the stream disconnects part-way with `does not support
     * thinking`, which reads as a broken install rather than a wrong setting.
     */
    args: [
      "--oss",
      "--local-provider",
      "ollama",
      "-c",
      "model_reasoning_effort=none",
      "-c",
      "model_supports_reasoning_summaries=false",
    ],
    modelValue: (model) => model,
    catalogueId: "codex",
    why: "Speaks to Ollama natively, so a pulled model needs no setup.",
    tradeoff: "Supports MCP, so it can use the servers you configure here.",
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    kind: "flags",
    licence: "Apache-2.0",
    // No MCP, so it cannot use anything configured in Connections.
    mcp: false,
    vendor: "Aider AI",
    vendorNeutral: true,
    /**
     * `--set-env` is aider's own documented way to set the endpoint without
     * exporting anything, which keeps this to argv.
     *
     * Note the base URL has no `/v1` — aider talks to Ollama's native API,
     * not its OpenAI-compatible one, and the `/v1` that every other bridge
     * needs makes this one fail.
     *
     * `--no-auto-commits` because aider commits every edit by default.
     * Pitwall computes a task's changeset against a fork point, and an agent
     * making its own commits underneath that produces a diff nobody wrote.
     */
    args: [
      "--set-env",
      "OLLAMA_API_BASE=http://127.0.0.1:11434",
      "--no-auto-commits",
    ],
    // Aider routes Ollama through this prefix; the bare name is a different
    // provider to it.
    modelValue: (model) => `ollama_chat/${model}`,
    catalogueId: "aider",
    why: "The most established harness for local models, and needs no account.",
    tradeoff: "No MCP, so it cannot use the servers you configure here.",
  },
  {
    id: "qwen",
    name: "Qwen Code",
    command: "qwen",
    kind: "config",
    licence: "Apache-2.0",
    mcp: true,
    vendor: "Alibaba",
    vendorNeutral: true,
    configPath: [".qwen", "settings.json"],
    isConfigured: (config) => Array.isArray(config?.modelProviders?.openai)
      && config.modelProviders.openai.some((entry) => String(entry?.baseUrl || "").includes("11434")),
    args: [],
    // The active model is pinned in settings rather than passed as a flag.
    modelValue: () => "",
    catalogueId: "qwen-code",
    why: "Built for the Qwen models, and supports MCP.",
    tradeoff: "Needs a provider written into its settings file first.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    kind: "config",
    licence: "MIT",
    mcp: true,
    vendor: "OpenCode",
    vendorNeutral: true,
    configPath: [".config", "opencode", "opencode.json"],
    isConfigured: (config) => Boolean(config?.provider?.ollama),
    args: [],
    modelValue: (model) => `ollama/${model}`,
    catalogueId: "opencode",
    why: "Provider-agnostic by design, and MIT licensed.",
    tradeoff: "Needs a provider written into its config file first.",
  },
];

/**
 * Which config bridges already point at Ollama.
 *
 * Kept here rather than in the caller so the question "is this one set up"
 * has one answer, and each bridge decides what set up means for its own file.
 */
function bridgeConfiguredIds(configsById) {
  const out = {};
  for (const agent of BRIDGE_AGENTS) {
    if (agent.kind !== "config" || !agent.isConfigured) continue;
    const config = configsById?.[agent.id];
    out[agent.id] = Boolean(config) && agent.isConfigured(config) === true;
  }
  return out;
}

/** The bridge to use, of any kind, given what is on this machine. */
function preferredBridge(installedCommands, model = "") {
  const ordered = orderedForModel(model);
  return ordered.find((agent) => installedCommands?.[agent.command]) || null;
}

/**
 * The order to prefer bridges in, for this particular model.
 *
 * A harness that knows a model's shape beats one that guesses at it. Codex has
 * no profile for a pulled Qwen model and says so — "defaulting to fallback
 * metadata; this can degrade performance" — and its context window cannot be
 * corrected from the command line. Qwen Code takes the figure in its config,
 * so Pitwall can write the real one, and it is built for these models.
 *
 * That is worth a place ahead of Codex when the model is a Qwen one and Qwen
 * Code is installed. It does not change what is offered automatically: Qwen
 * Code is a config bridge, and writing to somebody's settings stays a
 * deliberate act.
 */
function orderedForModel(model) {
  const isQwen = /^qwen/i.test(String(model || "").trim());

  // Vendor-neutral first, always.
  //
  // A model running on your own machine should not be driven by a CLI
  // published by a company that sells inference. Nothing is sent to OpenAI in
  // Codex's `--oss` mode — inference is entirely local — but the dependency is
  // the objection: a local-first feature whose default path is a commercial
  // vendor's tool, and whose ordinary mode signs in to that vendor's account.
  // Codex still works and is still offered, last, for somebody who already has
  // it and nothing else.
  const rank = (agent) => {
    if (!agent.vendorNeutral) return 9;
    // For a Qwen model, the harness built for it knows its shape: it takes the
    // context window in configuration, where Codex guesses and says so.
    if (agent.id === "qwen") return isQwen ? 0 : 3;
    // Otherwise the provider-agnostic one leads: it is designed to point at
    // whatever endpoint you have, which is the same thing being asked of it
    // here, and it supports the MCP servers configured in Pitwall.
    if (agent.id === "opencode") return 1;
    return agent.mcp ? 2 : 4;
  };

  return [...BRIDGE_AGENTS].sort((a, b) => rank(a) - rank(b));
}

/**
 * The bridge that can be used without editing anybody's configuration.
 *
 * Separate from `preferredBridge` because this one is allowed to happen by
 * itself. Discovering a model and silently writing a provider into a config
 * file the user owns is not discovery, it is a change they did not ask for.
 */
/**
 * The bridge discovery may reach for on its own.
 *
 * Two conditions, and the second is a decision rather than a constraint.
 *
 * It must need nothing written, because writing a provider into somebody's
 * config file is a deliberate act and not something discovery should do.
 *
 * And it must be vendor-neutral. A model running on your own machine should
 * not be driven, by default, by a CLI published by a company that sells
 * inference — that dependency is the thing a local model exists to avoid, even
 * though no inference leaves the machine in that CLI's local mode. Where
 * nothing neutral is installed, Pitwall offers to install one rather than
 * quietly reaching for the vendor's.
 */
function automaticBridge(installedCommands, model = "", configuredIds = {}) {
  return orderedForModel(model).find((agent) => {
    if (!agent.vendorNeutral || !installedCommands?.[agent.command]) return false;
    // A flags bridge needs nothing written and is usable at once. A config
    // bridge is usable once its file already points at Ollama — writing that
    // file is the deliberate act, and it has been done. Refusing to use it
    // afterwards was the bug: you could install the harness, connect it, and
    // still be told there was nothing to drive your model with.
    return agent.kind === "flags" || configuredIds[agent.id] === true;
  }) || null;
}

/**
 * The agent row a pulled model should appear as, derived rather than saved.
 *
 * Deliberately not persisted as a user-defined agent. A saved row outlives the
 * thing it points at: delete the model in Ollama and the row stays, offering a
 * session that cannot start. Deriving it means the list describes what is
 * currently runnable, and a removed model simply stops being offered.
 */
function localAgentOption({ models, installedCommands, facts = {}, configuredIds = {} }) {
  // Ordered for the first model, since that is the one a fresh session picks
  // and the one whose harness fit matters.
  const bridge = automaticBridge(installedCommands, models?.[0] || "", configuredIds);
  if (!bridge || !models?.length) return null;
  return {
    id: `ollama:${bridge.id}`,
    name: "Ollama",
    command: bridge.command,
    args: bridge.args.join(" "),
    bridgeId: bridge.id,
    // Nothing is "Auto" here: a local model is the specific one pulled.
    models: models.map((model) => ({
      label: model,
      value: bridge.modelValue(model),
      // Carried so a view can say what the model can hold rather than leaving
      // it to be discovered when a long session starts compacting.
      contextLength: facts[model]?.contextLength || 0,
    })),
  };
}

/**
 * Adds an Ollama provider to an OpenCode config without disturbing the rest.
 *
 * Returns the whole document, so the caller writes one file and never has to
 * reason about what was already in it.
 */
function withOllamaProvider(existing, models) {
  const config = existing && typeof existing === "object" ? { ...existing } : {};
  const providers = config.provider && typeof config.provider === "object" ? { ...config.provider } : {};
  const current = providers.ollama && typeof providers.ollama === "object" ? providers.ollama : {};

  // Their model list is kept and ours added to it: a model somebody
  // configured by hand is not ours to remove.
  const currentModels = current.models && typeof current.models === "object" ? current.models : {};
  const merged = { ...currentModels };
  for (const model of models) {
    const name = String(model || "").trim();
    if (!name) continue;
    if (!merged[name]) merged[name] = { name };
  }

  providers.ollama = {
    ...current,
    npm: current.npm || "@ai-sdk/openai-compatible",
    name: current.name || "Ollama (local)",
    options: { ...(current.options || {}), baseURL: current.options?.baseURL || OLLAMA_BASE_URL },
    models: merged,
  };

  return { ...config, $schema: config.$schema || "https://opencode.ai/config.json", provider: providers };
}

/**
 * Adds an Ollama provider to a Qwen Code settings file without disturbing it.
 *
 * Qwen's shape is different enough from OpenCode's to need its own writer:
 * providers are a list under a protocol key rather than a map, the key lives
 * in `env`, and the active model is pinned in `model.name` rather than passed
 * on the command line — which is why the Qwen bridge launches with no args.
 *
 * Same rule as the other writer, for the same reason: the file belongs to the
 * user, so entries that are already there are kept and only the one provider
 * is touched.
 */
function withQwenOllamaProvider(existing, models, activeModel, contextByModel = {}) {
  const config = existing && typeof existing === "object" ? { ...existing } : {};

  const env = { ...(config.env && typeof config.env === "object" ? config.env : {}) };
  // Ollama ignores the key, but the client requires one to be present.
  if (!env.OLLAMA_API_KEY) env.OLLAMA_API_KEY = "ollama";

  const providers = config.modelProviders && typeof config.modelProviders === "object"
    ? { ...config.modelProviders }
    : {};
  const openai = Array.isArray(providers.openai) ? [...providers.openai] : [];

  for (const model of models) {
    const name = String(model || "").trim();
    if (!name) continue;
    // Matched on id so running this twice updates rather than duplicates.
    if (openai.some((entry) => entry && entry.id === name)) continue;
    const contextWindow = Number(contextByModel[name]) || 0;
    openai.push({
      id: name,
      name: `${name} (Ollama)`,
      envKey: "OLLAMA_API_KEY",
      baseUrl: "http://127.0.0.1:11434/v1",
      // Written from what Ollama reports rather than left to a default. A
      // harness that does not know a 256k model's window drives it as if it
      // were far smaller and compacts the conversation for no reason.
      ...(contextWindow ? { generationConfig: { contextWindowSize: contextWindow } } : {}),
    });
  }

  providers.openai = openai;

  // Without this Qwen Code opens its "Select Authentication Method" screen on
  // every start and waits — which is precisely what a session driven by
  // Pitwall cannot answer. Its own documentation says to set it alongside
  // `modelProviders`; writing the provider and not this produced a config that
  // looked complete and could not start.
  const security = config.security && typeof config.security === "object" ? { ...config.security } : {};
  const auth = security.auth && typeof security.auth === "object" ? { ...security.auth } : {};

  return {
    ...config,
    env,
    modelProviders: providers,
    security: { ...security, auth: { ...auth, selectedType: auth.selectedType || "openai" } },
    model: { ...(config.model && typeof config.model === "object" ? config.model : {}), name: activeModel },
  };
}

/**
 * What to tell somebody who has a model and nothing to run it with.
 *
 * Names the specific thing to do next rather than saying it is unsupported —
 * the whole failure here was a screen that showed a model and then stopped.
 */
function bridgeGuidance({ models, installedCommands, configuredIds = {} }) {
  if (!models.length) {
    return { state: "no-models", message: "Pull a model first — there is nothing to point an agent at yet." };
  }

  const model = models[0] || "";
  const ordered = orderedForModel(model);
  const installed = ordered.filter((agent) => installedCommands[agent.command]);
  const neutral = installed.filter((agent) => agent.vendorNeutral);

  // Already offered on its own, so there is nothing to press: a button that
  // saves a second, permanent copy of a row that is already there is how a
  // list ends up with two of everything.
  const automatic = automaticBridge(installedCommands, model, configuredIds);
  if (automatic) {
    return {
      state: "automatic",
      agents: installed.map((agent) => agent.id),
      via: automatic.name,
      message: `Ready to use. Your pulled models appear when you start a session, driven by ${automatic.name} on this machine.`,
    };
  }

  // Something neutral is here but needs its config written, which is a
  // deliberate act rather than something discovery does.
  if (neutral.length) {
    return { state: "ready", agents: neutral.map((agent) => agent.id), message: "" };
  }

  // Nothing neutral. Offered rather than merely named, because the choice is a
  // real trade-off — the harness that needs no account is also the one that
  // cannot use your MCP servers — and Pitwall can install any of them.
  //
  // A vendor's own CLI that happens to be installed is named here rather than
  // used automatically. It works, and nothing leaves the machine in its local
  // mode; it is simply not what a local model should depend on by default,
  // and that is the user's call to make knowingly.
  const vendorFallback = installed.find((agent) => !agent.vendorNeutral);
  return {
    state: "needs-agent",
    suggestion: ordered.find((agent) => agent.vendorNeutral)?.id,
    suggestions: ordered
      .filter((agent) => agent.vendorNeutral)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        catalogueId: agent.catalogueId,
        licence: agent.licence,
        why: agent.why,
        tradeoff: agent.tradeoff,
        // Whether installing it is the whole job. A config bridge still needs
        // a provider written into its own file afterwards, and saying so
        // beforehand is cheaper than the user finding out.
        setup: agent.kind === "flags"
          ? "Nothing else to do — your models appear once it is installed."
          : "One more press after installing, to write the provider into its config.",
      })),
    fallback: vendorFallback
      ? { id: vendorFallback.id, name: vendorFallback.name, vendor: vendorFallback.vendor }
      : null,
    message: vendorFallback
      ? "A model on its own cannot edit code — it cannot read a file or run a command. " +
        `Pitwall can install an open harness to drive it, and will not reach for ${vendorFallback.name} on its own: ` +
        `a model running on your machine should not depend on ${vendorFallback.vendor} by default.`
      : "A model on its own cannot edit code — it cannot read a file or run a command. " +
        "Pitwall needs a harness to drive it, and can install one for you.",
  };
}

/**
 * The custom agent Pitwall registers once a bridge is configured.
 *
 * Built from the bridge's own definition rather than a hard-coded shape, so a
 * bridge that pins its model in a config file contributes no model flag and
 * one that takes it on the command line does.
 */
function customAgentFor({ agent, model }) {
  const modelValue = agent.modelValue ? agent.modelValue(model) : model;
  const args = [...(agent.args || [])];
  if (modelValue) args.push("--model", modelValue);
  return {
    name: `${agent.name} · ${model}`,
    command: agent.command,
    args: args.join(" "),
    models: model,
    modelDiscoveryCommand: "",
    login: "",
  };
}

module.exports = {
  OLLAMA_BASE_URL,
  BRIDGE_AGENTS,
  withOllamaProvider,
  bridgeGuidance,
  customAgentFor,
  preferredBridge,
  automaticBridge,
  orderedForModel,
  bridgeConfiguredIds,
  localAgentOption,
  withQwenOllamaProvider,
};
