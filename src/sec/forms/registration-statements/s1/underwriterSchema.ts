/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

export const UnderwriterOutputSchema = {
  type: "object",
  properties: {
    underwriters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          legal_name: { type: "string" },
          common_name: { type: "string" },
          role: { type: ["string", "null"], enum: ["lead", "bookrunner", "co-manager", "underwriter", null] },
          shares_allocated: { type: ["number", "null"] },
          over_allotment_shares: { type: ["number", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_span: { type: "string" },
        },
        required: ["legal_name", "common_name", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["underwriters", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface UnderwriterRowOut {
  legal_name: string;
  common_name: string;
  role: "lead" | "bookrunner" | "co-manager" | "underwriter" | null;
  shares_allocated: number | null;
  over_allotment_shares: number | null;
  confidence: number;
  source_span: string;
}
