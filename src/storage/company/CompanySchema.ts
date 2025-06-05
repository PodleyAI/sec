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
 * Company schema
 */
export const CompanySchema = Type.Object({
  company_hash_id: Type.String({ description: "Unique hash of the company" }),
  company_name: Type.String({ description: "Official name of the company" }),
  country_code: Type.Optional(
    TypeNullable(Type.String({ description: "Country code of the company" }))
  ),
  suffix: Type.Optional(
    TypeNullable(Type.String({ description: "Company suffix (Inc., LLC, Corp., etc.)" }))
  ),
  cik: Type.Optional(
    TypeNullable(TypeSecCik({ description: "Central Index Key (CIK) of the company" }))
  ),
  crd: Type.Optional(
    TypeNullable(
      Type.String({ description: "Central Registration Depository (CRD) of the company" })
    )
  ),
});

export type Company = Static<typeof CompanySchema>;

/**
 * Company repository storage type and primary key definitions
 */
export const CompanyPrimaryKeyNames = ["company_hash_id"] as const;
export type CompanyRepositoryStorage = TabularRepository<
  typeof CompanySchema,
  typeof CompanyPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const COMPANY_REPOSITORY_TOKEN = createServiceToken<CompanyRepositoryStorage>(
  "sec.storage.companyRepository"
);

/**
 * Company Entity Junction schema - links companies to entities (CIK entities)
 */
export const CompaniesEntityJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  cik: TypeSecCik(),
  titles: Type.Array(
    Type.String({
      description: "Relationship type, e.g. Subsidiary, Parent, Affiliate, etc.",
    })
  ),
  company_hash_id: Type.String({ description: "Reference to the company hash ID" }),
});

export type CompaniesEntityJunction = Static<typeof CompaniesEntityJunctionSchema>;

/**
 * Company-entity junction repository storage type and primary key definitions
 */
export const CompanyEntityJunctionPrimaryKeyNames = [
  "company_hash_id",
  "relation_name",
  "cik",
] as const;
export type CompanyEntityJunctionRepositoryStorage = TabularRepository<
  typeof CompaniesEntityJunctionSchema,
  typeof CompanyEntityJunctionPrimaryKeyNames
>;

export const COMPANY_ENTITY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<CompanyEntityJunctionRepositoryStorage>(
    "sec.storage.companyEntityJunctionRepository"
  );

/**
 * Company Address Junction schema - links companies to addresses
 */
export const CompaniesAddressJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  company_hash_id: Type.String({ description: "Reference to the company hash ID" }),
  address_hash_id: Type.String({ description: "Reference to the address hash ID" }),
});

export type CompaniesAddressJunction = Static<typeof CompaniesAddressJunctionSchema>;

/**
 * Company-address junction repository storage type and primary key definitions
 */
export const CompanyAddressJunctionPrimaryKeyNames = [
  "company_hash_id",
  "relation_name",
  "address_hash_id",
] as const;
export type CompanyAddressJunctionRepositoryStorage = TabularRepository<
  typeof CompaniesAddressJunctionSchema,
  typeof CompanyAddressJunctionPrimaryKeyNames
>;

export const COMPANY_ADDRESS_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<CompanyAddressJunctionRepositoryStorage>(
    "sec.storage.companyAddressJunctionRepository"
  );

/**
 * Company Phone Junction schema - links companies to phones
 */
export const CompanyPhoneJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Form relationship pair, e.g. form-d:offering",
  }),
  company_hash_id: Type.String({ description: "Reference to the company hash ID" }),
  international_number: Type.String({ description: "Reference to the international phone number" }),
});

export type CompanyPhoneJunction = Static<typeof CompanyPhoneJunctionSchema>;

/**
 * Company-phone junction repository storage type and primary key definitions
 */
export const CompanyPhoneJunctionPrimaryKeyNames = [
  "company_hash_id",
  "relation_name",
  "international_number",
] as const;
export type CompanyPhoneJunctionRepositoryStorage = TabularRepository<
  typeof CompanyPhoneJunctionSchema,
  typeof CompanyPhoneJunctionPrimaryKeyNames
>;

export const COMPANY_PHONE_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<CompanyPhoneJunctionRepositoryStorage>(
    "sec.storage.companyPhoneJunctionRepository"
  );

/**
 * Company Previous Names schema - tracks historical names of companies
 */
export const CompanyPreviousNamesSchema = Type.Object({
  company_hash_id: Type.String({ description: "Reference to the company hash ID" }),
  previous_name: Type.String({ description: "Previous name of the company" }),
  name_type: Type.Union(
    [Type.Literal("issuer"), Type.Literal("edgar"), Type.Literal("dba"), Type.Literal("other")],
    { description: "Type of previous name" }
  ),
  date_changed: Type.Optional(
    TypeNullable(Type.String({ format: "date", description: "Date when name was changed" }))
  ),
  source: Type.Optional(
    TypeNullable(Type.String({ description: "Source of the previous name information" }))
  ),
});

export type CompanyPreviousNames = Static<typeof CompanyPreviousNamesSchema>;

/**
 * Company previous names repository storage type and primary key definitions
 */
export const CompanyPreviousNamesPrimaryKeyNames = [
  "company_hash_id",
  "previous_name",
  "name_type",
] as const;
export type CompanyPreviousNamesRepositoryStorage = TabularRepository<
  typeof CompanyPreviousNamesSchema,
  typeof CompanyPreviousNamesPrimaryKeyNames
>;

export const COMPANY_PREVIOUS_NAMES_REPOSITORY_TOKEN =
  createServiceToken<CompanyPreviousNamesRepositoryStorage>(
    "sec.storage.companyPreviousNamesRepository"
  );
