/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import { readTitlesForObservations } from "./personObservationTitleBulkReader";
import {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  PersonObservationTitleTable,
  type PersonObservationTitle,
  type PersonObservationTitleRepositoryStorage,
} from "./PersonObservationTitleSchema";

/** Deterministic output order; titles carry no meaningful source order. */
function byTitle(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

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
    return rows.map((r) => r.title).sort(byTitle);
  }

  /**
   * Titles for many observations at once, keyed by observation id — one round
   * trip on a real database rather than one query per id (see
   * {@link readTitlesForObservations}). Every requested id gets an entry, empty
   * when the observation has no title rows.
   */
  async listForObservations(observation_ids: readonly number[]): Promise<Map<number, string[]>> {
    const distinct = [...new Set(observation_ids)];
    const byId = new Map<number, string[]>(distinct.map((id) => [id, []]));
    for (const row of await readTitlesForObservations(this.repo, distinct)) {
      const titles = byId.get(row.observation_id);
      // The map is keyed by JS number. A backend handing `observation_id` back
      // as a string or BigInt (a widened column read through node-postgres, a
      // safe-integers SQLite handle, a proxied storage) would miss every key,
      // so raise instead of silently reporting every person as title-less.
      if (titles === undefined) {
        throw new Error(
          `${PersonObservationTitleTable} returned observation_id ` +
            `${JSON.stringify(row.observation_id)} (${typeof row.observation_id}), ` +
            `which was not among the ${distinct.length} requested id(s) — backend id-type mismatch?`
        );
      }
      titles.push(row.title);
    }
    for (const titles of byId.values()) titles.sort(byTitle);
    return byId;
  }

  async deleteForObservation(observation_id: number): Promise<void> {
    await titleLocks.lock(observation_id, async () => {
      await this.repo.deleteSearch({ observation_id });
    });
  }
}
