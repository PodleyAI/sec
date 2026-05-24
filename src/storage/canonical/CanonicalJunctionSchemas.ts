/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * Canonical-person ↔ address junction, tagged by resolver_version.
 * `observation_count` is incremented every time an observation contributes
 * the same `(canonical_person_id, address_hash_id)` pair under the same
 * resolver_version; used downstream as a primary-address heuristic.
 *
 * Address rows themselves live in the existing `address` table; this
 * junction only references their hash IDs.
 */
export const CanonicalPersonAddressSchema = Type.Object({
  canonical_person_id: Type.String({ maxLength: 36 }),
  address_hash_id: Type.String({ maxLength: 64 }),
  resolver_version: Type.String({ maxLength: 32 }),
  observation_count: Type.Integer({
    minimum: 1,
    description: "Number of observations that resolved to this (canonical, address) pair",
  }),
  first_seen_at: Type.String({ description: "ISO 8601 timestamp of first sighting" }),
  last_seen_at: Type.String({ description: "ISO 8601 timestamp of most recent sighting" }),
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
  international_number: Type.String({ maxLength: 20 }),
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
  address_hash_id: Type.String({ maxLength: 64 }),
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
  international_number: Type.String({ maxLength: 20 }),
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
