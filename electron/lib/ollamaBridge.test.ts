import { describe, expect, it } from "vitest";
import {
  OLLAMA_BASE_URL,
  bridgeGuidance,
  customAgentFor,
  withOllamaProvider,
  BRIDGE_AGENTS,
  preferredBridge,
  automaticBridge,
  orderedForModel,
  bridgeConfiguredIds,
  localAgentOption,
  withQwenOllamaProvider,
} from "./ollamaBridge.cjs";

const opencode = BRIDGE_AGENTS.find((agent) => agent.id === "opencode");
const codex = BRIDGE_AGENTS.find((agent) => agent.id === "codex");

describe("withOllamaProvider", () => {
  it("adds a provider to an empty config", () => {
    const config = withOllamaProvider(null, ["qwen3-coder:30b"]);
    expect(config.provider.ollama.options.baseURL).toBe(OLLAMA_BASE_URL);
    expect(config.provider.ollama.models["qwen3-coder:30b"]).toEqual({ name: "qwen3-coder:30b" });
  });

  // Their file. A feature that helpfully replaces it to add one entry has done
  // more damage than the problem it solved.
  it("keeps every other provider untouched", () => {
    const config = withOllamaProvider(
      { provider: { anthropic: { apiKey: "secret" } }, theme: "dark" },
      ["llama3.3"],
    );
    expect(config.provider.anthropic).toEqual({ apiKey: "secret" });
    expect(config.theme).toBe("dark");
  });

  it("keeps models somebody configured by hand", () => {
    const config = withOllamaProvider(
      { provider: { ollama: { models: { "mine:7b": { name: "My model" } } } } },
      ["qwen3-coder:30b"],
    );
    expect(config.provider.ollama.models["mine:7b"]).toEqual({ name: "My model" });
    expect(config.provider.ollama.models["qwen3-coder:30b"]).toBeTruthy();
  });

  // Somebody serving Ollama on another host has a reason.
  it("does not overwrite a baseURL that is already set", () => {
    const config = withOllamaProvider(
      { provider: { ollama: { options: { baseURL: "http://box.local:11434/v1" } } } },
      ["llama3.3"],
    );
    expect(config.provider.ollama.options.baseURL).toBe("http://box.local:11434/v1");
  });

  it("is safe to run twice", () => {
    const once = withOllamaProvider(null, ["llama3.3"]);
    const twice = withOllamaProvider(once, ["llama3.3"]);
    expect(twice).toEqual(once);
  });

  it("ignores empty model names rather than writing a blank entry", () => {
    const config = withOllamaProvider(null, ["", "   ", "llama3.3"]);
    expect(Object.keys(config.provider.ollama.models)).toEqual(["llama3.3"]);
  });

  it("survives a config file that is not an object", () => {
    expect(withOllamaProvider("garbage", ["llama3.3"]).provider.ollama).toBeTruthy();
    expect(withOllamaProvider(undefined, ["llama3.3"]).provider.ollama).toBeTruthy();
  });
});

describe("bridgeGuidance", () => {
  // The whole failure was a screen that showed a model and then stopped.
  it("names the specific thing to install when nothing can drive the model", () => {
    const guidance = bridgeGuidance({ models: ["qwen3-coder:30b"], installedCommands: {} });
    expect(guidance.state).toBe("needs-agent");
    expect(guidance.message).toContain("cannot edit code");
    // Offered rather than named: Pitwall can install either of them, so this
    // is a decision the user can act on where they are standing.
    expect(guidance.suggestions.map((entry) => entry.name)).toContain("Aider");
    expect(guidance.suggestions.every((entry) => entry.catalogueId)).toBe(true);
    // Never the vendor's own CLI: a local model should not depend on a
    // company that sells inference.
    expect(guidance.suggestions.every((entry) => entry.id !== "codex")).toBe(true);
    expect(guidance.suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("states what choosing each harness costs you", () => {
    const guidance = bridgeGuidance({ models: ["m:1"], installedCommands: {} });
    const aider = guidance.suggestions.find((entry) => entry.id === "aider");
    // The one that needs no account is also the one that cannot use MCP, and
    // hiding that would be choosing on the user's behalf.
    expect(aider.tradeoff).toMatch(/No MCP/i);
    expect(guidance.suggestions.find((entry) => entry.id === "opencode").tradeoff).toMatch(/config/i);
  });

  it("is ready once something that can drive it is installed", () => {
    const guidance = bridgeGuidance({ models: ["qwen3-coder:30b"], installedCommands: { opencode: true } });
    expect(guidance.state).toBe("ready");
    expect(guidance.agents).toContain("opencode");
  });

  it("says the model is already usable when nothing needs pressing", () => {
    // The button would otherwise save a second, permanent copy of a row the
    // session dialog already offers.
    const guidance = bridgeGuidance({ models: ["qwen3-coder:30b"], installedCommands: { aider: true } });
    expect(guidance.state).toBe("automatic");
    expect(guidance.via).toBe("Aider");
  });

  it("asks for a model first when there is none", () => {
    expect(bridgeGuidance({ models: [], installedCommands: { opencode: true } }).state).toBe("no-models");
  });
});

describe("customAgentFor", () => {
  it("registers the agent against the provider and model that were configured", () => {
    const agent = customAgentFor({ agent: opencode, model: "qwen3-coder:30b" });
    expect(agent.command).toBe("opencode");
    expect(agent.args).toContain("ollama/qwen3-coder:30b");
    expect(agent.name).toContain("qwen3-coder:30b");
  });
});

describe("preferredBridge", () => {
  it("never prefers the vendor's own CLI over a neutral one", () => {
    // Nothing leaves the machine in Codex's local mode, but a local model
    // depending on a company that sells inference is the objection.
    expect(preferredBridge({ codex: true, opencode: true }).id).toBe("opencode");
    expect(preferredBridge({ codex: true, aider: true }).id).toBe("aider");
  });

  it("falls back to whatever is actually installed", () => {
    expect(preferredBridge({ opencode: true }).id).toBe("opencode");
  });

  it("is null when nothing can drive a model", () => {
    expect(preferredBridge({})).toBeNull();
  });
});

describe("localAgentOption", () => {
  it("offers nothing when no bridge is installed, rather than a row that cannot start", () => {
    expect(localAgentOption({ models: ["qwen3-coder:30b"], installedCommands: {} })).toBeNull();
  });

  it("offers nothing when there are no models", () => {
    expect(localAgentOption({ models: [], installedCommands: { codex: true } })).toBeNull();
  });

  it("keeps the flags that stop Codex's local stream dying, for anyone who connects it", () => {
    // Codex is no longer reached for automatically, but it still works when
    // somebody connects it deliberately, and without these the stream
    // disconnects on a model that cannot think — which reads as a broken
    // install rather than a wrong setting.
    const codexBridge = BRIDGE_AGENTS.find((agent) => agent.id === "codex");
    const args = codexBridge.args.join(" ");
    expect(args).toContain("model_reasoning_effort=none");
    expect(args).toContain("model_supports_reasoning_summaries=false");
    expect(args).toContain("--local-provider ollama");
  });

  it("does not offer a bridge that would have to edit a config file first", () => {
    // Writing a provider into somebody's settings is a deliberate act, not
    // something discovery should do on its own.
    expect(localAgentOption({ models: ["qwen3-coder:30b"], installedCommands: { opencode: true } })).toBeNull();
    expect(localAgentOption({ models: ["qwen3-coder:30b"], installedCommands: { qwen: true } })).toBeNull();
  });

  it("offers aider with the endpoint and the commit guard it needs", () => {
    const option = localAgentOption({ models: ["qwen3-coder:30b"], installedCommands: { aider: true } });
    // No /v1: aider speaks Ollama's native API, unlike every other bridge.
    expect(option.args).toContain("OLLAMA_API_BASE=http://127.0.0.1:11434");
    expect(option.args).not.toContain("/v1");
    // Pitwall computes changesets itself; aider committing underneath it
    // produces a diff nobody wrote.
    expect(option.args).toContain("--no-auto-commits");
    expect(option.models[0].value).toBe("ollama_chat/qwen3-coder:30b");
  });

  it("offers the pulled name itself to a bridge that speaks to Ollama directly", () => {
    const option = localAgentOption({ models: ["qwen3-coder:30b"], installedCommands: { aider: true } });
    // Aider namespaces it; Codex takes it bare. Both are the model that was
    // pulled, spelled the way that bridge resolves it.
    expect(option.models[0].label).toBe("qwen3-coder:30b");
    expect(BRIDGE_AGENTS.find((agent) => agent.id === "codex").modelValue("qwen3-coder:30b"))
      .toBe("qwen3-coder:30b");
  });

  it("never offers an Auto model, because a local model is the one that was pulled", () => {
    const option = localAgentOption({ models: ["a:1", "b:2"], installedCommands: { aider: true } });
    expect(option.models).toHaveLength(2);
    expect(option.models.some((model) => /auto/i.test(model.value))).toBe(false);
  });
});

describe("automaticBridge", () => {
  it("only ever returns a bridge that needs nothing written", () => {
    expect(automaticBridge({ opencode: true, qwen: true })).toBeNull();
    expect(automaticBridge({ aider: true }).id).toBe("aider");
    expect(automaticBridge({ codex: true, aider: true }).id).toBe("aider");
  });
});

describe("withQwenOllamaProvider", () => {
  it("keeps settings that have nothing to do with Pitwall", () => {
    const out = withQwenOllamaProvider({ theme: "dark", env: { FOO: "1" } }, ["m:1"], "m:1");
    expect(out.theme).toBe("dark");
    expect(out.env.FOO).toBe("1");
  });

  it("pins the active model, since the bridge passes no model flag", () => {
    expect(withQwenOllamaProvider({}, ["m:1"], "m:1").model.name).toBe("m:1");
  });

  it("supplies the key the client demands and Ollama ignores", () => {
    expect(withQwenOllamaProvider({}, ["m:1"], "m:1").env.OLLAMA_API_KEY).toBe("ollama");
  });

  it("keeps providers somebody configured by hand", () => {
    const existing = { modelProviders: { openai: [{ id: "gpt-4o", baseUrl: "https://api.openai.com/v1" }] } };
    const out = withQwenOllamaProvider(existing, ["m:1"], "m:1");
    expect(out.modelProviders.openai).toHaveLength(2);
    expect(out.modelProviders.openai[0].id).toBe("gpt-4o");
  });

  it("is safe to run twice", () => {
    const once = withQwenOllamaProvider({}, ["m:1"], "m:1");
    const twice = withQwenOllamaProvider(once, ["m:1"], "m:1");
    expect(twice.modelProviders.openai).toHaveLength(1);
  });
});

describe("choosing a bridge for the model in hand", () => {
  it("puts the harness built for Qwen first when the model is a Qwen one", () => {
    // Codex has no profile for a pulled Qwen model and says so, and its
    // context window cannot be corrected from the command line.
    expect(orderedForModel("qwen3-coder:30b")[0].id).toBe("qwen");
    expect(orderedForModel("qwen2.5-coder:7b")[0].id).toBe("qwen");
  });

  it("leads with the provider-agnostic one for anything else", () => {
    // Designed to be pointed at whatever endpoint you have, which is the
    // question being asked of it here, and it supports MCP.
    expect(orderedForModel("deepseek-coder:6.7b")[0].id).toBe("opencode");
    expect(orderedForModel("")[0].id).toBe("opencode");
  });

  it("puts the vendor's own CLI last, whatever the model", () => {
    for (const model of ["qwen3-coder:30b", "llama3.1:8b", ""]) {
      const order = orderedForModel(model);
      expect(order[order.length - 1].id).toBe("codex");
    }
  });

  it("still only offers a no-configuration bridge automatically", () => {
    // Qwen Code is preferred for a Qwen model and is a config bridge, so
    // automatic discovery must not reach for it.
    expect(automaticBridge({ qwen: true }, "qwen3-coder:30b")).toBeNull();
  });

  it("will not reach for the vendor's CLI on its own, even alone", () => {
    // Offering to install a neutral harness beats quietly bridging a local
    // model through the tool of a company that sells inference.
    expect(automaticBridge({ codex: true }, "qwen3-coder:30b")).toBeNull();
    expect(automaticBridge({ codex: true, aider: true }, "qwen3-coder:30b").id).toBe("aider");
  });

  it("prefers it once it is installed and the user has connected it", () => {
    expect(preferredBridge({ qwen: true, codex: true }, "qwen3-coder:30b").id).toBe("qwen");
    // Still neutral-first for a model it was not built for.
    expect(preferredBridge({ qwen: true, codex: true }, "llama3.1:8b").id).toBe("qwen");
    expect(preferredBridge({ codex: true }, "llama3.1:8b").id).toBe("codex");
  });
});

describe("what a local model is offered with", () => {
  it("carries the context length so nothing downstream has to guess", () => {
    const option = localAgentOption({
      models: ["qwen3-coder:30b"],
      installedCommands: { aider: true },
      facts: { "qwen3-coder:30b": { contextLength: 262144, tools: true } },
    });
    expect(option.models[0].contextLength).toBe(262144);
  });

  it("is content with no facts at all", () => {
    const option = localAgentOption({ models: ["m:1"], installedCommands: { aider: true } });
    expect(option.models[0].contextLength).toBe(0);
  });
});

describe("withQwenOllamaProvider and the context window", () => {
  it("writes the real window rather than leaving a default to be assumed", () => {
    const out = withQwenOllamaProvider({}, ["qwen3-coder:30b"], "qwen3-coder:30b", { "qwen3-coder:30b": 262144 });
    expect(out.modelProviders.openai[0].generationConfig.contextWindowSize).toBe(262144);
  });

  it("writes no window when nothing reported one, rather than inventing one", () => {
    const out = withQwenOllamaProvider({}, ["m:1"], "m:1", {});
    expect(out.modelProviders.openai[0].generationConfig).toBeUndefined();
  });
});

describe("a config bridge that has already been connected", () => {
  const configured = { qwen: true, opencode: false };

  it("is used automatically once its file points at Ollama", () => {
    // The bug this fixes: you could install the harness, connect it, and
    // still be told there was nothing to drive your model with.
    expect(automaticBridge({ qwen: true }, "qwen3-coder:30b", configured).id).toBe("qwen");
    expect(localAgentOption({
      models: ["qwen3-coder:30b"],
      installedCommands: { qwen: true },
      configuredIds: configured,
    }).command).toBe("qwen");
  });

  it("is not used before its file has been written", () => {
    // Writing a provider into somebody's config stays the deliberate act.
    expect(automaticBridge({ qwen: true }, "qwen3-coder:30b", {})).toBeNull();
    expect(automaticBridge({ qwen: true, opencode: true }, "llama3.1:8b", configured).id).toBe("qwen");
  });

  it("reads what set up means from each bridge's own file", () => {
    expect(bridgeConfiguredIds({
      qwen: { modelProviders: { openai: [{ baseUrl: "http://127.0.0.1:11434/v1" }] } },
      opencode: { provider: { ollama: {} } },
    })).toEqual({ qwen: true, opencode: true });

    // A config with providers, none of them Ollama, is not set up for this.
    expect(bridgeConfiguredIds({
      qwen: { modelProviders: { openai: [{ baseUrl: "https://api.openai.com/v1" }] } },
      opencode: { provider: { anthropic: {} } },
    })).toEqual({ qwen: false, opencode: false });
  });

  it("says the model is ready once a connected bridge can drive it", () => {
    const guidance = bridgeGuidance({
      models: ["qwen3-coder:30b"],
      installedCommands: { qwen: true },
      configuredIds: configured,
    });
    expect(guidance.state).toBe("automatic");
    expect(guidance.via).toBe("Qwen Code");
  });
});

describe("the Qwen setting that decides whether a session can start at all", () => {
  it("names the protocol, so Qwen Code does not stop and ask", () => {
    // Its docs: "Without this, you'd need to run /auth interactively" — which
    // a session driven by Pitwall has nobody to answer.
    const out = withQwenOllamaProvider({}, ["m:1"], "m:1", {});
    expect(out.security.auth.selectedType).toBe("openai");
  });

  it("never overrides an auth choice the user already made", () => {
    const existing = { security: { auth: { selectedType: "anthropic" }, sandbox: true } };
    const out = withQwenOllamaProvider(existing, ["m:1"], "m:1", {});
    expect(out.security.auth.selectedType).toBe("anthropic");
    // And keeps the rest of their security block.
    expect(out.security.sandbox).toBe(true);
  });
})
