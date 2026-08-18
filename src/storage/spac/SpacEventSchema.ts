/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * Lifecycle event vocabulary. `registration` / `ipo` come from S-1/424.
 * Item 1.01 / 1.02 / 5.03 / 5.07 are classified into a lifecycle type
 * (`definitive_agreement` / `terminated` / `vote` / `name_change`) or a
 * non-lifecycle type (`material_agreement` / `eight_k`); they are not 1:1
 * with item codes.
 * `deregistration` is written from Form 25 / Form 15 metadata, and from a
 * 25-NSE that is not unit separation. `unit_split` is written from an
 * exchange 25-NSE shortly after IPO (units unbundle; shares keep trading).
 * `withdrawal` is written from Form RW (registration withdrawal) metadata.
 * Remaining types are reserved for deferred extractors (S-4, Form 425,
 * liquidation narrative).
 */
export const SPAC_EVENT_TYPES = [
  "registration",
  "ipo",
  "unit_split",
  // Non-binding letter of intent (or agreement in principle) for a business
  // combination. No 8-K item code carries it — it is AI-extracted from
  // known-SPAC 8-K narratives (Item 1.01/7.01/8.01 press releases).
  "loi",
  "definitive_agreement",
  "proxy",
  "vote",
  "redemption",
  "pipe",
  "completed",
  "terminated",
  "liquidation",
  "deregistration",
  "withdrawal",
  "name_change",
  "ticker_change",
  // An investor-presentation exhibit (e.g. 8-K Item 7.01 EX-99); carries the
  // deck URL in source_document_url. Reserved for a dedicated exhibit extractor.
  "investor_presentation",
  // Non-merger Item 1.01 / 1.02 (underwriting, FPA, leases, etc.).
  "material_agreement",
  // Non-de-SPAC Item 5.07 (annual meeting, etc.).
  "eight_k",
] as const;
export type SpacEventType = (typeof SPAC_EVENT_TYPES)[number];

/** Event types written from 8-K item codes (replaced as a set on reprocess). */
export const ITEM_MAPPED_EVENT_TYPES = [
  "definitive_agreement",
  "terminated",
  "completed",
  "vote",
  "name_change",
  "material_agreement",
  "eight_k",
] as const satisfies readonly SpacEventType[];

/** Append-only lifecycle event; one row per dated event tied to a filing. */
export const SpacEventSchema = Type.Object({
  cik: TypeSecCik({ description: "SPAC origin CIK" }),
  accession_number: Type.String({ maxLength: 25 }),
  event_type: TypeStringEnum(SPAC_EVENT_TYPES, { description: "Event type" }),
  event_date: Type.String({ format: "date" }),
  form: TypeNullable(Type.String({ maxLength: 20 })),
  primary_document: TypeNullable(Type.String({ maxLength: 200 })),
  source_document_url: TypeNullable(
    Type.String({
      maxLength: 500,
      description: "Sub-document URL, e.g. an EX-99.1 investor presentation",
    })
  ),
  deal_index: TypeNullable(
    Type.Integer({ minimum: 0, description: "Associated spac_deal attempt" })
  ),
  amount: TypeNullable(Type.Number()),
  shares: TypeNullable(Type.Integer({ minimum: 0 })),
  detail: TypeNullable(Type.String({ maxLength: 1024 })),
  confidence: TypeNullable(Type.Number()),
  created_at: Type.String({ format: "date-time" }),
});

export type SpacEvent = Static<typeof SpacEventSchema>;

export const SpacEventPrimaryKeyNames = ["cik", "accession_number", "event_type"] as const;
export type SpacEventRepositoryStorage = ITabularStorage<
  typeof SpacEventSchema,
  typeof SpacEventPrimaryKeyNames,
  SpacEvent
>;

export const SPAC_EVENT_REPOSITORY_TOKEN = createServiceToken<SpacEventRepositoryStorage>(
  "sec.storage.spacEventRepository"
);
