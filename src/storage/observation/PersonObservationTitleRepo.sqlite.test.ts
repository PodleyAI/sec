/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { getDb } from "../../util/db";
import { SQLITE_MAX_IDS_PER_STATEMENT } from "./personObservationTitleBulkReader";
import { PersonObservationTitleRepo } from "./PersonObservationTitleRepo";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "./PersonObservationTitleSchema";

/**
 * `listForObservations` used to fan out into one `ITabularStorage.query` per
 * observation id. On a real database that is an N+1 for every caller joining
 * titles onto a page of person observations, so these tests pin BOTH the
 * grouped result and the fact that the storage abstraction is never consulted
 * per id — the read is an `IN`-list statement.
 */
describe("PersonObservationTitleRepo.listForObservations (sqlite)", () => {
  withSqliteDb("person_observation_titles_sqlite_test", [
    PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  ]);

  it("groups titles by observation without one query per id", async () => {
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
    // The old implementation issued one of these per distinct id.
    expect(querySpy).not.toHaveBeenCalled();
  });

  it("splits the id list into bind-parameter-bounded chunks", async () => {
    // Asserting on the SQL rather than on results: the installed SQLite caps a
    // statement at 32766 parameters, so an unchunked read of this list would
    // execute fine and every result assertion would still pass. The chunking
    // exists for builds that cap at 999, which this suite never runs against —
    // the statement shape is the only thing that can hold it in place.
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const chunks = 3;
    const remainder = 300;
    const total = SQLITE_MAX_IDS_PER_STATEMENT * (chunks - 1) + remainder;
    const ids = Array.from({ length: total }, (_, i) => i + 1);
    await storage.putBulk(
      ids.map((observation_id) => ({ observation_id, title: `Title ${observation_id}` }))
    );

    const prepareSpy = vi.spyOn(getDb(), "prepare");
    const byId = await new PersonObservationTitleRepo().listForObservations(ids);

    const sqls = prepareSpy.mock.calls.map((call) => String(call[0]));
    const widths = sqls.map((sql) => (sql.match(/\?/g) ?? []).length);
    // No statement may exceed the chunk size, whatever the engine would allow.
    for (const width of widths) expect(width).toBeLessThanOrEqual(SQLITE_MAX_IDS_PER_STATEMENT);
    // Two full chunks share one prepared statement; the short tail needs its own.
    expect(widths).toEqual([SQLITE_MAX_IDS_PER_STATEMENT, remainder]);

    expect(byId.size).toBe(total);
    // One id from each of the three chunks.
    expect(byId.get(1)).toEqual(["Title 1"]);
    expect(byId.get(SQLITE_MAX_IDS_PER_STATEMENT + 1)).toEqual([
      `Title ${SQLITE_MAX_IDS_PER_STATEMENT + 1}`,
    ]);
    expect(byId.get(total)).toEqual([`Title ${total}`]);
  });

  it("returns an empty map for an empty id list without touching the database", async () => {
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    expect(await new PersonObservationTitleRepo().listForObservations([])).toEqual(new Map());
    expect(querySpy).not.toHaveBeenCalled();
  });
});
