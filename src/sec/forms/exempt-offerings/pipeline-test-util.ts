/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers shared by the per-form `*.pipeline.test.ts` round-trip tests.
 * Each pipeline test parses every fixture, stores it, then queries the
 * repos to verify the parsed XML survives the full pipeline. These
 * helpers cover the bits every form has in common (fixture I/O,
 * accession derivation, all-or-fail iteration).
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { accessionFromFixtureName } from "../../../util/accession";
import { parseCikSafely } from "../../../util/parseCik";

export { accessionFromFixtureName };
export { parseCikSafely as safeCikToInt };

export function fixtureDir(slug: string): string {
  return join(__dirname, "mock_data", slug);
}

export function listFixtureFiles(slug: string): string[] {
  return readdirSync(fixtureDir(slug))
    .filter((f) => f.endsWith("-primary_doc.xml"))
    .sort();
}

export function readFixture(slug: string, file: string): string {
  return readFileSync(join(fixtureDir(slug), file), "utf-8");
}

/**
 * Synthesize an EDGAR-shaped `file_number` ("020-NNNNN", SEC office prefix
 * + 5+ digits) from an accession. Real file numbers live in the EDGAR
 * submission JSON, not in the fixture XML, so pipeline tests need a stable
 * stand-in to disambiguate offerings stored against the same CIK.
 */
export function deriveFileNumber(accessionNumber: string): string {
  const digits = accessionNumber.replace(/\D/g, "").slice(-7);
  return `020-${digits.padStart(5, "0")}`;
}

export interface PipelineSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly errors: ReadonlyArray<{ readonly file: string; readonly error: string }>;
}

/**
 * Walks every fixture under `slug`, applying `process`. Per-fixture errors
 * are captured (not rethrown) so the summary reflects the full set rather
 * than aborting on the first failure.
 */
export async function runPipeline(
  slug: string,
  process: (file: string, xml: string) => Promise<void>
): Promise<PipelineSummary> {
  const files = listFixtureFiles(slug);
  let succeeded = 0;
  const errors: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const xml = readFixture(slug, file);
    try {
      await process(file, xml);
      succeeded++;
    } catch (err) {
      errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { total: files.length, succeeded, failed: errors.length, errors };
}

/**
 * Throws when any fixture failed; includes the first few error messages so
 * a red test gives an actionable hint rather than just a count.
 */
export function assertAllSucceeded(summary: PipelineSummary): void {
  if (summary.failed === 0) return;
  const sample = summary.errors.slice(0, 5);
  throw new Error(
    `${summary.failed}/${summary.total} fixtures failed pipeline. First ${sample.length}: ` +
      sample.map((e) => `\n  ${e.file}: ${e.error}`).join("")
  );
}

