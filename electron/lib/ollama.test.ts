import { describe, expect, it } from "vitest";
import { isModelName, parseModels, formatSize, ollamaGuidance , modelFacts, servedContextLength, usableContextLength } from "./ollama.cjs";

describe("isModelName", () => {
  it("accepts the shapes Ollama actually uses", () => {
    for (const name of ["llama3.3", "qwen3-coder:30b", "library/gemma3", "deepseek-r1:7b-qwen-distill"]) {
      expect(isModelName(name)).toBe(true);
    }
  });

  // The name reaches a spawned process, so it is refused rather than escaped.
  it("refuses anything that could carry a shell", () => {
    for (const name of [
      "llama3; rm -rf /",
      "llama3 && curl evil",
      "$(whoami)",
      "../../etc/passwd",
      "llama3|sh",
      "",
      " ",
      "a".repeat(200),
    ]) {
      expect(isModelName(name)).toBe(false);
    }
  });
});

describe("parseModels", () => {
  it("reads the tag list into names and sizes", () => {
    const models = parseModels({
      models: [
        { name: "qwen3-coder:30b", size: 18_000_000_000, details: { parameter_size: "30B" } },
        { name: "llama3.3", size: 4_700_000_000 },
      ],
    });
    expect(models.map((model) => model.name)).toEqual(["llama3.3", "qwen3-coder:30b"]);
    expect(models[1].parameters).toBe("30B");
  });

  it("survives a response that is not the shape expected", () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({})).toEqual([]);
    expect(parseModels({ models: [{}, { name: "" }] })).toEqual([]);
  });
});

describe("formatSize", () => {
  it("reads in the unit a person would use", () => {
    expect(formatSize(18_000_000_000)).toBe("18.0 GB");
    expect(formatSize(700_000_000)).toBe("700 MB");
  });

  it("says nothing rather than 0 when there is no figure", () => {
    expect(formatSize(0)).toBe("");
    expect(formatSize(Number.NaN)).toBe("");
  });
});

describe("ollamaGuidance", () => {
  // In the order they have to be fixed: telling someone to pull a model
  // against a server that is not running sends them to a connection refused.
  it("reports the first thing standing in the way, not the last", () => {
    expect(ollamaGuidance({ installed: false, serving: false, modelCount: 0 }).state).toBe("missing");
    expect(ollamaGuidance({ installed: true, serving: false, modelCount: 0 }).state).toBe("stopped");
    expect(ollamaGuidance({ installed: true, serving: true, modelCount: 0 }).state).toBe("empty");
    expect(ollamaGuidance({ installed: true, serving: true, modelCount: 3 }).state).toBe("ready");
  });

  // The failure it exists to prevent: a 404 naming a model you thought you had.
  it("says what an agent pointed at an empty Ollama would see", () => {
    expect(ollamaGuidance({ installed: true, serving: true, modelCount: 0 }).message).toContain("404");
  });

  it("is silent once there is nothing to do", () => {
    expect(ollamaGuidance({ installed: true, serving: true, modelCount: 1 }).message).toBe("");
  });
});

describe("modelFacts", () => {
  it("finds the context length whatever the architecture calls it", () => {
    // The key is namespaced — qwen3moe.context_length, llama.context_length —
    // so it is found by suffix rather than by knowing every architecture.
    expect(modelFacts({ model_info: { "qwen3moe.context_length": 262144 } }).contextLength).toBe(262144);
    expect(modelFacts({ model_info: { "llama.context_length": 8192 } }).contextLength).toBe(8192);
  });

  it("reports whether the model can call tools", () => {
    // The deciding fact: a model that cannot call tools will hold a
    // conversation and change nothing, which is worse than not being offered.
    expect(modelFacts({ capabilities: ["completion", "tools"] }).tools).toBe(true);
    expect(modelFacts({ capabilities: ["completion"] }).tools).toBe(false);
  });

  it("survives a response that says nothing", () => {
    const facts = modelFacts({});
    expect(facts.contextLength).toBe(0);
    expect(facts.tools).toBe(false);
    expect(facts.capabilities).toEqual([]);
  });
});

describe("what the harness is told its context window is", () => {
  /**
   * The bug this exists for: a council member printed tool calls as plain text
   * instead of making them, then looped trying again. The cause was two
   * different numbers being treated as one — the model declared 262144, Ollama
   * had it loaded at 32768, and Pitwall wrote the first into the harness's
   * config. The harness filled 262k of prompt, Ollama truncated it from the
   * front, and the tool definitions went with the truncation.
   */
  it("reads the context Ollama actually loaded a model with", () => {
    const ps = { models: [{ name: "qwen3-coder:30b", context_length: 32768 }] };
    expect(servedContextLength(ps, "qwen3-coder:30b")).toBe(32768);
  });

  it("matches on either name the ps endpoint uses", () => {
    expect(servedContextLength({ models: [{ model: "llama3:8b", context_length: 8192 }] }, "llama3:8b")).toBe(8192);
  });

  it("is zero for a model that is not loaded, and for no server at all", () => {
    expect(servedContextLength({ models: [] }, "qwen3-coder:30b")).toBe(0);
    expect(servedContextLength(null, "qwen3-coder:30b")).toBe(0);
  });

  it("never reports more than Ollama will serve", () => {
    // The whole point. 262144 is true of the model and false of this server.
    expect(usableContextLength(262144, 32768)).toBe(32768);
  });

  it("never reports more than the model supports either", () => {
    // A server configured larger than the model does not grant it more.
    expect(usableContextLength(8192, 131072)).toBe(8192);
  });

  it("reports nothing when the model is not loaded, rather than its maximum", () => {
    // Writing no figure leaves the harness on its own default, which is a
    // smaller claim than the model's theoretical maximum and a true one.
    expect(usableContextLength(262144, 0)).toBe(0);
  });

  it("falls back to the served figure when the model declares none", () => {
    expect(usableContextLength(0, 32768)).toBe(32768);
  });
});
