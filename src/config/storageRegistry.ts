/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyTabularStorage,
  DataPortSchemaObject,
  FromSchema,
  ITabularStorage,
  ServiceToken,
  TypedArraySchemaOptions,
} from "workglow";
import { globalServiceRegistry } from "workglow";
import {
  CHANGE_LOG_REPOSITORY_TOKEN,
  ChangeLogPrimaryKeyNames,
  ChangeLogSchema,
} from "../storage/change-tracking/ChangeLogSchema";
import {
  FILING_DOCUMENT_REPOSITORY_TOKEN,
  FilingDocumentPrimaryKeyNames,
  FilingDocumentSchema,
} from "../storage/document/FilingDocumentSchema";
import {
  FILING_SECTION_REPOSITORY_TOKEN,
  FilingSectionPrimaryKeyNames,
  FilingSectionSchema,
} from "../storage/document/FilingSectionSchema";
import {
  CIK_NAME_REPOSITORY_TOKEN,
  CikNamePrimaryKeyNames,
  CikNameSchema,
} from "../storage/entity/CikNameSchema";
import {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  EntityHistoryPrimaryKeyNames,
  EntityHistorySchema,
} from "../storage/entity/EntityHistorySchema";
import {
  ENTITY_REPOSITORY_TOKEN,
  EntityPrimaryKeyNames,
  EntitySchema,
} from "../storage/entity/EntitySchema";
import {
  ENTITY_TICKER_REPOSITORY_TOKEN,
  EntityTickerPrimaryKeyNames,
  EntityTickerSchema,
} from "../storage/entity/EntityTickerSchema";
import {
  SIC_CODE_REPOSITORY_TOKEN,
  SicCodePrimaryKeyNames,
  SicCodeSchema,
} from "../storage/entity/SicCodeSchema";
import {
  COMPANY_FACTS_REPOSITORY_TOKEN,
  CompanyFactsPrimaryKeyNames,
  CompanyFactsSchema,
} from "../storage/facts/CompanyFactsSchema";
import {
  FILING_REPOSITORY_TOKEN,
  FilingPrimaryKeyNames,
  FilingSchema,
} from "../storage/filing/FilingSchema";
import {
  CIK_LAST_UPDATE_REPOSITORY_TOKEN,
  CikLastUpdatePrimaryKeyNames,
  CikLastUpdateSchema,
} from "../storage/processing/CikLastUpdateSchema";
import {
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
  DailyIndexCursorPrimaryKeyNames,
  DailyIndexCursorSchema,
} from "../storage/processing/DailyIndexCursorSchema";
import {
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  ProcessedFactsPrimaryKeyNames,
  ProcessedFactsSchema,
} from "../storage/processing/ProcessedFactsSchema";
import {
  PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
  ProcessedSubmissionsPrimaryKeyNames,
  ProcessedSubmissionsSchema,
} from "../storage/processing/ProcessedSubmissionsSchema";
import {
  XBRL_FACT_REPOSITORY_TOKEN,
  XbrlFactPrimaryKeyNames,
  XbrlFactRowSchema,
} from "../storage/xbrl/XbrlFactSchema";

/**
 * One tabular storage: the DI token it is registered under, the table it maps
 * to, and the shape both bootstraps build it from. Erased to a single element
 * type so the registry can be one array; {@link defineStorage} is what type-
 * checks each entry against its own schema.
 */
export interface StorageDefinition {
  readonly token: ServiceToken<AnyTabularStorage>;
  readonly table: string;
  readonly schema: DataPortSchemaObject;
  readonly primaryKeyNames: ReadonlyArray<string>;
  readonly indexes: readonly (string | readonly string[])[] | undefined;
  readonly uniqueIndexes: readonly (readonly string[])[] | undefined;
}

interface TypedStorageDefinition<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity,
> {
  readonly token: ServiceToken<ITabularStorage<Schema, PrimaryKeyNames, Entity>>;
  readonly table: string;
  readonly schema: Schema;
  readonly primaryKeyNames: PrimaryKeyNames;
  readonly indexes?: readonly (keyof Entity | readonly (keyof Entity)[])[];
  readonly uniqueIndexes?: readonly (readonly (keyof Entity)[])[];
}

/**
 * Type-checks one registry entry — index and unique-index columns against the
 * entity the schema produces, and the token against the storage type that
 * schema + primary key yield — then erases it into {@link StorageDefinition}.
 * The erasure is what lets 80-odd differently-typed tables live in one array.
 */
export function defineStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>(definition: TypedStorageDefinition<Schema, PrimaryKeyNames, Entity>): StorageDefinition {
  return definition as unknown as StorageDefinition;
}

/**
 * Builds the storage backing one table: the SQL-backed one in production, an
 * in-memory one under test. Taken as a parameter so the registry describes
 * tables without knowing which backend will hold them.
 */
export type StorageFactory = (definition: StorageDefinition) => AnyTabularStorage;

/**
 * Binds each descriptor's token to the storage the factory builds for it, in
 * array order — which is the order tables are created and dropped, so a table
 * whose creation depends on another must follow it here.
 */
export function registerStorages(
  definitions: readonly StorageDefinition[],
  makeStorage: StorageFactory
): void {
  for (const definition of definitions) {
    globalServiceRegistry.registerInstance(definition.token, makeStorage(definition));
  }
}

/**
 * Every tabular storage sec owns, in the order the tables are created and
 * dropped. Both bootstraps read exactly this list: `DefaultDI` builds each
 * entry through `createStorage` (SQLite / Postgres, per `SEC_DB_TYPE`) and
 * `resetDependencyInjectionsForTesting` builds each as an
 * `InMemoryTabularStorage`, so a table can no longer exist in one and not the
 * other.
 *
 * Indexes are declared once, from the production DDL. The in-memory backend
 * stores them but serves `query`/`getAll` by full scan, so they only shape the
 * SQL backends' DDL.
 */
export const SEC_STORAGE_REGISTRY: readonly StorageDefinition[] = [
  // ------------------------------ Entities --------------------------------
  defineStorage({
    token: ENTITY_REPOSITORY_TOKEN,
    table: "entities",
    schema: EntitySchema,
    primaryKeyNames: EntityPrimaryKeyNames,
    indexes: [["name"], ["sic"]],
  }),
  defineStorage({
    token: ENTITY_HISTORY_REPOSITORY_TOKEN,
    table: "entities_history",
    schema: EntityHistorySchema,
    primaryKeyNames: EntityHistoryPrimaryKeyNames,
    indexes: [["valid_to"]],
  }),
  defineStorage({
    token: ENTITY_TICKER_REPOSITORY_TOKEN,
    table: "entity_tickers",
    schema: EntityTickerSchema,
    primaryKeyNames: EntityTickerPrimaryKeyNames,
    indexes: [["ticker", "exchange"], ["cik"]],
  }),
  defineStorage({
    token: SIC_CODE_REPOSITORY_TOKEN,
    table: "sic_code",
    schema: SicCodeSchema,
    primaryKeyNames: SicCodePrimaryKeyNames,
  }),
  defineStorage({
    token: CIK_NAME_REPOSITORY_TOKEN,
    table: "cik_names",
    schema: CikNameSchema,
    primaryKeyNames: CikNamePrimaryKeyNames,
    indexes: [["name"]],
  }),
  // ------------------------------ Filings --------------------------------
  defineStorage({
    token: FILING_REPOSITORY_TOKEN,
    table: "filings",
    schema: FilingSchema,
    primaryKeyNames: FilingPrimaryKeyNames,
    indexes: [
      ["form", "cik"],
      ["filing_date"],
      ["accession_number"],
      ["file_number"],
      // Contact dossiers ask for the newest filing once per connected CIK.
      // The PK starts with CIK but cannot answer the filing-date order, which
      // made every row in a large dossier sort that company's entire history.
      ["cik", "filing_date", "accession_number"],
    ],
  }),
  defineStorage({
    token: FILING_DOCUMENT_REPOSITORY_TOKEN,
    table: "filing_document",
    schema: FilingDocumentSchema,
    primaryKeyNames: FilingDocumentPrimaryKeyNames,
    // The sweep's anti-join asks "which filings of this form have no PRIMARY row
    // at the current converter version" — the primary is written last, so its
    // presence is what means the whole submission landed. `converted_at` serves
    // the recency listing.
    indexes: [["form", "converter_version", "is_primary"], ["converted_at"]],
  }),
  defineStorage({
    token: FILING_SECTION_REPOSITORY_TOKEN,
    table: "filing_section",
    schema: FilingSectionSchema,
    primaryKeyNames: FilingSectionPrimaryKeyNames,
    // Every read of this table is "the sections of one filing", either whole
    // (ordered by ordinal, which the primary key already serves) or one by
    // slug. The unique index is the correctness half: two sections of one
    // filing sharing a slug would make `?section=` ambiguous, and the splitter
    // deduplicates precisely so this holds.
    uniqueIndexes: [["cik", "accession_number", "doc_file", "slug"]],
  }),
  // ------------------------------ Processing Tracking --------------------------------
  defineStorage({
    token: CIK_LAST_UPDATE_REPOSITORY_TOKEN,
    table: "cik_last_update",
    schema: CikLastUpdateSchema,
    primaryKeyNames: CikLastUpdatePrimaryKeyNames,
  }),
  defineStorage({
    token: DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
    table: "daily_index_cursor",
    schema: DailyIndexCursorSchema,
    primaryKeyNames: DailyIndexCursorPrimaryKeyNames,
  }),
  defineStorage({
    token: PROCESSED_FACTS_REPOSITORY_TOKEN,
    table: "processed_facts",
    schema: ProcessedFactsSchema,
    primaryKeyNames: ProcessedFactsPrimaryKeyNames,
    indexes: [["last_processed"]],
  }),
  defineStorage({
    token: PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    table: "processed_submissions",
    schema: ProcessedSubmissionsSchema,
    primaryKeyNames: ProcessedSubmissionsPrimaryKeyNames,
    indexes: [["last_processed"]],
  }),
  // ------------------------------ Company Facts --------------------------------
  defineStorage({
    token: COMPANY_FACTS_REPOSITORY_TOKEN,
    table: "company_facts",
    schema: CompanyFactsSchema,
    primaryKeyNames: CompanyFactsPrimaryKeyNames,
    indexes: [["cik", "name"]],
  }),
  defineStorage({
    token: XBRL_FACT_REPOSITORY_TOKEN,
    table: "xbrl_fact",
    schema: XbrlFactRowSchema,
    primaryKeyNames: XbrlFactPrimaryKeyNames,
    indexes: [["cik"], ["concept"]],
  }),
  // ------------------------------ Change Log --------------------------------
  defineStorage({
    token: CHANGE_LOG_REPOSITORY_TOKEN,
    table: "change_log",
    schema: ChangeLogSchema,
    primaryKeyNames: ChangeLogPrimaryKeyNames,
    indexes: [["entity_type", "entity_id"]],
  }),
];
