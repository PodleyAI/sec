/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { PortalRepo } from "../../../storage/portal/PortalRepo";
import { accessionFromFixtureName } from "../../../util/accession";
import { parseCikSafely } from "../../../util/parseCik";
import { Form_CFPORTAL } from "./Form_CFPORTAL";
import { processFormCFPORTAL } from "./Form_CFPORTAL.storage";

const FIXTURE_DIR = join(__dirname, "mock_data", "cfportal");

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith("-primary_doc.xml"))
    .sort();
}

describe("Form_CFPORTAL storage", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("stores a Portal row and entity observations for every fixture", async () => {
    const portalRepo = new PortalRepo();
    const companyObs = new CompanyObservationRepo();
    const personObs = new PersonObservationRepo();
    const files = fixtureFiles();
    expect(files.length).toBeGreaterThan(0);

    let sawWithdrawal = false;
    let sawScheduleA = false;

    for (const file of files) {
      const xml = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      const parsed = await Form_CFPORTAL.parse("CFPORTAL", xml);
      const accession = accessionFromFixtureName(file);
      const cik = parseCikSafely(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormCFPORTAL({
        cik,
        accession_number: accession,
        formCfportal: parsed,
      });

      const portal = await portalRepo.getPortal(cik);
      expect(portal).toBeDefined();

      if (parsed.headerData.submissionType === "CFPORTAL-W") {
        sawWithdrawal = true;
        expect(portal!.live).toBe(false);
      } else {
        expect(portal!.name).toBe(parsed.formData!.identifyingInformation!.nameOfPortal!);
        expect(portal!.live).toBe(true);
        // Portal company observed at index 0
        const companies = await companyObs.listByAccession(accession);
        expect(companies.some((o) => o.observation_index === 0 && o.cik === cik)).toBe(true);
      }

      const owners = parsed.formData?.scheduleA?.entityOrNaturalPerson ?? [];
      if (owners.length > 0) {
        sawScheduleA = true;
        const persons = await personObs.listByAccession(accession);
        const companies = await companyObs.listByAccession(accession);
        const observedOwners =
          persons.filter((o) => o.observation_index >= 100).length +
          companies.filter((o) => o.observation_index >= 100).length;
        expect(observedOwners).toBe(owners.filter((p) => p.fullLegalName).length);
      }
    }

    // The fixture set must keep exercising both interesting paths; a pruned
    // CFPORTAL-W fixture would otherwise silently drop withdrawal coverage.
    expect(sawScheduleA).toBe(true);
    expect(sawWithdrawal).toBe(true);
  });
});
