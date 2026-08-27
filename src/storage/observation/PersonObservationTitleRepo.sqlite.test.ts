/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { PersonObservationTitleRepo } from "./PersonObservationTitleRepo";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "./PersonObservationTitleSchema";

/** Mirrors `MAX_IDS_PER_QUERY` in the repo — kept local so a drift is visible. */
const CHUNK = 900;

/**
 * `listForObservations` used to fan out into one `ITabularStorage.query` per
 * observation id. On a real database that is an N+1 for every caller joining
 * titles onto a page of person observations, so these tests pin BOTH the
 * grouped result and the query count — against a real SQLite backend, since
 * the in-memory storage cannot show that the `in` criterion reaches SQL.
 */
describe("PersonObservationTitleRepo.listForObservations (sqlite)", () => {
  withSqliteDb("person_observation_titles_sqlite_test", [
    PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  ]);

  it("groups titles by observation in a single query", async () => {
    const repo = new PersonObservationTitleRepo();
    await repo.replaceForObservation(1, ["Director", "Chief Executive Officer"]);
    await repo.replaceForObservation(2, ["Promoter"]);

    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    const byId = await repo.listForObservations([1, 2, 3, 1]);

    expect(byId.get(1)).toEqual(["Chief Executive Officer", "Director"]);
    expect(byId.get(2)).toEqual(["Promoter"]);
    // An id with no title rows still gets an entry — Form D lists some related
    // persons by relationship alone, and those people must not be dropped.
    expect(byId.get(3)).toEqual([]);
    // The old implementation issued one query per distinct id; three, here.
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it("splits an id list longer than the bind-parameter bound into chunked queries", async () => {
    // SQLite renders an `in` list as one bind parameter per value, so a list
    // past SQLITE_MAX_VARIABLE_NUMBER has to be split. The installed engine
    // caps at 32766, so only the query count can hold this in place — a result
    // assertion would pass just as well with the chunking removed.
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const chunks = 3;
    const remainder = 300;
    const total = CHUNK * (chunks - 1) + remainder;
    const ids = Array.from({ length: total }, (_, i) => i + 1);
    await storage.putBulk(
      ids.map((observation_id) => ({ observation_id, title: `Title ${observation_id}` }))
    );

    const querySpy = vi.spyOn(storage, "query");
    const byId = await new PersonObservationTitleRepo().listForObservations(ids);

    expect(querySpy).toHaveBeenCalledTimes(chunks);
    // No single query may carry more ids than the bound, whatever the engine
    // would have tolerated.
    for (const [criteria] of querySpy.mock.calls) {
      const criterion = (criteria as { observation_id: { readonly value: readonly number[] } })
        .observation_id;
      expect(criterion.value.length).toBeLessThanOrEqual(CHUNK);
    }

    expect(byId.size).toBe(total);
    // One id from each of the three chunks.
    expect(byId.get(1)).toEqual(["Title 1"]);
    expect(byId.get(CHUNK + 1)).toEqual([`Title ${CHUNK + 1}`]);
    expect(byId.get(total)).toEqual([`Title ${total}`]);
  });

  it("returns an empty map for an empty id list without touching the database", async () => {
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    expect(await new PersonObservationTitleRepo().listForObservations([])).toEqual(new Map());
    expect(querySpy).not.toHaveBeenCalled();
  });
});
