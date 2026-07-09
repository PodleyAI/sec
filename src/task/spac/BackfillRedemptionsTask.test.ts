/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import {
  BackfillRedemptionsTask,
  selectRedemptionBackfillAccessions,
  selectRedemptionBackfillCandidates,
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

async function seedSuccessfulRun(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
}): Promise<void> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await runRepo.recordRun({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    extractor_id: "redemption",
    extractor_version: "1.0.0",
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

describe("selectRedemptionBackfillCandidates", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  async function seedFixture(): Promise<void> {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-trigger", form: "8-K", items: "5.07" });
    await seedFiling({
      cik: 5,
      accession_number: "acc-trigger-amend",
      form: "8-K/A",
      items: "2.01",
    });
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

  it("returns (cik, accession) pairs in the candidate form", async () => {
    await seedFixture();

    const candidates = await selectRedemptionBackfillCandidates();
    const accessions = candidates.map((c) => c.accession_number);
    expect(accessions).toContain("acc-trigger");
    expect(accessions).toContain("acc-trigger-amend");
    for (const c of candidates) {
      expect(c.cik).toBe(5);
    }
  });

  it("dry-run reports the selected count without reprocessing or skipping", async () => {
    await seedFixture();

    const out = await new BackfillRedemptionsTask().run({ dryRun: true } as any);
    expect(out.selected).toBe(2);
    expect(out.processed).toBe(0);
    expect(out.skipped).toBe(0);
  });

  it("aggregates candidates across multiple SPACs in two bulk filing queries", async () => {
    // Two SPACs each with one trigger 8-K plus a non-trigger 8-K; the bulk-query
    // path must still filter correctly.
    await seedSpac(5);
    await seedSpac(7);
    await seedFiling({ cik: 5, accession_number: "acc-5a", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-5b", form: "8-K", items: "2.02" });
    await seedFiling({ cik: 7, accession_number: "acc-7a", form: "8-K/A", items: "2.01" });
    await seedFiling({ cik: 7, accession_number: "acc-7b", form: "8-K", items: "9.01" });

    const candidates = await selectRedemptionBackfillCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions.has("acc-5a")).toBe(true);
    expect(accessions.has("acc-7a")).toBe(true);
    expect(accessions.has("acc-5b")).toBe(false);
    expect(accessions.has("acc-7b")).toBe(false);
  });
});

describe("BackfillRedemptionsTask.execute idempotency", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("skips candidates that already have a successful run at the active version", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-todo", form: "8-K", items: "5.07" });
    // One is already extracted; the other is not.
    await seedSuccessfulRun({ cik: 5, accession_number: "acc-done", form: "8-K" });

    // No network: subclass that does nothing in execute() — we just want to
    // verify the skip predicate, not the reprocessing semantics.
    class CountingBackfill extends BackfillRedemptionsTask {
      public processedAccessions: string[] = [];
      override async execute(input: any, context: any) {
        const candidates = await selectRedemptionBackfillCandidates();
        const runRepo = new ExtractorRunRepo(
          globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
        );
        let processed = 0;
        let skipped = 0;
        for (const c of candidates) {
          if (!input.force) {
            const already = await runRepo.hasSuccessfulRun(
              c.cik,
              c.accession_number,
              "redemption",
              "1.0.0"
            );
            if (already) {
              skipped++;
              continue;
            }
          }
          this.processedAccessions.push(c.accession_number);
          processed++;
        }
        return { selected: candidates.length, processed, skipped };
      }
    }

    const task = new CountingBackfill();
    const out = await task.run({ force: false } as any);
    expect(out.selected).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.processed).toBe(1);
    expect(task.processedAccessions).toEqual(["acc-todo"]);
  });

  it("force=true reprocesses even rows that already have a successful run", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "8-K", items: "5.07" });
    await seedSuccessfulRun({ cik: 5, accession_number: "acc-done", form: "8-K" });

    class CountingBackfill extends BackfillRedemptionsTask {
      public processedAccessions: string[] = [];
      override async execute(input: any, _context: any) {
        const candidates = await selectRedemptionBackfillCandidates();
        const runRepo = new ExtractorRunRepo(
          globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
        );
        let processed = 0;
        let skipped = 0;
        for (const c of candidates) {
          if (!input.force) {
            const already = await runRepo.hasSuccessfulRun(
              c.cik,
              c.accession_number,
              "redemption",
              "1.0.0"
            );
            if (already) {
              skipped++;
              continue;
            }
          }
          this.processedAccessions.push(c.accession_number);
          processed++;
        }
        return { selected: candidates.length, processed, skipped };
      }
    }

    const task = new CountingBackfill();
    const out = await task.run({ force: true } as any);
    expect(out.selected).toBe(1);
    expect(out.skipped).toBe(0);
    expect(out.processed).toBe(1);
    expect(task.processedAccessions).toEqual(["acc-done"]);
  });
});
