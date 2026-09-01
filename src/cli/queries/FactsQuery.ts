import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import type { CompanyFact } from "../../storage/facts/CompanyFactsSchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { collectPage, streamMatchingRows } from "./_streamMatches";
import type { QueryResult } from "./EntityQuery";

export interface FactsQueryParams {
  readonly cik: number;
  readonly search?: string;
  readonly name?: string;
  readonly taxonomy?: string;
  readonly year?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryFacts(params: FactsQueryParams): Promise<QueryResult<CompanyFact>> {
  const repo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const criteria: SearchCriteria<CompanyFact> = { cik: params.cik } as Partial<CompanyFact>;
  if (params.year !== undefined) (criteria as Partial<CompanyFact>).fy = params.year;

  const hasSearch = params.search !== undefined && params.search !== "";
  const hasName = params.name !== undefined && params.name !== "";
  const hasTaxonomy = params.taxonomy !== undefined && params.taxonomy !== "";
  const needsPredicate = hasSearch || hasName || hasTaxonomy;

  if (!needsPredicate) {
    const total = await repo.count(criteria);
    const rows = (await repo.query(criteria, { limit, offset })) ?? [];
    return { rows, total };
  }

  const searchLower = hasSearch ? params.search!.toLowerCase() : null;
  const nameLower = hasName ? params.name!.toLowerCase() : null;
  const taxLower = hasTaxonomy ? params.taxonomy!.toLowerCase() : null;
  const predicate = (f: CompanyFact): boolean => {
    if (searchLower !== null && !f.name.toLowerCase().includes(searchLower)) return false;
    if (nameLower !== null && !f.name.toLowerCase().includes(nameLower)) return false;
    if (taxLower !== null && !f.grouping.toLowerCase().includes(taxLower)) return false;
    return true;
  };

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  // totalApprox is the "this number is a lower bound" signal — only
  // emit it when the stream was capped, not when it drained.
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}
