/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
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
        filing_date: "2025-06-01",
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

  it("ignores an out-of-order replay of an older filing (withdrawn portals stay withdrawn)", async () => {
    const portalRepo = new PortalRepo();
    const files = fixtureFiles();
    const withdrawalFile = files.find((f) => {
      const xml = readFileSync(join(FIXTURE_DIR, f), "utf-8");
      return xml.includes("<submissionType>CFPORTAL-W</submissionType>");
    });
    expect(withdrawalFile).toBeDefined();
    const registrationFile = files.find((f) => f !== withdrawalFile)!;

    const cik = 7777777; // cik is a processor param, so fixtures can be replayed under one CIK
    const withdrawal = await Form_CFPORTAL.parse(
      "CFPORTAL",
      readFileSync(join(FIXTURE_DIR, withdrawalFile!), "utf-8")
    );
    const registration = await Form_CFPORTAL.parse(
      "CFPORTAL",
      readFileSync(join(FIXTURE_DIR, registrationFile), "utf-8")
    );

    await processFormCFPORTAL({
      cik,
      accession_number: "0000000001-25-000002",
      filing_date: "2025-06-24",
      formCfportal: withdrawal,
    });
    expect((await portalRepo.getPortal(cik))?.live).toBe(false);

    // Back-catalog replay of the original (older) registration: must not
    // resurrect the withdrawn portal.
    await processFormCFPORTAL({
      cik,
      accession_number: "0000000001-24-000001",
      filing_date: "2024-01-01",
      formCfportal: registration,
    });
    const portal = await portalRepo.getPortal(cik);
    expect(portal?.live).toBe(false);
    expect(portal?.as_of).toBe("2025-06-24");

    // A genuinely newer registration applies.
    await processFormCFPORTAL({
      cik,
      accession_number: "0000000001-26-000001",
      filing_date: "2026-01-01",
      formCfportal: registration,
    });
    expect((await portalRepo.getPortal(cik))?.live).toBe(true);
  });

  // Regression: a person whose name happens to include a company-ending
  // word ("Holdings LLC") was routed to observeCompany when entityType was
  // absent — contaminating the canonical company pool. With no CIK/CRD
  // identifier, the heuristic now prefers person.
  it("Schedule A: missing entityType + no CIK/CRD routes the owner to observePerson", async () => {
    const personObs = new PersonObservationRepo();
    const companyObs = new CompanyObservationRepo();

    const cik = 5555555;
    const accession = "0000000001-26-000099";

    // Synthetic CFPORTAL parse with one Schedule A owner whose entityType
    // is absent and who carries no CIK/CRD.
    const synthetic: any = {
      headerData: {
        submissionType: "CFPORTAL",
        filerInfo: {
          filer: {
            filerCredentials: {
              filerCik: String(cik),
            },
          },
        },
      },
      formData: {
        identifyingInformation: {
          nameOfPortal: "Test Portal LLC",
        },
        scheduleA: {
          entityOrNaturalPerson: [
            {
              fullLegalName: "John Smith Holdings LLC",
              // entityType intentionally absent
              titleStatus: "Director",
              ownershipCode: "A",
              controlPerson: "Y",
              // cikNumber / crdNumber absent
            },
          ],
        },
      },
    };

    await processFormCFPORTAL({
      cik,
      accession_number: accession,
      filing_date: "2026-06-01",
      formCfportal: synthetic,
    });

    const persons = await personObs.listByAccession(accession);
    const companies = await companyObs.listByAccession(accession);

    // The owner (index 100) must be a person, not a company.
    expect(persons.some((o) => o.observation_index === 100)).toBe(true);
    expect(companies.some((o) => o.observation_index === 100)).toBe(false);
  });

  // Companion to the above: when a CIK is present, the company-ending
  // heuristic still routes to observeCompany (companies typically carry an
  // identifier).
  it("Schedule A: missing entityType + a CIK still routes a company-ending name to observeCompany", async () => {
    const personObs = new PersonObservationRepo();
    const companyObs = new CompanyObservationRepo();

    const cik = 5555556;
    const accession = "0000000001-26-000100";

    const synthetic: any = {
      headerData: {
        submissionType: "CFPORTAL",
        filerInfo: {
          filer: {
            filerCredentials: { filerCik: String(cik) },
          },
        },
      },
      formData: {
        identifyingInformation: { nameOfPortal: "Test Portal LLC" },
        scheduleA: {
          entityOrNaturalPerson: [
            {
              fullLegalName: "Acme Holdings LLC",
              titleStatus: "Member",
              cikNumber: "1234567",
            },
          ],
        },
      },
    };

    await processFormCFPORTAL({
      cik,
      accession_number: accession,
      filing_date: "2026-06-01",
      formCfportal: synthetic,
    });

    const persons = await personObs.listByAccession(accession);
    const companies = await companyObs.listByAccession(accession);

    expect(companies.some((o) => o.observation_index === 100)).toBe(true);
    expect(persons.some((o) => o.observation_index === 100)).toBe(false);
  });

  it("CFPORTAL/A with absent identifyingInformation fields preserves existing name/brand/url", async () => {
    const portalRepo = new PortalRepo();
    const files = fixtureFiles();
    // Pick the first non-withdrawal fixture that carries identifying info.
    let seedFile: string | undefined;
    for (const f of files) {
      const xml = readFileSync(join(FIXTURE_DIR, f), "utf-8");
      if (xml.includes("<submissionType>CFPORTAL-W</submissionType>")) continue;
      const parsedProbe = await Form_CFPORTAL.parse("CFPORTAL", xml);
      if (parsedProbe.formData?.identifyingInformation?.nameOfPortal) {
        seedFile = f;
        break;
      }
    }
    expect(seedFile).toBeDefined();

    const cik = 6666666;
    const seedXml = readFileSync(join(FIXTURE_DIR, seedFile!), "utf-8");
    const seedParse = await Form_CFPORTAL.parse("CFPORTAL", seedXml);

    // Seed: register the portal with the full parse.
    await processFormCFPORTAL({
      cik,
      accession_number: "0000000001-24-000010",
      filing_date: "2024-06-01",
      formCfportal: seedParse,
    });

    const seeded = await portalRepo.getPortal(cik);
    expect(seeded?.name).toBeTruthy();
    const seededName = seeded?.name;
    const seededBrand = seeded?.brand;
    const seededUrl = seeded?.url;

    // Build a follow-up parse that strips identifying fields (simulating an
    // amendment that only touched other sections).
    const followUp = await Form_CFPORTAL.parse("CFPORTAL", seedXml);
    delete (followUp.formData!.identifyingInformation as any).nameOfPortal;
    delete (followUp.formData!.identifyingInformation as any).otherNamesAndWebsiteUrls;

    await processFormCFPORTAL({
      cik,
      accession_number: "0000000001-25-000010",
      filing_date: "2025-06-01",
      formCfportal: followUp,
    });

    const after = await portalRepo.getPortal(cik);
    expect(after?.name).toBe(seededName ?? null);
    expect(after?.brand).toBe(seededBrand ?? null);
    expect(after?.url).toBe(seededUrl ?? null);
    expect(after?.as_of).toBe("2025-06-01");
  });
});

/**
 * Two phones on one filing, belonging to two different companies.
 *
 * `portalContactPhone` is the portal's own. `investorFundsContactPhone` sits
 * under `escrowArrangements` and belongs to the bank or trust company holding
 * investor funds — measured across all 817 cached CFPORTAL filings, 786 carry
 * both and 772 of them (99%) differ. The escrow numbers are shared
 * infrastructure: the one in this fixture, 702-840-4000, appears on 46
 * distinct portal CIKs. Filing it as `entity:contact` would tell 46 portals
 * they share a switchboard.
 */
describe("Form CFPORTAL phones", () => {
  let phoneRepo: PhoneRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    phoneRepo = new PhoneRepo();
  });

  it("keeps the portal's phone and the escrow agent's under different relations", async () => {
    const file = "000121390021050768-primary_doc.xml";
    const parsed = await Form_CFPORTAL.parse(
      "CFPORTAL",
      readFileSync(join(FIXTURE_DIR, file), "utf-8")
    );
    const cik = parseCikSafely(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);
    const portalRaw = parsed.formData?.identifyingInformation?.portalContact?.portalContactPhone;
    const escrowRaw =
      parsed.formData?.escrowArrangements?.investorFundsContacts?.[0]?.investorFundsContactPhone;
    expect(portalRaw).toBeTruthy();
    expect(escrowRaw).toBeTruthy();
    expect(portalRaw).not.toBe(escrowRaw);

    await processFormCFPORTAL({
      cik,
      accession_number: "test-accession-cfportal-phone",
      filing_date: "2025-06-01",
      formCfportal: parsed,
    });

    const phones = (await phoneRepo.phoneRepository.getAll()) ?? [];
    const portalPhone = phones.find((row) => row.raw_phone === portalRaw);
    const escrowPhone = phones.find((row) => row.raw_phone === escrowRaw);
    expect(portalPhone).toBeDefined();
    expect(escrowPhone).toBeDefined();

    const relationsFor = async (international_number: string): Promise<string[]> =>
      ((await phoneRepo.phoneEntityJunctionRepository.query({ international_number })) ?? [])
        .filter((j) => Number(j.cik) === cik)
        .map((j) => j.relation_name);

    expect(await relationsFor(portalPhone!.international_number)).toContain("entity:contact");
    // The escrow number is reachable, but never claimed as the portal's own.
    const escrowRelations = await relationsFor(escrowPhone!.international_number);
    expect(escrowRelations).toContain("portal:investor-funds");
    expect(escrowRelations).not.toContain("entity:contact");

    // And only the portal's own number reaches the portal observation.
    const observations = await new CompanyObservationRepo().listAll();
    const portalObs = observations.find(
      (o) => o.accession_number === "test-accession-cfportal-phone" && o.observation_index === 0
    );
    expect(portalObs?.raw_phone_id).toBe(portalPhone!.international_number);
  });
});
