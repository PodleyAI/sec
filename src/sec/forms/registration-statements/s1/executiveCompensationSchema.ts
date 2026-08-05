/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_NUMBER = { type: ["number", "null"] } as const;
const CONFIDENCE = { type: "number", minimum: 0, maximum: 1 } as const;
const SOURCE_SPAN = { type: "string" } as const;
const NONCE_SEEN = { type: "string", pattern: "^[0-9a-f]{16}$" } as const;

/**
 * One Summary Compensation Table cell row: a named executive officer's
 * compensation for ONE fiscal year. The column set is the union of Item 402(c)
 * (full disclosure) and Item 402(n) (the scaled disclosure most S-1 registrants
 * use, which omits the pension/NQDC column and reports two years rather than
 * three) — every money column is nullable, so a filing under either regime maps
 * onto the same row without a discriminator.
 */
export const ExecutiveCompensationOutputSchema = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          person_name: { type: "string" },
          principal_position: NULLABLE_STRING,
          fiscal_year: NULLABLE_NUMBER,
          salary: NULLABLE_NUMBER,
          bonus: NULLABLE_NUMBER,
          stock_awards: NULLABLE_NUMBER,
          option_awards: NULLABLE_NUMBER,
          non_equity_incentive: NULLABLE_NUMBER,
          pension_and_nqdc: NULLABLE_NUMBER,
          all_other_compensation: NULLABLE_NUMBER,
          total: NULLABLE_NUMBER,
          footnote: NULLABLE_STRING,
          confidence: CONFIDENCE,
          source_span: SOURCE_SPAN,
        },
        required: ["person_name", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: NONCE_SEEN,
  },
  required: ["rows", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface ExecutiveCompensationRow {
  person_name: string;
  principal_position: string | null;
  fiscal_year: number | null;
  salary: number | null;
  bonus: number | null;
  stock_awards: number | null;
  option_awards: number | null;
  non_equity_incentive: number | null;
  pension_and_nqdc: number | null;
  all_other_compensation: number | null;
  total: number | null;
  footnote: string | null;
  confidence: number;
  source_span: string;
}
