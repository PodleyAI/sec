/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { estimateCost, costFromUsage, estimateTokens } from "./modelPricing";

/** 1M input tokens' worth of characters at the harness's ~4 chars/token ratio. */
const ONE_M_TOKENS_OF_CHARS = 4_000_000;

/** USD cost of exactly 1M input tokens and 1M output tokens for a model. */
function perMillion(modelId: string): { input: number | null; output: number | null } {
  return {
    input: estimateCost(modelId, ONE_M_TOKENS_OF_CHARS, 0).usd,
    output: estimateCost(modelId, 0, ONE_M_TOKENS_OF_CHARS).usd,
  };
}

describe("estimateTokens", () => {
  it("approximates ~4 chars per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("DeepSeek pricing", () => {
  it("prices deepseek-v4-flash at the published cache-miss input / output rates", () => {
    expect(perMillion("deepseek-v4-flash")).toEqual({ input: 0.14, output: 0.28 });
  });

  it("prices deepseek-v4-pro at the published cache-miss input / output rates", () => {
    expect(perMillion("deepseek-v4-pro")).toEqual({ input: 0.435, output: 0.87 });
  });

  it("ranks flash cheaper than pro on the same text", () => {
    const flash = estimateCost("deepseek-v4-flash", 40_000, 2_000).usd!;
    const pro = estimateCost("deepseek-v4-pro", 40_000, 2_000).usd!;
    expect(flash).toBeLessThan(pro);
  });

  it("beats every Anthropic tier on the same text (the reason to consider it)", () => {
    const flash = estimateCost("deepseek-v4-flash", 40_000, 2_000).usd!;
    const haiku = estimateCost("claude-haiku-4-5", 40_000, 2_000).usd!;
    expect(flash).toBeLessThan(haiku);
  });
});

describe("priceFor dispatch", () => {
  it("treats local models as free", () => {
    expect(estimateCost("onnx:onnx-community/Qwen3-4B-Instruct-2507-ONNX", 40_000, 2_000).usd).toBe(
      0
    );
    expect(estimateCost("gguf:Model-Q4.gguf", 40_000, 2_000).usd).toBe(0);
    expect(estimateCost("llama:Model-Q4.gguf", 40_000, 2_000).usd).toBe(0);
  });

  it("does not treat a cloud vendor/model path as a free local model", () => {
    // Regression: a bare `/` used to mean "local ONNX", which priced OpenRouter
    // / HF Inference ids at $0.
    expect(estimateCost("open-router:anthropic/claude-sonnet-4", 40_000, 2_000).usd).toBeNull();
    expect(estimateCost("hfi:meta-llama/Llama-3.3-70B-Instruct", 40_000, 2_000).usd).toBeNull();
    expect(estimateCost("onnx-community/Qwen3-4B-Instruct-2507-ONNX", 40_000, 2_000).usd).toBeNull();
  });

  it("reports an unknown id as unavailable rather than guessing", () => {
    expect(estimateCost("no-such-model-9000", 40_000, 2_000).usd).toBeNull();
  });

  it("still prices the other cloud vendors", () => {
    expect(perMillion("claude-sonnet-5")).toEqual({ input: 3, output: 15 });
    expect(perMillion("gpt-5.4-mini")).toEqual({ input: 0.75, output: 4.5 });
    expect(perMillion("gemini-3-flash-preview")).toEqual({ input: 0.5, output: 3 });
    expect(perMillion("grok-4.5")).toEqual({ input: 2, output: 6 });
  });
});

describe("costFromUsage", () => {
  it("prefers a provider-stated cost over the rate card (OpenRouter)", () => {
    const cost = costFromUsage(
      {
        input: 1000,
        output: 50,
        cached: 200,
        cacheWrite: undefined,
        reasoning: undefined,
        total: 1250,
        extra: { cost: 0.00042 },
      },
      "open-router:deepseek-v4-flash",
      40_000,
      2_000
    );
    expect(cost.usd).toBe(0.00042);
    expect(cost.inputTokens).toBe(1200);
    expect(cost.outputTokens).toBe(50);
  });

  it("falls back to the char estimate when usage is absent", () => {
    expect(costFromUsage(undefined, "deepseek-v4-flash", 4_000, 400)).toEqual(
      estimateCost("deepseek-v4-flash", 4_000, 400)
    );
  });

  it("keeps real tokens but leaves USD null when usage has no stated cost and no rate card", () => {
    const cost = costFromUsage(
      {
        input: 100,
        output: 10,
        cached: undefined,
        cacheWrite: undefined,
        reasoning: undefined,
        total: 110,
        extra: undefined,
      },
      "open-router:deepseek-v4-flash",
      40_000,
      2_000
    );
    expect(cost).toEqual({ inputTokens: 100, outputTokens: 10, usd: null });
  });
});

describe("Gemini pricing", () => {
  it("prices the flash models in the default sweep", () => {
    // https://ai.google.dev/gemini-api/docs/pricing (paid tier, per 1M tokens)
    expect(estimateCost("gemini-3.6-flash", 4_000_000, 4_000_000).usd).toBeCloseTo(1.5 + 7.5, 5);
  });

  it("does not price a -flash-lite id as -flash", () => {
    // The lookup is a substring match in array order, so "gemini-3.5-flash-lite"
    // must be listed before "gemini-3.5-flash" or it inherits the wrong price.
    const lite = estimateCost("gemini-3.5-flash-lite", 4_000_000, 4_000_000).usd;
    const full = estimateCost("gemini-3.5-flash", 4_000_000, 4_000_000).usd;
    expect(lite).toBeCloseTo(0.3 + 2.5, 5);
    expect(full).toBeCloseTo(1.5 + 9, 5);
    expect(lite).toBeLessThan(full!);
  });

  it("prices the 2.5 family", () => {
    expect(estimateCost("gemini-2.5-flash-lite", 4_000_000, 4_000_000).usd).toBeCloseTo(0.1 + 0.4, 5);
    expect(estimateCost("gemini-2.5-pro", 4_000_000, 4_000_000).usd).toBeCloseTo(1.25 + 10, 5);
  });
});
