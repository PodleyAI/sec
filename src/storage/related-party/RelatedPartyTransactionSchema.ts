/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

export const RelatedPartyTransactionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  extractor_id: Type.String({ maxLength: 16 }),
  transaction_index: Type.Integer({ minimum: 0 }),
  party_kind: Type.Union([Type.Literal("person"), Type.Literal("company")], {
    description: "person | company",
  }),
  observation_id: TypeNullable(
    Type.Integer({ description: "FK to the related-party observation" })
  ),
  counterparty: TypeNullable(Type.String({ maxLength: 256 })),
  nature: TypeNullable(
    Type.String({ description: "e.g. loan, consulting agreement, registration rights" })
  ),
  amount: TypeNullable(Type.Number()),
  // Free-form prose the filer chose, not a code: real values run to full
  // clauses ("In connection with an intended initial business combination" is
  // already 59 chars). The old maxLength of 64 was not a property of the data,
  // and overflowing it threw mid-persist and dead-lettered the whole section.
  // Unbounded matches the sibling free-text fields (`nature`, `footnote`).
  period: TypeNullable(Type.String()),
  footnote: TypeNullable(Type.String()),
});

export type RelatedPartyTransaction = Static<typeof RelatedPartyTransactionSchema>;

export const RelatedPartyTransactionPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "transaction_index",
] as const;

export type RelatedPartyTransactionRepositoryStorage = ITabularStorage<
  typeof RelatedPartyTransactionSchema,
  typeof RelatedPartyTransactionPrimaryKeyNames,
  RelatedPartyTransaction
>;

export const RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN =
  createServiceToken<RelatedPartyTransactionRepositoryStorage>(
    "sec.storage.relatedPartyTransactionRepository"
  );
