import type { SearchCriteria } from "workglow";
import { globalServiceRegistry } from "workglow";
import type { Filing } from "../../storage/filing/FilingSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { collectPage, streamMatchingRows } from "./_streamMatches";
import type { QueryResult } from "./EntityQuery";

export interface FilingQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly form?: string;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Builds the `SearchCriteria` portion that the database can evaluate for us:
 * `cik`/`form` equality plus a single-sided date range. `search`
 * (substring on `primary_doc_description`) cannot push down — workglow's
 * `SearchCriteria` has no LIKE operator — and a two-sided date range
 * cannot either, since `SearchCriteria` only accepts one condition per
 * column. Both fall through to the streaming-predicate path.
 */
function buildCriteria(params: FilingQueryParams): SearchCriteria<Filing> {
  const criteria: SearchCriteria<Filing> = {};
  if (params.cik !== undefined) {
    (criteria as Partial<Filing>).cik = params.cik;
  }
  if (params.form !== undefined) {
    (criteria as Partial<Filing>).form = params.form;
  }
  if (params.after !== undefined && params.before === undefined) {
    (criteria as any).filing_date = { value: params.after, operator: ">=" };
  } else if (params.before !== undefined && params.after === undefined) {
    (criteria as any).filing_date = { value: params.before, operator: "<=" };
  }
  return criteria;
}

export async function queryFilings(params: FilingQueryParams): Promise<QueryResult<Filing>> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const criteria = buildCriteria(params);
  // Date range with both endpoints — apply one bound DB-side, the other in
  // the predicate. Substring search always lives in the predicate.
  const hasRange = params.after !== undefined && params.before !== undefined;
  const hasSearch = params.search !== undefined && params.search !== "";
  const needsPredicate = hasRange || hasSearch;

  if (!needsPredicate) {
    // Pure DB path. count() drives the displayed total without loading
    // the table. workglow's `query({})` rejects empty criteria, so when
    // no filters are set we fall through to getOffsetPage() + size().
    const hasCriteria = Object.keys(criteria).length > 0;
    if (hasCriteria) {
      const total = await repo.count(criteria);
      const rows =
        (await repo.query(criteria, {
          orderBy: [{ column: "filing_date", direction: "DESC" }],
          limit,
          offset,
        })) ?? [];
      return { rows, total };
    }
    const total = await repo.size();
    const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
    return { rows, total };
  }

  // Streaming path. Push criteria down to the DB; apply substring and the
  // closing range bound in JS. collectPage counts every match up to the
  // soft cap (so `total` is a meaningful lower bound) while keeping only
  // the requested window in memory.
  const searchLower = hasSearch ? params.search!.toLowerCase() : null;
  const predicate = (f: Filing): boolean => {
    if (params.after !== undefined && f.filing_date < params.after) return false;
    if (params.before !== undefined && f.filing_date > params.before) return false;
    if (searchLower !== null) {
      const doc = f.primary_doc_description;
      if (doc === null || doc === undefined) return false;
      if (!doc.toLowerCase().includes(searchLower)) return false;
    }
    return true;
  };

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  // Only emit totalApprox when we actually capped the stream. If the
  // iterator drained, `total` is exact; consumers (TableRenderer, JSON
  // output) treat the PRESENCE of totalApprox as the "this is a lower
  // bound" signal.
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}
