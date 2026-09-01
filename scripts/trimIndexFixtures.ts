#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reduce the committed EDGAR quarterly `master.idx` fixtures to a representative
 * slice.
 *
 * A full quarter's master index is ~30 MB of highly repetitive pipe-delimited
 * text; two of them dominated both the working tree (49 MB) and the git pack
 * (~6.9 MB of a 12 MB repo), and `FetchQuarterlyIndexTask.test.ts` only ever
 * asserts that the parse yields >100 distinct CIKs. The full quarter buys
 * nothing the slice does not.
 *
 * The slice is taken as evenly-spaced **contiguous blocks** rather than a stride
 * sample or a simple head, because the properties under test are positional:
 *
 * - contiguous rows keep the same CIK repeating across rows with different
 *   `Date Filed` values, which is what exercises the parser's keep-the-latest-
 *   date-per-CIK dedupe;
 * - spreading the blocks over the whole file keeps the date range spanning the
 *   quarter and the form-type mix varied, instead of only the alphabetically
 *   first filers in the first weeks.
 *
 * The header block (through the `---------` separator the parser scans for) is
 * copied verbatim, so the fixture stays a well-formed master index.
 *
 * Usage:
 *   bun scripts/trimIndexFixtures.ts [--rows N] [--blocks N] [--check] [file...]
 *
 * `--check` reports what would change without writing. With no file arguments,
 * every `YYYY-QTRn.master.idx` under the fixture directory is processed.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const FIXTURE_DIR = resolve(import.meta.dir, "../src/sec/indexes/mock_data");
const SEPARATOR = /^-{5,}$/;

/** Total data rows to keep per fixture. */
const DEFAULT_ROWS = 2500;
/** Number of evenly-spaced contiguous blocks those rows are drawn from. */
const DEFAULT_BLOCKS = 20;

interface TrimResult {
  readonly header: string[];
  readonly rows: string[];
  readonly distinctCiks: number;
  readonly originalRows: number;
}

export function trimMasterIndex(content: string, rows: number, blocks: number): TrimResult {
  const lines = content.split("\n");
  const sepIndex = lines.findIndex((l) => SEPARATOR.test(l.trim()));
  if (sepIndex < 0) {
    throw new Error("No '-----' separator found; this does not look like a master.idx");
  }

  const header = lines.slice(0, sepIndex + 1);
  const dataRows = lines.slice(sepIndex + 1).filter((l) => l.trim().length > 0);
  if (dataRows.length <= rows) {
    return {
      header,
      rows: dataRows,
      distinctCiks: new Set(dataRows.map((l) => l.split("|")[0])).size,
      originalRows: dataRows.length,
    };
  }

  const blockSize = Math.max(1, Math.floor(rows / blocks));
  const stride = Math.floor(dataRows.length / blocks);
  const kept: string[] = [];
  for (let b = 0; b < blocks; b++) {
    const start = Math.min(b * stride, dataRows.length - blockSize);
    kept.push(...dataRows.slice(start, start + blockSize));
  }

  return {
    header,
    rows: kept,
    distinctCiks: new Set(kept.map((l) => l.split("|")[0])).size,
    originalRows: dataRows.length,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const numeric = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  const rows = numeric("--rows", DEFAULT_ROWS);
  const blocks = numeric("--blocks", DEFAULT_BLOCKS);

  const explicit = argv.filter(
    (a) => !a.startsWith("--") && a !== String(rows) && a !== String(blocks)
  );
  const files =
    explicit.length > 0
      ? explicit.map((f) => resolve(f))
      : readdirSync(FIXTURE_DIR)
          .filter((n) => /^\d{4}-QTR\d\.master\.idx$/.test(n))
          .map((n) => join(FIXTURE_DIR, n));

  for (const file of files) {
    const before = readFileSync(file, "utf-8");
    const result = trimMasterIndex(before, rows, blocks);
    const after = [...result.header, ...result.rows, ""].join("\n");

    console.log(
      `${basename(file)}: ${result.originalRows} -> ${result.rows.length} rows ` +
        `(${result.distinctCiks} distinct CIKs), ` +
        `${(before.length / 1048576).toFixed(1)} MB -> ${(after.length / 1024).toFixed(0)} KB`
    );
    if (result.distinctCiks <= 100) {
      throw new Error(
        `${basename(file)}: only ${result.distinctCiks} distinct CIKs; the index tests assert >100. ` +
          "Raise --rows or --blocks."
      );
    }
    // A fixture under 1 KB is interpreted by the index tests as a simulated
    // EDGAR 403 error response, which would silently invert the test's meaning.
    if (after.length < 1000) {
      throw new Error(`${basename(file)}: trimmed below the 1 KB error-fixture threshold`);
    }
    if (!check) writeFileSync(file, after);
  }
  console.log(check ? "Check only — nothing written." : "Done.");
}

if (import.meta.main) main();
