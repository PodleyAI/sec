/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  type PersonObservationTitle,
  type PersonObservationTitleRepositoryStorage,
} from "./PersonObservationTitleSchema";

/**
 * Serialises whole-list replacement per observation. Single-process only —
 * same caveat as the junction repos' lock.
 */
const titleLocks = new KeyedMutex<number>();

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
   * case-insensitively de-duplicated, clamped to the column width). A
   * per-title diff, not a wholesale rewrite: a title is keyed by its text, so
   * an already-stored title is untouched (a reordered replay is a no-op) and
   * only titles the new list no longer asserts are deleted. Source order is
   * not stored — it carries no meaning across filings.
   */
  async replaceForObservation(
    observation_id: number,
    titles: readonly string[]
  ): Promise<PersonObservationTitle[]> {
    const seen = new Set<string>();
    const rows: PersonObservationTitle[] = [];
    for (const raw of titles) {
      const title = raw.trim().slice(0, 256);
      if (title === "") continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ observation_id, title });
    }
    return titleLocks.lock(observation_id, async () => {
      const existing = (await this.repo.query({ observation_id })) ?? [];
      const incoming = new Set(rows.map((r) => r.title));
      for (const ex of existing) {
        if (!incoming.has(ex.title)) {
          await this.repo.delete({ observation_id, title: ex.title });
        }
      }
      const existingTitles = new Set(existing.map((r) => r.title));
      const added = rows.filter((r) => !existingTitles.has(r.title));
      if (added.length > 0) await this.repo.putBulk(added);
      return rows;
    });
  }

  /** The observation's titles, sorted by title text for deterministic output. */
  async listForObservation(observation_id: number): Promise<string[]> {
    const rows = (await this.repo.query({ observation_id })) ?? [];
    return rows.map((r) => r.title).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Titles for many observations at once, keyed by observation id. */
  async listForObservations(observation_ids: readonly number[]): Promise<Map<number, string[]>> {
    const distinct = [...new Set(observation_ids)];
    const lists = await Promise.all(distinct.map((id) => this.listForObservation(id)));
    return new Map(distinct.map((id, i) => [id, lists[i]]));
  }

  async deleteForObservation(observation_id: number): Promise<void> {
    await titleLocks.lock(observation_id, async () => {
      await this.repo.deleteSearch({ observation_id });
    });
  }
}
