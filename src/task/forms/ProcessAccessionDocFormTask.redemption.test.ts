/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { IExecuteContext } from "workglow";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

class CapturingTask extends ProcessAccessionDocFormTask {
  public readonly fetched: string[] = [];

  protected override async runFetch(
    _cik: number,
    _accessionNumber: string,
    fileName: string,
    _context: IExecuteContext
  ): Promise<string> {
    this.fetched.push(fileName);
    return "<SEC-HEADER></SEC-HEADER>";
  }
}

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2025-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Redeem SPAC Inc.",
    spac_sic: 6770,
  });
}

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly primary_doc: string;
  readonly items: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: opts.primary_doc,
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

describe("ProcessAccessionDocFormTask redemption fetch escalation", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("fetches the full .txt for a known-SPAC trigger-item 8-K", async () => {
    const accession = "0000000000-26-000007";
    await seedSpac(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07,9.01",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain(`${accession}.txt`);
  });

  it("keeps the primary-doc fetch for a non-trigger item", async () => {
    const accession = "0000000000-26-000008";
    await seedSpac(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "2.02",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain("primary.htm");
    expect(task.fetched).not.toContain(`${accession}.txt`);
  });

  it("keeps the primary-doc fetch for a non-SPAC CIK", async () => {
    const accession = "0000000000-26-000010";
    await seedFiling({
      cik: 99,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain("primary.htm");
    expect(task.fetched).not.toContain(`${accession}.txt`);
  });
});
