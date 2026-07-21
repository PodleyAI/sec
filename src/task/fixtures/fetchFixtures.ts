/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Orchestration for downloading real SEC filings into the exempt-offering
 * mock_data/ tree. Exposed as a plain async function so:
 *
 *   - `sec fetch fixtures ...` can drive it from the CLI (where the
 *     SEC job queue, DI, and shutdown are already wired by src/sec.ts);
 *   - tests can call it without spinning up Commander.
 *
 * All HTTP work flows through this repo's own fetch primitives:
 *   - `FetchQuarterlyFormIdxTask` for the form-sorted quarterly index
 *     (cached under SEC_RAW_DATA_FOLDER between runs).
 *   - `SecFetchAccessionDocTask` for each primary_doc.xml (also cached).
 *
 * The job queue's rate limiter (10 req/s evenly spaced) governs request
 * pacing; we just fan out and await.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  EXEMPT_OFFERING_FORM_CODES,
  EXEMPT_OFFERING_FORM_SLUGS,
  type ExemptOfferingFormCode,
  isExemptOfferingFormCode,
} from "../../sec/forms/exempt-offerings/form-slugs";
import { accessionFromFileName, accessionWithoutDashes } from "../../util/accession";
import { SecFetchAccessionDocTask } from "../forms/SecFetchAccessionDocTask";
import {
  FetchQuarterlyFormIdxTask,
  type QuarterlyFormIdxRow,
} from "../index/FetchQuarterlyFormIdxTask";

export const DEFAULT_FIXTURES_PER_FORM = 50;

// Written output: keep it out of the source tree. `import.meta.dir` after
// bundling points at `dist/`, which would silently write into the packaged
// binary's directory — a `SEC_FIXTURES_DIR` override, else cwd, is stable
// regardless of how the CLI was launched.
const MOCK_ROOT = resolve(
  process.env.SEC_FIXTURES_DIR ?? process.cwd(),
  ".sec-fixtures/exempt-offerings"
);

export interface FetchFixturesOptions {
  readonly forms?: readonly ExemptOfferingFormCode[];
  readonly count?: number;
  readonly quarters?: readonly string[];
  readonly listOnly?: boolean;
  readonly log?: (msg: string) => void;
}

export interface FetchFixturesResult {
  readonly downloaded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly perForm: ReadonlyMap<ExemptOfferingFormCode, { ok: number; failed: number }>;
}

export function parseFormCodes(values: readonly string[]): ExemptOfferingFormCode[] {
  const out: ExemptOfferingFormCode[] = [];
  for (const v of values) {
    if (!isExemptOfferingFormCode(v)) {
      throw new Error(
        `Unsupported form code "${v}". Known: ${EXEMPT_OFFERING_FORM_CODES.join(", ")}`
      );
    }
    out.push(v);
  }
  return out;
}

export function parseQuarterStrings(values: readonly string[]): string[] {
  for (const v of values) {
    if (!/^\d{4}Q[1-4]$/.test(v)) {
      throw new Error(`Quarter must look like 2025Q1, got: ${v}`);
    }
  }
  return [...values];
}

/**
 * Pick the two most recently settled quarters (skipping the in-progress
 * quarter because its `form.idx` is partial and shifts under us).
 */
export function defaultQuarters(now: Date = new Date()): string[] {
  const y = now.getUTCFullYear();
  const currentQ = Math.floor(now.getUTCMonth() / 3) + 1;
  const out: string[] = [];
  for (let back = 2; back <= 3; back++) {
    let qq = currentQ - back;
    let yy = y;
    while (qq <= 0) {
      qq += 4;
      yy -= 1;
    }
    out.push(`${yy}Q${qq}`);
  }
  return out;
}

/** "2025Q1" -> a date inside that quarter (the task derives the quarter back out). */
export function quarterToDate(quarter: string): string {
  const match = quarter.match(/^(\d{4})Q([1-4])$/);
  if (!match) throw new Error(`Invalid quarter ${quarter}`);
  const [, year, q] = match;
  const startMonth = (Number(q) - 1) * 3 + 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-15`;
}

function fixturePath(form: ExemptOfferingFormCode, accession: string): string {
  const slug = EXEMPT_OFFERING_FORM_SLUGS[form];
  return join(MOCK_ROOT, slug, `${accessionWithoutDashes(accession)}-primary_doc.xml`);
}

function existingFixtureAccessions(form: ExemptOfferingFormCode): Set<string> {
  const slug = EXEMPT_OFFERING_FORM_SLUGS[form];
  const dir = join(MOCK_ROOT, slug);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith("-primary_doc.xml"))
      .map((f) => f.replace("-primary_doc.xml", ""))
  );
}

interface FormPlan {
  readonly form: ExemptOfferingFormCode;
  readonly toFetch: readonly QuarterlyFormIdxRow[];
  readonly skipped: number;
}

function buildPlan(
  rows: readonly QuarterlyFormIdxRow[],
  form: ExemptOfferingFormCode,
  count: number
): FormPlan {
  const existing = existingFixtureAccessions(form);
  const candidates = rows.filter((r) => r.formType === form);
  const fresh: QuarterlyFormIdxRow[] = [];
  let skipped = 0;
  for (const r of candidates) {
    const accNoDashes = accessionWithoutDashes(accessionFromFileName(r.fileName));
    if (existing.has(accNoDashes)) {
      skipped++;
      continue;
    }
    fresh.push(r);
    if (fresh.length >= count) break;
  }
  return { form, toFetch: fresh, skipped };
}

/**
 * Pull one filing's primary_doc.xml through SecFetchAccessionDocTask.
 * Returns the XML body when EDGAR served XML; null when it served HTML
 * (some withdrawal-style filings have no XML primary doc) or errored.
 */
async function fetchPrimaryDoc(
  row: QuarterlyFormIdxRow,
  log: (msg: string) => void
): Promise<string | null> {
  const accession = accessionFromFileName(row.fileName);
  const task = new SecFetchAccessionDocTask({
    cik: row.cik,
    accessionNumber: accession,
    fileName: "primary_doc.xml",
  });
  let result;
  try {
    result = await task.run();
  } catch (err) {
    log(`  ${row.formType} ${accession} -> error ${(err as Error).message}`);
    return null;
  }
  const text = result.text;
  if (!text) {
    log(`  ${row.formType} ${accession} -> empty response`);
    return null;
  }
  if (!text.trimStart().startsWith("<?xml")) {
    log(`  ${row.formType} ${accession} -> non-XML body, skipping`);
    return null;
  }
  return text;
}

async function downloadPlan(
  plan: FormPlan,
  log: (msg: string) => void
): Promise<{ ok: number; failed: number }> {
  const slug = EXEMPT_OFFERING_FORM_SLUGS[plan.form];
  const dir = join(MOCK_ROOT, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Fan out — the SEC job queue's CompositeLimiter (10 req/s evenly
  // spaced) paces the actual HTTP calls.
  const settled = await Promise.allSettled(
    plan.toFetch.map(async (row) => {
      const accession = accessionFromFileName(row.fileName);
      const target = fixturePath(plan.form, accession);
      if (existsSync(target)) return true;
      const body = await fetchPrimaryDoc(row, log);
      if (body === null) return false;
      writeFileSync(target, body);
      return true;
    })
  );

  let ok = 0;
  let failed = 0;
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value) ok++;
    else failed++;
  }
  return { ok, failed };
}

export async function fetchFixtures(options: FetchFixturesOptions = {}): Promise<FetchFixturesResult> {
  const forms = options.forms ?? EXEMPT_OFFERING_FORM_CODES;
  const count = options.count ?? DEFAULT_FIXTURES_PER_FORM;
  const quarters = options.quarters ?? defaultQuarters();
  const listOnly = options.listOnly ?? false;
  const log = options.log ?? ((msg: string) => process.stderr.write(msg + "\n"));

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("count must be a positive number");
  }
  parseQuarterStrings(quarters); // validate shape

  console.log(`[sec fetch] output dir: ${MOCK_ROOT}`);

  // Pull form.idx for each requested quarter (cached on disk via the
  // SecCachedFetchTask layer; second runs in the same quarter are free).
  const rowsByQuarter = new Map<string, QuarterlyFormIdxRow[]>();
  for (const q of quarters) {
    log(`Fetching index ${q} ...`);
    const task = new FetchQuarterlyFormIdxTask();
    const { rows } = await task.run({ date: quarterToDate(q) });
    log(`  ${q}: ${rows.length} rows`);
    rowsByQuarter.set(q, rows);
  }

  // Dedupe across quarters by accession so the same filing isn't
  // attempted twice if it appears in both.
  const combined: QuarterlyFormIdxRow[] = [];
  const seen = new Set<string>();
  for (const q of quarters) {
    for (const r of rowsByQuarter.get(q) ?? []) {
      const accession = accessionFromFileName(r.fileName);
      if (seen.has(accession)) continue;
      seen.add(accession);
      combined.push(r);
    }
  }

  const perForm = new Map<ExemptOfferingFormCode, { ok: number; failed: number }>();
  let downloaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const form of forms) {
    const plan = buildPlan(combined, form, count);
    log(`Form ${form}: ${plan.toFetch.length} to fetch, ${plan.skipped} already on disk`);
    skipped += plan.skipped;
    if (listOnly) {
      for (const row of plan.toFetch) {
        const accession = accessionFromFileName(row.fileName);
        process.stdout.write(
          `${form}\t${row.cik}\t${accession}\t${row.companyName}\n`
        );
      }
      perForm.set(form, { ok: 0, failed: 0 });
      continue;
    }
    const result = await downloadPlan(plan, log);
    perForm.set(form, result);
    downloaded += result.ok;
    failed += result.failed;
    log(`Form ${form}: ok=${result.ok} failed=${result.failed}`);
  }

  return { downloaded, failed, skipped, perForm };
}
