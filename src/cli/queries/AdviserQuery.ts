/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SearchCriteria } from "workglow";
import { globalServiceRegistry } from "workglow";
import { ADV_ADVISER_REPOSITORY_TOKEN, type AdvAdviser } from "../../storage/adv/AdvAdviserSchema";
import { collectPage, streamMatchingRows } from "./_streamMatches";
import type { QueryResult } from "./EntityQuery";

export interface AdviserQueryParams {
  /** Substring match against the legal and business names. */
  readonly search?: string;
  readonly crd?: string;
  readonly state?: string;
  readonly snapshot?: string;
  /** Only advisers reporting at least this much regulatory AUM. */
  readonly minAum?: number;
  readonly limit?: number;
  readonly offset?: number;
}

function matchesName(adviser: AdvAdviser, needle: string): boolean {
  const lower = needle.toLowerCase();
  return (
    (adviser.legal_name?.toLowerCase().includes(lower) ?? false) ||
    (adviser.primary_business_name?.toLowerCase().includes(lower) ?? false)
  );
}

export async function queryAdvisers(params: AdviserQueryParams): Promise<QueryResult<AdvAdviser>> {
  const repo = globalServiceRegistry.get(ADV_ADVISER_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  const criteria: SearchCriteria<AdvAdviser> = {};
  if (params.crd !== undefined) (criteria as Partial<AdvAdviser>).crd_number = params.crd;
  if (params.state !== undefined) {
    (criteria as Partial<AdvAdviser>).main_office_state = params.state;
  }
  if (params.snapshot !== undefined) {
    (criteria as Partial<AdvAdviser>).snapshot = params.snapshot;
  }
  const hasCriteria = Object.keys(criteria).length > 0;
  const needle = params.search === "" ? undefined : params.search;
  const hasMinAum = params.minAum !== undefined;

  // Both remaining filters are predicates no backend can express as equality —
  // a substring and an inequality — so they stream. Where neither is asked for,
  // the criteria push down and the count is exact.
  if (needle === undefined && !hasMinAum) {
    if (hasCriteria) {
      const total = await repo.count(criteria);
      const rows = (await repo.query(criteria, { limit, offset })) ?? [];
      return { rows, total };
    }
    const total = await repo.size();
    const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
    return { rows, total };
  }

  const { rows, total, exhausted } = await collectPage(
    streamMatchingRows<AdvAdviser>(repo, criteria, (adviser) => {
      if (needle !== undefined && !matchesName(adviser, needle)) return false;
      if (hasMinAum && (adviser.regulatory_aum ?? 0) < params.minAum!) return false;
      return true;
    }),
    offset,
    limit
  );

  // A lower bound only when the stream was capped: a drained stream counted
  // every match, and calling that approximate would make the number useless.
  return exhausted ? { rows, total } : { rows, total, totalApprox: { atLeast: total } };
}
