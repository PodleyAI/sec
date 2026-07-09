/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { XbrlFactRepo } from "../../storage/xbrl/XbrlFactRepo";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import { formatXbrlPeriod, queryXbrlFacts } from "./XbrlQuery";

const ACCESSION = "0001213900-26-039320";

function makeFact(overrides: Partial<XbrlFactRow> = {}): XbrlFactRow {
  return {
    accession_number: ACCESSION,
    fact_index: 0,
    cik: 2114227,
    concept: "dei:EntityRegistrantName",
    namespace: "http://xbrl.sec.gov/dei/2025",
    context_ref: "c1",
    unit: null,
    period_start: null,
    period_end: null,
    period_instant: "2026-03-31",
    value_text: "Churchill Capital Corp XII",
    value_numeric: null,
    decimals: null,
    sign: null,
    format: null,
    is_numeric: false,
    is_hidden: false,
    dimensions_json: null,
    source: "inline",
    created_at: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("queryXbrlFacts", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("requires an accession or CIK", async () => {
    await expect(queryXbrlFacts({})).rejects.toThrow(/accession number or a CIK/);
  });

  it("returns a filing's facts in extraction order", async () => {
    await new XbrlFactRepo().replaceForAccession(ACCESSION, [
      makeFact({ fact_index: 1, concept: "spac:AssetsHeldInTrustNoncurrent" }),
      makeFact({ fact_index: 0 }),
    ]);
    const result = await queryXbrlFacts({ accession: ACCESSION });
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.fact_index)).toEqual([0, 1]);
  });

  it("filters by concept substring and numeric-only", async () => {
    await new XbrlFactRepo().replaceForAccession(ACCESSION, [
      makeFact({ fact_index: 0 }),
      makeFact({
        fact_index: 1,
        concept: "spac:AssetsHeldInTrustNoncurrent",
        is_numeric: true,
        value_numeric: 250000000,
        unit: "USD",
      }),
    ]);
    const byConcept = await queryXbrlFacts({ accession: ACCESSION, concept: "heldintrust" });
    expect(byConcept.rows).toHaveLength(1);
    expect(byConcept.rows[0].concept).toBe("spac:AssetsHeldInTrustNoncurrent");

    const numeric = await queryXbrlFacts({ accession: ACCESSION, numericOnly: true });
    expect(numeric.rows).toHaveLength(1);
    expect(numeric.rows[0].value_numeric).toBe(250000000);
  });

  it("queries by CIK across filings", async () => {
    const repo = new XbrlFactRepo();
    await repo.replaceForAccession(ACCESSION, [makeFact()]);
    await repo.replaceForAccession("0001213900-26-047229", [
      makeFact({ accession_number: "0001213900-26-047229" }),
    ]);
    const result = await queryXbrlFacts({ cik: 2114227 });
    expect(result.total).toBe(2);
  });
});

describe("formatXbrlPeriod", () => {
  it("formats instants, durations, and missing periods", () => {
    expect(formatXbrlPeriod(makeFact())).toBe("2026-03-31");
    expect(
      formatXbrlPeriod(
        makeFact({ period_instant: null, period_start: "2026-01-01", period_end: "2026-03-31" })
      )
    ).toBe("2026-01-01..2026-03-31");
    expect(formatXbrlPeriod(makeFact({ period_instant: null }))).toBe("");
  });
});
