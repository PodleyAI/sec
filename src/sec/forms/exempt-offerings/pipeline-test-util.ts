/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers shared by the per-form `*.pipeline.test.ts` files. These tests load
 * every XML fixture from `mock_data/<form-slug>/`, run it through the form
 * parser and the corresponding `processFormX` storage routine, then issue
 * real queries against the repos to verify the parsed XML survives the
 * full pipeline.
 *
 * The point of these tests is to catch round-trip regressions: schema drift,
 * normalization that drops fields, repos that silently swallow rows. They are
 * deliberately separate from the existing `.test.ts` and `.storage.test.ts`
 * files so we don't disturb their assertion shape.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Returns the absolute path to a `mock_data/<slug>/` directory containing
 * XML fixtures.
 */
export function fixtureDir(slug: string): string {
  return join(__dirname, "mock_data", slug);
}

/**
 * Lists every `*-primary_doc.xml` file in a fixture directory, sorted by
 * filename for determinism.
 */
export function listFixtureFiles(slug: string): string[] {
  return readdirSync(fixtureDir(slug))
    .filter((f) => f.endsWith("-primary_doc.xml"))
    .sort();
}

/**
 * Reads a fixture file's contents as UTF-8.
 */
export function readFixture(slug: string, file: string): string {
  return readFileSync(join(fixtureDir(slug), file), "utf-8");
}

/**
 * Derives the bare accession number ("0001234567-25-000001"-style) from a
 * fixture filename like "000123456725000001-primary_doc.xml". The fixture
 * filenames omit the dashes, so we reinsert them in the canonical
 * 10-2-6 format.
 */
export function accessionFromFixtureName(file: string): string {
  const noDashes = file.replace(/-primary_doc\.xml$/, "");
  if (!/^\d{18}$/.test(noDashes)) return noDashes;
  return `${noDashes.slice(0, 10)}-${noDashes.slice(10, 12)}-${noDashes.slice(12, 18)}`;
}

/**
 * Generates a stable synthetic `file_number` from the accession number when
 * a fixture doesn't carry one. EDGAR's file numbers look like "020-12345"
 * (SEC office prefix + 5+ digits), so we follow that shape. Pipeline tests
 * use these to disambiguate offerings stored against the same CIK.
 */
export function deriveFileNumber(accessionNumber: string): string {
  const digits = accessionNumber.replace(/\D/g, "").slice(-7);
  return `020-${digits.padStart(5, "0")}`;
}

/**
 * Pipeline runner: applies `process` to every fixture under `slug`, with the
 * supplied per-fixture function. Collects successes and failures and returns
 * a summary the caller can assert against.
 *
 * Errors thrown by `process` are caught per-fixture so a single bad filing
 * doesn't abort the run -- pipeline tests want to see the overall shape of
 * what made it through, not just the first failure.
 */
export interface PipelineSummary {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ file: string; error: string }>;
}

export async function runPipeline(
  slug: string,
  process: (file: string, xml: string) => Promise<void>
): Promise<PipelineSummary> {
  const files = listFixtureFiles(slug);
  const summary: PipelineSummary = {
    total: files.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  for (const file of files) {
    const xml = readFixture(slug, file);
    try {
      await process(file, xml);
      summary.succeeded++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

/**
 * Asserts a pipeline summary has 100% success and dumps the first few errors
 * if not, so a failing test message is actionable.
 */
export function assertAllSucceeded(summary: PipelineSummary): void {
  if (summary.failed === 0) return;
  const sample = summary.errors.slice(0, 5);
  throw new Error(
    `${summary.failed}/${summary.total} fixtures failed pipeline. First ${sample.length}: ` +
      sample.map((e) => `\n  ${e.file}: ${e.error}`).join("")
  );
}

/**
 * Normalizes a CIK-shaped string to a non-negative integer. Mirrors the
 * `parseCikSafely` helper inside Form_C.storage / Form_D.storage so tests
 * compute the same int the storage layer uses.
 */
export function safeCikToInt(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null) return 0;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}
