/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, TaskAbortedError } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { SpacLoiExtractionRepo } from "../../storage/spac/SpacLoiExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { registerBackfillDescriptor, spacTrigger8KDescriptor } from "./backfillDescriptors";
import { BackfillExtractorTask, runExtractorBackfill } from "./BackfillExtractorTask";

// The redemption and LOI passes run inside another extractor's `store` and are
// supplied by the package that ships the 8-K narrative reading, so nothing
// registers their descriptors here. Registering them locally is what keeps
// their selection and needing-work predicates — which read tables this package
// owns — under test rather than unreachable.
registerBackfillDescriptor(
  spacTrigger8KDescriptor(
    "redemption",
    "redemption",
    hasRedemptionTriggerItem,
    async (accession_number) =>
      (await new SpacRedemptionExtractionRepo().getByAccession(accession_number)) !== undefined
  )
);
registerBackfillDescriptor(
  spacTrigger8KDescriptor(
    "loi",
    "loi",
    hasLoiTriggerItem,
    async (accession_number) =>
      (await new SpacLoiExtractionRepo().getByAccession(accession_number)) !== undefined
  )
);

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
  readonly items?: string;
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
    items: opts.items ?? null,
    act: null,
  } as never);
}

async function seedSuccessfulRun(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly extractor_id: string;
}): Promise<void> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await runRepo.recordRun({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    extractor_id: opts.extractor_id,
    extractor_version: "1.0.0",
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

describe("runExtractorBackfill", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("throws with the backfillable ids for an unknown extractor", async () => {
    await expect(
      runExtractorBackfill({
        extractorId: "nope",
        force: false,
        dryRun: true,
        processFiling: async () => {},
      })
    ).rejects.toThrow(/No backfill wiring for extractor 'nope'.*redemption/);
  });

  it("skips candidates that already have a successful run at the active version", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-todo", form: "8-K", items: "5.07" });
    await seedSuccessfulRun({
      cik: 5,
      accession_number: "acc-done",
      form: "8-K",
      extractor_id: "redemption",
    });

    const processedAccessions: string[] = [];
    const out = await runExtractorBackfill({
      extractorId: "redemption",
      force: false,
      dryRun: false,
      processFiling: async (a) => {
        processedAccessions.push(a);
      },
    });
    expect(out).toEqual({ selected: 2, processed: 1, skipped: 1 });
    expect(processedAccessions).toEqual(["acc-todo"]);
  });

  it("force=true reprocesses even rows that already have a successful run", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "8-K", items: "5.07" });
    await seedSuccessfulRun({
      cik: 5,
      accession_number: "acc-done",
      form: "8-K",
      extractor_id: "redemption",
    });

    const processedAccessions: string[] = [];
    const out = await runExtractorBackfill({
      extractorId: "redemption",
      force: true,
      dryRun: false,
      processFiling: async (a) => {
        processedAccessions.push(a);
      },
    });
    expect(out).toEqual({ selected: 1, processed: 1, skipped: 0 });
    expect(processedAccessions).toEqual(["acc-done"]);
  });

  it("dry-run reports selected/skipped without reprocessing", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "8-K", items: "8.01" });
    await seedFiling({ cik: 5, accession_number: "acc-todo", form: "8-K", items: "7.01" });
    await seedSuccessfulRun({
      cik: 5,
      accession_number: "acc-done",
      form: "8-K",
      extractor_id: "loi",
    });

    const processedAccessions: string[] = [];
    const out = await runExtractorBackfill({
      extractorId: "loi",
      force: false,
      dryRun: true,
      processFiling: async (a) => {
        processedAccessions.push(a);
      },
    });
    expect(out).toEqual({ selected: 2, processed: 0, skipped: 1 });
    expect(processedAccessions).toEqual([]);
  });

  it("isolates per-filing failures and keeps sweeping", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-bad", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-good", form: "8-K", items: "5.07" });

    const processedAccessions: string[] = [];
    const out = await runExtractorBackfill({
      extractorId: "redemption",
      force: false,
      dryRun: false,
      processFiling: async (a) => {
        if (a === "acc-bad") throw new Error("fetch failed");
        processedAccessions.push(a);
      },
    });
    expect(out.selected).toBe(2);
    expect(out.processed).toBe(1);
    expect(processedAccessions).toEqual(["acc-good"]);
  });

  it("rethrows TaskAbortedError and processes nothing when the signal is aborted", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-1", form: "8-K", items: "5.07" });

    const controller = new AbortController();
    controller.abort();
    const processedAccessions: string[] = [];
    await expect(
      runExtractorBackfill({
        extractorId: "redemption",
        force: false,
        dryRun: false,
        signal: controller.signal,
        processFiling: async (a) => {
          processedAccessions.push(a);
        },
      })
    ).rejects.toThrow(TaskAbortedError);
    expect(processedAccessions).toEqual([]);
  });
});

describe("BackfillExtractorTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("dry-run reports the selected count through the task wrapper", async () => {
    await seedSpac(82);
    await seedFiling({ cik: 82, accession_number: "acc-dry", form: "8-K", items: "7.01" });

    const out = await new BackfillExtractorTask().execute({ extractorId: "loi", dryRun: true }, {
      signal: undefined,
      own: (x: unknown) => x,
      disown: () => {},
      updateProgress: async () => {},
    } as never);
    expect(out).toEqual({ selected: 1, processed: 0, skipped: 0 });
  });

  it("releases each filing's owned workflow instead of retaining the whole sweep", async () => {
    await seedSpac(83);
    for (let i = 0; i < 5; i++) {
      await seedFiling({ cik: 83, accession_number: `acc-own-${i}`, form: "8-K", items: "7.01" });
    }

    const task = new BackfillExtractorTask();
    // A post-run count alone cannot tell "held all five, then dropped them"
    // from "never held more than one", so sample the live count as each
    // wrapper is added. ProcessAccessionDocFormTask throws "Filing not found"
    // for the seeded-metadata-only filings — the sweep isolates that per
    // filing, and the ownership churn still happens without any network.
    let peak = 0;
    task.subGraph.on("task_added", () => {
      peak = Math.max(peak, task.subGraph.getTasks().length);
    });

    await task.run({ extractorId: "loi" } as never);
    expect(peak).toBe(1);
    expect(task.subGraph.getTasks()).toHaveLength(0);
  });
});
