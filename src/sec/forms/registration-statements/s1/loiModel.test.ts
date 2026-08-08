/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecModelDefault } from "../../../../config/Constants";
import { getLoiConfidenceFloor, getLoiModelId } from "./loiModel";
import { CONFIDENCE_FLOOR } from "./sectionRunner";

const FLOOR_ENV = "SEC_LOI_CONFIDENCE_FLOOR";
const MODEL_ENV = "SEC_LOI_MODEL";

let originalFloor: string | undefined;
let originalModel: string | undefined;
beforeEach(() => {
  originalFloor = process.env[FLOOR_ENV];
  originalModel = process.env[MODEL_ENV];
});
afterEach(() => {
  if (originalFloor === undefined) delete process.env[FLOOR_ENV];
  else process.env[FLOOR_ENV] = originalFloor;
  if (originalModel === undefined) delete process.env[MODEL_ENV];
  else process.env[MODEL_ENV] = originalModel;
});

describe("getLoiModelId", () => {
  // The shared default, not a literal id — see the note in s1Model.test.ts.
  it("defaults to the shared default model id when unset", () => {
    delete process.env[MODEL_ENV];
    expect(getLoiModelId()).toBe(SecModelDefault);
  });
  it("honors SEC_LOI_MODEL when set", () => {
    process.env[MODEL_ENV] = "claude-opus-5";
    expect(getLoiModelId()).toBe("claude-opus-5");
  });
});

describe("getLoiConfidenceFloor", () => {
  it("uses the per-extractor env when set", () => {
    process.env[FLOOR_ENV] = "0.7";
    expect(getLoiConfidenceFloor()).toBe(0.7);
  });
  it("falls back to the shared global floor when unset", () => {
    delete process.env[FLOOR_ENV];
    expect(getLoiConfidenceFloor()).toBe(CONFIDENCE_FLOOR);
  });
  it("falls back on a non-numeric value", () => {
    process.env[FLOOR_ENV] = "high";
    expect(getLoiConfidenceFloor()).toBe(CONFIDENCE_FLOOR);
  });
});
