/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../../../storage/filing/FilingSchema";
import { issuerHasCombinationListing } from "./newcoListing";

async function seedFiling(cik: number, accession: string, form: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number: accession,
    form,
    primary_doc: `${form}.htm`,
    file_number: "",
    filing_date: "2024-10-02",
    acceptance_date: "2024-10-02T00:00:00.000Z",
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

describe("issuerHasCombinationListing", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("is false with no filings", async () => {
    expect(await issuerHasCombinationListing(2001557)).toBe(false);
  });

  it("is false with only an 8-A12B (SPAC IPO listing)", async () => {
    await seedFiling(1, "0000000000-24-000001", "8-A12B");
    expect(await issuerHasCombinationListing(1)).toBe(false);
  });

  it("is false with only an S-4", async () => {
    await seedFiling(2, "0000000000-24-000002", "S-4");
    expect(await issuerHasCombinationListing(2)).toBe(false);
  });

  it("is true with an S-4 and an 8-A12B", async () => {
    await seedFiling(3, "0000000000-24-000003", "S-4");
    await seedFiling(3, "0000000000-24-000004", "8-A12B");
    expect(await issuerHasCombinationListing(3)).toBe(true);
  });

  it("is true with F-4 and 8-A12G amendments", async () => {
    await seedFiling(4, "0000000000-24-000005", "F-4/A");
    await seedFiling(4, "0000000000-24-000006", "8-A12G/A");
    expect(await issuerHasCombinationListing(4)).toBe(true);
  });

  it("is true with S-4EF/A and 8-A12B", async () => {
    await seedFiling(5, "0000000000-24-000007", "S-4EF/A");
    await seedFiling(5, "0000000000-24-000008", "8-A12B");
    expect(await issuerHasCombinationListing(5)).toBe(true);
  });
});
