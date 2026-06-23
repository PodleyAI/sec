/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";

/** Outcome of a business-combination attempt. */
export const SPAC_DEAL_OUTCOMES = ["pending", "completed", "terminated"] as const;
export type SpacDealOutcome = (typeof SPAC_DEAL_OUTCOMES)[number];

/** One row per business-combination attempt. Append-only; terminated attempts are retained. */
export const SpacDealSchema = Type.Object({
  cik: Type.Integer({ minimum: 0, description: "SPAC origin CIK" }),
  deal_index: Type.Integer({ minimum: 0, description: "0-based ordinal of the attempt" }),
  target_name: TypeNullable(Type.String({ maxLength: 200 })),
  target_cik: TypeNullable(Type.Integer({ minimum: 0 })),
  announced_date: TypeNullable(Type.String({ format: "date" })),
  definitive_agreement_date: TypeNullable(Type.String({ format: "date" })),
  proxy_date: TypeNullable(Type.String({ format: "date" })),
  vote_date: TypeNullable(Type.String({ format: "date" })),
  pipe_amount: TypeNullable(Type.Number()),
  redemption_amount: TypeNullable(Type.Number()),
  redemption_shares: TypeNullable(Type.Integer({ minimum: 0 })),
  outcome: TypeStringEnum(SPAC_DEAL_OUTCOMES, { description: "pending | completed | terminated" }),
  outcome_date: TypeNullable(Type.String({ format: "date" })),
  source_accession: TypeNullable(Type.String({ maxLength: 25 })),
  created_at: Type.String({ format: "date-time" }),
});

export type SpacDeal = Static<typeof SpacDealSchema>;

export const SpacDealPrimaryKeyNames = ["cik", "deal_index"] as const;
export type SpacDealRepositoryStorage = ITabularStorage<
  typeof SpacDealSchema,
  typeof SpacDealPrimaryKeyNames,
  SpacDeal
>;

export const SPAC_DEAL_REPOSITORY_TOKEN = createServiceToken<SpacDealRepositoryStorage>(
  "sec.storage.spacDealRepository"
);
