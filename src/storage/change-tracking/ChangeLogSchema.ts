//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken } from "@podley/util";
import { Static, Type } from "typebox";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Change Log schema - unified tracking of all changes across the system
 */
export const ChangeLogSchema = Type.Object({
  change_id: Type.String({
    description: "Unique identifier for the change (UUID)",
  }),
  entity_type: Type.Union(
    [
      Type.Literal("entity"),
      Type.Literal("address"),
      Type.Literal("company"),
      Type.Literal("person"),
      Type.Literal("phone"),
      Type.Literal("entity_address_junction"),
      Type.Literal("entity_company_junction"),
      Type.Literal("entity_person_junction"),
      Type.Literal("entity_phone_junction"),
      Type.Literal("crowdfunding"),
    ],
    {
      description: "Type of entity that changed",
    }
  ),
  entity_id: Type.String({
    description: "Primary identifier of the entity (CIK for entities, hash_id for others)",
  }),
  field_name: Type.String({
    description: "Name of the field that changed",
  }),
  old_value: TypeNullable(
    Type.String({
      description: "Previous value (serialized as JSON if complex)",
    })
  ),
  new_value: TypeNullable(
    Type.String({
      description: "New value (serialized as JSON if complex)",
    })
  ),
  change_type: Type.Union(
    [Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")],
    {
      description: "Type of change operation",
    }
  ),
  change_source: Type.String({
    description: "Source of this change (e.g., '10-K', '8-K', 'SUBMISSION_UPDATE', 'DAILY_INDEX')",
  }),
  change_date: Type.String({
    format: "date-time",
    description: "When this change was recorded",
  }),
  filing_accession_number: TypeNullable(
    Type.String({
      description: "SEC filing accession number that triggered this change",
    })
  ),
  batch_id: TypeNullable(
    Type.String({
      description: "Batch identifier for grouping related changes",
    })
  ),
  user_id: TypeNullable(
    Type.String({
      description: "User or system that made the change",
    })
  ),
  metadata: TypeNullable(
    Type.String({
      description: "Additional metadata about the change (JSON)",
    })
  ),
});

export type ChangeLog = Static<typeof ChangeLogSchema>;

/**
 * Change Log repository storage type and primary key definitions
 */
export const ChangeLogPrimaryKeyNames = ["change_id"] as const;
export type ChangeLogRepositoryStorage = TabularRepository<
  typeof ChangeLogSchema,
  typeof ChangeLogPrimaryKeyNames,
  ChangeLog
>;

/**
 * Dependency injection tokens for repositories
 */
export const CHANGE_LOG_REPOSITORY_TOKEN = createServiceToken<ChangeLogRepositoryStorage>(
  "sec.storage.changeLogRepository"
);
