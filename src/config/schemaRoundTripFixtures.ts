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

/**
 * Every value of Form 1-A's `securitiesOfferedTypes` multi-select, which the
 * form declares `maxOccurs="6"`. Stringified into one Postgres array literal it
 * runs past 250 chars, so it overflowed the original `varchar(100)` column and
 * lost the filing.
 *
 * It is a LIST, and the two backends store it differently — a JSON array in
 * SQLite TEXT, a `text[]` on Postgres. That difference is exactly why one
 * fixture drives both suites: the storage may differ, what the repository hands
 * back may not.
 */
export const ALL_SECURITIES_OFFERED_TYPES = [
  "Equity (common or preferred stock)",
  "Debt",
  "Option, warrant or other right to acquire another security",
  "Security to be acquired upon exercise of option, warrant or other right to acquire security",
  "Tenant-in-common securities",
  "Other(describe)",
];

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
