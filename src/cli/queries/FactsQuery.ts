import type { CompanyFact } from "../../storage/facts/CompanyFactsSchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { globalServiceRegistry } from "@workglow/util";
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

  let facts: CompanyFact[] =
    (await repo.query({ cik: params.cik } as Partial<CompanyFact>)) ?? [];

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    facts = facts.filter((f) => f.name.toLowerCase().includes(searchLower));
  }

  if (params.name) {
    const nameLower = params.name.toLowerCase();
    facts = facts.filter((f) => f.name.toLowerCase().includes(nameLower));
  }

  if (params.taxonomy) {
    const taxLower = params.taxonomy.toLowerCase();
    facts = facts.filter((f) => f.grouping.toLowerCase().includes(taxLower));
  }

  if (params.year !== undefined) {
    facts = facts.filter((f) => f.fy === params.year);
  }

  const total = facts.length;
  const rows = facts.slice(offset, offset + limit);

  return { rows, total };
}
