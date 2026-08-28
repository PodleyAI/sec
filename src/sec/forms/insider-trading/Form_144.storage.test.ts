/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { Form144Repo } from "../../../storage/form144/Form144Repo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { accessionFromFixtureName } from "../../../util/accession";
import { parseCikSafely } from "../../../util/parseCik";
import { Form_144 } from "./Form_144";
import { processForm144 } from "./Form_144.storage";

const CASES = [
  { dir: "form-144", form: "144" as const },
  { dir: "form-144-a", form: "144/A" as const },
];

function listFixtures(dir: string): string[] {
  return readdirSync(join(__dirname, "mock_data", dir)).filter((f) =>
    f.endsWith("-primary_doc.xml")
  );
}

describe("Form 144 storage", () => {
  let repo: Form144Repo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new Form144Repo();
  });

  it("parses and stores every fixture without error", async () => {
    const errors: Array<{ file: string; error: string }> = [];
    let count = 0;

    for (const { dir, form } of CASES) {
      for (const file of listFixtures(dir)) {
        count++;
        const accession = accessionFromFixtureName(file);
        try {
          const xml = readFileSync(join(__dirname, "mock_data", dir, file), "utf-8");
          const doc = await Form_144.parse(form, xml);
          await processForm144({
            cik: parseCikSafely(doc.formData?.issuerInfo?.issuerCik),
            file_number: "",
            accession_number: accession,
            filing_date: "2026-05-27",
            primary_doc: file,
            form,
            extractor_id: "144",
            doc,
          });
          const filing = await repo.getFiling(accession);
          expect(filing).toBeDefined();
          expect(filing!.form).toBe(form);
        } catch (error) {
          errors.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    expect(count).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it("stores the filing header, acquisitions, and trailing-3-month sales", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const filing = await repo.getFiling(accession);
    expect(filing?.issuer_name).toBe("HF Sinclair");
    expect(filing?.issuer_cik).toBe(1534263);
    expect(filing?.person_for_whose_account).toBe("Go Timothy");
    expect(filing?.relationships_to_issuer).toBe("Former Employee");
    expect(filing?.broker_name).toBe("Pershing Advisor Solutions");
    expect(filing?.no_of_units_sold).toBe(129915);
    expect(filing?.aggregate_market_value).toBe(9019409.69);
    expect(filing?.approx_sale_date).toBe("05/26/2026");
    expect(filing?.securities_exchange_name).toBe("NYSE");
    expect(filing?.nothing_to_report_past_3_months).toBe(false);

    const acquisitions = await repo.getAcquisitions(accession);
    expect(acquisitions.length).toBe(2);
    expect(acquisitions[0].nature_of_acquisition).toBe("Vested Stock");
    expect(acquisitions[0].amount_acquired).toBe(66505);
    expect(acquisitions[0].is_gift).toBe(false);

    const sales = await repo.getRecentSales(accession);
    expect(sales.length).toBe(2);
    expect(sales[0].seller_name).toBe("Timothy Go");
    expect(sales[0].amount_sold).toBe(16814);
    expect(sales[0].gross_proceeds).toBe(1123856.61);
  });

  it("observes the issuer + broker as companies and the seller as a person", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const persons = (await new PersonObservationRepo().listByAccession(accession)).map(
      (p) => p.last_name
    );
    const companies = (await new CompanyObservationRepo().listByAccession(accession)).map(
      (c) => c.name
    );

    expect(persons).toContain("Go Timothy");
    expect(companies).toContain("HF Sinclair");
    expect(companies).toContain("Pershing Advisor Solutions");
  });

  it("stamps observations with the dispatching extractor's id, not the form symbol", async () => {
    // The id reaches the observation rows and the run ledger, so it has to be
    // the id of the extractor that produced them. Re-deriving it from `form`
    // answers a different question, and answers it arbitrarily once a form
    // carries two extractors.
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144-second",
      doc,
    });

    const ids = [
      ...(await new PersonObservationRepo().listByAccession(accession)).map((p) => p.extractor_id),
      ...(await new CompanyObservationRepo().listByAccession(accession)).map((c) => c.extractor_id),
    ];
    expect(ids.length).toBeGreaterThan(0);
    expect([...new Set(ids)]).toEqual(["144-second"]);
  });

  it("stores a nothing-to-report amendment with acquisitions but no sales", async () => {
    const accession = "0001663266-26-000004";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144-a", "000166326626000004-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144/A", xml);
    await processForm144({
      cik: parseCikSafely(doc.formData?.issuerInfo?.issuerCik),
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144/A",
      extractor_id: "144",
      doc,
    });

    const filing = await repo.getFiling(accession);
    expect(filing?.nothing_to_report_past_3_months).toBe(true);
    expect((await repo.getRecentSales(accession)).length).toBe(0);
    expect((await repo.getAcquisitions(accession)).length).toBeGreaterThan(0);
  });

  it("stores null (not a fabricated 0) for an empty numeric element", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    // Simulate a filing that emits an empty <aggregateMarketValue/> element.
    doc.formData!.securitiesInformation!.aggregateMarketValue = "";
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const filing = await repo.getFiling(accession);
    expect(filing?.aggregate_market_value).toBeNull();
    // A populated sibling field still coerces to its real number.
    expect(filing?.no_of_units_sold).toBe(129915);
  });

  it("stores null (not a fabricated 0) for a whitespace-only aggregateMarketValue", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    // Filings have been observed with whitespace-only numeric elements, which
    // the previous local num() coerced to 0 via Number("   ") and silently
    // fabricated a market value.
    doc.formData!.securitiesInformation!.aggregateMarketValue = "   ";
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const filing = await repo.getFiling(accession);
    expect(filing?.aggregate_market_value).toBeNull();
    expect(filing?.no_of_units_sold).toBe(129915);
  });

  it("stores null (not a fabricated 0) for whitespace-only grossProceeds on a recent sale", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    doc.formData!.securitiesSoldInPast3Months![0].grossProceeds = "   ";
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const sales = await repo.getRecentSales(accession);
    expect(sales[0].gross_proceeds).toBeNull();
    expect(sales[0].amount_sold).toBe(16814);
  });

  it("stores null (not a fabricated 0) for whitespace-only amountOfSecuritiesAcquired", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    doc.formData!.securitiesToBeSold![0].amountOfSecuritiesAcquired = "   ";
    await processForm144({
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144",
      extractor_id: "144",
      doc,
    });

    const acquisitions = await repo.getAcquisitions(accession);
    expect(acquisitions[0].amount_acquired).toBeNull();
    // The second acquisition's populated field is unaffected.
    expect(acquisitions[1].amount_acquired).not.toBeNull();
  });

  it("clears stale rows when re-extracted with fewer acquisitions", async () => {
    const accession = "0001663266-26-000003";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-144", "000166326626000003-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_144.parse("144", xml);
    const args = {
      cik: 1534263,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "144" as const,
      extractor_id: "144",
    };

    await processForm144({ ...args, doc });
    expect((await repo.getAcquisitions(accession)).length).toBe(2);
    expect((await repo.getRecentSales(accession)).length).toBe(2);

    // Re-extract with the detail tables trimmed, as a parser change would.
    const fewer = {
      ...doc,
      formData: {
        ...doc.formData,
        securitiesToBeSold: doc.formData!.securitiesToBeSold!.slice(0, 1),
        securitiesSoldInPast3Months: undefined,
      },
    };
    await processForm144({ ...args, doc: fewer });

    expect((await repo.getAcquisitions(accession)).length).toBe(1);
    expect((await repo.getRecentSales(accession)).length).toBe(0);
  });
});

/**
 * The issuer's contact phone, junctioned to the ISSUER — not to the filer.
 *
 * A Form 144 is filed BY the selling shareholder ABOUT the issuer, so the
 * filing CIK belongs to someone else. Attaching the number there would hand a
 * shareholder the company's phone, which is why this one case junctions on
 * `issuerInfo.issuerCik` rather than the `cik` argument.
 */
describe("Form 144 issuer phone", () => {
  let phoneRepo: PhoneRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    phoneRepo = new PhoneRepo();
  });

  it("stores issuerContactPhone against the issuer CIK", async () => {
    const file = "000166326626000003-primary_doc.xml";
    const xml = readFileSync(join(__dirname, "mock_data", "form-144", file), "utf-8");
    const doc = await Form_144.parse("144", xml);
    const raw = doc.formData?.issuerInfo?.issuerContactPhone;
    expect(raw).toBeTruthy();
    const issuerCik = parseCikSafely(doc.formData?.issuerInfo?.issuerCik);
    expect(issuerCik).toBeTruthy();

    await processForm144({
      // A DIFFERENT filer CIK, which is the normal shape for this form and the
      // whole reason the junction must not use it.
      cik: 999_999_999,
      file_number: "",
      extractor_id: "144",
      accession_number: "test-accession-144-phone",
      filing_date: "2026-05-27",
      primary_doc: file,
      form: "144",
      doc,
    });

    const stored = ((await phoneRepo.phoneRepository.getAll()) ?? []).find(
      (row) => row.raw_phone === raw
    );
    expect(stored).toBeDefined();

    const junction =
      (await phoneRepo.phoneEntityJunctionRepository.query({
        international_number: stored!.international_number,
      })) ?? [];
    expect(junction.some((j) => Number(j.cik) === issuerCik)).toBe(true);
    expect(junction.some((j) => Number(j.cik) === 999_999_999)).toBe(false);
  });
});
