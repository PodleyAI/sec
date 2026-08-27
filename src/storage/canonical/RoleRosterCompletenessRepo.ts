/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN,
  type RoleRosterCompleteness,
  type RoleRosterCompletenessRepositoryStorage,
} from "./RoleRosterCompletenessSchema";

interface RoleRosterCompletenessRepoOptions {
  roleRosterCompletenessRepository?: RoleRosterCompletenessRepositoryStorage;
}

/**
 * Accessions per `in`-list query — see `MAX_IDS_PER_QUERY` in
 * `PersonObservationTitleRepo` for the rationale (SQLite binds one bind
 * parameter per value).
 */
const MAX_ACCESSIONS_PER_QUERY = 900;

/**
 * Reads and writes the roster completeness decisions described by
 * {@link RoleRosterCompletenessSchema}.
 */
export class RoleRosterCompletenessRepo {
  private repo: RoleRosterCompletenessRepositoryStorage;

  constructor(options: RoleRosterCompletenessRepoOptions = {}) {
    this.repo =
      options.roleRosterCompletenessRepository ??
      globalServiceRegistry.get(ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN);
  }

  /**
   * Record one decision, replacing whatever an earlier extraction of the same
   * filing decided about the same roster — a re-extraction that now declines a
   * row must retract its own "complete", and one that stops declining must
   * restore it.
   */
  async record(decision: RoleRosterCompleteness): Promise<void> {
    await this.repo.put(decision);
  }

  /** Every recorded decision for these accessions, chunked for the `in`-list bind limit. */
  async listForAccessions(accession_numbers: readonly string[]): Promise<RoleRosterCompleteness[]> {
    const distinct = [...new Set(accession_numbers)];
    const rows: RoleRosterCompleteness[] = [];
    for (let start = 0; start < distinct.length; start += MAX_ACCESSIONS_PER_QUERY) {
      const chunk = distinct.slice(start, start + MAX_ACCESSIONS_PER_QUERY);
      const found =
        (await this.repo.query({ accession_number: { value: chunk, operator: "in" } })) ?? [];
      rows.push(...found);
    }
    return rows;
  }
}
