import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import type { Crowdfunding } from "../../storage/portal/CrowdfundingSchema";
import { CROWDFUNDING_REPOSITORY_TOKEN } from "../../storage/portal/CrowdfundingSchema";
import type { QueryResult } from "./EntityQuery";
import { collectPage, streamMatchingRows } from "./_streamMatches";

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

  const criteria: SearchCriteria<Crowdfunding> = {};
  if (params.cik !== undefined) (criteria as Partial<Crowdfunding>).cik = params.cik;
  if (params.portal !== undefined) (criteria as Partial<Crowdfunding>).portal_cik = params.portal;
  // One side of the date range pushes down via SearchCondition; both
  // sides need the predicate (workglow takes one condition per column).
  if (params.after !== undefined && params.before === undefined) {
    (criteria as any).filing_date = { value: params.after, operator: ">=" };
  } else if (params.before !== undefined && params.after === undefined) {
    (criteria as any).filing_date = { value: params.before, operator: "<=" };
  }

  const hasRange = params.after !== undefined && params.before !== undefined;
  const hasSearch = params.search !== undefined && params.search !== "";
  const needsPredicate = hasRange || hasSearch;

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
  const predicate = (c: Crowdfunding): boolean => {
    if (params.after !== undefined && c.filing_date < params.after) return false;
    if (params.before !== undefined && c.filing_date > params.before) return false;
    if (searchLower !== null && !c.name.toLowerCase().includes(searchLower)) return false;
    return true;
  };

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  return { rows, total, totalApprox: { atLeast: total, exhausted } };
}
