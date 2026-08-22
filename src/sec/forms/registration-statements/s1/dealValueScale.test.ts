/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { isPlausibleDealValue, MIN_PLAUSIBLE_DEAL_VALUE, usableDealValue } from "./dealValueScale";

describe("dealValueScale", () => {
  it("accepts figures in the range real combinations are announced at", () => {
    for (const value of [MIN_PLAUSIBLE_DEAL_VALUE, 250_000_000, 1_400_000_000, 9_500_000_000]) {
      expect(isPlausibleDealValue(value)).toBe(true);
      expect(usableDealValue(value)).toBe(value);
    }
  });

  it("rejects a figure written in the units of its own sentence", () => {
    // "$1.4 billion" returned as 1.4, or as 1400. Both validate against the
    // schema and both become an `acquired` valuation off by a factor of a
    // million, which nothing downstream re-derives.
    for (const value of [1.4, 1400, 250, 0]) {
      expect(isPlausibleDealValue(value)).toBe(false);
      expect(usableDealValue(value)).toBeNull();
    }
  });

  it("rejects null, undefined, and non-finite values", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isPlausibleDealValue(value)).toBe(false);
      expect(usableDealValue(value)).toBeNull();
    }
  });

  it("does not try to rescale — a guess is indistinguishable from a fact once stored", () => {
    // The remedy for an unusable figure is null, not a second model of the
    // filing. `usableDealValue` has no branch that multiplies.
    expect(usableDealValue(1.4)).toBeNull();
    expect(usableDealValue(1.4)).not.toBe(1_400_000_000);
  });

  it("puts the floor far from both populations", () => {
    // A real combination is tens of millions at minimum (the trust alone is),
    // and a scaled figure is single or quadruple digits, so nothing sits near
    // the boundary and the floor needs no judgement call.
    expect(MIN_PLAUSIBLE_DEAL_VALUE).toBe(10_000_000);
    expect(isPlausibleDealValue(MIN_PLAUSIBLE_DEAL_VALUE - 1)).toBe(false);
  });
});
