/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SEC_MODEL, parseModelIdList, SecModelDefault } from "../../../../config/Constants";
import { getS1ModelId, getS1ModelIds } from "./s1Model";

const ORIG_S1 = process.env.SEC_S1_MODEL;
const ORIG_DEFAULT = process.env.SEC_MODEL_DEFAULT;
afterEach(() => {
  if (ORIG_S1 === undefined) delete process.env.SEC_S1_MODEL;
  else process.env.SEC_S1_MODEL = ORIG_S1;
  if (ORIG_DEFAULT === undefined) delete process.env.SEC_MODEL_DEFAULT;
  else process.env.SEC_MODEL_DEFAULT = ORIG_DEFAULT;
});

describe("parseModelIdList", () => {
  it("treats a scalar as a one-element list", () => {
    expect(parseModelIdList("claude-opus-5", DEFAULT_SEC_MODEL)).toEqual(["claude-opus-5"]);
  });
  it("splits a CSV, trims, and drops duplicates and empty parts", () => {
    expect(
      parseModelIdList(" claude-sonnet-5, , claude-haiku-4-5, claude-sonnet-5 ", DEFAULT_SEC_MODEL)
    ).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
  });
  it("falls back when the value is unset or blank", () => {
    expect(parseModelIdList(undefined, DEFAULT_SEC_MODEL)).toEqual([DEFAULT_SEC_MODEL]);
    expect(parseModelIdList("  ", DEFAULT_SEC_MODEL)).toEqual([DEFAULT_SEC_MODEL]);
  });
});

describe("getS1ModelId", () => {
  it("returns the configured model id from SEC_S1_MODEL", () => {
    process.env.SEC_S1_MODEL = "claude-opus-5";
    expect(getS1ModelId()).toBe("claude-opus-5");
  });
  it("returns the first id when SEC_S1_MODEL is a CSV list", () => {
    process.env.SEC_S1_MODEL = "claude-sonnet-5,claude-haiku-4-5";
    expect(getS1ModelId()).toBe("claude-sonnet-5");
  });
  // Asserts the fallback *wiring* — that an unset override defers to the shared
  // default — not which model that default happens to name. Pinning the literal
  // made every change to `DEFAULT_SEC_MODEL` fail this and its two siblings.
  it("falls back to the shared default model id when unset", () => {
    delete process.env.SEC_S1_MODEL;
    expect(getS1ModelId()).toBe(SecModelDefault);
  });
});

describe("getS1ModelIds", () => {
  it("returns the full CSV list from SEC_S1_MODEL", () => {
    process.env.SEC_S1_MODEL = "claude-sonnet-5,claude-haiku-4-5";
    expect(getS1ModelIds()).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
  });
  it("inherits the full SEC_MODEL_DEFAULT list when the override is unset", () => {
    delete process.env.SEC_S1_MODEL;
    process.env.SEC_MODEL_DEFAULT = "claude-sonnet-5,claude-haiku-4-5";
    expect(getS1ModelIds()).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
  });
});
