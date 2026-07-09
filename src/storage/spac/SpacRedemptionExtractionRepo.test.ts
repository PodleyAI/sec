/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacRedemptionExtractionRepo } from "./SpacRedemptionExtractionRepo";
import type { SpacRedemptionExtraction } from "./SpacRedemptionExtractionSchema";

function row(
  p: Partial<SpacRedemptionExtraction> & Pick<SpacRedemptionExtraction, "accession_number" | "cik">
): SpacRedemptionExtraction {
  return {
    form: "8-K",
    filing_date: "2021-05-01",
    extractor_id: "redemption",
    extractor_version: "1.0.0",
    redemption_shares: null,
    redemption_amount: null,
    price_per_share: null,
    confidence: 0.9,
    source_span: null,
    model_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("SpacRedemptionExtractionRepo", () => {
  let repo: SpacRedemptionExtractionRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRedemptionExtractionRepo();
  });

  it("round-trips a row and overwrites by accession", async () => {
    await repo.save(row({ accession_number: "a1", cik: 5, redemption_amount: 100_000 }));
    await repo.save(row({ accession_number: "a1", cik: 5, redemption_amount: 200_000 }));
    expect((await repo.getByAccession("a1"))?.redemption_amount).toBe(200_000);
  });

  it("queries all extractions for a CIK", async () => {
    await repo.save(row({ accession_number: "a1", cik: 5, redemption_shares: 1000 }));
    await repo.save(row({ accession_number: "a2", cik: 5, redemption_shares: 2000 }));
    await repo.save(row({ accession_number: "b1", cik: 6, redemption_shares: 3000 }));
    expect((await repo.getByCik(5)).length).toBe(2);
    expect(await repo.getByCik(99)).toEqual([]);
  });

  it("re-save same accession stays length 1 with updated field", async () => {
    await repo.save(row({ accession_number: "a1", cik: 5, price_per_share: 10.0 }));
    await repo.save(row({ accession_number: "a1", cik: 5, price_per_share: 10.12 }));
    const rows = await repo.getByCik(5);
    expect(rows.length).toBe(1);
    expect(rows[0].price_per_share).toBe(10.12);
  });
});
