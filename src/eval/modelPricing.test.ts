/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { estimateCost, estimateTokens } from "./modelPricing";

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
    expect(estimateCost("onnx-community/Qwen3-4B-Instruct-2507-ONNX", 40_000, 2_000).usd).toBe(0);
    expect(estimateCost("gguf:Model-Q4.gguf", 40_000, 2_000).usd).toBe(0);
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
