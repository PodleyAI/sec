/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_STORAGE_REGISTRY, type StorageDefinition } from "../../config/storageRegistry";
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
 * Every sec table keyed by (or carrying) `accession_number`.
 *
 * Derived from {@link SEC_STORAGE_REGISTRY} rather than listed, because the
 * point of the extraction viewer is to show what an extractor wrote WITHOUT a
 * per-extractor allow-list going stale the first time someone adds a table. A
 * new extraction table shows up in the viewer as soon as it is registered.
 */
export function accessionScopedStorages(): readonly StorageDefinition[] {
  return SEC_STORAGE_REGISTRY.filter(
    (def) => (def.schema.properties as Record<string, unknown>)["accession_number"] !== undefined
  );
}

function columnsOf(def: StorageDefinition): readonly string[] {
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
    // `extractor_runs` / `extraction_dead_letter` are reported above in their
    // own shape; repeating them as generic row dumps says nothing new.
    if (def.table === "extractor_runs" || def.table === "extraction_dead_letter") continue;
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
