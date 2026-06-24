/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** 8-K item codes that can carry realized SPAC redemptions. */
export const REDEMPTION_TRIGGER_ITEMS: readonly string[] = ["5.07", "2.01", "8.01"];

/** True when a comma/semicolon-separated items string contains a trigger code. */
export function hasRedemptionTriggerItem(items: string | null | undefined): boolean {
  if (!items) return false;
  const set = new Set(items.split(/[,;]/).map((s) => s.trim()));
  return REDEMPTION_TRIGGER_ITEMS.some((code) => set.has(code));
}
