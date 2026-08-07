/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { SecModelDefault } from "../../../../config/Constants";
import { getS1ModelId } from "./s1Model";

const ORIG = process.env.SEC_S1_MODEL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.SEC_S1_MODEL;
  else process.env.SEC_S1_MODEL = ORIG;
});

describe("getS1ModelId", () => {
  it("returns the configured model id from SEC_S1_MODEL", () => {
    process.env.SEC_S1_MODEL = "claude-opus-5";
    expect(getS1ModelId()).toBe("claude-opus-5");
  });
  // Asserts the fallback *wiring* — that an unset override defers to the shared
  // default — not which model that default happens to name. Pinning the literal
  // made every change to `DEFAULT_SEC_MODEL` fail this and its two siblings.
  it("falls back to the shared default model id when unset", () => {
    delete process.env.SEC_S1_MODEL;
    expect(getS1ModelId()).toBe(SecModelDefault);
  });
});
