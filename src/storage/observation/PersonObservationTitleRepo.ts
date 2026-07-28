/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  type PersonObservationTitle,
  type PersonObservationTitleRepositoryStorage,
} from "./PersonObservationTitleSchema";

interface PersonObservationTitleRepoOptions {
  personObservationTitleRepository?: PersonObservationTitleRepositoryStorage;
}

/**
 * Manages the per-title child rows of person observations. Writes are
 * whole-list replacements per observation: a re-observation's titles are the
 * complete claim of that filing, so stale rows from a prior (longer) list must
 * not survive.
 */
export class PersonObservationTitleRepo {
  private repo: PersonObservationTitleRepositoryStorage;

  constructor(options: PersonObservationTitleRepoOptions = {}) {
    this.repo =
      options.personObservationTitleRepository ??
      globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
  }

  /**
   * Replace an observation's title rows with `titles` (empties dropped,
   * case-insensitively de-duplicated preserving first-seen order, clamped to
   * the column width). Returns the persisted rows in `title_index` order.
   */
  async replaceForObservation(
    observation_id: number,
    titles: readonly string[]
  ): Promise<PersonObservationTitle[]> {
    await this.deleteForObservation(observation_id);
    const seen = new Set<string>();
    const rows: PersonObservationTitle[] = [];
    for (const raw of titles) {
      const title = raw.trim().slice(0, 256);
      if (title === "") continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ observation_id, title_index: rows.length, title });
    }
    for (const row of rows) {
      await this.repo.put(row);
    }
    return rows;
  }

  /** The observation's titles in `title_index` (source) order. */
  async listForObservation(observation_id: number): Promise<string[]> {
    const rows = (await this.repo.query({ observation_id })) ?? [];
    return rows.sort((a, b) => a.title_index - b.title_index).map((r) => r.title);
  }

  /** Titles for many observations at once, keyed by observation id. */
  async listForObservations(observation_ids: readonly number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    for (const id of observation_ids) {
      out.set(id, await this.listForObservation(id));
    }
    return out;
  }

  async deleteForObservation(observation_id: number): Promise<void> {
    const rows = (await this.repo.query({ observation_id })) ?? [];
    for (const row of rows) {
      await this.repo.delete({ observation_id: row.observation_id, title_index: row.title_index });
    }
  }
}
