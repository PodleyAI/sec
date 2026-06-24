/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getMergerProxyConfidenceFloor } from "./mergerModel";
import { CONFIDENCE_FLOOR } from "./sectionRunner";

const ENV = "SEC_MERGER_PROXY_CONFIDENCE_FLOOR";
// Snapshot immediately before each test (not at module load) so suite-level
// setup or other files touching this env var cannot corrupt the baseline.
let original: string | undefined;
beforeEach(() => {
  original = process.env[ENV];
});
afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

describe("getMergerProxyConfidenceFloor", () => {
  it("uses the per-extractor env when set", () => {
    process.env[ENV] = "0.7";
    expect(getMergerProxyConfidenceFloor()).toBe(0.7);
  });
  it("falls back to the shared global floor when unset", () => {
    delete process.env[ENV];
    expect(getMergerProxyConfidenceFloor()).toBe(CONFIDENCE_FLOOR);
  });
  it("falls back on a non-numeric value", () => {
    process.env[ENV] = "high";
    expect(getMergerProxyConfidenceFloor()).toBe(CONFIDENCE_FLOOR);
  });
});
