/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../../storage/classification/S1ClassificationSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../storage/spac/SpacCandidateSchema";
import { IdentifySpacsTask } from "./IdentifySpacsTask";

const ctx = {
  signal: new AbortController().signal,
  updateProgress: () => {},
} as unknown as IExecuteContext;

/**
 * `prune` now selects the reprocessed CIKs with a `>=` range query over
 * `processed_submissions.last_processed` instead of an `in`-list over the
 * candidate table. `last_processed` is a plain `YYYY-MM-DD` TEXT column, so the
 * comparison must mean the same thing on a real SQLite backend as it does on the
 * in-memory repository the rest of the suite uses — a looser or stricter
 * comparison here would over- or under-delete candidate rows.
 */
describe("IdentifySpacsTask pruning (sqlite)", () => {
  withSqliteDb("identify_spacs_prune_sqlite_test", [
    ENTITY_REPOSITORY_TOKEN,
    ENTITY_HISTORY_REPOSITORY_TOKEN,
    FILING_REPOSITORY_TOKEN,
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
    S1_CLASSIFICATION_REPOSITORY_TOKEN,
    SPAC_CANDIDATE_REPOSITORY_TOKEN,
  ]);

  it("deletes only the rows whose CIK was reprocessed at or after the watermark", async () => {
    const candidates = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    const processed = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);
    const identified_at = "2026-08-01T00:00:00.000Z";
    // The watermark is the newest identified_at minus one day: 2026-07-31.
    const watermark = "2026-07-31";

    for (const cik of [1, 2, 3]) {
      await candidates.put({
        cik,
        name: `Gone Acquisition Corp ${cik}`,
        current_sic: 6770,
        signal_sic_6770: true,
        signal_filed_sic_6770: null,
        signal_name_match: true,
        signal_renamed_from: null,
        first_reg_form: null,
        first_reg_date: null,
        reg_while_spac_named: null,
        confidence: "low",
        identified_at,
      });
    }
    // 1: before the watermark — untouched, must survive.
    await processed.put({ cik: 1, last_processed: "2026-07-30", success: true });
    // 2: exactly on the watermark — `>=`, so it was reprocessed and is stale.
    await processed.put({ cik: 2, last_processed: watermark, success: true });
    // 3: after the watermark — stale.
    await processed.put({ cik: 3, last_processed: "2026-08-05", success: true });

    // None of these CIKs has an entity row, so the scan matches nothing and
    // every candidate is a pruning candidate; only the reprocessed ones go.
    const out = await new IdentifySpacsTask().execute({}, ctx);

    expect(out.since).toBe(watermark);
    expect(out.pruned).toBe(2);
    expect(((await candidates.getAll()) ?? []).map((r) => r.cik)).toEqual([1]);
  });
});
