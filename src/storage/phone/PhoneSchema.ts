//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

export const PHONE_TYPE = Type.Union(
  [
    Type.Literal("fixed-line"),
    Type.Literal("fixed-line-or-mobile"),
    Type.Literal("mobile"),
    Type.Literal("pager"),
    Type.Literal("personal-number"),
    Type.Literal("premium-rate"),
    Type.Literal("shared-cost"),
    Type.Literal("toll-free"),
    Type.Literal("uan"),
    Type.Literal("voip"),
    Type.Literal("unknown"),
  ],
  { description: "Type of phone number as detected by awesome-phonenumber library" }
);

export type PhoneType = Static<typeof PHONE_TYPE>;

/**
 * Phone schema
 */
export const PhoneSchema = Type.Object({
  country_code: Type.String({
    minLength: 2,
    maxLength: 2,
    description: "ISO 3166-1 alpha-2 country code",
  }),
  international_number: Type.String({
    maxLength: 20,
    description: "International phone number with country code",
  }),
  type: Type.Optional(PHONE_TYPE),
  raw_phone: Type.String({ description: "Original phone number as entered" }),
});

export type Phone = Static<typeof PhoneSchema>;

/**
 * Phone repository storage type and primary key definitions
 */
export const PhonePrimaryKeyNames = ["international_number"] as const;
export type PhoneRepositoryStorage = TabularRepository<
  typeof PhoneSchema,
  typeof PhonePrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const PHONE_REPOSITORY_TOKEN = createServiceToken<PhoneRepositoryStorage>(
  "sec.storage.phoneRepository"
);

/**
 * Phone Entity Junction schema - links phones to entities (CIK entities)
 */
export const PhonesEntityJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  cik: TypeSecCik(),
  international_number: Type.String({ description: "Reference to the international phone number" }),
});

export type PhonesEntityJunction = Static<typeof PhonesEntityJunctionSchema>;

/**
 * Phone-entity junction repository storage type and primary key definitions
 */
export const PhoneEntityJunctionPrimaryKeyNames = [
  "international_number",
  "relation_name",
  "cik",
] as const;
export type PhoneEntityJunctionRepositoryStorage = TabularRepository<
  typeof PhonesEntityJunctionSchema,
  typeof PhoneEntityJunctionPrimaryKeyNames
>;

export const PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<PhoneEntityJunctionRepositoryStorage>(
    "sec.storage.phoneEntityJunctionRepository"
  );
