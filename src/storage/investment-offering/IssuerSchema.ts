/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";

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
export type IssuerRepositoryStorage = ITabularStorage<
  typeof IssuerSchema,
  typeof IssuerPrimaryKeyNames,
  Issuer
>;

/**
 * Dependency injection tokens for repositories
 */
export const ISSUER_REPOSITORY_TOKEN = createServiceToken<IssuerRepositoryStorage>(
  "sec.storage.issuerRepository"
);
