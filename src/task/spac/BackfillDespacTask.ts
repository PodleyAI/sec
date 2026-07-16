/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";

export type BackfillDespacTaskInput = {
  readonly dryRun: boolean;
};

export type BackfillDespacTaskOutput = {
  readonly selected: number;
  readonly updated: number;
};

/**
 * Re-runs de-SPAC linkage over every completed SPAC from now-current entity
 * metadata (idempotent; fills the still-null post_merger_* slots). The
 * item-2.01 8-K that closes a combination is usually processed BEFORE the
 * surviving entity's renamed submissions land, so those slots start null.
 */
export class BackfillDespacTask extends Task<BackfillDespacTaskInput, BackfillDespacTaskOutput> {
  static readonly type = "BackfillDespacTask";
  static readonly category = "SEC";
  static readonly title = "Backfill de-SPAC linkage";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      dryRun: Type.Boolean(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      selected: Type.Number(),
      updated: Type.Number(),
    });
  }

  async execute(input: BackfillDespacTaskInput): Promise<BackfillDespacTaskOutput> {
    const repo = new SpacRepo();
    const completed = (await repo.getAllSpacs()).filter((s) => s.status === "completed");
    let updated = 0;
    if (!input.dryRun) {
      const writer = new SpacReportWriter();
      for (const s of completed) {
        const before = JSON.stringify([s.surviving_name, s.post_merger_sic, s.post_merger_tickers]);
        await writer.recordDeSpacLinkage({
          cik: s.cik,
          accession_number: "despac-refresh",
          // Anchor at the row's own as_of so the refresh is not treated as a
          // stale write and can apply the entity-sourced values.
          filing_date: s.as_of ?? s.completed_date ?? "",
          form: "8-K",
        });
        const after = await repo.getSpac(s.cik);
        const now = after
          ? JSON.stringify([after.surviving_name, after.post_merger_sic, after.post_merger_tickers])
          : before;
        if (now !== before) updated++;
      }
    }
    return { selected: completed.length, updated };
  }
}
