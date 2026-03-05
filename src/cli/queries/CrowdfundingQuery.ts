import type { Crowdfunding } from "../../storage/portal/CrowdfundingSchema";
import { CROWDFUNDING_REPOSITORY_TOKEN } from "../../storage/portal/CrowdfundingSchema";
import { globalServiceRegistry } from "@workglow/util";
import type { QueryResult } from "./EntityQuery";

export interface CrowdfundingQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly portal?: number;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryCrowdfunding(
  params: CrowdfundingQueryParams
): Promise<QueryResult<Crowdfunding>> {
  const repo = globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  let items: Crowdfunding[];

  if (params.cik !== undefined) {
    items = (await repo.query({ cik: params.cik } as Partial<Crowdfunding>)) ?? [];
  } else {
    items = (await repo.getAll()) ?? [];
  }

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    items = items.filter((c) => c.name.toLowerCase().includes(searchLower));
  }

  if (params.portal !== undefined) {
    items = items.filter((c) => c.portal_cik === params.portal);
  }

  if (params.after !== undefined) {
    items = items.filter((c) => c.filing_date >= params.after!);
  }

  if (params.before !== undefined) {
    items = items.filter((c) => c.filing_date <= params.before!);
  }

  const total = items.length;
  const rows = items.slice(offset, offset + limit);

  return { rows, total };
}
