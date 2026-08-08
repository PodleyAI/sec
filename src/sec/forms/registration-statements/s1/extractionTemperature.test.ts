/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { SecCliConfigurationError } from "../../../../config/EnvToDI";
import { getExtractionTemperature as getExtractionTemperatureFromConfig } from "../../../../config/extractionTemperature";
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

  it("throws on a malformed value rather than silently reading it as greedy", () => {
    // Coercing to 0 would report exactly the setting the operator did NOT ask
    // for — "greedy sampling is on" — with nothing saying the value was
    // discarded. A decimal comma is the realistic typo.
    process.env[KEY] = "0,5";
    expect(() => getExtractionTemperature()).toThrow(/SEC_EXTRACTION_TEMPERATURE/);
    process.env[KEY] = "warm";
    expect(() => getExtractionTemperature()).toThrow(/SEC_EXTRACTION_TEMPERATURE/);
  });

  it("rejects a temperature outside the [0, 2] sampling range", () => {
    process.env[KEY] = "5";
    expect(() => getExtractionTemperature()).toThrow(/out of range/);
    process.env[KEY] = "3";
    expect(() => getExtractionTemperature()).toThrow(/out of range/);
    process.env[KEY] = "-1";
    expect(() => getExtractionTemperature()).toThrow(/out of range/);
  });

  it("throws a configuration error, the class the pipeline exempts from dead-lettering", () => {
    // The type is what carries the fix: a bad env value is wrong for every
    // section of every filing, so the section runner and the form task both
    // re-throw this class instead of recording a version-gated dead letter.
    process.env[KEY] = "0,5";
    expect(() => getExtractionTemperature()).toThrow(SecCliConfigurationError);
    process.env[KEY] = "3";
    expect(() => getExtractionTemperature()).toThrow(SecCliConfigurationError);
  });

  it("is the same function whether reached through config or the extractors module", () => {
    // It moved to `config/` so the CLI can validate it at startup; the
    // extractors module re-exports it so call sites did not have to move.
    expect(getExtractionTemperature).toBe(getExtractionTemperatureFromConfig);
  });

  it("accepts the range bounds", () => {
    process.env[KEY] = "2";
    expect(getExtractionTemperature()).toBe(2);
    process.env[KEY] = "0";
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
