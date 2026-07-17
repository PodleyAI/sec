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

  // Order by (accession, fact_index): extraction order within a filing, and a
  // stable per-filing grouping for the across-issuer (CIK) case.
  const byFilingOrder = (a: XbrlFactRow, b: XbrlFactRow): number =>
    a.accession_number.localeCompare(b.accession_number) || a.fact_index - b.fact_index;

  const hasConcept = params.concept !== undefined && params.concept !== "";
  if (!hasConcept && params.numericOnly !== true) {
    const total = await repo.count(criteria);
    // Push ORDER BY (accession, fact_index) down to storage so pagination is
    // consistent across pages. Sorting only the returned page would leave the
    // overall order at the backend's default, letting offset/limit skip or
    // duplicate rows across pages.
    const rows =
      (await repo.query(criteria, {
        orderBy: [
          { column: "accession_number", direction: "ASC" },
          { column: "fact_index", direction: "ASC" },
        ],
        limit,
        offset,
      })) ?? [];
    return { rows, total };
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
  // Within-page extraction order, matching the unfiltered path above.
  rows.sort(byFilingOrder);
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

interface StoredDimension {
  readonly dimension: string;
  readonly member: string;
}

/** Local part of a QName, dropping the prefix and the noise Axis/Member/Domain suffix. */
function dimensionLabel(qname: string): string {
  const local = qname.includes(":") ? qname.slice(qname.indexOf(":") + 1) : qname;
  return local.replace(/(Axis|Member|Domain)$/, "");
}

/**
 * Compact dimensional-qualifier display for a fact row: `Axis=Member` pairs
 * joined with "; " (e.g. `StatementClassOfStock=CommonClassA`), or "" when the
 * fact is on the default (undimensioned) context. Malformed JSON degrades to "".
 */
export function formatXbrlDimensions(row: XbrlFactRow): string {
  if (row.dimensions_json === null || row.dimensions_json === "") return "";
  try {
    const dims = JSON.parse(row.dimensions_json) as readonly StoredDimension[];
    if (!Array.isArray(dims)) return "";
    return dims.map((d) => `${dimensionLabel(d.dimension)}=${dimensionLabel(d.member)}`).join("; ");
  } catch {
    return "";
  }
}
