/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { expandFormTypes } from "./syncFormDomains";

/**
 * `expandFormTypes` can run during CLI argument parsing, before anything else
 * has populated the form-extractor registry. This file imports nothing that
 * would register extractors as a side effect other than `./syncFormDomains`
 * itself, so it only passes if that module registers them on its own.
 */
describe("expandFormTypes registry bootstrap", () => {
  it("expands an extractor id to its full form list on a bare import", () => {
    expect(expandFormTypes(["D"])).toEqual(["D", "D/A"]);
  });
});
