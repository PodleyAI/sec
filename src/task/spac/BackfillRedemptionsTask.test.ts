/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import {
  BackfillRedemptionsTask,
  selectRedemptionBackfillAccessions,
} from "./BackfillRedemptionsTask";

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2025-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Backfill SPAC Inc.",
    spac_sic: 6770,
  });
}

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly items: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-19",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items,
    act: null,
  } as never);
}

describe("selectRedemptionBackfillAccessions", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  async function seedFixture(): Promise<void> {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-trigger", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-trigger-amend", form: "8-K/A", items: "2.01" });
    await seedFiling({ cik: 5, accession_number: "acc-2.02", form: "8-K", items: "2.02" });
    await seedFiling({ cik: 5, accession_number: "acc-10k", form: "10-K", items: "5.07" });
    // Non-SPAC cik: trigger-item 8-K, but no spac row.
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "8-K", items: "5.07" });
  }

  it("selects known-SPAC trigger-item 8-Ks (incl. 8-K/A) only", async () => {
    await seedFixture();

    const accessions = await selectRedemptionBackfillAccessions();
    expect(accessions).toContain("acc-trigger");
    expect(accessions).toContain("acc-trigger-amend");
    expect(accessions).not.toContain("acc-2.02");
    expect(accessions).not.toContain("acc-10k");
    expect(accessions).not.toContain("acc-nonspac");
  });

  it("dry-run reports the selected count without reprocessing", async () => {
    await seedFixture();

    const out = await new BackfillRedemptionsTask().run({ dryRun: true } as any);
    expect(out.selected).toBe(2);
    expect(out.processed).toBe(0);
  });
});
