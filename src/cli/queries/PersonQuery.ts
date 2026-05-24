/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import type { PersonObservation } from "../../storage/observation/PersonObservationSchema";
import type { QueryResult } from "./EntityQuery";

export interface PersonQueryParams {
  readonly search?: string;
  readonly cik?: number;
  readonly relationship?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export async function queryPersons(
  params: PersonQueryParams
): Promise<QueryResult<PersonObservation>> {
  const repo = new PersonObservationRepo();
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;

  let persons = await repo.listAll();

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    persons = persons.filter((p) => {
      const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ").toLowerCase();
      return fullName.includes(searchLower);
    });
  }

  if (params.cik !== undefined) {
    persons = persons.filter((p) => p.source_filing_issuer_cik === params.cik);
  }

  if (params.relationship) {
    const relLower = params.relationship.toLowerCase();
    persons = persons.filter(
      (p) => p.relationship !== null && p.relationship !== undefined && p.relationship.toLowerCase().includes(relLower)
    );
  }

  const total = persons.length;
  const rows = persons.slice(offset, offset + limit);

  return { rows, total };
}
