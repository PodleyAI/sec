/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../../storage/classification/S1ClassificationSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN } from "../../storage/spac/SpacSchema";
import {
  latestClassifiedAsSpac,
  type ClassificationVerdict,
} from "../../task/spac/classifySpacCandidate";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { SYNC_FORM_DOMAINS } from "./syncFormDomains";

// Typed `ReadonlySet<string>` for lookup — the stored column is a plain string
// (`TypeStringEnum` surfaces `string`, not the union) — while the literals are
// still checked against {@link SpacCandidateConfidence}, so a typo is a compile error.
const PROCESS_CONFIDENCES: ReadonlySet<string> = new Set<SpacCandidateConfidence>([
  "high",
  "medium",
]);

const SPAC_EXTRACTOR_IDS: ReadonlySet<string> = new Set(SYNC_FORM_DOMAINS.spacs);

/** CIKs per `in` list — same bound as the forms worklist. */
const TOUCHED_CIK_CHUNK = 900;

export const SPAC_PROCESS_ONLY_VALUES = ["never-processed", "updates"] as const;
export type SpacProcessOnly = (typeof SPAC_PROCESS_ONLY_VALUES)[number];

export function parseSpacProcessOnly(value: string): SpacProcessOnly {
  if ((SPAC_PROCESS_ONLY_VALUES as readonly string[]).includes(value)) {
    return value as SpacProcessOnly;
  }
  throw new Error(`Invalid --only "${value}". Expected: ${SPAC_PROCESS_ONLY_VALUES.join(", ")}`);
}

/**
 * Split issuers across `--shard i/N` processes by CIK. Accession hashing would
 * put two filings of one SPAC on different shards, which is the ordering the
 * timeline replay exists to prevent.
 */
export function shardCiks(
  ciks: readonly number[],
  shard: { readonly index: number; readonly count: number } | undefined
): number[] {
  if (shard === undefined || shard.count <= 1) return [...ciks];
  return ciks.filter((cik) => cik % shard.count === shard.index);
}

function isSuccessfulSpacRun(row: {
  readonly success: boolean;
  readonly outcome: string;
}): boolean {
  if (row.outcome) return row.outcome === "success";
  return row.success;
}

const MS_PER_DAY = 86_400_000;

/** UTC calendar day before `isoTimestamp`'s date. `ran_at` is date-granular for this gate. */
export function dayBeforeUtc(isoTimestamp: string): string {
  const day = isoTimestamp.slice(0, 10);
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return new Date(t - MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Newest-first rows read per extractor when looking for its latest successful
 * run. One would do if `success: true` were the whole predicate, but a legacy
 * or partial row can carry `success: true` with a non-success `outcome`, so the
 * post-filter needs a few rows to walk. Bounded because these tables are
 * corpus-wide.
 */
const LATEST_RUN_SCAN_LIMIT = 20;

/**
 * Inclusive filing-date floor for `--only updates`: the day before the latest
 * successful SPAC extractor run. Matches identify's "take the watermark back
 * one day" so a CIK processed later on the same date is not skipped.
 *
 * The max is pushed into the query. `SYNC_FORM_DOMAINS.spacs` includes 8-K,
 * S-1 and 424, whose `extractor_runs` rows are written by the general
 * `sync forms` sweep for every issuer rather than only for SPACs — millions of
 * them. Scanning that in JS to find one timestamp is a multi-hundred-MB spike
 * before a single issuer is touched, paid independently by every `--shard`
 * process, and on Postgres the driver buffers the whole result set first.
 */
export async function spacUpdatesFiledOnOrAfter(): Promise<string | undefined> {
  const storage = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
  let latest: string | undefined;
  for (const extractor_id of SPAC_EXTRACTOR_IDS) {
    const rows =
      (await storage.query(
        { extractor_id, success: true },
        { orderBy: [{ column: "ran_at", direction: "DESC" }], limit: LATEST_RUN_SCAN_LIMIT }
      )) ?? [];
    for (const row of rows) {
      if (!isSuccessfulSpacRun(row)) continue;
      // Newest-first, so the first row that survives the filter is this
      // extractor's max.
      if (latest === undefined || row.ran_at > latest) latest = row.ran_at;
      break;
    }
  }
  if (latest === undefined) return undefined;
  return dayBeforeUtc(latest);
}

/** CIKs in `ciks` that have any successful SPAC-extractor run, at any version. */
export async function listTouchedSpacCiks(ciks: readonly number[]): Promise<Set<number>> {
  const want = new Set(ciks);
  const touched = new Set<number>();
  if (want.size === 0) return touched;

  const storage = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
  const sorted = [...want].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += TOUCHED_CIK_CHUNK) {
    const chunk = sorted.slice(i, i + TOUCHED_CIK_CHUNK);
    for (const extractor_id of SPAC_EXTRACTOR_IDS) {
      const rows =
        (await storage.query({
          extractor_id,
          success: true,
          cik: { value: chunk, operator: "in" },
        })) ?? [];
      for (const row of rows) {
        if (!want.has(row.cik)) continue;
        if (!isSuccessfulSpacRun(row)) continue;
        touched.add(row.cik);
      }
    }
  }
  return touched;
}

export async function filterSpacCiksByHistory(
  ciks: readonly number[],
  only: SpacProcessOnly | undefined
): Promise<number[]> {
  if (only === undefined || ciks.length === 0) return [...ciks];
  const touched = await listTouchedSpacCiks(ciks);
  if (only === "never-processed") {
    return ciks.filter((cik) => !touched.has(cik));
  }
  return ciks.filter((cik) => touched.has(cik));
}

/** Known spac rows ∪ high|medium candidates, minus classified-not-SPAC CIKs. */
export async function listSpacProcessCiks(): Promise<number[]> {
  const known = await listKnownSpacCiks();
  const knownSet = new Set(known);
  const ciks = new Set<number>(known);
  const candidateRepo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

  let candidates = await candidateRepo.query({
    confidence: { value: ["high", "medium"], operator: "in" },
  });
  if (candidates === undefined) {
    candidates =
      (await candidateRepo.getAll())?.filter((row) => PROCESS_CONFIDENCES.has(row.confidence)) ??
      [];
  }

  const unknown = candidates.filter((row) => !knownSet.has(row.cik)).map((row) => row.cik);
  const rejected = await listCiksLatestClassificationNotSpac(unknown);

  for (const row of candidates) {
    if (rejected.has(row.cik)) continue;
    ciks.add(row.cik);
  }

  return [...ciks].sort((a, b) => a - b);
}

/**
 * CIKs among `ciks` whose latest parsed registration classified `is_spac=false`.
 * A CIK with no classification is not rejected — the forms pipeline has not
 * answered yet.
 */
async function listCiksLatestClassificationNotSpac(ciks: readonly number[]): Promise<Set<number>> {
  const rejected = new Set<number>();
  if (ciks.length === 0) return rejected;

  const classRepo = globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN);
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const byCik = new Map<number, ClassificationVerdict[]>();
  const accessions = new Set<string>();
  const sorted = [...new Set(ciks)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += TOUCHED_CIK_CHUNK) {
    const chunk = sorted.slice(i, i + TOUCHED_CIK_CHUNK);
    const rows = (await classRepo.query({ cik: { value: chunk, operator: "in" } })) ?? [];
    for (const row of rows) {
      if (row.cik == null) continue;
      accessions.add(row.accession_number);
      const list = byCik.get(row.cik) ?? [];
      list.push({
        accession_number: row.accession_number,
        is_spac: row.is_spac,
        created_at: row.created_at,
      });
      byCik.set(row.cik, list);
    }
  }

  const filingDateByAccession = new Map<string, string>();
  const accessionList = [...accessions];
  for (let i = 0; i < accessionList.length; i += TOUCHED_CIK_CHUNK) {
    const chunk = accessionList.slice(i, i + TOUCHED_CIK_CHUNK);
    const filings =
      (await filingRepo.query({ accession_number: { value: chunk, operator: "in" } })) ?? [];
    for (const filing of filings) {
      filingDateByAccession.set(filing.accession_number, filing.filing_date);
    }
  }

  for (const [cik, rows] of byCik) {
    if (latestClassifiedAsSpac(rows, filingDateByAccession) === false) {
      rejected.add(cik);
    }
  }
  return rejected;
}

/** CIKs that already have a `spac` row — the 8-K / proxy / 25-15 handlers' gate. */
export async function listKnownSpacCiks(): Promise<number[]> {
  const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
  const ciks = (await spacRepo.getAll())?.map((row) => row.cik) ?? [];
  return [...new Set(ciks)].sort((a, b) => a - b);
}
