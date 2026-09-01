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
import {
  formsForExtractor,
  getBackfillDescriptor,
  listBackfillableExtractorIds,
} from "./backfillDescriptors";

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly items?: string;
  readonly filing_date?: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const filing_date = opts.filing_date ?? "2026-03-20";
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date,
    acceptance_date: `${filing_date}T00:00:00.000Z`,
    report_date: filing_date,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items ?? null,
    act: null,
  } as never);
}

describe("backfill descriptor registry", () => {
  it("resolves a generic form-based descriptor for every form-routed extractor", () => {
    for (const id of ["S-1-xbrl", "424-xbrl", "8-K-items", "C", "D", "CFPORTAL", "1-A", "144"]) {
      expect(getBackfillDescriptor(id)?.extractorId).toBe(id);
    }
  });

  it("returns undefined for unknown extractor ids", () => {
    expect(getBackfillDescriptor("nope")).toBeUndefined();
  });

  it("lists every backfillable id, including the sub-extractors", () => {
    const ids = listBackfillableExtractorIds();
    for (const id of ["S-1", "8-K", "merger-proxy", "redemption", "loi", "25-15", "RW"]) {
      expect(ids).toContain(id);
    }
  });

  it("formsForExtractor maps an extractor id back to its routed forms", () => {
    expect(formsForExtractor("S-1-xbrl").sort()).toEqual(
      ["DRS", "DRS/A", "F-1", "F-1/A", "F-1MEF", "S-1", "S-1/A", "S-1MEF"].sort()
    );
    expect(formsForExtractor("loi")).toEqual([]);
  });
});

describe("generic form-based descriptor", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects every filing of the extractor's routed forms", async () => {
    await seedFiling({ cik: 1, accession_number: "acc-s1", form: "S-1" });
    await seedFiling({ cik: 1, accession_number: "acc-s1a", form: "S-1/A" });
    await seedFiling({ cik: 2, accession_number: "acc-drs", form: "DRS" });
    await seedFiling({ cik: 2, accession_number: "acc-8k", form: "8-K", items: "8.01" });

    const candidates = await getBackfillDescriptor("S-1-xbrl")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-s1", "acc-s1a", "acc-drs"]));
  });
});
