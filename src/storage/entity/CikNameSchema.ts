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
 * SIC Code schema - represents Standard Industrial Classification codes
 */
export const CikNameSchema = Type.Object({
  cik: TypeSecCik(),
  name: TypeNullable(
    Type.String({
      description: "Name of the entity",
    })
  ),
});

export type CikNameType = Static<typeof CikNameSchema>;

/**
 * SIC Code repository storage type and primary key definitions
 */
export const CikNamePrimaryKeyNames = ["cik"] as const;
export type CikNameRepositoryStorage = TabularRepository<
  typeof CikNameSchema,
  typeof CikNamePrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const CIK_NAME_REPOSITORY_TOKEN = createServiceToken<CikNameRepositoryStorage>(
  "sec.storage.cikNameRepository"
);
