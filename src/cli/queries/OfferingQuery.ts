import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import type { InvestmentOffering } from "../../storage/investment-offering/InvestmentOfferingSchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../../storage/investment-offering/InvestmentOfferingSchema";
import type { QueryResult } from "./EntityQuery";
import { collectPage, streamMatchingRows } from "./_streamMatches";

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

  const criteria: SearchCriteria<InvestmentOffering> = {};
  if (params.cik !== undefined) (criteria as Partial<InvestmentOffering>).cik = params.cik;
  if (params.after !== undefined && params.before === undefined) {
    (criteria as any).date_of_first_sale = { value: params.after, operator: ">=" };
  } else if (params.before !== undefined && params.after === undefined) {
    (criteria as any).date_of_first_sale = { value: params.before, operator: "<=" };
  }

  // `search`, `industry`, `exemption` all need substring matching → predicate.
  // Date range with both ends → predicate.
  const hasRange = params.after !== undefined && params.before !== undefined;
  const hasSearch = params.search !== undefined && params.search !== "";
  const hasIndustry = params.industry !== undefined && params.industry !== "";
  const hasExemption = params.exemption !== undefined && params.exemption !== "";
  const needsPredicate = hasRange || hasSearch || hasIndustry || hasExemption;

  if (!needsPredicate) {
    const hasCriteria = Object.keys(criteria).length > 0;
    if (hasCriteria) {
      const total = await repo.count(criteria);
      const rows = (await repo.query(criteria, { limit, offset })) ?? [];
      return { rows, total };
    }
    const total = await repo.size();
    const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
    return { rows, total };
  }

  const searchLower = hasSearch ? params.search!.toLowerCase() : null;
  const industryLower = hasIndustry ? params.industry!.toLowerCase() : null;
  const exemptionRaw = hasExemption ? params.exemption! : null;
  const predicate = (o: InvestmentOffering): boolean => {
    // Null dates are rejected by ANY date filter, on either side. The
    // previous after-only branch used `(date ?? "") < params.after`
    // which happened to do the right thing (empty string sorts before
    // any non-empty date), but a future change to date string format
    // could flip behaviour silently. Handle null once, then compare.
    if (params.after !== undefined || params.before !== undefined) {
      if (o.date_of_first_sale === null || o.date_of_first_sale === undefined) return false;
      if (params.after !== undefined && o.date_of_first_sale < params.after) return false;
      if (params.before !== undefined && o.date_of_first_sale > params.before) return false;
    }
    if (searchLower !== null && !o.industry_group.toLowerCase().includes(searchLower)) return false;
    if (industryLower !== null && !o.industry_group.toLowerCase().includes(industryLower)) {
      return false;
    }
    if (exemptionRaw !== null) {
      if (o.exemptions === null || o.exemptions === undefined) return false;
      if (!o.exemptions.includes(exemptionRaw)) return false;
    }
    return true;
  };

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  // totalApprox is the "this number is a lower bound" signal — only
  // emit it when the stream was capped, not when it drained.
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total, exhausted } };
}
