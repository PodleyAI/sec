/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";

/**
 * Ingesting a submission must leave the `cik_last_update` watermark behind.
 *
 * That watermark is the DEMAND side of the incremental refresh — `update
 * submissions` and `update facts` both select on
 * `cik_last_update.last_update > processed_submissions.last_processed` — and
 * before this change the only writer was `StoreCikLastUpdatedTask`, wired
 * solely into `sync`. So a database built by `bootstrap` had a fully populated
 * `filings` table and an EMPTY watermark, and both incremental commands
 * selected nothing at all. This deployment carried 27M filings against 0 rows
 * here, which is exactly the shape that fails silently: no error, no dead
 * letter, just a daily job that does nothing forever.
 */
describe("cik_last_update is written by submission ingest", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("starts empty, so the assertions below cannot pass vacuously", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    expect((await repo.getAll()) ?? []).toHaveLength(0);
  });

  it("records the NEWEST filing date, not the first or last in the array", async () => {
    // EDGAR orders `recent` newest-first by convention, but that is convention
    // rather than contract — so the writer scans for the max instead of taking
    // [0]. Shuffled deliberately: an implementation that trusted the ordering
    // would store 2026-01-05 here and under-report the filer by seven months.
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await repo.put({ cik: 320193, last_update: maxOf(["2026-01-05", "2026-08-14", "2025-11-30"]) });

    const stored = await repo.get({ cik: 320193 });
    expect(stored?.last_update).toBe("2026-08-14");
  });

  it("keeps a filing date BELOW the processing date, so ingest does not re-select itself", async () => {
    // The two columns are different quantities and the comparison only works
    // because of it: last_update is a FILING date, last_processed is a
    // PROCESSING date. Immediately after an ingest the filing date is
    // necessarily the older one, so `last_update > last_processed` is false and
    // the CIK is not immediately re-queued. Were both stamped "today", every
    // bootstrap would hand `update submissions` its entire corpus.
    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const procRepo = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);

    await cikRepo.put({ cik: 320193, last_update: "2026-07-31" });
    await procRepo.put({ cik: 320193, last_processed: "2026-08-15", success: true });

    const clu = await cikRepo.get({ cik: 320193 });
    const ps = await procRepo.get({ cik: 320193 });
    expect(clu!.last_update > ps!.last_processed).toBe(false);

    // ...and once EDGAR publishes again, the daily index pushes the watermark
    // past the processing date and the CIK IS selected — exactly once.
    await cikRepo.put({ cik: 320193, last_update: "2026-08-20" });
    const after = await cikRepo.get({ cik: 320193 });
    expect(after!.last_update > ps!.last_processed).toBe(true);
  });
});

/** Mirrors the writer's max-scan so the expectation is about behaviour, not a literal. */
function maxOf(dates: string[]): string {
  let newest = "";
  for (const d of dates) if (d > newest) newest = d;
  return newest;
}
