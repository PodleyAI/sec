/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { listPricingForModelId } from "./listPricing";

describe("listPricingForModelId", () => {
  it("prices Anthropic families by name", () => {
    // Sonnet 5's $2/$10 is permanent and distinct from 4.x at $3/$15.
    expect(listPricingForModelId("claude-sonnet-5")).toEqual({
      currency: "USD",
      input: 2,
      output: 10,
      cached: 0.2,
      cacheWrite: 2.5,
      cacheStoragePerHour: undefined,
    });
    expect(listPricingForModelId("claude-sonnet-4-6")?.input).toBe(3);
    expect(listPricingForModelId("claude-sonnet-4-5")?.input).toBe(3);
    expect(listPricingForModelId("claude-haiku-4-5")?.output).toBe(5);
    expect(listPricingForModelId("claude-opus-5")?.input).toBe(5);
  });

  it("prices Grok 4.6 at the published <200k rates", () => {
    expect(listPricingForModelId("grok-4.6")).toEqual({
      currency: "USD",
      input: 2,
      output: 6,
      cached: 0.5,
      cacheWrite: undefined,
      cacheStoragePerHour: undefined,
    });
  });

  it("prices Grok 4.5 at its own cache-hit rate", () => {
    expect(listPricingForModelId("grok-4.5")?.input).toBe(2);
    expect(listPricingForModelId("grok-4.5")?.cached).toBe(0.3);
  });

  it("prices the DeepSeek V4 Pro 0813 snapshot at the same cache-miss rates as pro", () => {
    expect(listPricingForModelId("deepseek-v4-pro-0813")).toEqual(
      listPricingForModelId("deepseek-v4-pro")
    );
    expect(listPricingForModelId("deepseek-v4-pro-0813")?.input).toBe(0.435);
    expect(listPricingForModelId("deepseek-v4-pro-0813")?.output).toBe(0.87);
  });

  it("treats local models as free", () => {
    expect(listPricingForModelId("onnx:org/model")?.input).toBe(0);
    expect(listPricingForModelId("gguf:Model.gguf")?.output).toBe(0);
  });

  it("leaves gateway and unknown ids unpriced", () => {
    expect(listPricingForModelId("open-router:anthropic/claude-sonnet-4")).toBeUndefined();
    expect(listPricingForModelId("hfi:meta-llama/Llama-3.3-70B-Instruct")).toBeUndefined();
    expect(listPricingForModelId("no-such-model-9000")).toBeUndefined();
  });
});
