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
          common_name: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source_span: { type: "string" },
        },
        required: ["legal_name", "common_name", "confidence", "source_span"],
        additionalProperties: false,
      },
    },
    // Required: the model must copy the untrusted-fence nonce verbatim into
    // this field. sectionExtractors.ts compares it against the nonce
    // generated for this call and throws NonceMismatchError on any
    // deviation, before any `sponsors` rows are trusted.
    nonce_seen: { type: "string" },
  },
  required: ["sponsors", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface SpacSponsorRow {
  legal_name: string;
  common_name: string;
  confidence: number;
  source_span: string;
}
