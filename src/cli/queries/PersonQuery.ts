/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import {
  PERSON_OBSERVATION_REPOSITORY_TOKEN,
  type PersonObservation,
} from "../../storage/observation/PersonObservationSchema";
import { PersonObservationTitleRepo } from "../../storage/observation/PersonObservationTitleRepo";
import type { QueryResult } from "./EntityQuery";
import { collectPage, streamMatchingRows } from "./_streamMatches";

export interface PersonQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly relationship?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** A person observation with its titles joined in from the per-title rows. */
export interface PersonQueryRow extends PersonObservation {
  readonly titles: readonly string[];
}

export async function queryPersons(
  params: PersonQueryParams
): Promise<QueryResult<PersonQueryRow>> {
  const repo = globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  // `cik` pushes down to the DB; `search` (over first+middle+last) and
  // `relationship` (substring on a single column) do not — workglow has
  // no LIKE operator. When only `cik` is set we use the pure-DB path;
  // otherwise we stream.
  const criteria: SearchCriteria<PersonObservation> = {};
  if (params.cik !== undefined) {
    (criteria as Partial<PersonObservation>).source_filing_issuer_cik = params.cik;
  }
  const hasSearch = params.search !== undefined && params.search !== "";
  const hasRel = params.relationship !== undefined && params.relationship !== "";
  const needsPredicate = hasSearch || hasRel;

  if (!needsPredicate) {
    const hasCriteria = Object.keys(criteria).length > 0;
    if (hasCriteria) {
      const total = await repo.count(criteria);
      const rows = (await repo.query(criteria, { limit, offset })) ?? [];
      return { rows: await joinTitles(rows), total };
    }
    const total = await repo.size();
    const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
    return { rows: await joinTitles(rows), total };
  }

  const searchLower = hasSearch ? params.search!.toLowerCase() : null;
  const relLower = hasRel ? params.relationship!.toLowerCase() : null;
  const predicate = (p: PersonObservation): boolean => {
    if (searchLower !== null) {
      const fullName = [p.first_name, p.middle_name, p.last_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!fullName.includes(searchLower)) return false;
    }
    if (relLower !== null) {
      if (p.relationship === null || p.relationship === undefined) return false;
      if (!p.relationship.toLowerCase().includes(relLower)) return false;
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
  const joined = await joinTitles(rows);
  return exhausted
    ? { rows: joined, total }
    : { rows: joined, total, totalApprox: { atLeast: total } };
}

/**
 * Titles live one row per title; join them back per returned page row only —
 * never over the streamed candidates.
 */
async function joinTitles(rows: readonly PersonObservation[]): Promise<PersonQueryRow[]> {
  if (rows.length === 0) return [];
  const titleRepo = new PersonObservationTitleRepo();
  const byId = await titleRepo.listForObservations(rows.map((r) => r.observation_id));
  return rows.map((r) => ({ ...r, titles: byId.get(r.observation_id) ?? [] }));
}
