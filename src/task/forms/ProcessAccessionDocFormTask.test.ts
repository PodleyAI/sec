/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { resetNoExtractorWarningsForTesting } from "../../sec/forms/parserOnlyForms";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly primary_doc: string;
  readonly file_number?: string;
  readonly filing_date?: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: opts.primary_doc,
    file_number: opts.file_number ?? "",
    filing_date: opts.filing_date ?? "2025-01-01",
    acceptance_date: "2025-01-01T00:00:00.000Z",
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

describe("ProcessAccessionDocFormTask (versioned)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetDependencyInjectionsForTesting();
  });

  it("skips a form no extractor is mapped for, and says so", async () => {
    // Nothing here reads a 10-K. That is a deployment fact rather than a
    // defect, so the filing is skipped and the run carries on; the warning is
    // what stops the skip being silent.
    await seedFiling({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "10-K", // no extractor is registered for it
      primary_doc: "primary_doc.xml",
    });
    resetNoExtractorWarningsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const task = new ProcessAccessionDocFormTask();

    const out = await task.execute({ accessionNumber: "0001234567-25-000001" }, {
      own: <T>(x: T): T => x,
    } as any);

    expect(out).toEqual({ success: true });
    expect(warn.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringContaining("no extractor is registered for form '10-K'")
    );
  });

  it("relabels the reused instance with form and accession", async () => {
    // `spac process` (and the forms sweep) pipes one instance through a map;
    // without setTitle the CLI row stays "Process filing document" for every
    // filing. This path returns before fetch, so the label is observable
    // without the network.
    await seedFiling({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "10-K",
      primary_doc: "primary_doc.xml",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const task = new ProcessAccessionDocFormTask();
    expect(task.title).toBe("Process filing document");
    await task.execute({ accessionNumber: "0001234567-25-000001" }, {
      own: <T>(x: T): T => x,
    } as any);
    expect(task.title).toBe("10-K 0001234567-25-000001");
  });

  it("throws if no current version is bootstrapped for the form's extractor", async () => {
    const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
    // bootstrap ran in setupAllDatabases; clear the D current slot for this test
    await reg.clearSlot("extractor", "D", "current");

    await seedFiling({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "D",
      primary_doc: "primary_doc.xml",
    });
    const task = new ProcessAccessionDocFormTask();
    await expect(
      task.execute({ accessionNumber: "0001234567-25-000001" }, { own: <T>(x: T): T => x } as any)
    ).rejects.toThrow(/No active slot.*extractor.*D/i);
  });
});
