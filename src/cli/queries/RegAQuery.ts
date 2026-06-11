/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import { RegAOfferingRepo } from "../../storage/reg-a/RegAOfferingRepo";
import type { RegAOffering } from "../../storage/reg-a/RegAOfferingSchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../../storage/reg-a/RegAOfferingSchema";
import type { QueryResult } from "./EntityQuery";
import { collectPage, streamMatchingRows } from "./_streamMatches";

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
  /** Defined only for per-CIK summaries. */
  readonly latestAggregateOffering: number | undefined;
}

export async function summarizeRegA(cik: number | undefined): Promise<RegASummary> {
  const repo = new RegAOfferingRepo();
  if (cik === undefined) {
    const byStatus = await repo.countOfferingsByStatus();
    const byTier = await repo.countOfferingsByTier();
    let offeringCount = 0;
    for (const n of byStatus.values()) offeringCount += n;
    return { offeringCount, byStatus, byTier, latestAggregateOffering: undefined };
  }
  const offerings = await repo.getOfferingsByCik(cik);
  const byStatus = new Map<string, number>();
  const byTier = new Map<string, number>();
  for (const o of offerings) {
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    const tier = o.tier ?? "unknown";
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
  }
  return {
    offeringCount: offerings.length,
    byStatus,
    byTier,
    latestAggregateOffering: await repo.latestAggregateOfferingByCik(cik),
  };
}
