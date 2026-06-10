/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import { XBRL_FACT_REPOSITORY_TOKEN } from "../../storage/xbrl/XbrlFactSchema";
import type { QueryResult } from "./EntityQuery";
import { collectPage, streamMatchingRows } from "./_streamMatches";

export interface XbrlQueryParams {
  /** Filing accession number; either this or `cik` must be provided. */
  readonly accession?: string;
  readonly cik?: number;
  /** Case-insensitive substring filter on the concept QName (e.g. "TrustAccount"). */
  readonly concept?: string;
  readonly numericOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** XBRL facts for a filing (or an issuer across filings), in extraction order. */
export async function queryXbrlFacts(params: XbrlQueryParams): Promise<QueryResult<XbrlFactRow>> {
  if (params.accession === undefined && params.cik === undefined) {
    throw new Error("queryXbrlFacts requires an accession number or a CIK");
  }
  const repo = globalServiceRegistry.get(XBRL_FACT_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const criteria: SearchCriteria<XbrlFactRow> = (
    params.accession !== undefined ? { accession_number: params.accession } : { cik: params.cik }
  ) as Partial<XbrlFactRow>;

  const hasConcept = params.concept !== undefined && params.concept !== "";
  if (!hasConcept && params.numericOnly !== true) {
    const total = await repo.count(criteria);
    const rows = (await repo.query(criteria, { limit, offset })) ?? [];
    return { rows: rows.sort((a, b) => a.fact_index - b.fact_index), total };
  }

  const conceptLower = hasConcept ? params.concept!.toLowerCase() : null;
  const predicate = (f: XbrlFactRow): boolean => {
    if (conceptLower !== null && !f.concept.toLowerCase().includes(conceptLower)) return false;
    if (params.numericOnly === true && !f.is_numeric) return false;
    return true;
  };

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}

/** Compact period display: instant date, "start..end" duration, or "". */
export function formatXbrlPeriod(row: XbrlFactRow): string {
  if (row.period_instant !== null) return row.period_instant;
  if (row.period_start !== null || row.period_end !== null) {
    return `${row.period_start ?? "?"}..${row.period_end ?? "?"}`;
  }
  return "";
}
