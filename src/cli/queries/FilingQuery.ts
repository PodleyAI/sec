import type { Filing } from "../../storage/filing/FilingSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { globalServiceRegistry } from "@workglow/util";
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

export async function queryFilings(params: FilingQueryParams): Promise<QueryResult<Filing>> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const needsClientFilter =
    params.search !== undefined || params.after !== undefined || params.before !== undefined;

  let filings: Filing[];

  if (!needsClientFilter && (params.cik !== undefined || params.form !== undefined)) {
    const criteria: Partial<Filing> = {};
    if (params.cik !== undefined) criteria.cik = params.cik;
    if (params.form !== undefined) criteria.form = params.form;
    filings = (await repo.query(criteria)) ?? [];
  } else {
    filings = (await repo.getAll()) ?? [];
  }

  // Apply exact filters when fetched via getAll
  if (needsClientFilter) {
    if (params.cik !== undefined) {
      filings = filings.filter((f) => f.cik === params.cik);
    }
    if (params.form !== undefined) {
      filings = filings.filter((f) => f.form === params.form);
    }
  }

  // Apply text search on primary_doc_description
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filings = filings.filter(
      (f) =>
        f.primary_doc_description !== null &&
        f.primary_doc_description !== undefined &&
        f.primary_doc_description.toLowerCase().includes(searchLower)
    );
  }

  // Apply date range filters
  if (params.after !== undefined) {
    filings = filings.filter((f) => f.filing_date >= params.after!);
  }
  if (params.before !== undefined) {
    filings = filings.filter((f) => f.filing_date <= params.before!);
  }

  const total = filings.length;
  const rows = filings.slice(offset, offset + limit);

  return { rows, total };
}
