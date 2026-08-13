/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ModelConfig } from "workglow";
import {
  getExtractionEffortOverride,
  setExtractionEffortOverride,
  withExtractionReasoning,
} from "./extractionReasoning";

function fakeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    model_id: "m",
    title: "m",
    description: "",
    provider: "OPENROUTER",
    provider_config: { model_name: "deepinfra/deepseek" },
    capabilities: [],
    metadata: {},
    ...overrides,
  } as ModelConfig;
}

afterEach(() => {
  setExtractionEffortOverride(undefined);
});

describe("withExtractionReasoning", () => {
  it("leaves the model unchanged when effort is undefined", () => {
    const model = fakeModel();
    expect(withExtractionReasoning(model, undefined)).toBe(model);
  });

  it("sets top-level model.effort", () => {
    const out = withExtractionReasoning(fakeModel(), "high");
    expect(out.effort).toBe("high");
    expect(
      (out as { provider_config?: { reasoning?: unknown } }).provider_config?.reasoning
    ).toBeUndefined();
  });

  it("pins none without stamping OpenRouter provider_config", () => {
    const out = withExtractionReasoning(fakeModel(), "none");
    expect(out.effort).toBe("none");
    expect((out as { provider_config?: { reasoning?: unknown } }).provider_config?.reasoning).toBe(
      undefined
    );
  });

  it("lets setExtractionEffortOverride win over the per-extractor argument", () => {
    setExtractionEffortOverride("ultra");
    expect(getExtractionEffortOverride()).toBe("ultra");
    expect(withExtractionReasoning(fakeModel(), "low").effort).toBe("ultra");
  });
});
