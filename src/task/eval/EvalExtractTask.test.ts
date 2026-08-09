/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { EvalExtractTask } from "./EvalExtractTask";

describe("EvalExtractTask defaults", () => {
  // Task.getDefaultInputsFromStaticInputDefinitions fills optional props. An
  // Optional(Array(String, {minItems:1})) becomes [undefined], which
  // filterByName then reports as the phantom fixture name "undefined" — even
  // when the CLI never passed --fixture. Empty array (or absent) is fine;
  // a one-slot undefined array is not.
  it("does not invent a fixtures filter when the option is omitted", () => {
    const task = new EvalExtractTask({
      defaults: { models: ["claude-haiku-4-5"], extractor: "management" },
    });
    const fixtures = task.defaults.fixtures as unknown;
    // A one-element [undefined] has length 1, so runExtractionEval treats it as
    // an intentional --fixture filter and reports `no fixture named "undefined"`.
    if (Array.isArray(fixtures)) {
      expect(fixtures.length === 0 || fixtures.every((f) => typeof f === "string")).toBe(true);
    }
  });
});
