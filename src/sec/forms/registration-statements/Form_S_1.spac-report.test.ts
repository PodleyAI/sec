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

// This test exercises the writer directly with S-1-shaped inputs. A full
// processFormS1 fixture test belongs with the existing S-1 storage fixtures;
// here we lock the registration→row contract the S-1 path depends on.
describe("S-1 SPAC report population contract", () => {
  let repo: SpacRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  it("a registration creates a registered SPAC row with name and SIC", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 1821595,
      accession_number: "0001213900-20-000001",
      filing_date: "2020-12-21",
      form: "S-1",
      primary_document: null,
      spac_name: "10X Capital Venture Acquisition Corp",
      spac_sic: 6770,
    });
    const row = await repo.getSpac(1821595);
    expect(row?.status).toBe("registered");
    expect(row?.spac_sic).toBe(6770);
    expect(row?.registration_date).toBe("2020-12-21");
  });
});
