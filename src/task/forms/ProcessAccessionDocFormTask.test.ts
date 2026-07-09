/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
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
    resetDependencyInjectionsForTesting();
  });

  it("throws if no extractor is mapped for the form", async () => {
    await seedFiling({
      cik: 1234567,
      accession_number: "0001234567-25-000001",
      form: "10-K", // not in FORM_TO_EXTRACTOR_ID
      primary_doc: "primary_doc.xml",
    });
    const task = new ProcessAccessionDocFormTask();
    await expect(
      task.execute({ accessionNumber: "0001234567-25-000001" }, { own: <T>(x: T): T => x } as any)
    ).rejects.toThrow(/No extractor.*10-K/i);
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
