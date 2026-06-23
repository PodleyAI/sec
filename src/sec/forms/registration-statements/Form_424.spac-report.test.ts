/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";

describe("424 SPAC report population contract", () => {
  let repo: SpacRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  it("registration then IPO yields an ipo-status row with proceeds and trust", async () => {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik: 1821595,
      accession_number: "reg",
      filing_date: "2020-12-21",
      form: "S-1",
      primary_document: null,
      spac_name: "10X Capital Venture Acquisition Corp",
      spac_sic: 6770,
    });
    await writer.recordIpo({
      cik: 1821595,
      accession_number: "ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: null,
      ipo_proceeds: 201_250_000,
      trust_amount: 201_250_000,
      spac_tickers: ["VCVC.U"],
    });
    const row = await repo.getSpac(1821595);
    expect(row?.status).toBe("ipo");
    expect(row?.ipo_proceeds).toBe(201_250_000);
    expect(row?.trust_amount).toBe(201_250_000);
    expect(row?.ipo_date).toBe("2021-01-15");
  });
});
