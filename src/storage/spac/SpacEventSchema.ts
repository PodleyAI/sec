/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";

/**
 * Lifecycle event vocabulary. `registration` / `ipo` come from S-1/424; the
 * de-SPAC milestones `definitive_agreement` / `terminated` / `completed` /
 * `vote` are written from 8-K item codes. The remaining types are reserved for
 * deferred extractors (S-4/DEFM14A, Form 425, Form 25/15).
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
  "name_change",
  "ticker_change",
  // An investor-presentation exhibit (e.g. 8-K Item 7.01 EX-99); carries the
  // deck URL in source_document_url. Reserved for a dedicated exhibit extractor.
  "investor_presentation",
] as const;
export type SpacEventType = (typeof SPAC_EVENT_TYPES)[number];

/** Append-only lifecycle event; one row per dated event tied to a filing. */
export const SpacEventSchema = Type.Object({
  cik: Type.Integer({ minimum: 0, description: "SPAC origin CIK" }),
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
