/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacMergerExtractionRepo } from "./SpacMergerExtractionRepo";
import type { SpacMergerExtraction } from "./SpacMergerExtractionSchema";

function row(
  p: Partial<SpacMergerExtraction> & Pick<SpacMergerExtraction, "accession_number" | "cik">
): SpacMergerExtraction {
  return {
    form: "DEFM14A",
    filing_date: "2021-05-01",
    extractor_id: "merger-proxy",
    extractor_version: "1.0.0",
    target_name: null,
    target_cik: null,
    target_observation_id: null,
    pipe_amount: null,
    equity_value: null,
    enterprise_value: null,
    merger_consideration: null,
    target_description: null,
    confidence: 0.9,
    source_span: null,
    seeks_combination_approval: null,
    model_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("SpacMergerExtractionRepo", () => {
  let repo: SpacMergerExtractionRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacMergerExtractionRepo();
  });

  it("round-trips a row and overwrites by accession", async () => {
    await repo.save(row({ accession_number: "a1", cik: 5, target_name: "Old Co" }));
    await repo.save(row({ accession_number: "a1", cik: 5, target_name: "New Co" }));
    expect((await repo.getByAccession("a1"))?.target_name).toBe("New Co");
  });

  it("queries all extractions for a CIK", async () => {
    await repo.save(row({ accession_number: "a1", cik: 5, target_name: "T1" }));
    await repo.save(row({ accession_number: "a2", cik: 5, target_name: "T2" }));
    await repo.save(row({ accession_number: "b1", cik: 6, target_name: "T3" }));
    const forCik = await repo.getByCik(5);
    expect(forCik.map((r) => r.target_name).sort()).toEqual(["T1", "T2"]);
  });
});
