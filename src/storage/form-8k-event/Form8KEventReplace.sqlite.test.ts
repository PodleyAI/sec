/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, Sqlite } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { closeDb, getDb } from "../../util/db";
import { Form8KEventRepo } from "./Form8KEventRepo";

const TEST_DB_NAME = "form8k_replace_sqlite_test";

/**
 * Verifies that the SQLite transaction wrapping in `replaceEvents` rolls
 * back as a unit. We do that by re-running `replaceEvents` with one event
 * whose `item_code` is `null` — the NOT NULL constraint on the column
 * fails INSIDE the transaction (after the DELETE has run), and the
 * transaction wrapper rolls everything back so the prior rows are intact.
 */
describe("replaceEvents (sqlite) transactional rollback", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-form8k-replace-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
    DefaultDI();
    await setupAllDatabases();
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

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
      .prepare<
        [],
        { item_code: string }
      >(`SELECT item_code FROM form_8k_events WHERE cik = ? AND accession_number = ?`)
      .all(320193, "0001193125-24-000001");
    expect(all.map((r) => r.item_code).sort()).toEqual(["1.01"]);
  });
});
