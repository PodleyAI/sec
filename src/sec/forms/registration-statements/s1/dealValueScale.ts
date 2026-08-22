/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The smallest deal value that can be a whole-dollar figure rather than a units
 * error.
 *
 * A de-SPAC combination's announced equity or enterprise value is at minimum in
 * the tens of millions — the trust alone is that, by the terms of the offering —
 * so a stated value of `1.4` is not a $1.40 deal, it is "$1.4 billion" written
 * in the units of the sentence it was read from. Ten million is far below any
 * real combination and far above any plausible scaled figure, so the two
 * populations do not overlap and the floor needs no judgement call.
 */
export const MIN_PLAUSIBLE_DEAL_VALUE = 10_000_000;

/**
 * Whether a stated deal value can be believed as whole dollars.
 *
 * This exists because the failure is silent and terminal. A value scaled into
 * millions is a perfectly ordinary number: it validates against the schema, it
 * stores, and downstream it becomes an `acquired`-basis valuation off by a
 * factor of a million. Nothing further along re-derives it, and a percentage
 * change computed against it is merely very large rather than obviously wrong —
 * so the only place it can be caught is where it is read.
 *
 * Dropping the value is the right remedy rather than rescaling it. A guess at
 * the intended magnitude ("this is probably billions") is a second model of the
 * filing, and a wrong guess is indistinguishable from a right one once stored.
 * A null says what is true: the proxy stated a deal value and we could not use
 * the figure we read.
 */
export function isPlausibleDealValue(value: number | null | undefined): value is number {
  if (value == null) return false;
  return Number.isFinite(value) && value >= MIN_PLAUSIBLE_DEAL_VALUE;
}

/** The value if it can be believed, else null. */
export function usableDealValue(value: number | null | undefined): number | null {
  return isPlausibleDealValue(value) ? value : null;
}
