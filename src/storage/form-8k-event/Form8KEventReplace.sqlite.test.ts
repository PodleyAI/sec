/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { SEC_DRY_RUN } from "../../config/tokens";
import { getDb } from "../../util/db";
import { Form8KEventRepo } from "./Form8KEventRepo";
import { FORM_8K_EVENT_REPOSITORY_TOKEN } from "./Form8KEventSchema";

const TEST_DB_NAME = "form8k_replace_sqlite_test";

/**
 * Verifies that the SQLite transaction wrapping in `replaceEvents` rolls
 * back as a unit. We do that by re-running `replaceEvents` with one event
 * whose `item_code` is `null` — the NOT NULL constraint on the column
 * fails INSIDE the transaction (after the DELETE has run), and the
 * transaction wrapper rolls everything back so the prior rows are intact.
 */
describe("replaceEvents (sqlite) transactional rollback", () => {
  withSqliteDb(TEST_DB_NAME, [FORM_8K_EVENT_REPOSITORY_TOKEN]);

  it("rolls back the DELETE when a later INSERT fails inside the transaction", async () => {
    const repo = new Form8KEventRepo();
    // Seed: one valid row.
    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        extractor_id: "8-K",
        extractor_version: "1.0.0",
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);

    // Now attempt to replace with two rows where the second has
    // `item_code: null` (violates NOT NULL). The DELETE runs first, then
    // the first INSERT succeeds, then the second INSERT fails — the
    // transaction wrapper rolls every step back.
    await expect(
      repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
        {
          cik: 320193,
          accession_number: "0001193125-24-000001",
          extractor_id: "8-K",
          extractor_version: "1.0.0",
          item_code: "2.02",
          item_description: null,
          filing_date: "2024-01-15",
          report_date: null,
          is_amendment: false,
        },
        {
          cik: 320193,
          accession_number: "0001193125-24-000001",
          extractor_id: "8-K",
          extractor_version: "1.0.0",
          // @ts-expect-error – we are intentionally injecting a NOT NULL violation
          item_code: null,
          item_description: null,
          filing_date: "2024-01-15",
          report_date: null,
          is_amendment: false,
        },
      ])
    ).rejects.toThrow();

    // After rollback the original "1.01" row is still there.
    const after = await repo.getEventsByAccession(320193, "0001193125-24-000001", "8-K", "1.0.0");
    expect(after.length).toBe(1);
    expect(after[0].item_code).toBe("1.01");

    // And the partial "2.02" insert (which ran before the failing one)
    // is also rolled back — the table has the v1 baseline, not a mixed
    // pre-existing-plus-half-new state.
    const db = getDb();
    const all = db
      .prepare<[], { item_code: string }>(
        `SELECT item_code FROM form_8k_events WHERE cik = ? AND accession_number = ?`
      )
      .all(320193, "0001193125-24-000001");
    expect(all.map((r) => r.item_code).sort()).toEqual(["1.01"]);
  });

  it("writes nothing to the database under --dry-run", async () => {
    // Dry run is enforced by wrapping each storage in ReadOnlyTabularStorage,
    // whose writes no-op. The raw-SQL path bypasses that wrapper, so without a
    // dry-run guard in the backend dispatch this INSERT commits for real.
    //
    // Order matters and mirrors the CLI: the preAction hook sets SEC_DRY_RUN
    // before DefaultDI builds the storages, which is what makes createStorage
    // wrap them. Re-run DefaultDI here for the same reason.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    DefaultDI();

    await new Form8KEventRepo().replaceEvents(320193, "0001193125-24-000002", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000002",
        extractor_id: "8-K",
        extractor_version: "1.0.0",
        item_code: "5.07",
        item_description: null,
        filing_date: "2024-02-01",
        report_date: null,
        is_amendment: false,
      },
    ]);

    const rows = getDb()
      .prepare<[string], { item_code: string }>(
        `SELECT item_code FROM form_8k_events WHERE accession_number = ?`
      )
      .all("0001193125-24-000002");
    expect(rows).toEqual([]);
  });
});
