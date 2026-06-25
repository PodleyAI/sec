/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { parseInlineXbrl } from "../../sec/xbrl/parseInlineXbrl";
import { toXbrlFactRows } from "../../sec/xbrl/toFactRows";
import { globalServiceRegistry } from "workglow";
import { XbrlFactRepo } from "./XbrlFactRepo";
import {
  XBRL_FACT_REPOSITORY_TOKEN,
  type XbrlFactRow,
  type XbrlFactRepositoryStorage,
} from "./XbrlFactSchema";

const ACCESSION = "0001213900-26-039320";

const INLINE_HTML =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:dei="http://xbrl.sec.gov/dei/2025"` +
  ` xmlns:spac="http://xbrl.sec.gov/spac/2025q3"><body>` +
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="c1"><xbrli:entity>` +
  `<xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period></xbrli:context>` +
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>` +
  `</ix:resources></ix:header></div>` +
  `<ix:nonNumeric contextRef="c1" name="dei:EntityRegistrantName">Churchill Capital Corp XII</ix:nonNumeric>` +
  `<ix:nonFraction contextRef="c1" unitRef="usd" name="spac:SaleOfSecuritiesGrossProceeds"` +
  ` decimals="0" format="ixt:num-dot-decimal" scale="0">250,000,000</ix:nonFraction>` +
  `</body></html>`;

function rowsFromInline(): XbrlFactRow[] {
  const doc = parseInlineXbrl(INLINE_HTML);
  return toXbrlFactRows({ doc, accession_number: ACCESSION, cik: 2114227 });
}

describe("XbrlFactRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("round-trips parsed facts with denormalized period and unit", async () => {
    const repo = new XbrlFactRepo();
    await repo.replaceForAccession(ACCESSION, rowsFromInline());

    const rows = await repo.getByAccession(ACCESSION);
    expect(rows).toHaveLength(2);
    expect(rows[0].concept).toBe("dei:EntityRegistrantName");
    expect(rows[0].value_text).toBe("Churchill Capital Corp XII");
    expect(rows[0].is_numeric).toBe(false);
    expect(rows[0].period_instant).toBe("2026-03-31");

    expect(rows[1].concept).toBe("spac:SaleOfSecuritiesGrossProceeds");
    expect(rows[1].value_numeric).toBe(250000000);
    expect(rows[1].unit).toBe("USD");
    expect(rows[1].namespace).toBe("http://xbrl.sec.gov/spac/2025q3");
    expect(rows[1].source).toBe("inline");
  });

  it("replaceForAccession clears stale rows from a previous longer extract", async () => {
    const repo = new XbrlFactRepo();
    const rows = rowsFromInline();
    await repo.replaceForAccession(ACCESSION, rows);
    await repo.replaceForAccession(ACCESSION, rows.slice(0, 1));
    expect(await repo.countByAccession(ACCESSION)).toBe(1);
  });

  it("keeps the prior facts when a re-extract's putBulk fails (no zero-facts window)", async () => {
    // Seed a complete prior extract.
    await new XbrlFactRepo().replaceForAccession(ACCESSION, rowsFromInline());
    expect(await new XbrlFactRepo().countByAccession(ACCESSION)).toBe(2);

    // A re-extract whose putBulk rejects (e.g. a maxLength overflow on one row)
    // must not have already deleted the prior facts.
    const real = globalServiceRegistry.get(XBRL_FACT_REPOSITORY_TOKEN);
    const failingPutBulk = {
      putBulk: async () => {
        throw new Error("simulated putBulk rejection");
      },
      query: (criteria: unknown) => (real.query as (c: unknown) => unknown)(criteria),
      delete: (pk: unknown) => (real.delete as (p: unknown) => unknown)(pk),
      // Delegated so the OLD delete-then-put order would genuinely wipe the prior
      // facts here (and fail the count assertion below), not error on a missing method.
      deleteSearch: (c: unknown) => (real.deleteSearch as (c: unknown) => unknown)(c),
    } as unknown as XbrlFactRepositoryStorage;

    await expect(
      new XbrlFactRepo(failingPutBulk).replaceForAccession(ACCESSION, rowsFromInline())
    ).rejects.toThrow("simulated putBulk rejection");

    // The prior facts are still there — the old delete-then-put order would have
    // wiped them before the put failed.
    expect(await new XbrlFactRepo().countByAccession(ACCESSION)).toBe(2);
  });

  it("queries one concept across an issuer's filings", async () => {
    const repo = new XbrlFactRepo();
    await repo.replaceForAccession(ACCESSION, rowsFromInline());
    const other = rowsFromInline().map((r) => ({
      ...r,
      accession_number: "0001213900-26-047229",
    }));
    await repo.replaceForAccession("0001213900-26-047229", other);

    const series = await repo.getByCikConcept(2114227, "spac:SaleOfSecuritiesGrossProceeds");
    expect(series).toHaveLength(2);
    expect(series.map((r) => r.accession_number)).toEqual([ACCESSION, "0001213900-26-047229"]);
  });
});
