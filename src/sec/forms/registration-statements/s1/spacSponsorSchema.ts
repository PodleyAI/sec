/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

export const SpacSponsorOutputSchema = {
  type: "object",
  properties: {
    sponsors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          legal_name: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_span: { type: "string" },
        },
        required: ["legal_name", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["sponsors", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface SpacSponsorRow {
  legal_name: string;
  confidence: number;
  source_span: string;
  /**
   * Marks a row as produced by the model-free table parse — asserted by that
   * parser's unit tests, and absent from the model's JSON schema. Persist does
   * not read it: the provenance model id comes from `SectionPersistMeta.source`.
   */
  source?: "deterministic";
}
