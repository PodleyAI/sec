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
 * Entity schema - represents companies and other entities in the SEC database
 */
export const EntitySchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  name: TypeNullable(Type.String({ description: "Entity name" })),
  type: TypeNullable(Type.String({ description: "Entity type" })),
  sic: TypeNullable(
    Type.Integer({
      minimum: 0,
      maximum: 9999,
      description: "Standard Industrial Classification code",
    })
  ),
  ein: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "Employer Identification Number",
    })
  ),
  description: TypeNullable(Type.String({ description: "Entity description" })),
  website: TypeNullable(Type.String({ description: "Entity website URL" })),
  investor_website: TypeNullable(Type.String({ description: "Investor relations website URL" })),
  category: TypeNullable(Type.String({ description: "Entity category" })),
  fiscal_year: TypeNullable(
    Type.String({
      maxLength: 4,
      description: "Fiscal year end (MMDD format)",
    })
  ),
  state_incorporation: TypeNullable(
    Type.String({
      maxLength: 2,
      description: "State of incorporation code",
    })
  ),
  state_incorporation_desc: TypeNullable(
    Type.String({
      description: "State of incorporation description",
    })
  ),
});

export type Entity = Static<typeof EntitySchema>;

/**
 * Entity repository storage type and primary key definitions
 */
export const EntityPrimaryKeyNames = ["cik"] as const;
export type EntityRepositoryStorage = TabularRepository<
  typeof EntitySchema,
  typeof EntityPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const ENTITY_REPOSITORY_TOKEN = createServiceToken<EntityRepositoryStorage>(
  "sec.storage.entityRepository"
);
