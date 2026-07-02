/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";

/** Lifecycle status of a SPAC. Terminal states: completed, liquidated, withdrawn. */
export const SPAC_STATUSES = [
  "registered",
  "ipo",
  "searching",
  "deal_announced",
  "proxy",
  "completed",
  "liquidated",
  "withdrawn",
] as const;
export type SpacStatus = (typeof SPAC_STATUSES)[number];

/**
 * Mutable consolidated SPAC report row (one per SPAC, keyed by origin CIK).
 * Event/deal-derived fields are recomputed by {@link buildSpacRow}; filing-sourced
 * scalar fields are merged under the `as_of` out-of-order guard.
 */
export const SpacSchema = Type.Object({
  cik: Type.Integer({ minimum: 0, description: "SPAC origin CIK (primary key)" }),
  current_cik: TypeNullable(
    Type.Integer({ minimum: 0, description: "Surviving entity CIK if it differs from cik" })
  ),
  status: TypeStringEnum(SPAC_STATUSES, { description: "Lifecycle status" }),

  // Names (three eras + close-time snapshot)
  spac_name: TypeNullable(
    Type.String({ maxLength: 200, description: "Blank-check shell name at IPO" })
  ),
  target_name: TypeNullable(
    Type.String({ maxLength: 200, description: "Active deal's target name" })
  ),
  surviving_name: TypeNullable(
    Type.String({
      maxLength: 200,
      description: "Combined entity name as of de-SPAC close (snapshot)",
    })
  ),
  current_name: TypeNullable(Type.String({ maxLength: 200, description: "Latest known name" })),

  // SIC (three eras)
  spac_sic: TypeNullable(Type.Integer({ minimum: 0, description: "SIC at IPO (≈6770)" })),
  post_merger_sic: TypeNullable(Type.Integer({ minimum: 0, description: "SIC at de-SPAC close" })),
  current_sic: TypeNullable(Type.Integer({ minimum: 0, description: "Latest SIC" })),

  // Tickers (three eras; JSON-encoded string arrays)
  spac_tickers: TypeNullable(Type.String({ description: "JSON string[] of SPAC-era tickers" })),
  post_merger_tickers: TypeNullable(
    Type.String({ description: "JSON string[] of post-merger tickers" })
  ),
  current_tickers: TypeNullable(Type.String({ description: "JSON string[] of current tickers" })),

  // Amounts
  ipo_proceeds: TypeNullable(Type.Number({ description: "Gross IPO proceeds" })),
  trust_amount: TypeNullable(
    Type.Number({ description: "Initial trust amount (redeemable cash)" })
  ),
  pipe_amount: TypeNullable(Type.Number({ description: "PIPE financing on the active deal" })),
  total_redemption_amount: TypeNullable(
    Type.Number({ description: "Cumulative redemptions across all votes" })
  ),

  // Narrative / enrichment (embarc-facing). Merge-preserved filing-sourced
  // scalars under the same `as_of` guard as the other scalars; `focus` /
  // `focus_location` / `details` hold JSON-encoded strings (mirroring the
  // `spac_tickers` string[] pattern). `url_sponsor` has no reliable SEC source
  // and is editorial/manual (column only). `target_description` (merger-proxy)
  // and `investorpres_*` (event stream) land in later phases.
  focus: TypeNullable(
    Type.String({
      description: "JSON string[] of business sector focus tags (controlled vocabulary)",
    })
  ),
  focus_location: TypeNullable(
    Type.String({ description: "JSON string[] of geographic focus tags (e.g. 'Latin America')" })
  ),
  description: TypeNullable(
    Type.String({ description: "SPAC narrative description (blank-check business purpose)" })
  ),
  target_description: TypeNullable(
    Type.String({ description: "Target company description (derived from the active deal)" })
  ),
  team: TypeNullable(Type.String({ description: "Management team narrative text" })),
  details: TypeNullable(Type.String({ description: "JSON key/value freeform details map" })),
  url_spac: TypeNullable(Type.String({ maxLength: 500, description: "SPAC website URL" })),
  url_sponsor: TypeNullable(
    Type.String({ maxLength: 500, description: "Sponsor website URL (editorial/manual)" })
  ),
  investorpres_url: TypeNullable(
    Type.String({
      maxLength: 500,
      description: "Investor presentation URL (derived from event stream)",
    })
  ),
  investorpres_date: TypeNullable(
    Type.String({
      format: "date",
      description: "Investor presentation date (derived from event stream)",
    })
  ),

  // Rolled-up key dates
  registration_date: TypeNullable(Type.String({ format: "date" })),
  ipo_date: TypeNullable(Type.String({ format: "date" })),
  unit_split_date: TypeNullable(Type.String({ format: "date" })),
  definitive_agreement_date: TypeNullable(Type.String({ format: "date" })),
  proxy_date: TypeNullable(Type.String({ format: "date" })),
  vote_date: TypeNullable(Type.String({ format: "date" })),
  completed_date: TypeNullable(Type.String({ format: "date" })),
  failed_date: TypeNullable(Type.String({ format: "date" })),

  // Temporal / provenance
  as_of: TypeNullable(
    Type.String({
      format: "date",
      description:
        "Filing date of the filing that last shaped the merged scalar fields; out-of-order guard",
    })
  ),
  updated_at: Type.String({ format: "date-time", description: "Last write timestamp" }),
});

export type Spac = Static<typeof SpacSchema>;

export const SpacPrimaryKeyNames = ["cik"] as const;
export type SpacRepositoryStorage = ITabularStorage<
  typeof SpacSchema,
  typeof SpacPrimaryKeyNames,
  Spac
>;

export const SPAC_REPOSITORY_TOKEN = createServiceToken<SpacRepositoryStorage>(
  "sec.storage.spacRepository"
);
