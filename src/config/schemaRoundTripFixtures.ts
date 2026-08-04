/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real-shaped values at the top end of what EDGAR produces, used to assert both
 * backends against identical input. Each one overflowed a column at its
 * original declared width and failed the whole filer's submission.
 */

/** Normalized phone with the extension kept inline — 24 chars, was a 20-char PK. */
export const LONG_PHONE_INTERNATIONAL = "+1 516 482 1200 ext. 108";

/** Comma-joined multi-registrant file numbers — 107 chars, was a 10-char column. */
export const LONG_FILE_NUMBER = [
  "333-123456",
  "333-123457",
  "333-123458",
  "333-123459",
  "333-123460",
  "333-123461",
  "333-123462",
  "333-123463",
  "333-123464",
  "333-1234",
].join(",");
