/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SpacUnitTermsRepo } from "./SpacUnitTermsRepo";

describe("SpacUnitTermsRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("saves and reads SPAC unit terms by natural key", async () => {
    const repo = new SpacUnitTermsRepo();
    await repo.save({
      extractor_id: "S-1",
      accession_number: "0000000000-26-000002",
      cik: 1848507,
      units_offered: 20000000,
      price_per_unit: 10,
      unit_composition: "one share and one-half of one redeemable warrant",
      warrant_fraction_per_unit: 0.5,
      right_fraction_per_unit: null,
      trust_per_unit: 10.1,
      over_allotment_units: 3000000,
      exchange: "NASDAQ",
      ticker: "ACQU",
      gross_proceeds: 200000000,
      net_proceeds: null,
      confidence: 0.85,
      source_span: "each unit consists of one share",
      created_at: new Date().toISOString(),
    });
    const got = await repo.get("S-1", "0000000000-26-000002");
    expect(got?.warrant_fraction_per_unit).toBe(0.5);
    expect(got?.trust_per_unit).toBe(10.1);
  });
});
