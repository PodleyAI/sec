/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

export const UseOfProceedsOutputSchema = {
  type: "object",
  properties: {
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          purpose: { type: ["string", "null"] },
          amount: { type: ["number", "null"] },
          percent: { type: ["number", "null"] },
          note: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_span: { type: "string" },
        },
        required: ["confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["line_items", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface UseOfProceedsLineRow {
  purpose: string | null;
  amount: number | null;
  percent: number | null;
  note: string | null;
  confidence: number;
  source_span: string;
}
