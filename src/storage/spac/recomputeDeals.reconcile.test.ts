/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import type { SpacDeal } from "./SpacDealSchema";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";

/** A stale orphan deal row carrying a redemption amount, as a prior larger derivation would leave. */
const orphanDeal = (cik: number, deal_index: number): SpacDeal => ({
  cik,
  deal_index,
  target_name: null,
  target_cik: null,
  announced_date: null,
  definitive_agreement_date: null,
  proxy_date: null,
  vote_date: null,
  pipe_amount: null,
  redemption_amount: 999_999,
  redemption_shares: 1,
  outcome: "completed",
  outcome_date: "2026-09-09",
  source_accession: "orphan",
  created_at: "2026-01-01T00:00:00.000Z",
});

describe("recomputeAndSaveDeals reconciliation", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("deletes deal rows no longer in the derived set so the rollup drops their amounts", async () => {
    const cik = 555;
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Reconcile SPAC Inc.",
      spac_sic: 6770,
    });
    // A two-event stream derives exactly one deal (deal_index 0).
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-da`,
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [
        { event_type: "definitive_agreement", event_date: "2026-01-10" },
        { event_type: "completed", event_date: "2026-03-20" },
      ],
    });
    const repo = new SpacRepo();
    expect((await repo.getDeals(cik)).map((d) => d.deal_index)).toEqual([0]);

    // Inject a stale orphan (deal_index 1) as a prior, larger derivation would have left.
    await repo.saveDeal(orphanDeal(cik, 1));
    expect((await repo.getDeals(cik)).length).toBe(2);

    // Any recompute must reconcile away the orphan. recordRedemption appends no
    // event — it only recomputes deals + rebuilds the row.
    await writer.recordRedemption({
      cik,
      accession_number: `${cik}-redemption`,
      filing_date: "2026-03-21",
      form: "8-K",
    });

    const after = await repo.getDeals(cik);
    expect(after.map((d) => d.deal_index)).toEqual([0]);
    // The orphan's 999,999 is no longer summed into the rollup.
    const spac = await repo.getSpac(cik);
    expect(spac).toBeDefined();
    expect(spac?.total_redemption_amount ?? null).toBeNull();
  });
});
