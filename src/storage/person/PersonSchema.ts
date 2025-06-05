//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/**
 * Person schema
 */
export const PersonSchema = Type.Object({
  person_hash_id: Type.String({ description: "Unique hash of the person" }),
  first: Type.String({ description: "First name of the person" }),
  middle: TypeNullable(Type.String({ description: "Middle name or initial of the person" })),
  last: Type.String({ description: "Last name of the person" }),
  suffix: TypeNullable(Type.String({ description: "Name suffix (Jr., Sr., III, etc.)" })),
  title: TypeNullable(Type.String({ description: "Professional title or designation" })),
  nick: TypeNullable(Type.String({ description: "Nickname of the person" })),
  dob: Type.Optional(
    TypeNullable(
      Type.String({
        minLength: 4,
        maxLength: 10,
        description: "Date of birth of the person, YYYY-MM-DD or YYYY-MM or YYYY",
      })
    )
  ),
  notes: Type.Optional(
    TypeNullable(
      Type.String({ description: "Notes used to make two people with the same name different" })
    )
  ),
  cik: Type.Optional(
    TypeNullable(TypeSecCik({ description: "Central Index Key (CIK) of the person" }))
  ),
  crd: Type.Optional(
    TypeNullable(
      Type.String({ description: "Central Registration Depository (CRD) of the person" })
    )
  ),
});

export type Person = Static<typeof PersonSchema>;

/**
 * Person repository storage type and primary key definitions
 */
export const PersonPrimaryKeyNames = ["person_hash_id"] as const;
export type PersonRepositoryStorage = TabularRepository<
  typeof PersonSchema,
  typeof PersonPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const PERSON_REPOSITORY_TOKEN = createServiceToken<PersonRepositoryStorage>(
  "sec.storage.personRepository"
);

/**
 * Person Entity Junction schema - links persons to entities (CIK entities)
 */
export const PersonsEntityJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  cik: TypeSecCik(),
  titles: Type.Array(
    Type.String({
      description: "Title of the relationship, e.g. CEO, General Counsel, etc.",
    })
  ),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
});

export type PersonsEntityJunction = Static<typeof PersonsEntityJunctionSchema>;

/**
 * Person-entity junction repository storage type and primary key definitions
 */
export const PersonEntityJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "cik",
] as const;
export type PersonEntityJunctionRepositoryStorage = TabularRepository<
  typeof PersonsEntityJunctionSchema,
  typeof PersonEntityJunctionPrimaryKeyNames
>;

export const PERSON_ENTITY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonEntityJunctionRepositoryStorage>(
    "sec.storage.personEntityJunctionRepository"
  );

/**
 * Person Address Junction schema - links persons to addresses
 */
export const PersonsAddressJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
  address_hash_id: Type.String({ description: "Reference to the address hash ID" }),
});

export type PersonsAddressJunction = Static<typeof PersonsAddressJunctionSchema>;

/**
 * Person-address junction repository storage type and primary key definitions
 */
export const PersonAddressJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "address_hash_id",
] as const;
export type PersonAddressJunctionRepositoryStorage = TabularRepository<
  typeof PersonsAddressJunctionSchema,
  typeof PersonAddressJunctionPrimaryKeyNames
>;

export const PERSON_ADDRESS_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonAddressJunctionRepositoryStorage>(
    "sec.storage.personAddressJunctionRepository"
  );

/**
 * Person Phone Junction schema - links persons to phones
 */
export const PersonPhoneJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
  international_number: Type.String({ description: "Reference to the international phone number" }),
});

export type PersonPhoneJunction = Static<typeof PersonPhoneJunctionSchema>;

/**
 * Person-phone junction repository storage type and primary key definitions
 */
export const PersonPhoneJunctionPrimaryKeyNames = [
  "person_hash_id",
  "relation_name",
  "international_number",
] as const;
export type PersonPhoneJunctionRepositoryStorage = TabularRepository<
  typeof PersonPhoneJunctionSchema,
  typeof PersonPhoneJunctionPrimaryKeyNames
>;

export const PERSON_PHONE_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PersonPhoneJunctionRepositoryStorage>(
    "sec.storage.personPhoneJunctionRepository"
  );

/**
 * Person Previous Names schema - tracks historical names of persons
 */
export const PersonPreviousNamesSchema = Type.Object({
  person_hash_id: Type.String({ description: "Reference to the person hash ID" }),
  previous_name: Type.String({ description: "Previous name of the person" }),
  name_type: Type.Union(
    [Type.Literal("maiden"), Type.Literal("former"), Type.Literal("alias"), Type.Literal("other")],
    { description: "Type of previous name" }
  ),
  date_changed: Type.Optional(
    TypeNullable(Type.String({ format: "date", description: "Date when name was changed" }))
  ),
  source: Type.Optional(
    TypeNullable(Type.String({ description: "Source of the previous name information" }))
  ),
});

export type PersonPreviousNames = Static<typeof PersonPreviousNamesSchema>;

/**
 * Person previous names repository storage type and primary key definitions
 */
export const PersonPreviousNamesPrimaryKeyNames = [
  "person_hash_id",
  "previous_name",
  "name_type",
] as const;
export type PersonPreviousNamesRepositoryStorage = TabularRepository<
  typeof PersonPreviousNamesSchema,
  typeof PersonPreviousNamesPrimaryKeyNames
>;

export const PERSON_PREVIOUS_NAMES_REPOSITORY_TOKEN =
  createServiceToken<PersonPreviousNamesRepositoryStorage>(
    "sec.storage.personPreviousNamesRepository"
  );
