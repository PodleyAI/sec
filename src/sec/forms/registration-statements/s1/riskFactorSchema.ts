/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const CONFIDENCE = { type: "number", minimum: 0, maximum: 1 } as const;
const SOURCE_SPAN = { type: "string" } as const;
const NONCE_SEEN = { type: "string", pattern: "^[0-9a-f]{16}$" } as const;

/**
 * One row per risk factor: the filer's own caption (the bolded lead-in sentence
 * that introduces each risk) plus the category heading it sits under. The
 * multi-paragraph body under each caption is deliberately NOT extracted — the
 * caption is the enumerable, queryable unit of an Item 105 disclosure, and the
 * filing itself remains the body of record.
 */
export const RiskFactorsOutputSchema = {
  type: "object",
  properties: {
    risks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: {
            type: "string",
            description:
              "The risk factor's caption, verbatim from the document — the bolded " +
              "lead-in sentence, not a paraphrase or summary",
          },
          category: NULLABLE_STRING,
          confidence: CONFIDENCE,
          source_span: SOURCE_SPAN,
        },
        required: ["headline", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: NONCE_SEEN,
  },
  required: ["risks", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface RiskFactorRow {
  headline: string;
  category: string | null;
  confidence: number;
  source_span: string;
}
