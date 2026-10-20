import { describe, expect, it } from "vitest";
import {
  parseHermesModels,
  parseClaudeHelpModels,
  parseClaudeRuntimeModels,
  parseCliModelOutput,
  parseCustomModelOutput,
  parseCodexModelsCache,
} from "./modelDiscovery.cjs";

describe("parseCodexModelsCache", () => {
  it("returns the visible account models in CLI priority order", () => {
    expect(parseCodexModelsCache({
      models: [
        { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", priority: 0 },
        { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", priority: 7 },
        { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", priority: 1 },
      ],
    })).toEqual([
      { label: "GPT-5.6-Sol", value: "gpt-5.6-sol" },
      { label: "GPT-5.5", value: "gpt-5.5" },
    ]);
  });
});

describe("parseCliModelOutput", () => {
  it("supports JSON model endpoints", () => {
    expect(parseCliModelOutput(JSON.stringify({
      data: [{ id: "grok-4.5", display_name: "Grok 4.5" }, { id: "grok-4" }],
    }))).toEqual([
      { label: "Grok 4.5", value: "grok-4.5" },
      { label: "grok-4", value: "grok-4" },
    ]);
  });

  it("extracts model ids from text output", () => {
    expect(parseCliModelOutput("* gemini-3-pro-preview  available\n* gemini-3-flash-preview  available"))
      .toEqual([
        { label: "gemini-3-pro-preview", value: "gemini-3-pro-preview" },
        { label: "gemini-3-flash-preview", value: "gemini-3-flash-preview" },
      ]);
  });
});

describe("parseCustomModelOutput", () => {
  it("supports arbitrary agent model ids in one-model-per-line output", () => {
    expect(parseCustomModelOutput("qwen2.5-coder\ndeepseek-r1\nllama3.1:70b"))
      .toEqual([
        { label: "qwen2.5-coder", value: "qwen2.5-coder" },
        { label: "deepseek-r1", value: "deepseek-r1" },
        { label: "llama3.1:70b", value: "llama3.1:70b" },
      ]);
  });
});

describe("parseClaudeHelpModels", () => {
  it("derives aliases from the installed Claude CLI instead of a static list", () => {
    const help = "--model <model> Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name (e.g. 'claude-fable-5'). -n, --name";
    expect(parseClaudeHelpModels(help)).toEqual([
      { label: "Fable", value: "fable" },
      { label: "Opus", value: "opus" },
      { label: "Sonnet", value: "sonnet" },
    ]);
  });
});

describe("parseClaudeRuntimeModels", () => {
  it("returns concrete models from Claude's authenticated runtime cache", () => {
    expect(parseClaudeRuntimeModels({
      additionalModelOptionsCache: [{ value: "claude-fable-5[1m]", label: "Fable" }],
      cachedGrowthBookFeatures: {
        tengu_auto_mode_config: {
          severityByModel: {
            "claude-sonnet-5[1m]": {},
            "claude-opus-4-8[1m]": {},
            "claude-sonnet-5": {},
            "claude-opus-4-8": {},
          },
        },
      },
      clientDataCacheSlots: {
        a: { model: "claude-opus-4-8" },
      },
    })).toEqual([
      { label: "Fable 5 · 1M context", value: "claude-fable-5[1m]" },
      { label: "Opus 4.8", value: "claude-opus-4-8" },
      { label: "Opus 4.8 · 1M context", value: "claude-opus-4-8[1m]" },
      { label: "Sonnet 5", value: "claude-sonnet-5" },
      { label: "Sonnet 5 · 1M context", value: "claude-sonnet-5[1m]" },
    ]);
  });
});

describe("parseHermesModels", () => {
  const recommended = { "https://portal.nousresearch.com": { data: {
    freeRecommendedModels: [{ modelName: "poolside/laguna-s-2.1:free", displayName: "poolside/laguna-s-2.1:free" }],
    paidRecommendedModels: [{ modelName: "x-ai/grok-4.7", displayName: "SpaceXAI: Grok 4.7" }],
  } } };
  const catalog = { providers: {
    nous: { models: [{ id: "x-ai/grok-4.7" }, { id: "anthropic/claude-sonnet-5.5" }] },
    openrouter: { models: [{ id: "deepseek/deepseek-v4.1-flash" }] },
  } };

  it("puts Portal's free models first and marks what needs credits", () => {
    expect(parseHermesModels({ provider: "nous", recommended, catalog })).toEqual([
      { value: "poolside/laguna-s-2.1:free", label: "poolside/laguna-s-2.1:free · free" },
      { value: "x-ai/grok-4.7", label: "SpaceXAI: Grok 4.7 · needs credits" },
      { value: "anthropic/claude-sonnet-5.5", label: "anthropic/claude-sonnet-5.5 · needs credits" },
    ]);
  });

  it("lists another provider's catalog and marks the configured default", () => {
    expect(parseHermesModels({ provider: "openrouter", defaultModel: "deepseek/deepseek-v4.1-flash", recommended, catalog })).toEqual([
      { value: "deepseek/deepseek-v4.1-flash", label: "deepseek/deepseek-v4.1-flash · your default" },
    ]);
  });

  it("drops a model Hermes has reported gone, and a doubled free marker", () => {
    const withRetired = { "https://portal.nousresearch.com": { data: { freeRecommendedModels: [
      { modelName: "stealth/space-bunny-alpha", displayName: "stealth/space-bunny-alpha" },
      { modelName: "poolside/laguna-xs-2.1:free", displayName: "Poolside: Laguna XS 2.1 (free)" },
    ] } } };
    expect(parseHermesModels({ provider: "nous", recommended: withRetired, unavailable: ["stealth/space-bunny-alpha"] })).toEqual([
      { value: "poolside/laguna-xs-2.1:free", label: "Poolside: Laguna XS 2.1 · free" },
    ]);
  });

  it("returns nothing rather than guessing when Hermes has no cache", () => {
    expect(parseHermesModels({ provider: "nous" })).toEqual([]);
  });
});
