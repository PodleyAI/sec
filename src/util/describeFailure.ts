/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One short phrase naming why something failed, for a per-item warning and a
 * grouped tally. Kept to the message so distinct causes — a 404, a 403 (EDGAR
 * blocking the User-Agent), an exhausted-retry 429, a truncated archive — stay
 * distinguishable without a stack trace per item in a sweep that can fail
 * thousands of times.
 *
 * `maxLength` is the caller's, because the surfaces differ: a per-filing row
 * wants a tighter phrase than a per-day log line, and one HTML error page must
 * not flood either.
 */
export function describeFailureReason(err: unknown, maxLength: number): string {
  const message = err instanceof Error ? err.message : String(err);
  const collapsed = message.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "unknown error";
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}
