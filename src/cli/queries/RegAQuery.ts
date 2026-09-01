/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchCriteria } from "workglow";
import { globalServiceRegistry } from "workglow";
import { RegAOfferingRepo } from "../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../storage/reg-a/RegAOfferingSchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../../storage/reg-a/RegAOfferingSchema";
import { collectPage, streamMatchingRows } from "./_streamMatches";
import type { QueryResult } from "./EntityQuery";

export interface RegAQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly tier?: string;
  readonly status?: string;
  readonly jurisdiction?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryRegAOfferings(
  params: RegAQueryParams
): Promise<QueryResult<RegAOffering>> {
  const repo = globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const criteria: SearchCriteria<RegAOffering> = {};
  if (params.cik !== undefined) (criteria as Partial<RegAOffering>).cik = params.cik;
  if (params.tier !== undefined) (criteria as Partial<RegAOffering>).tier = params.tier;
  if (params.status !== undefined) (criteria as Partial<RegAOffering>).status = params.status;
  if (params.jurisdiction !== undefined)
    (criteria as Partial<RegAOffering>).jurisdiction = params.jurisdiction;

  const hasSearch = params.search !== undefined && params.search !== "";
  if (!hasSearch) {
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

  const searchLower = params.search!.toLowerCase();
  const predicate = (o: RegAOffering): boolean =>
    (o.issuer_name ?? "").toLowerCase().includes(searchLower);

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows(repo, criteria, predicate),
    offset,
    limit
  );
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}

export interface RegASummary {
  readonly offeringCount: number;
  readonly byStatus: ReadonlyMap<string, number>;
  readonly byTier: ReadonlyMap<string, number>;
  /**
   * Only computed for per-CIK summaries; null when no history row carries an
   * aggregate amount (distinct from a genuine $0).
   */
  readonly latestAggregateOffering: number | null | undefined;
}

export async function summarizeRegA(cik: number | undefined): Promise<RegASummary> {
  const repo = new RegAOfferingRepo();
  const [offeringCount, byStatus, byTier, latestAggregateOffering] = await Promise.all([
    repo.countOfferings(cik),
    repo.countOfferingsByStatus(cik),
    repo.countOfferingsByTier(cik),
    cik === undefined ? Promise.resolve(undefined) : repo.latestAggregateOfferingByCik(cik),
  ]);
  return { offeringCount, byStatus, byTier, latestAggregateOffering };
}
