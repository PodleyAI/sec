/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { getExtractionTemperature, isTemperatureUnsupportedError } from "./sectionExtractors";

const KEY = "SEC_EXTRACTION_TEMPERATURE";
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("getExtractionTemperature", () => {
  it("defaults to greedy sampling", () => {
    delete process.env[KEY];
    expect(getExtractionTemperature()).toBe(0);
  });

  it("honours an explicit override", () => {
    process.env[KEY] = "0.7";
    expect(getExtractionTemperature()).toBe(0.7);
  });

  it("omits the parameter entirely when set empty", () => {
    // The escape hatch for models that reject any temperature but their own
    // default — sending one would fail every call rather than degrade.
    process.env[KEY] = "";
    expect(getExtractionTemperature()).toBeUndefined();
  });

  it("falls back to greedy on a non-numeric value rather than sending NaN", () => {
    process.env[KEY] = "warm";
    expect(getExtractionTemperature()).toBe(0);
  });
});

describe("isTemperatureUnsupportedError", () => {
  it("recognises the provider's rejection of the parameter", () => {
    // Verbatim from a live gpt-5.6-luna call.
    expect(
      isTemperatureUnsupportedError(
        new Error(
          "Invalid request to OPENAI for StructuredGenerationTask: 400 Unsupported parameter: 'temperature' is not supported with this model."
        )
      )
    ).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    expect(isTemperatureUnsupportedError(new Error("400 rate limit exceeded"))).toBe(false);
    expect(
      isTemperatureUnsupportedError(new Error("Unsupported parameter: 'top_k' is not supported"))
    ).toBe(false);
    // A temperature mentioned without a support complaint is not this error.
    expect(isTemperatureUnsupportedError(new Error("temperature must be <= 2"))).toBe(false);
  });
});
