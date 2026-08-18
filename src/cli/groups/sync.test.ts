/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { validateLookback } from "./sync";

describe("validateLookback", () => {
  it("rejects lookback below 1", () => {
    expect(() => validateLookback(0)).toThrow("--lookback must be at least 1");
  });

  it("returns the lookback when valid", () => {
    expect(validateLookback(3)).toBe(3);
  });
});
