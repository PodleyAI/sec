/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * Canonical-person ↔ address junction, tagged by resolver_version. Two
 * writers keep this table, and they fill these columns differently:
 * `EntityObserver`'s incremental path increments `observation_count` by one
 * and stamps `first_seen_at`/`last_seen_at` with the wall clock each time an
 * observation contributes the same `(canonical_person_id, address_hash_id)`
 * pair; `rebuildPersonJunctions` (a projection) replaces a resolver
 * version's rows wholesale with one row per group, `observation_count` a
 * plain group size and `first_seen_at`/`last_seen_at` the min/max
 * `filing_date` of the asserting filings. Used downstream as a
 * primary-address heuristic.
 *
 * Address rows themselves live in the existing `address` table; this
 * junction only references their hash IDs.
 */
export const CanonicalPersonAddressSchema = Type.Object({
  canonical_person_id: Type.String({ maxLength: 36 }),
  address_hash_id: Type.String({ maxLength: 512 }),
  resolver_version: Type.String({ maxLength: 32 }),
  observation_count: Type.Integer({
    minimum: 1,
    description:
      "Count of contributing observations — a running increment from EntityObserver, " +
      "or a group size from a rebuildPersonJunctions projection",
  }),
  first_seen_at: Type.String({
    description:
      "Earliest sighting — an ISO 8601 timestamp from EntityObserver, " +
      "or a YYYY-MM-DD filing_date from a rebuildPersonJunctions projection",
  }),
  last_seen_at: Type.String({
    description:
      "Most recent sighting — an ISO 8601 timestamp from EntityObserver, " +
      "or a YYYY-MM-DD filing_date from a rebuildPersonJunctions projection",
  }),
});
export type CanonicalPersonAddress = Static<typeof CanonicalPersonAddressSchema>;
export const CanonicalPersonAddressPrimaryKeyNames = [
  "canonical_person_id",
  "address_hash_id",
  "resolver_version",
] as const;
export type CanonicalPersonAddressRepositoryStorage = ITabularStorage<
  typeof CanonicalPersonAddressSchema,
  typeof CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddress
>;
export const CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalPersonAddressRepositoryStorage>(
    "sec.storage.canonicalPersonAddressRepository"
  );

/**
 * Canonical-person ↔ phone junction. Phone rows live in the existing
 * `phone` table keyed on `international_number`; this junction references
 * the same column.
 */
export const CanonicalPersonPhoneSchema = Type.Object({
  canonical_person_id: Type.String({ maxLength: 36 }),
  // Must track PhoneSchema.international_number (64) — this column holds the
  // same value, and a normalized number carries its extension inline.
  international_number: Type.String({ maxLength: 64 }),
  resolver_version: Type.String({ maxLength: 32 }),
  observation_count: Type.Integer({ minimum: 1 }),
  first_seen_at: Type.String(),
  last_seen_at: Type.String(),
});
export type CanonicalPersonPhone = Static<typeof CanonicalPersonPhoneSchema>;
export const CanonicalPersonPhonePrimaryKeyNames = [
  "canonical_person_id",
  "international_number",
  "resolver_version",
] as const;
export type CanonicalPersonPhoneRepositoryStorage = ITabularStorage<
  typeof CanonicalPersonPhoneSchema,
  typeof CanonicalPersonPhonePrimaryKeyNames,
  CanonicalPersonPhone
>;
export const CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN =
  createServiceToken<CanonicalPersonPhoneRepositoryStorage>(
    "sec.storage.canonicalPersonPhoneRepository"
  );

/** Canonical-company ↔ address junction. */
export const CanonicalCompanyAddressSchema = Type.Object({
  canonical_company_id: Type.String({ maxLength: 36 }),
  address_hash_id: Type.String({ maxLength: 512 }),
  resolver_version: Type.String({ maxLength: 32 }),
  observation_count: Type.Integer({ minimum: 1 }),
  first_seen_at: Type.String(),
  last_seen_at: Type.String(),
});
export type CanonicalCompanyAddress = Static<typeof CanonicalCompanyAddressSchema>;
export const CanonicalCompanyAddressPrimaryKeyNames = [
  "canonical_company_id",
  "address_hash_id",
  "resolver_version",
] as const;
export type CanonicalCompanyAddressRepositoryStorage = ITabularStorage<
  typeof CanonicalCompanyAddressSchema,
  typeof CanonicalCompanyAddressPrimaryKeyNames,
  CanonicalCompanyAddress
>;
export const CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalCompanyAddressRepositoryStorage>(
    "sec.storage.canonicalCompanyAddressRepository"
  );

/** Canonical-company ↔ phone junction. */
export const CanonicalCompanyPhoneSchema = Type.Object({
  canonical_company_id: Type.String({ maxLength: 36 }),
  // Must track PhoneSchema.international_number (64) — this column holds the
  // same value, and a normalized number carries its extension inline.
  international_number: Type.String({ maxLength: 64 }),
  resolver_version: Type.String({ maxLength: 32 }),
  observation_count: Type.Integer({ minimum: 1 }),
  first_seen_at: Type.String(),
  last_seen_at: Type.String(),
});
export type CanonicalCompanyPhone = Static<typeof CanonicalCompanyPhoneSchema>;
export const CanonicalCompanyPhonePrimaryKeyNames = [
  "canonical_company_id",
  "international_number",
  "resolver_version",
] as const;
export type CanonicalCompanyPhoneRepositoryStorage = ITabularStorage<
  typeof CanonicalCompanyPhoneSchema,
  typeof CanonicalCompanyPhonePrimaryKeyNames,
  CanonicalCompanyPhone
>;
export const CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN =
  createServiceToken<CanonicalCompanyPhoneRepositoryStorage>(
    "sec.storage.canonicalCompanyPhoneRepository"
  );
