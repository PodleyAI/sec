/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { OfferingTermsRepo } from "./OfferingTermsRepo";

describe("OfferingTermsRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("saves and reads an offering-terms row by natural key", async () => {
    const repo = new OfferingTermsRepo();
    await repo.save({
      extractor_id: "S-1",
      accession_number: "0000000000-26-000001",
      cik: 1018724,
      security_type: "Common Stock",
      shares_offered: 5000000,
      price: null,
      price_low: 14,
      price_high: 16,
      gross_proceeds: 75000000,
      net_proceeds: 69000000,
      over_allotment_shares: 750000,
      exchange: "NASDAQ",
      ticker: "ACME",
      par_value: 0.0001,
      confidence: 0.9,
      source_span: "We are offering 5,000,000 shares",
      created_at: new Date().toISOString(),
    });
    const got = await repo.get("S-1", "0000000000-26-000001");
    expect(got?.price_high).toBe(16);
    expect(got?.ticker).toBe("ACME");
  });
});
