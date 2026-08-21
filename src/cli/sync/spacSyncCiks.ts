/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN } from "../../storage/spac/SpacSchema";
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
 * Inclusive filing-date floor for `--only updates`: the day before the latest
 * successful SPAC extractor run. Matches identify's "take the watermark back
 * one day" so a CIK processed later on the same date is not skipped.
 */
export async function spacUpdatesFiledOnOrAfter(): Promise<string | undefined> {
  const storage = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
  let latest: string | undefined;
  for (const extractor_id of SPAC_EXTRACTOR_IDS) {
    const rows = (await storage.query({ extractor_id, success: true })) ?? [];
    for (const row of rows) {
      if (!isSuccessfulSpacRun(row)) continue;
      if (latest === undefined || row.ran_at > latest) latest = row.ran_at;
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

/** Known spac rows ∪ spac_candidate rows with confidence high|medium. */
export async function listSpacProcessCiks(): Promise<number[]> {
  const known = await listKnownSpacCiks();
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

  for (const row of candidates) {
    ciks.add(row.cik);
  }

  return [...ciks].sort((a, b) => a - b);
}

/** CIKs that already have a `spac` row — the 8-K / proxy / 25-15 handlers' gate. */
export async function listKnownSpacCiks(): Promise<number[]> {
  const spacRepo = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
  const ciks = (await spacRepo.getAll())?.map((row) => row.cik) ?? [];
  return [...new Set(ciks)].sort((a, b) => a - b);
}
