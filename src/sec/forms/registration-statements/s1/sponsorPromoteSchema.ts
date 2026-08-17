/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_NUMBER = { type: ["number", "null"] } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

/**
 * One sponsor-promote object, extracted from a SPAC prospectus's "The Offering" /
 * "The Sponsor" prose: founder-share promote, private-placement warrant coverage,
 * and trust sizing. Every figure is nullable — a filing that discloses only some
 * of them yields the rest as null (mirrors {@link OfferingTermsOutputSchema}).
 */
export const SponsorPromoteOutputSchema = {
  type: "object",
  properties: {
    founder_shares: NULLABLE_NUMBER,
    founder_percent: NULLABLE_NUMBER,
    private_placement_warrants: NULLABLE_NUMBER,
    private_placement_warrant_price: NULLABLE_NUMBER,
    public_warrant_coverage: NULLABLE_NUMBER,
    trust_per_public_share: NULLABLE_NUMBER,
    trust_total: NULLABLE_NUMBER,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    // Nullable so a model that finds no promote disclosure returns a null span
    // (→ the section runner records MODEL_EMPTY) instead of failing validation.
    source_span: NULLABLE_STRING,
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["confidence", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface SponsorPromoteRow {
  founder_shares: number | null;
  founder_percent: number | null;
  private_placement_warrants: number | null;
  private_placement_warrant_price: number | null;
  public_warrant_coverage: number | null;
  trust_per_public_share: number | null;
  trust_total: number | null;
  confidence: number;
  source_span: string;
  /** Persist-only. Set by the markdown-table parser; never part of the model schema. */
  source?: "deterministic";
}
