/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../storage/filing/FilingSchema";
import { OfferingTermsRepo } from "../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../storage/offering/SpacUnitTermsRepo";
import { compareIssuerDeal } from "./issuerDeal";

async function seedFiling(cik: number, accession_number: string, filing_date: string) {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const row: Filing = {
    cik,
    accession_number,
    filing_date,
    report_date: null,
    acceptance_date: `${filing_date}T00:00:00.000Z`,
    form: "S-1",
    file_number: null,
    film_number: null,
    primary_doc: "primary_doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  };
  await repo.put(row);
}

const CIK = 2114227;

function spacRow(extractor_id: string, accession_number: string, overrides: object = {}) {
  return {
    extractor_id,
    accession_number,
    cik: CIK,
    units_offered: 25000000,
    price_per_unit: 10,
    unit_composition: "one share and one-quarter warrant",
    warrant_fraction_per_unit: 0.25,
    right_fraction_per_unit: null,
    trust_per_unit: 10.0,
    over_allotment_units: 3750000,
    exchange: "NASDAQ",
    ticker: "CCXII.U",
    gross_proceeds: 250000000,
    net_proceeds: null,
    confidence: 0.9,
    source_span: "each unit",
    created_at: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("compareIssuerDeal", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("returns null when the issuer has no extracted terms", async () => {
    expect(await compareIssuerDeal(CIK)).toBeNull();
  });

  it("joins registered vs priced SPAC unit terms with deltas", async () => {
    const repo = new SpacUnitTermsRepo();
    await repo.save(spacRow("S-1", "0000000000-26-000801"));
    await repo.save(
      spacRow("424", "0000000000-26-000802", {
        units_offered: 34500000,
        gross_proceeds: 345000000,
        over_allotment_units: null,
        created_at: "2026-04-28T00:00:00.000Z",
      })
    );

    const result = (await compareIssuerDeal(CIK))!;
    expect(result.kind).toBe("spac");
    expect(result.registered_accession).toBe("0000000000-26-000801");
    expect(result.priced_accession).toBe("0000000000-26-000802");

    const byField = new Map(result.fields.map((f) => [f.field, f]));
    expect(byField.get("units_offered")).toEqual({
      field: "units_offered",
      registered: 25000000,
      priced: 34500000,
      delta: 9500000,
    });
    expect(byField.get("gross_proceeds")?.delta).toBe(95000000);
    // Upsized but over-allotment dropped at pricing: numeric vs null -> no delta.
    expect(byField.get("over_allotment_units")).toEqual({
      field: "over_allotment_units",
      registered: 3750000,
      priced: null,
      delta: null,
    });
    expect(byField.get("ticker")?.delta).toBeNull();
  });

  // Regression: re-extracting an older amendment after the newer one used
  // to make the older row "win" because the offerings table was sorted by
  // created_at. The latest-by-filing-date filing must always be reported as
  // "registered".
  it("orders by filing_date, not extract created_at (re-extracted older amendment loses)", async () => {
    const repo = new SpacUnitTermsRepo();
    // Newer amendment: extracted earlier.
    const newerAccession = "0000000000-26-000900";
    await seedFiling(CIK, newerAccession, "2026-04-15");
    await repo.save(
      spacRow("S-1", newerAccession, {
        units_offered: 30000000,
        created_at: "2026-04-15T00:00:00.000Z",
      })
    );

    // Older amendment: re-extracted LATER (so its created_at is newer).
    const olderAccession = "0000000000-26-000800";
    await seedFiling(CIK, olderAccession, "2026-04-01");
    await repo.save(
      spacRow("S-1", olderAccession, {
        units_offered: 25000000,
        created_at: "2026-05-01T00:00:00.000Z",
      })
    );

    const result = (await compareIssuerDeal(CIK))!;
    // Latest by filing_date wins as "registered", not latest by created_at.
    expect(result.registered_accession).toBe(newerAccession);
    expect(result.fields.find((f) => f.field === "units_offered")?.registered).toBe(30000000);
  });

  it("uses the latest registration extract when amendments exist", async () => {
    const repo = new SpacUnitTermsRepo();
    await repo.save(spacRow("S-1", "0000000000-26-000801"));
    await repo.save(
      spacRow("S-1", "0000000000-26-000803", {
        units_offered: 30000000,
        created_at: "2026-04-15T00:00:00.000Z",
      })
    );

    const result = (await compareIssuerDeal(CIK))!;
    expect(result.registered_accession).toBe("0000000000-26-000803");
    expect(result.priced_accession).toBeNull();
    expect(result.fields.find((f) => f.field === "units_offered")?.registered).toBe(30000000);
  });

  it("compares equity offerings (price range -> final price)", async () => {
    const repo = new OfferingTermsRepo();
    await repo.save({
      extractor_id: "S-1",
      accession_number: "0000000000-26-000804",
      cik: CIK,
      security_type: "Common Stock",
      shares_offered: 5000000,
      price: null,
      price_low: 14,
      price_high: 16,
      gross_proceeds: 75000000,
      net_proceeds: null,
      over_allotment_shares: 750000,
      exchange: "NASDAQ",
      ticker: "ACME",
      par_value: 0.0001,
      confidence: 0.9,
      source_span: "5,000,000 shares",
      created_at: "2026-04-02T00:00:00.000Z",
    });
    await repo.save({
      extractor_id: "424",
      accession_number: "0000000000-26-000805",
      cik: CIK,
      security_type: "Common Stock",
      shares_offered: 5750000,
      price: 15,
      price_low: null,
      price_high: null,
      gross_proceeds: 86250000,
      net_proceeds: null,
      over_allotment_shares: 862500,
      exchange: "NASDAQ",
      ticker: "ACME",
      par_value: 0.0001,
      confidence: 0.9,
      source_span: "5,750,000 shares at $15.00",
      created_at: "2026-04-28T00:00:00.000Z",
    });

    const result = (await compareIssuerDeal(CIK))!;
    expect(result.kind).toBe("equity");
    const byField = new Map(result.fields.map((f) => [f.field, f]));
    expect(byField.get("shares_offered")?.delta).toBe(750000);
    expect(byField.get("price")?.priced).toBe(15);
    expect(byField.get("price_low")?.registered).toBe(14);
    expect(byField.get("gross_proceeds")?.delta).toBe(11250000);
  });
});
