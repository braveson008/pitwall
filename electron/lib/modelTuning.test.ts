import { describe, expect, it } from "vitest";
import {
  contextChoices,
  formatContext,
  gb,
  isKeepAlive,
  kvBytesPerToken,
  kvEstimateIsExact,
  maxContextForMemory,
  recommendedContext,
  usableMemoryBytes,
} from "./modelTuning.cjs";

/** qwen3-coder:30b, as Ollama reports it. */
const QWEN = {
  "qwen3moe.block_count": 48,
  "qwen3moe.attention.head_count": 32,
  "qwen3moe.attention.head_count_kv": 4,
  "qwen3moe.attention.key_length": 128,
  "qwen3moe.attention.value_length": 128,
  "qwen3moe.embedding_length": 2048,
  "qwen3moe.context_length": 262144,
};

describe("kvBytesPerToken", () => {
  it("computes the real cost from the model's own dimensions", () => {
    // 48 layers × (128 + 128) × 4 kv heads × 2 bytes.
    expect(kvBytesPerToken(QWEN)).toBe(98_304);
    expect(kvEstimateIsExact(QWEN)).toBe(true);
  });

  it("agrees with what the machine actually did", () => {
    // Measured on an M3 Pro: growing qwen3-coder:30b from 32k to 64k moved it
    // from 22.0 GB to 25.0 GB. Predicting 3.0–3.3 GB for those 32768 tokens is
    // what makes the rest of this file worth trusting.
    const delta = kvBytesPerToken(QWEN) * 32_768;
    expect(delta).toBeGreaterThan(3.0e9);
    expect(delta).toBeLessThan(3.4e9);
  });

  it("uses the embedding width when a model publishes less, and says so", () => {
    const sparse = { "llama.block_count": 32, "llama.embedding_length": 4096 };
    expect(kvBytesPerToken(sparse)).toBe(32 * 4096 * 2 * 2);
    // Flagged as an estimate rather than presented as the same kind of number.
    expect(kvEstimateIsExact(sparse)).toBe(false);
  });

  it("returns zero rather than a guess when it knows nothing", () => {
    // Zero means "no figure", and every caller treats that as "cannot advise".
    expect(kvBytesPerToken({})).toBe(0);
    expect(kvBytesPerToken(undefined as never)).toBe(0);
  });
});

describe("usableMemoryBytes", () => {
  it("leaves the machine a quarter of itself", () => {
    // The rest is the OS, the browser, and Pitwall. A model that takes all of
    // it loads and then the machine swaps, which is worse than a smaller window.
    expect(usableMemoryBytes(40e9)).toBe(30e9);
    expect(usableMemoryBytes(0)).toBe(0);
  });
});

describe("contextChoices", () => {
  const base = {
    totalMemoryBytes: 39e9,
    modelBytes: 18.6e9,
    bytesPerToken: kvBytesPerToken(QWEN),
    declaredMax: 262_144,
  };

  it("prices each window on this machine", () => {
    const choices = contextChoices(base);
    const at32k = choices.find((choice) => choice.tokens === 32_768)!;
    // Measured: 22 GB. The arithmetic has to land on the same number.
    expect(at32k.totalBytes).toBeGreaterThan(21.5e9);
    expect(at32k.totalBytes).toBeLessThan(22.5e9);
    expect(at32k.fits).toBe(true);
  });

  it("marks the band where it loads but the machine stops being pleasant", () => {
    // 64k loaded fine on the test machine and took 25 GB of 29.25 usable.
    // "Tight" is a different fact from "will not fit" and gets a different word.
    const at64k = contextChoices(base).find((choice) => choice.tokens === 65_536)!;
    expect(at64k.fits).toBe(true);
    expect(at64k.tight).toBe(true);
  });

  it("says plainly when a window will not fit", () => {
    const at256k = contextChoices(base).find((choice) => choice.tokens === 262_144)!;
    expect(at256k.fits).toBe(false);
  });

  it("still lists what will not fit, rather than hiding it", () => {
    // It is the user's machine and they may know something this arithmetic
    // does not — a smaller cache type, a different offload.
    expect(contextChoices(base).some((choice) => !choice.fits)).toBe(true);
  });

  it("never offers more than the model itself supports", () => {
    const small = contextChoices({ ...base, declaredMax: 32_768 });
    expect(small.every((choice) => choice.tokens <= 32_768)).toBe(true);
  });

  it("marks everything unfit when the cost per token is unknown", () => {
    // No figure means no advice, not optimistic advice.
    expect(contextChoices({ ...base, bytesPerToken: 0 }).every((choice) => !choice.fits)).toBe(true);
  });
});

describe("recommendedContext", () => {
  const base = {
    totalMemoryBytes: 39e9,
    modelBytes: 18.6e9,
    bytesPerToken: kvBytesPerToken(QWEN),
    declaredMax: 262_144,
  };

  it("prefers headroom over the last doubling", () => {
    // 64k fits and is tight; 32k fits comfortably. The failure being avoided
    // is the machine swapping, not the model refusing to load.
    expect(recommendedContext(contextChoices(base))).toBe(32_768);
  });

  it("takes a tight window when nothing else fits", () => {
    const cramped = contextChoices({ ...base, totalMemoryBytes: 26e9 });
    expect(recommendedContext(cramped)).toBeGreaterThan(0);
  });

  it("recommends nothing when nothing fits", () => {
    expect(recommendedContext(contextChoices({ ...base, totalMemoryBytes: 8e9 }))).toBe(0);
  });
});

describe("maxContextForMemory", () => {
  it("is the largest window the spare memory pays for", () => {
    const max = maxContextForMemory({
      totalMemoryBytes: 39e9,
      modelBytes: 18.6e9,
      bytesPerToken: kvBytesPerToken(QWEN),
      declaredMax: 262_144,
    });
    // (39 × 0.75 − 18.6) GB ÷ 98,304 bytes ≈ 108k, rounded down to whole 1024s.
    expect(max).toBeGreaterThan(100_000);
    expect(max).toBeLessThan(115_000);
    expect(max % 1024).toBe(0);
  });

  it("is capped by the model, not only by the machine", () => {
    expect(
      maxContextForMemory({ totalMemoryBytes: 512e9, modelBytes: 1e9, bytesPerToken: 1000, declaredMax: 8192 }),
    ).toBe(8192);
  });

  it("is zero when the weights alone do not fit", () => {
    expect(
      maxContextForMemory({ totalMemoryBytes: 8e9, modelBytes: 18.6e9, bytesPerToken: 98_304 }),
    ).toBe(0);
  });
});

describe("formatting", () => {
  it("says windows the way people do", () => {
    expect(formatContext(32_768)).toBe("32k");
    expect(formatContext(262_144)).toBe("256k");
    expect(formatContext(0)).toBe("");
  });

  it("drops a decimal once the number is large enough not to need one", () => {
    expect(gb(3.22e9)).toBe("3.2 GB");
    expect(gb(22e9)).toBe("22 GB");
  });
});

describe("isKeepAlive", () => {
  it("accepts the offered values and nothing else", () => {
    expect(isKeepAlive("30m")).toBe(true);
    expect(isKeepAlive("-1")).toBe(true);
    // Reaches a spawned process eventually; it is checked, not escaped.
    expect(isKeepAlive("30m; rm -rf /")).toBe(false);
    expect(isKeepAlive("")).toBe(false);
  });
});
