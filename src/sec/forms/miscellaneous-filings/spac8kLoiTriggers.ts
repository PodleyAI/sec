/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 8-K item codes that can carry a non-binding letter-of-intent announcement.
 * There is no dedicated item code for an LOI: it usually surfaces as narrative
 * under Item 8.01 (Other Events) or a press-release exhibit under Item 7.01
 * (Reg FD), and occasionally under Item 1.01 when the LOI carries binding
 * provisions (exclusivity, confidentiality).
 */
export const LOI_TRIGGER_ITEMS: readonly string[] = ["1.01", "7.01", "8.01"];

/** True when a comma/semicolon-separated items string contains an LOI trigger code. */
export function hasLoiTriggerItem(items: string | null | undefined): boolean {
  if (!items) return false;
  const set = new Set(items.split(/[,;]/).map((s) => s.trim()));
  return LOI_TRIGGER_ITEMS.some((code) => set.has(code));
}
