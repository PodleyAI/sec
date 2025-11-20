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
 * Address Entity History Junction schema - tracks temporal relationships between addresses and entities
 */
export const AddressesEntityHistoryJunctionSchema = Type.Object({
  relation_name: Type.String({
    maxLength: 50,
    description: "Name of the relationship type between address and entity",
  }),
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) of the entity",
  }),
  address_hash_id: Type.String({ description: "Reference to the address hash ID" }),
  valid_from: Type.String({
    format: "date-time",
    description: "When this address association became valid",
  }),
  valid_to: TypeNullable(
    Type.String({
      format: "date-time",
      description: "When this address association ceased to be valid (null = current)",
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

export type AddressesEntityHistoryJunction = Static<typeof AddressesEntityHistoryJunctionSchema>;

/**
 * Address history junction repository storage type and primary key definitions
 */
export const AddressHistoryJunctionPrimaryKeyNames = [
  "address_hash_id",
  "relation_name",
  "cik",
  "valid_from",
] as const;
export type AddressHistoryJunctionRepositoryStorage = TabularRepository<
  typeof AddressesEntityHistoryJunctionSchema,
  typeof AddressHistoryJunctionPrimaryKeyNames
>;

export const ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN =
  createServiceToken<AddressHistoryJunctionRepositoryStorage>(
    "sec.storage.addressHistoryJunctionRepository"
  );
