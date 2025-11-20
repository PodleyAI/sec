//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken } from "@podley/util";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { Static, Type } from "@sinclair/typebox";

/**
 * Entity History schema - tracks changes to entity attributes over time
 */
export const EntityHistorySchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  valid_from: Type.String({
    format: "date-time",
    description: "When this version became valid",
  }),
  valid_to: TypeNullable(
    Type.String({
      format: "date-time",
      description: "When this version ceased to be valid (null = current)",
    })
  ),
  name: TypeNullable(Type.String({ description: "Entity name at this time" })),
  type: TypeNullable(Type.String({ description: "Entity type at this time" })),
  sic: TypeNullable(
    Type.Integer({
      minimum: 0,
      maximum: 9999,
      description: "Standard Industrial Classification code at this time",
    })
  ),
  ein: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "Employer Identification Number at this time",
    })
  ),
  description: TypeNullable(Type.String({ description: "Entity description at this time" })),
  website: TypeNullable(Type.String({ description: "Entity website URL at this time" })),
  investor_website: TypeNullable(
    Type.String({ description: "Investor relations website URL at this time" })
  ),
  category: TypeNullable(Type.String({ description: "Entity category at this time" })),
  fiscal_year: TypeNullable(
    Type.String({
      maxLength: 4,
      description: "Fiscal year end (MMDD format) at this time",
    })
  ),
  state_incorporation: TypeNullable(
    Type.String({
      maxLength: 2,
      description: "State of incorporation code at this time",
    })
  ),
  state_incorporation_desc: TypeNullable(
    Type.String({
      description: "State of incorporation description at this time",
    })
  ),
  change_source: Type.String({
    description: "Source of this change (e.g., '10-K', '8-K', 'SUBMISSION_UPDATE')",
  }),
  change_date: Type.String({
    format: "date-time",
    description: "When this change was recorded in our system",
  }),
});

export type EntityHistory = Static<typeof EntityHistorySchema>;

/**
 * Entity History repository storage type and primary key definitions
 */
export const EntityHistoryPrimaryKeyNames = ["cik", "valid_from"] as const;
export type EntityHistoryRepositoryStorage = TabularRepository<
  typeof EntityHistorySchema,
  typeof EntityHistoryPrimaryKeyNames,
  EntityHistory
>;

/**
 * Dependency injection tokens for repositories
 */
export const ENTITY_HISTORY_REPOSITORY_TOKEN = createServiceToken<EntityHistoryRepositoryStorage>(
  "sec.storage.entityHistoryRepository"
);
