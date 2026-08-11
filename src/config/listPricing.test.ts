/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { listPricingForModelId } from "./listPricing";

describe("listPricingForModelId", () => {
  it("prices Anthropic families by name", () => {
    expect(listPricingForModelId("claude-sonnet-5")?.input).toBe(3);
    expect(listPricingForModelId("claude-haiku-4-5")?.output).toBe(5);
    expect(listPricingForModelId("claude-opus-5")?.input).toBe(5);
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
