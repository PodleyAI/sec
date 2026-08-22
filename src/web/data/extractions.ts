/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  globalServiceRegistry,
  type AnyTabularStorage,
  type DataPortSchemaObject,
  type ServiceToken,
} from "workglow";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import type { ExtractionDeadLetter } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import type { ExtractorRun } from "../../storage/versioning/ExtractorRunSchema";

/** One table's rows for a single filing. */
export interface ExtractionTable {
  readonly table: string;
  readonly rows: readonly Record<string, unknown>[];
  /** Column names in schema order, so a table reads the way its schema declares it. */
  readonly columns: readonly string[];
  /** Why the table could not be read, or "" — a table `db setup` never created reads as this. */
  readonly error: string;
}

/** Everything recorded about one accession: what ran, what it wrote, what failed. */
export interface AccessionExtractions {
  readonly accessionNumber: string;
  readonly runs: readonly ExtractorRun[];
  readonly deadLetters: readonly ExtractionDeadLetter[];
  /** Only tables that actually hold rows for this accession — the empty ones are noise. */
  readonly tables: readonly ExtractionTable[];
  /** Tables searched but holding nothing, so "nothing was extracted" is distinguishable from "not looked at". */
  readonly emptyTables: readonly string[];
}

/**
 * The three fields the extraction viewer needs of a table: what to read it
 * through, what to call it, and which columns it declares.
 *
 * Structurally a subset of both `StorageDefinition` and embarc-data's
 * `RepoDescriptor`, so a downstream package registers the descriptors it
 * already has rather than restating them.
 */
export interface WebExtractionTable {
  readonly token: ServiceToken<AnyTabularStorage>;
  readonly table: string;
  readonly schema: DataPortSchemaObject;
}

/**
 * Accession-keyed tables the per-filing viewer does not sweep.
 *
 * `extractor_runs` and `extraction_dead_letter` are reported in their own shape
 * above; repeating them as generic row dumps says nothing new.
 *
 * `company_facts` is not extraction output at all — it is the bulk
 * companyfacts ingest for a whole CIK, where `accession_number` is provenance
 * carried on each fact rather than the key anything reads it by. Two things
 * follow. It is the largest table in an EDGAR database and carries no index
 * leading on `accession_number`, so including it charged every filing page a
 * full scan; and it is populated from 10-K/10-Q, none of which are forms this
 * UI opens, so that scan almost always returned nothing. The filing's OWN
 * XBRL — parsed from the document by the extractor — is `xbrl_fact`, which is
 * keyed by accession and still shown.
 */
const SKIPPED_TABLES: ReadonlySet<string> = new Set([
  "extractor_runs",
  "extraction_dead_letter",
  "company_facts",
]);

const extensionTables = new Map<string, WebExtractionTable>();

/**
 * Add a downstream package's tables to the per-filing extraction viewer, the
 * companion to `registerDbStatsTables` for `db stats`.
 *
 * A superset's extraction output is invisible without this: the viewer reads
 * `SEC_STORAGE_REGISTRY`, which by construction holds only the tables sec owns,
 * so an `embarc-data` filing page would show every sec row for an accession and
 * silently omit the superset's own — the shape most likely to be read as "that
 * extractor wrote nothing". Tables with no `accession_number` column are
 * accepted and ignored: registering a domain's whole descriptor list is the
 * ergonomic call, and filtering is this module's job, not the caller's.
 */
export function registerWebExtractionTables(tables: readonly WebExtractionTable[]): void {
  for (const table of tables) {
    if (SEC_STORAGE_REGISTRY.some((def) => def.table === table.table)) {
      throw new Error(`extraction table is already owned by sec: ${table.table}`);
    }
    extensionTables.set(table.table, table);
  }
}

export function clearWebExtractionTablesForTesting(): void {
  extensionTables.clear();
}

/**
 * Every table keyed by (or carrying) `accession_number`.
 *
 * Derived from {@link SEC_STORAGE_REGISTRY} (plus whatever a superset
 * registered) rather than listed, because the point of the extraction viewer is
 * to show what an extractor wrote WITHOUT a per-extractor allow-list going
 * stale the first time someone adds a table. A new extraction table shows up in
 * the viewer as soon as it is registered.
 */
export function accessionScopedStorages(): readonly WebExtractionTable[] {
  return [...SEC_STORAGE_REGISTRY, ...extensionTables.values()].filter(
    (def) => (def.schema.properties as Record<string, unknown>)["accession_number"] !== undefined
  );
}

function columnsOf(def: WebExtractionTable): readonly string[] {
  return Object.keys(def.schema.properties as Record<string, unknown>);
}

/**
 * Gather every recorded trace of one filing: its extractor runs, its
 * dead-letter entries, and each table's rows.
 *
 * A table that cannot be read is reported per table rather than thrown, for the
 * same reason `db stats` degrades one row instead of the whole report: a
 * database missing one newly-added table must still show the twenty tables it
 * does have.
 */
export async function loadAccessionExtractions(
  accessionNumber: string
): Promise<AccessionExtractions> {
  const runRepo = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
  const deadLetterRepo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
  const [runs, deadLetters] = await Promise.all([
    runRepo.query({ accession_number: accessionNumber }).then((r) => r ?? []),
    deadLetterRepo.query({ accession_number: accessionNumber }).then((r) => r ?? []),
  ]);

  const tables: ExtractionTable[] = [];
  const emptyTables: string[] = [];
  for (const def of accessionScopedStorages()) {
    if (SKIPPED_TABLES.has(def.table)) continue;
    try {
      const storage = globalServiceRegistry.get(def.token);
      const rows = (await storage.query({ accession_number: accessionNumber })) ?? [];
      if (rows.length === 0) {
        emptyTables.push(def.table);
        continue;
      }
      tables.push({
        table: def.table,
        rows: rows as Record<string, unknown>[],
        columns: columnsOf(def),
        error: "",
      });
    } catch (e) {
      tables.push({
        table: def.table,
        rows: [],
        columns: columnsOf(def),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    accessionNumber,
    runs: runs as ExtractorRun[],
    deadLetters: deadLetters as ExtractionDeadLetter[],
    tables,
    emptyTables,
  };
}
