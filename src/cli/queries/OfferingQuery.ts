import type { InvestmentOffering } from "../../storage/investment-offering/InvestmentOfferingSchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../../storage/investment-offering/InvestmentOfferingSchema";
import { globalServiceRegistry } from "@workglow/util";
import type { QueryResult } from "./EntityQuery";

export interface OfferingQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly industry?: string;
  readonly exemption?: string;
  readonly after?: string;
  readonly before?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryOfferings(
  params: OfferingQueryParams
): Promise<QueryResult<InvestmentOffering>> {
  const repo = globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  let offerings: InvestmentOffering[];

  if (params.cik !== undefined) {
    offerings = (await repo.query({ cik: params.cik } as Partial<InvestmentOffering>)) ?? [];
  } else {
    offerings = (await repo.getAll()) ?? [];
  }

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    offerings = offerings.filter(
      (o) => o.industry_group.toLowerCase().includes(searchLower)
    );
  }

  if (params.industry) {
    const industryLower = params.industry.toLowerCase();
    offerings = offerings.filter(
      (o) => o.industry_group.toLowerCase().includes(industryLower)
    );
  }

  if (params.exemption) {
    offerings = offerings.filter(
      (o) => o.exemptions !== null && o.exemptions !== undefined && o.exemptions.includes(params.exemption!)
    );
  }

  if (params.after !== undefined) {
    offerings = offerings.filter(
      (o) => o.date_of_first_sale !== null && o.date_of_first_sale !== undefined && o.date_of_first_sale >= params.after!
    );
  }

  if (params.before !== undefined) {
    offerings = offerings.filter(
      (o) => o.date_of_first_sale !== null && o.date_of_first_sale !== undefined && o.date_of_first_sale <= params.before!
    );
  }

  const total = offerings.length;
  const rows = offerings.slice(offset, offset + limit);

  return { rows, total };
}
