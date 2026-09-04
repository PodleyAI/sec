/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Comma-joined multi-registrant file numbers — 107 chars, against a column
 * originally declared at 10. A real-shaped value at the top end of what EDGAR
 * produces: it overflowed that width and failed the whole filer's submission.
 * Shared by both backends' suites so each is asserted against identical input.
 */
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
