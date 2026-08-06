/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { RiskFactorRepo } from "./RiskFactorRepo";

const ACCESSION = "0000000000-26-000001";

function row(risk_index: number, headline: string, category: string | null) {
  return {
    extractor_id: "S-1",
    accession_number: ACCESSION,
    risk_index,
    cik: 1018724,
    category,
    headline,
    confidence: 0.9,
    source_span: headline,
    created_at: new Date().toISOString(),
  };
}

describe("RiskFactorRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("returns a filing's risks in document order and clears them", async () => {
    const repo = new RiskFactorRepo();
    await repo.save(row(1, "We may never complete an initial business combination.", "Risks"));
    await repo.save(row(0, "We are a blank check company with no operating history.", "Risks"));

    const got = await repo.queryByAccession(ACCESSION);
    expect(got.map((r) => r.risk_index)).toEqual([0, 1]);
    expect(got[0].headline).toContain("blank check company");

    await repo.clear(ACCESSION);
    expect(await repo.queryByAccession(ACCESSION)).toHaveLength(0);
  });

  it("keeps a null category", async () => {
    const repo = new RiskFactorRepo();
    await repo.save(row(0, "Our securities may be delisted.", null));
    const got = await repo.queryByAccession(ACCESSION);
    expect(got[0].category).toBeNull();
  });
});
