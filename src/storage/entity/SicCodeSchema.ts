//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";

/**
 * SIC Code schema - represents Standard Industrial Classification codes
 */
export const SicCodeSchema = Type.Object({
  sic: Type.Integer({
    minimum: 0,
    maximum: 9999,
    description: "Standard Industrial Classification code",
  }),
  description: TypeNullable(
    Type.String({
      description: "Description of the SIC code industry classification",
    })
  ),
});

export type SicCode = Static<typeof SicCodeSchema>;

/**
 * SIC Code repository storage type and primary key definitions
 */
export const SicCodePrimaryKeyNames = ["sic"] as const;
export type SicCodeRepositoryStorage = TabularRepository<
  typeof SicCodeSchema,
  typeof SicCodePrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const SIC_CODE_REPOSITORY_TOKEN = createServiceToken<SicCodeRepositoryStorage>(
  "sec.storage.sicCodeRepository"
);
