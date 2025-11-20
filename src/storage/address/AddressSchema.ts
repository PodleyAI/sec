//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";
import { TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";
import { ISO_COUNTRY_CODE_ARRAY, SEC_STATE_CODE_ARRAY } from "./AddressSchemaCodes";

export type StateOrCountryCode = (typeof SEC_STATE_CODE_ARRAY)[number];
export type CountryCode = (typeof ISO_COUNTRY_CODE_ARRAY)[number];

export const STATE_COUNTRY_CODE = TypeStringEnum(SEC_STATE_CODE_ARRAY, {
  description: "State or SEC Country Code",
});

export const COUNTRY_CODE = TypeStringEnum(ISO_COUNTRY_CODE_ARRAY, {
  description: "ISO Country Code",
});

/**
 * Address schema
 */
export const AddressSchema = Type.Object({
  address_hash_id: Type.String({ description: "Unique hash of the address" }),
  street1: Type.String({ description: "First line of the address" }),
  street2: TypeNullable(Type.String({ description: "Second line of the address" })),
  street3: TypeNullable(Type.String({ description: "Third line of the address" })),
  city: Type.String({ description: "City of the address" }),
  state_or_country: STATE_COUNTRY_CODE,
  country_code: COUNTRY_CODE,
  zip: TypeNullable(Type.String({ description: "Zip code of the address" })),
});

export type Address = Static<typeof AddressSchema>;

/**
 * Address repository storage type and primary key definitions
 */
export const AddressPrimaryKeyNames = ["address_hash_id"] as const;
export type AddressRepositoryStorage = TabularRepository<
  typeof AddressSchema,
  typeof AddressPrimaryKeyNames,
  Address
>;

/**
 * Dependency injection tokens for repositories
 */
export const ADDRESS_REPOSITORY_TOKEN = createServiceToken<AddressRepositoryStorage>(
  "sec.storage.addressRepository"
);

/**
 * Address Entity Junction schema - links addresses to entities (CIK entities)
 */
export const AddressesEntityJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Name of the relationship type between address and entity",
  }),
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) of the entity",
  }),
  address_hash_id: Type.String({ description: "Reference to the address hash ID" }),
});

export type AddressesEntityJunction = Static<typeof AddressesEntityJunctionSchema>;

/**
 * Address junction repository storage type and primary key definitions
 */
export const AddressJunctionPrimaryKeyNames = ["address_hash_id", "relation_name", "cik"] as const;
export type AddressJunctionRepositoryStorage = TabularRepository<
  typeof AddressesEntityJunctionSchema,
  typeof AddressJunctionPrimaryKeyNames,
  AddressesEntityJunction
>;

export const ADDRESS_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<AddressJunctionRepositoryStorage>("sec.storage.addressJunctionRepository");
