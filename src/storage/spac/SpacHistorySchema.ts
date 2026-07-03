/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/** Versioned snapshot of the mutable `spac` row for point-in-time reconstruction. */
export const SpacHistorySchema = Type.Object({
  cik: Type.Integer({ minimum: 0 }),
  valid_from: Type.String({ format: "date-time", description: "When this version became valid" }),
  valid_to: TypeNullable(Type.String({ format: "date-time", description: "null = current" })),
  status: TypeNullable(Type.String({ maxLength: 20 })),
  current_cik: TypeNullable(Type.Integer({ minimum: 0 })),
  spac_name: TypeNullable(Type.String({ maxLength: 200 })),
  target_name: TypeNullable(Type.String({ maxLength: 200 })),
  surviving_name: TypeNullable(Type.String({ maxLength: 200 })),
  current_name: TypeNullable(Type.String({ maxLength: 200 })),
  spac_sic: TypeNullable(Type.Integer({ minimum: 0 })),
  post_merger_sic: TypeNullable(Type.Integer({ minimum: 0 })),
  current_sic: TypeNullable(Type.Integer({ minimum: 0 })),
  spac_tickers: TypeNullable(Type.String()),
  post_merger_tickers: TypeNullable(Type.String()),
  current_tickers: TypeNullable(Type.String()),
  ipo_proceeds: TypeNullable(Type.Number()),
  trust_amount: TypeNullable(Type.Number()),
  pipe_amount: TypeNullable(Type.Number()),
  total_redemption_amount: TypeNullable(Type.Number()),
  // Narrative / enrichment (mirrors SpacSchema).
  focus: TypeNullable(Type.String()),
  focus_location: TypeNullable(Type.String()),
  description: TypeNullable(Type.String()),
  target_description: TypeNullable(Type.String()),
  team: TypeNullable(Type.String()),
  details: TypeNullable(Type.String()),
  url_spac: TypeNullable(Type.String({ maxLength: 500 })),
  url_sponsor: TypeNullable(Type.String({ maxLength: 500 })),
  investorpres_url: TypeNullable(Type.String({ maxLength: 500 })),
  investorpres_date: TypeNullable(Type.String({ format: "date" })),
  registration_date: TypeNullable(Type.String({ format: "date" })),
  ipo_date: TypeNullable(Type.String({ format: "date" })),
  unit_split_date: TypeNullable(Type.String({ format: "date" })),
  definitive_agreement_date: TypeNullable(Type.String({ format: "date" })),
  proxy_date: TypeNullable(Type.String({ format: "date" })),
  vote_date: TypeNullable(Type.String({ format: "date" })),
  completed_date: TypeNullable(Type.String({ format: "date" })),
  failed_date: TypeNullable(Type.String({ format: "date" })),
  change_source: Type.String({
    maxLength: 50,
    description: "Form/accession that drove the change",
  }),
  change_date: Type.String({ format: "date-time" }),
});

export type SpacHistory = Static<typeof SpacHistorySchema>;

export const SpacHistoryPrimaryKeyNames = ["cik", "valid_from"] as const;
export type SpacHistoryRepositoryStorage = ITabularStorage<
  typeof SpacHistorySchema,
  typeof SpacHistoryPrimaryKeyNames,
  SpacHistory
>;

export const SPAC_HISTORY_REPOSITORY_TOKEN = createServiceToken<SpacHistoryRepositoryStorage>(
  "sec.storage.spacHistoryRepository"
);
