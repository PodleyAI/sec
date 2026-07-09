/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { getS1ModelId } from "./s1Model";

const ORIG = process.env.SEC_S1_MODEL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.SEC_S1_MODEL;
  else process.env.SEC_S1_MODEL = ORIG;
});

describe("getS1ModelId", () => {
  it("returns the configured model id from SEC_S1_MODEL", () => {
    process.env.SEC_S1_MODEL = "claude-opus-4-8";
    expect(getS1ModelId()).toBe("claude-opus-4-8");
  });
  it("falls back to a default model id when unset", () => {
    delete process.env.SEC_S1_MODEL;
    expect(getS1ModelId()).toBe("claude-sonnet-5");
  });
});
