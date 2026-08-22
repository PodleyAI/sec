/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPAC_CANDIDATE_CONFIDENCES,
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN } from "../../storage/spac/SpacSchema";

/** One page of the candidate screen, with the totals a filter needs to make sense. */
export interface CandidatePage {
  readonly rows: readonly SpacCandidate[];
  /** Rows matching the filter, before paging. */
  readonly matched: number;
  /** Rows in the table, ignoring the filter. */
  readonly total: number;
  readonly byConfidence: Readonly<Record<SpacCandidateConfidence, number>>;
  /** How many of the whole table already have a `spac` row (i.e. have been processed). */
  readonly processed: number;
  /** CIKs on this page that already have a `spac` row. */
  readonly processedOnPage: ReadonlySet<number>;
  readonly offset: number;
  readonly limit: number;
  readonly confidence: SpacCandidateConfidence | undefined;
  readonly search: string;
  /** Newest `identified_at` in the table — when the screen last ran. */
  readonly identifiedAt: string;
}

export function isCandidateConfidence(value: string): value is SpacCandidateConfidence {
  return (SPAC_CANDIDATE_CONFIDENCES as readonly string[]).includes(value);
}

/** Case-insensitive match on the name as scanned, the former name, or the CIK. */
function matchesSearch(row: SpacCandidate, needle: string): boolean {
  if (needle === "") return true;
  const lower = needle.toLowerCase();
  if (String(row.cik).includes(lower)) return true;
  if ((row.name ?? "").toLowerCase().includes(lower)) return true;
  return (row.signal_renamed_from ?? "").toLowerCase().includes(lower);
}

/**
 * Read `spac_candidate`, newest registration first.
 *
 * Undated rows (no registration on file) sort last rather than leading the list
 * on an empty string — the same rule `ListSpacCandidatesTask` applies, since the
 * two surfaces list the same table and an operator moving between them must not
 * see two different orders.
 */
export async function loadCandidates(args: {
  readonly confidence?: SpacCandidateConfidence | undefined;
  readonly search?: string | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}): Promise<CandidatePage> {
  const storage = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
  const spacStorage = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
  const all = (await storage.getAll()) ?? [];
  const spacRows = (await spacStorage.getAll()) ?? [];
  const knownSpacCiks = new Set<number>(spacRows.map((r) => r.cik));

  const byConfidence: Record<SpacCandidateConfidence, number> = { high: 0, medium: 0, low: 0 };
  let identifiedAt = "";
  for (const row of all) {
    // `confidence` is a plain string column, so a row written by an older build
    // (or by hand) can hold a value outside the ladder; count only the three.
    if (isCandidateConfidence(row.confidence)) byConfidence[row.confidence] += 1;
    if (row.identified_at > identifiedAt) identifiedAt = row.identified_at;
  }

  const search = (args.search ?? "").trim();
  const matched = all
    .filter((row) => args.confidence === undefined || row.confidence === args.confidence)
    .filter((row) => matchesSearch(row, search))
    .sort((a, b) => (b.first_reg_date ?? "").localeCompare(a.first_reg_date ?? ""));

  const offset = Math.max(0, args.offset ?? 0);
  const limit = Math.max(0, args.limit ?? 50);
  const rows = matched.slice(offset, offset + limit);

  return {
    rows,
    matched: matched.length,
    total: all.length,
    byConfidence,
    processed: all.filter((r) => knownSpacCiks.has(r.cik)).length,
    processedOnPage: new Set(rows.filter((r) => knownSpacCiks.has(r.cik)).map((r) => r.cik)),
    offset,
    limit,
    confidence: args.confidence,
    search,
    identifiedAt,
  };
}
