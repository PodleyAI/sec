/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { selectSubmissionsToRefresh } from "./UpdateAllSubmissionsTask";

/**
 * `UpdateAllSubmissionsTask` reads the whole watermark table, and it has to do
 * that with `getAll()` — the tabular backend REJECTS an empty criteria object
 * with "Query criteria must not be empty. Use getAll() to retrieve all
 * records."
 *
 * The task used `query({}, { orderBy })`, which throws unconditionally: it is
 * the criteria that is rejected, not the result, so the command could never
 * complete and neither could the `sync` pipeline that runs it third. It hid for
 * a long time because every database anyone ran it against had an EMPTY
 * `cik_last_update`, which made a hard failure look like "nothing to do".
 * `UpdateAllCompanyFactsTask` already used `getAll()`; the two siblings had
 * drifted apart on the one call that matters.
 *
 * This asserts the backend contract directly rather than mocking it, so it
 * fails if the read is ever written back as `query({})` — in either sibling.
 */
describe("watermark reads use getAll, not query({})", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("rejects an empty criteria object", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await repo.put({ cik: 320193, last_update: "2026-08-14" });

    // This is the call the task used to make. If a future backend starts
    // accepting it, this test fails loudly and the comments explaining why
    // getAll() is mandatory can come out.
    await expect(
      repo.query({} as never, { orderBy: [{ column: "last_update", direction: "DESC" }] })
    ).rejects.toThrow(/criteria must not be empty/i);
  });

  it("returns every row through getAll, ordered", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await repo.put({ cik: 1, last_update: "2026-07-01" });
    await repo.put({ cik: 2, last_update: "2026-08-14" });
    await repo.put({ cik: 3, last_update: "2026-07-20" });

    const rows =
      (await repo.getAll({ orderBy: [{ column: "last_update", direction: "DESC" }] })) ?? [];

    expect(rows).toHaveLength(3);
    expect(rows[0].last_update).toBe("2026-08-14");
  });
});

/**
 * The freshness rule the task applies once it has the rows, driven through the
 * production `selectSubmissionsToRefresh` — the same function `execute` and its
 * dry-run report both call, so the two can never disagree about what a run
 * would do.
 */
describe("submission refresh selection", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects a CIK whose filing date has moved past its processing date", async () => {
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const procRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    // moved:     EDGAR published after we last processed  → refetch
    // unmoved:   processed after the newest filing        → skip
    // brand new: no processed row at all                  → initial fetch
    await cikRepo.put({ cik: 100, last_update: "2026-08-14" });
    await procRepo.put({ cik: 100, last_processed: "2026-08-01", success: true });
    await cikRepo.put({ cik: 200, last_update: "2026-07-31" });
    await procRepo.put({ cik: 200, last_processed: "2026-08-15", success: true });
    await cikRepo.put({ cik: 300, last_update: "2026-08-10" });

    const { needsUpdating, needsInitialProcessing } = await selectSubmissionsToRefresh(false);

    expect(needsUpdating.map((c) => c.cik)).toEqual([100]);
    expect(needsInitialProcessing.map((c) => c.cik)).toEqual([300]);
  });

  it("does not select a CIK whose processing date EQUALS its watermark", async () => {
    // The comparison is `>`, not `>=`. At `>=` every CIK processed on the same
    // day its newest filing was published would be re-fetched on every run,
    // forever.
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const procRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    await cikRepo.put({ cik: 100, last_update: "2026-08-14" });
    await procRepo.put({ cik: 100, last_processed: "2026-08-14", success: true });

    const { needsUpdating, needsInitialProcessing } = await selectSubmissionsToRefresh(false);

    expect(needsUpdating).toHaveLength(0);
    expect(needsInitialProcessing).toHaveLength(0);
  });

  it("selects every watermark row under force, and nothing as initial processing", async () => {
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const procRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    await cikRepo.put({ cik: 100, last_update: "2026-08-14" });
    await procRepo.put({ cik: 100, last_processed: "2026-08-15", success: true });
    await cikRepo.put({ cik: 300, last_update: "2026-08-10" });

    const { needsUpdating, needsInitialProcessing } = await selectSubmissionsToRefresh(true);

    expect(needsUpdating.map((c) => c.cik).sort()).toEqual([100, 300]);
    expect(needsInitialProcessing).toHaveLength(0);
  });

  it("treats a CIK with no processed row as initial processing, not an update", async () => {
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await cikRepo.put({ cik: 300, last_update: "2026-08-10" });

    const { needsUpdating, needsInitialProcessing } = await selectSubmissionsToRefresh(false);

    expect(needsUpdating).toHaveLength(0);
    expect(needsInitialProcessing.map((c) => c.cik)).toEqual([300]);
  });
});
