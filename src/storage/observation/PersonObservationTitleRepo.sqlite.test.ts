/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, Sqlite } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { closeDb } from "../../util/db";
import { PersonObservationTitleRepo } from "./PersonObservationTitleRepo";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "./PersonObservationTitleSchema";

const TEST_DB_NAME = "person_observation_titles_sqlite_test";

/**
 * `listForObservations` used to fan out into one `ITabularStorage.query` per
 * observation id. On a real database that is an N+1 for every caller joining
 * titles onto a page of person observations, so these tests pin BOTH the
 * grouped result and the fact that the storage abstraction is never consulted
 * per id — the read is a single `IN`-list statement.
 */
describe("PersonObservationTitleRepo.listForObservations (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-obs-titles-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
    DefaultDI();
    await setupAllDatabases();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

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

  it("reads an id list longer than SQLite's bind-parameter cap", async () => {
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const ids = Array.from({ length: 2100 }, (_, i) => i + 1);
    await storage.putBulk(
      ids.map((observation_id) => ({ observation_id, title: `Title ${observation_id}` }))
    );

    const byId = await new PersonObservationTitleRepo().listForObservations(ids);

    expect(byId.size).toBe(ids.length);
    // One id from each chunk the reader has to split the list into.
    expect(byId.get(1)).toEqual(["Title 1"]);
    expect(byId.get(950)).toEqual(["Title 950"]);
    expect(byId.get(1801)).toEqual(["Title 1801"]);
    expect(byId.get(2100)).toEqual(["Title 2100"]);
  });

  it("returns an empty map for an empty id list without touching the database", async () => {
    const storage = globalServiceRegistry.get(PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN);
    const querySpy = vi.spyOn(storage, "query");

    expect(await new PersonObservationTitleRepo().listForObservations([])).toEqual(new Map());
    expect(querySpy).not.toHaveBeenCalled();
  });
});
