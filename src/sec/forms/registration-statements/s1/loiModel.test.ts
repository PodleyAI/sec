/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecModelDefault } from "../../../../config/Constants";
import { getLoiConfidenceFloor, getLoiModelId, getLoiModelIds } from "./loiModel";
import { CONFIDENCE_FLOOR } from "./sectionRunner";

const FLOOR_ENV = "SEC_LOI_CONFIDENCE_FLOOR";
const MODEL_ENV = "SEC_LOI_MODEL";
const DEFAULT_ENV = "SEC_MODEL_DEFAULT";

let originalFloor: string | undefined;
let originalModel: string | undefined;
let originalDefault: string | undefined;
beforeEach(() => {
  originalFloor = process.env[FLOOR_ENV];
  originalModel = process.env[MODEL_ENV];
  originalDefault = process.env[DEFAULT_ENV];
});
afterEach(() => {
  if (originalFloor === undefined) delete process.env[FLOOR_ENV];
  else process.env[FLOOR_ENV] = originalFloor;
  if (originalModel === undefined) delete process.env[MODEL_ENV];
  else process.env[MODEL_ENV] = originalModel;
  if (originalDefault === undefined) delete process.env[DEFAULT_ENV];
  else process.env[DEFAULT_ENV] = originalDefault;
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
  it("returns the first id when SEC_LOI_MODEL is a CSV list", () => {
    process.env[MODEL_ENV] = "claude-sonnet-5,claude-haiku-4-5";
    expect(getLoiModelId()).toBe("claude-sonnet-5");
  });
});

describe("getLoiModelIds", () => {
  it("inherits the full SEC_MODEL_DEFAULT list when the override is unset", () => {
    delete process.env[MODEL_ENV];
    process.env[DEFAULT_ENV] = "gpt-5.6-luna,grok-4.6";
    expect(getLoiModelIds()).toEqual(["gpt-5.6-luna", "grok-4.6"]);
  });

  it("keeps a set override first and appends remaining schema-enforced default ids", () => {
    process.env[MODEL_ENV] = "gpt-5.6-luna";
    process.env[DEFAULT_ENV] = "gpt-5.6-luna,claude-haiku-4-5";
    expect(getLoiModelIds()).toEqual(["gpt-5.6-luna", "claude-haiku-4-5"]);
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
