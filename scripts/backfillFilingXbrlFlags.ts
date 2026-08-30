#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-time repair of `filings.is_xbrl` / `is_inline_xbrl` / `is_xbrl_numeric`.
 *
 * `TypeSECBoolean` encoded EDGAR's wire booleans with `value === "1"`, but the
 * submissions endpoint sends the INTEGERS `0`/`1`, so every comparison was
 * false and `StoreSubmissionFilingsTask`'s `filing.isXBRL || null` turned that
 * false into NULL. The result was all three columns NULL across the entire
 * corpus — 27,174,096 rows — while every other optional column populated
 * normally, which is why it read as a schema quirk rather than a bug.
 *
 * The schema fix only helps filings ingested after it. This replays the flags
 * from the submissions JSON already on disk under `SEC_RAW_DATA_FOLDER`, so the
 * repair costs no EDGAR requests.
 *
 * By default only rows with at least one flag TRUE are written (~900k of 27M,
 * measured at 3.3% over a 3,000-file sample). That is what the facts
 * eligibility filter reads, and it keeps the UPDATE — and the dead tuples it
 * leaves behind — two orders of magnitude smaller. Pass `--all-rows` to write
 * explicit `false` everywhere too, at the cost of rewriting all 27M rows.
 *
 * Usage:
 *   bun scripts/backfillFilingXbrlFlags.ts [--dry-run] [--all-rows] [--limit N]
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { globalServiceRegistry } from "workglow";
import { EnvToDI } from "../src/config/EnvToDI";
import { SEC_RAW_DATA_FOLDER } from "../src/config/tokens";
import { closePgPool, getPgPool } from "../src/util/pg";

interface FlagRow {
  readonly cik: number;
  readonly accession: string;
  readonly xbrl: boolean;
  readonly inline: boolean;
  readonly numeric: boolean;
}

/** Postgres caps a statement at 65535 binds; 5 per row leaves headroom at 10k. */
const ROWS_PER_STATEMENT = 10_000;

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * The columnar filings block, wherever it lives. The primary
 * `CIK##########.json` nests it under `filings.recent`; the overflow pages
 * (`CIK##########-submissions-###.json`) ARE the block.
 */
function filingsBlock(parsed: any): Record<string, unknown[]> | undefined {
  const recent = parsed?.filings?.recent;
  if (recent && Array.isArray(recent.accessionNumber)) return recent;
  if (Array.isArray(parsed?.accessionNumber)) return parsed;
  return undefined;
}

/**
 * The CIK the file's rows belong to. Read from the filename rather than the
 * payload: overflow pages carry no `cik` field, and the filename is the only
 * thing tying them back to their issuer.
 */
function cikFromFileName(name: string): number | undefined {
  const match = /^CIK(\d{10})/.exec(name);
  return match ? Number(match[1]) : undefined;
}

function rowsFromFile(name: string, parsed: unknown, allRows: boolean): FlagRow[] {
  const cik = cikFromFileName(name);
  if (cik === undefined) return [];
  const block = filingsBlock(parsed);
  if (!block) return [];

  const accessions = (block.accessionNumber ?? []) as string[];
  const xbrl = (block.isXBRL ?? []) as unknown[];
  const inline = (block.isInlineXBRL ?? []) as unknown[];
  const numeric = (block.isXBRLNumeric ?? []) as unknown[];

  const rows: FlagRow[] = [];
  for (let i = 0; i < accessions.length; i++) {
    const accession = accessions[i];
    if (!accession) continue;
    const row = {
      cik,
      accession,
      xbrl: truthy(xbrl[i]),
      inline: truthy(inline[i]),
      numeric: truthy(numeric[i]),
    };
    if (allRows || row.xbrl || row.inline || row.numeric) rows.push(row);
  }
  return rows;
}

async function flushBatch(rows: ReadonlyArray<FlagRow>): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPgPool();
  for (let start = 0; start < rows.length; start += ROWS_PER_STATEMENT) {
    const slice = rows.slice(start, start + ROWS_PER_STATEMENT);
    const values: (number | string | boolean)[] = [];
    const placeholders: string[] = [];
    slice.forEach((r, i) => {
      const base = i * 5;
      placeholders.push(
        `($${base + 1}::bigint, $${base + 2}::varchar, $${base + 3}::boolean, $${base + 4}::boolean, $${base + 5}::boolean)`
      );
      values.push(r.cik, r.accession, r.xbrl, r.inline, r.numeric);
    });
    await pool.query(
      `INSERT INTO "xbrl_flag_backfill" ("cik", "accession_number", "is_xbrl", "is_inline_xbrl", "is_xbrl_numeric")
       VALUES ${placeholders.join(", ")}
       ON CONFLICT DO NOTHING`,
      values
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const allRows = argv.includes("--all-rows");
  const limitArg = argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : undefined;

  EnvToDI();
  if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) {
    throw new Error("SEC_RAW_DATA_FOLDER is not set; nothing to replay from.");
  }
  const dir = path.join(globalServiceRegistry.get(SEC_RAW_DATA_FOLDER), "submissions");

  let files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  if (limit !== undefined && Number.isFinite(limit)) files = files.slice(0, limit);
  console.log(`Replaying XBRL flags from ${files.length.toLocaleString()} files in ${dir}`);
  console.log(allRows ? "Mode: every row (writes explicit false)" : "Mode: true rows only");

  const pool = getPgPool();
  if (!dryRun) {
    // A real (not TEMP) staging table: TEMP is per-connection and the pool
    // hands out a different connection per query, so a TEMP table created here
    // would be invisible to the very next INSERT. UNLOGGED skips the WAL, which
    // is safe because the table is derived from files on disk — a crash means
    // re-running the script, not lost data.
    await pool.query(`DROP TABLE IF EXISTS "xbrl_flag_backfill"`);
    await pool.query(
      `CREATE UNLOGGED TABLE "xbrl_flag_backfill" (
         "cik" bigint NOT NULL,
         "accession_number" varchar(20) NOT NULL,
         "is_xbrl" boolean,
         "is_inline_xbrl" boolean,
         "is_xbrl_numeric" boolean,
         PRIMARY KEY ("cik", "accession_number")
       )`
    );
  }

  let scanned = 0;
  let staged = 0;
  let batch: FlagRow[] = [];
  for (const name of files) {
    scanned++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch (e) {
      console.warn(`Skipping unreadable ${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const rows = rowsFromFile(name, parsed, allRows);
    staged += rows.length;
    if (!dryRun) {
      batch.push(...rows);
      if (batch.length >= ROWS_PER_STATEMENT) {
        await flushBatch(batch);
        batch = [];
      }
    }
    if (scanned % 25_000 === 0) {
      console.log(`  ${scanned.toLocaleString()} files, ${staged.toLocaleString()} rows staged`);
    }
  }
  if (!dryRun) await flushBatch(batch);

  console.log(`Scanned ${scanned.toLocaleString()} files, staged ${staged.toLocaleString()} rows`);

  if (dryRun) {
    console.log("--dry-run: nothing written.");
    await closePgPool();
    return;
  }

  console.log("Applying to filings…");
  const applied = await pool.query(
    `UPDATE "filings" f
        SET "is_xbrl" = b."is_xbrl",
            "is_inline_xbrl" = b."is_inline_xbrl",
            "is_xbrl_numeric" = b."is_xbrl_numeric"
       FROM "xbrl_flag_backfill" b
      WHERE f."cik" = b."cik"
        AND f."accession_number" = b."accession_number"
        AND (f."is_xbrl" IS DISTINCT FROM b."is_xbrl"
          OR f."is_inline_xbrl" IS DISTINCT FROM b."is_inline_xbrl"
          OR f."is_xbrl_numeric" IS DISTINCT FROM b."is_xbrl_numeric")`
  );
  console.log(`Updated ${(applied.rowCount ?? 0).toLocaleString()} filings rows.`);

  const check = await pool.query<{ ciks: string }>(
    `SELECT count(DISTINCT "cik") AS ciks FROM "filings"
      WHERE "is_xbrl" OR "is_inline_xbrl" OR "is_xbrl_numeric"`
  );
  console.log(`${Number(check.rows[0]?.ciks ?? 0).toLocaleString()} CIKs now have an XBRL filing.`);

  await pool.query(`DROP TABLE IF EXISTS "xbrl_flag_backfill"`);
  await closePgPool();
}

main().catch(async (e) => {
  console.error(e);
  await closePgPool();
  process.exit(1);
});
