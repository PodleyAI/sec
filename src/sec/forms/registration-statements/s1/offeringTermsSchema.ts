/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "workglow";

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_NUMBER = { type: ["number", "null"] } as const;

/**
 * One offering-terms object. The model fills equity fields for a normal IPO and
 * unit fields for a SPAC; `processFormS1` routes by the deterministic is_spac
 * flag. `tickers` feeds the point-in-time IssuerTicker series.
 */
export const OfferingTermsOutputSchema = {
  type: "object",
  properties: {
    security_type: NULLABLE_STRING,
    shares_offered: NULLABLE_NUMBER,
    price: NULLABLE_NUMBER,
    price_low: NULLABLE_NUMBER,
    price_high: NULLABLE_NUMBER,
    gross_proceeds: NULLABLE_NUMBER,
    net_proceeds: NULLABLE_NUMBER,
    over_allotment_shares: NULLABLE_NUMBER,
    units_offered: NULLABLE_NUMBER,
    price_per_unit: NULLABLE_NUMBER,
    unit_composition: NULLABLE_STRING,
    warrant_fraction_per_unit: NULLABLE_NUMBER,
    right_fraction_per_unit: NULLABLE_NUMBER,
    trust_per_unit: NULLABLE_NUMBER,
    over_allotment_units: NULLABLE_NUMBER,
    exchange: NULLABLE_STRING,
    par_value: NULLABLE_NUMBER,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_span: { type: "string" },
    tickers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          exchange: NULLABLE_STRING,
          security_type: NULLABLE_STRING,
          is_primary: { type: "boolean" },
        },
        required: ["ticker", "is_primary"],
        additionalProperties: false,
      },
    },
    nonce_seen: { type: "string", pattern: "^[0-9a-f]{16}$" },
  },
  required: ["confidence", "source_span", "tickers", "nonce_seen"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export interface OfferingTickerRow {
  ticker: string;
  exchange: string | null;
  security_type: string | null;
  is_primary: boolean;
}

export interface OfferingTermsRow {
  security_type: string | null;
  shares_offered: number | null;
  price: number | null;
  price_low: number | null;
  price_high: number | null;
  gross_proceeds: number | null;
  net_proceeds: number | null;
  over_allotment_shares: number | null;
  units_offered: number | null;
  price_per_unit: number | null;
  unit_composition: string | null;
  warrant_fraction_per_unit: number | null;
  right_fraction_per_unit: number | null;
  trust_per_unit: number | null;
  over_allotment_units: number | null;
  exchange: string | null;
  par_value: number | null;
  confidence: number;
  source_span: string;
  tickers: ReadonlyArray<OfferingTickerRow>;
  /** Persist-only. Set by the markdown-table parser; never part of the model schema. */
  source?: "deterministic";
}
