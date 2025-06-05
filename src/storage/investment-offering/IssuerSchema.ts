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

/**
 * Issuer schema based on edgar_issuers table - represents the relationship between entities and their issuers
 */
export const IssuerSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) of the entity" }),
  issuer_cik: TypeSecCik({ description: "Central Index Key (CIK) of the issuer entity" }),
  is_primary: Type.Boolean({
    description: "Whether this is a primary issuer relationship",
  }),
});

export type Issuer = Static<typeof IssuerSchema>;

/**
 * Issuer repository storage type and primary key definitions
 */
export const IssuerPrimaryKeyNames = ["cik", "issuer_cik"] as const;
export type IssuerRepositoryStorage = TabularRepository<
  typeof IssuerSchema,
  typeof IssuerPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const ISSUER_REPOSITORY_TOKEN = createServiceToken<IssuerRepositoryStorage>(
  "sec.storage.issuerRepository"
);
