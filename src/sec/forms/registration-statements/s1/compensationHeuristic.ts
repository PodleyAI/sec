/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two regulation-mandated captions of a Summary Compensation Table. Both
 * are prescribed wording rather than drafting choices, so their presence is a
 * far better signal than any prose keyword: the stub column is captioned "Name
 * and Principal Position" and the first compensation column "Salary".
 */
const TABLE_LABEL = /summary compensation table/i;
const STUB_COLUMN = /name and principal position/i;
const SALARY_COLUMN = /\bsalary\b/i;

/**
 * True when a compensation section plausibly contains a Summary Compensation
 * Table.
 *
 * A blank-check company has no compensation history: its compensation section
 * is one paragraph saying no officer or director has received any compensation.
 * Running the AI extractor there costs a call to learn nothing and leaves a
 * permanent `MODEL_EMPTY` dead letter on a filing that is behaving correctly, so
 * the section is gated on this cheap deterministic check first — the same shape
 * as the blank-check gate gating the SPAC content classifier.
 *
 * Deliberately conservative: it demands the salary column caption AND one of the
 * two table identifiers, so narrative prose that merely discusses salaries does
 * not trip it.
 */
export function hasSummaryCompensationTable(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  if (!SALARY_COLUMN.test(text)) return false;
  return TABLE_LABEL.test(text) || STUB_COLUMN.test(text);
}
