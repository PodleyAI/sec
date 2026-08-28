/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  type ExtractorRun,
} from "../../storage/versioning/ExtractorRunSchema";
import { FetchAndStoreFormsTask } from "./FetchAndStoreFormsTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1234567;
const ACC = "0001234567-26-000001";
const noopStore = async (): Promise<void> => {};

async function seedFiling(form: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: ACC,
    form,
    primary_doc: "doc.htm",
    file_number: "333-1",
    filing_date: "2026-01-02",
    acceptance_date: "2026-01-02T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

/**
 * Writes a run row straight through the storage rather than `recordRun`, which
 * stamps `ran_at` with the current time — these tests are about which row the
 * counter picks, so both the timestamp and the insertion order must be chosen.
 */
async function seedRun(row: {
  extractor_id: string;
  extractor_version: string;
  outcome: ExtractorRun["outcome"];
  ran_at: string;
  form: string;
}): Promise<void> {
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: ACC,
    form: row.form,
    extractor_id: row.extractor_id,
    extractor_version: row.extractor_version,
    slot_at_run: "current",
    ran_at: row.ran_at,
    success: row.outcome === "success",
    outcome: row.outcome,
    error: null,
    read_full_submission: null,
  } as ExtractorRun);
}

/**
 * The counting logic under test reads back rows the sub-task would otherwise
 * write; a no-op keeps the seeded rows as the only input.
 */
function stubProcessing(): () => void {
  const proto = ProcessAccessionDocFormTask.prototype;
  const real = proto.execute;
  proto.execute = async () => ({ success: true });
  return () => {
    proto.execute = real;
  };
}

async function runTask(form: string): Promise<{
  succeeded: number;
  partial: number;
  failed: number;
  triage: number;
}> {
  const restore = stubProcessing();
  try {
    const task = new FetchAndStoreFormsTask();
    return await task.execute({ cik: CIK, form }, {
      own: <T>(value: T) => value,
    } as unknown as IExecuteContext);
  } finally {
    restore();
  }
}

describe("FetchAndStoreFormsTask outcome counts", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("counts only the form's own extractor, not the sub-extractors it gates", async () => {
    // A known-SPAC 8-K writes three run rows for one filing: the form's own
    // `8-K` extractor plus the `loi` and `redemption` sub-extractors. Counting
    // every row for the accession reported the filing as failed whenever a
    // sub-extractor's row happened to come back last.
    await seedFiling("8-K");
    await seedRun({
      extractor_id: "8-K",
      extractor_version: "1.0.0",
      outcome: "success",
      ran_at: "2026-02-01T00:00:00.000Z",
      form: "8-K",
    });
    await seedRun({
      extractor_id: "loi",
      extractor_version: "1.0.0",
      outcome: "failure",
      ran_at: "2026-02-01T00:00:01.000Z",
      form: "8-K",
    });
    await seedRun({
      extractor_id: "redemption",
      extractor_version: "1.0.0",
      outcome: "failure",
      ran_at: "2026-02-01T00:00:02.000Z",
      form: "8-K",
    });

    const out = await runTask("8-K");
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.partial).toBe(0);
  });

  it("takes the newest run by ran_at, not the last row a query returned", async () => {
    // The re-run case: the PK includes extractor_version, so an older attempt's
    // row survives beside the new one. Row order is not guaranteed on any
    // backend, and here the older row is inserted last.
    await seedFiling("8-K");
    await seedRun({
      extractor_id: "8-K",
      extractor_version: "1.1.0",
      outcome: "success",
      ran_at: "2026-03-01T00:00:00.000Z",
      form: "8-K",
    });
    await seedRun({
      extractor_id: "8-K",
      extractor_version: "1.0.0",
      outcome: "failure",
      ran_at: "2026-01-01T00:00:00.000Z",
      form: "8-K",
    });

    const out = await runTask("8-K");
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(0);
  });

  it("counts a filing with no run row for its extractor as failed", async () => {
    await seedFiling("8-K");
    await seedRun({
      extractor_id: "loi",
      extractor_version: "1.0.0",
      outcome: "success",
      ran_at: "2026-02-01T00:00:00.000Z",
      form: "8-K",
    });

    const out = await runTask("8-K");
    expect(out.succeeded).toBe(0);
    expect(out.failed).toBe(1);
  });

  it("throws naming the form when no extractor is wired for it", async () => {
    await seedFiling("NOT-A-FORM");
    await expect(runTask("NOT-A-FORM")).rejects.toThrow(/NOT-A-FORM/);
  });

  it("counts a filing succeeded only when every extractor of its form did", async () => {
    // A de-SPAC `S-4` is a registration statement AND the merger proxy for the
    // same vote, so the form carries two extractors with two version slots and
    // two run rows. There is no single id to count it by: reading one of them
    // reports the filing done while the other still owes its work.
    //
    // Both registrations are additive — `S-4` is a symbol the shipped map has
    // no entry for, and the second is keyed by its own `section`, so the
    // shipped `merger-proxy` key that every `DEF 14A` runs through is untouched.
    registerFormExtractor({ id: "S-4", forms: ["S-4"], store: noopStore });
    registerFormExtractor({
      id: "merger-proxy",
      section: "de-spac",
      forms: ["S-4"],
      store: noopStore,
    });
    await seedFiling("S-4");
    await seedRun({
      extractor_id: "S-4",
      extractor_version: "1.0.0",
      outcome: "success",
      ran_at: "2026-02-01T00:00:00.000Z",
      form: "S-4",
    });

    const halfDone = await runTask("S-4");
    expect(halfDone.succeeded).toBe(0);
    expect(halfDone.failed).toBe(1);

    await seedRun({
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      outcome: "success",
      ran_at: "2026-02-01T00:00:01.000Z",
      form: "S-4",
    });

    const done = await runTask("S-4");
    expect(done.succeeded).toBe(1);
    expect(done.failed).toBe(0);
    expect(done.partial).toBe(0);
  });
});
