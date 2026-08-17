/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_3 } from "./Form_3";
import { Form_4 } from "./Form_4";
import { Form_5 } from "./Form_5";
import { processOwnershipForm } from "./OwnershipDocument.storage";
import { Section16Repo } from "../../../storage/section16/Section16Repo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { ADDRESS_REPOSITORY_TOKEN } from "../../../storage/address/AddressSchema";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { accessionFromFixtureName } from "../../../util/accession";
import { parseCikSafely } from "../../../util/parseCik";

const CASES = [
  { dir: "form-3", form: "3" as const, parser: Form_3 },
  { dir: "form-3-a", form: "3/A" as const, parser: Form_3 },
  { dir: "form-4", form: "4" as const, parser: Form_4 },
  { dir: "form-4-a", form: "4/A" as const, parser: Form_4 },
  { dir: "form-5", form: "5" as const, parser: Form_5 },
];

function listFixtures(dir: string): string[] {
  return readdirSync(join(__dirname, "mock_data", dir)).filter((f) =>
    f.endsWith("-primary_doc.xml")
  );
}

describe("OwnershipDocument storage (Forms 3/4/5)", () => {
  let repo: Section16Repo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new Section16Repo();
  });

  it("parses and stores every fixture without error", async () => {
    const errors: Array<{ file: string; error: string }> = [];
    let count = 0;

    for (const { dir, form, parser } of CASES) {
      for (const file of listFixtures(dir)) {
        count++;
        const accession = accessionFromFixtureName(file);
        try {
          const xml = readFileSync(join(__dirname, "mock_data", dir, file), "utf-8");
          const doc = await (parser as typeof Form_4).parse(form as "4", xml);
          await processOwnershipForm({
            cik: parseCikSafely(doc.issuer?.issuerCik),
            file_number: "",
            accession_number: accession,
            filing_date: "2026-05-27",
            primary_doc: file,
            form,
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

  it("stores a Form 4 with non-derivative and derivative transactions", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const filing = await repo.getFiling(accession);
    expect(filing?.issuer_name).toBe("HCW Biologics Inc.");
    expect(filing?.not_subject_to_section16).toBe(false);

    const txns = await repo.getTransactions(accession);
    expect(txns.length).toBe(2);

    const nonDeriv = txns.find((t) => !t.is_derivative)!;
    expect(nonDeriv.transaction_code).toBe("P");
    expect(nonDeriv.shares).toBe(177936);
    expect(nonDeriv.price_per_share).toBe(1.405);
    expect(nonDeriv.acquired_disposed_code).toBe("A");
    expect(nonDeriv.shares_owned_following).toBe(203441);

    const deriv = txns.find((t) => t.is_derivative)!;
    expect(deriv.conversion_or_exercise_price).toBe(1.28);
    expect(deriv.expiration_date).toBe("2031-11-22");
    expect(deriv.underlying_security_title).toBe("Common Stock");
    expect(deriv.underlying_security_shares).toBe(177936);
  });

  it("classifies directors/officers as persons and entities as companies", async () => {
    // Multi-owner Form 4: an individual 10% owner plus two fund entities.
    const accession = "0000902664-26-002604";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000090266426002604-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    await processOwnershipForm({
      cik: 885508,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const persons = (await new PersonObservationRepo().listByAccession(accession)).map(
      (p) => p.last_name
    );
    const companies = (await new CompanyObservationRepo().listByAccession(accession)).map(
      (c) => c.name
    );

    expect(persons).toContain("Fischer Seth");
    expect(companies).toContain("STRATUS PROPERTIES INC"); // issuer
    expect(companies).toContain("Oasis Management Co Ltd.");
    expect(companies).toContain("Oasis Investments II Master Fund Ltd.");
  });

  it("clears stale rows when a filing is re-extracted with fewer transactions", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);

    // First pass: one non-derivative + one derivative transaction = 2 rows.
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });
    expect((await repo.getTransactions(accession)).length).toBe(2);

    // Re-extract the same accession but with the derivative table removed, as a
    // parser change reducing the row count would produce.
    const fewer = { ...doc, derivativeTable: undefined };
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc: fewer,
    });

    const txns = await repo.getTransactions(accession);
    expect(txns.length).toBe(1); // no orphaned derivative row left behind
    expect(txns[0].is_derivative).toBe(false);
  });

  it("stores Form 3/A holdings (non-derivative and derivative)", async () => {
    const accession = "0000950103-26-007758";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-3-a", "000095010326007758-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_3.parse("3/A", xml);
    await processOwnershipForm({
      cik: 1122411,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "3/A",
      doc,
    });

    const holdings = await repo.getHoldings(accession);
    expect(holdings.length).toBe(3);

    const nonDeriv = holdings.filter((h) => !h.is_derivative);
    expect(nonDeriv.length).toBe(1);
    expect(nonDeriv[0].security_title).toBe("Ordinary Shares");
    expect(nonDeriv[0].shares_owned_following).toBe(30000);

    const deriv = holdings.filter((h) => h.is_derivative);
    expect(deriv.length).toBe(2);
    expect(deriv[0].conversion_or_exercise_price).toBe(41.1);
    expect(deriv[0].underlying_security_shares).toBe(365000);
    // exerciseDate carried only a footnote id -> null, no transaction rows.
    expect(deriv[0].exercise_date).toBeNull();

    // A Form 3 reports holdings only, never transactions.
    expect((await repo.getTransactions(accession)).length).toBe(0);

    // The officer is observed as a person with the officer title.
    const persons = await new PersonObservationRepo().listByAccession(accession);
    expect(persons.some((p) => p.last_name === "Chung Chih-Hsiao")).toBe(true);
  });

  it("stores null (not 0) for an empty transactionShares element on a Form 4", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    // Simulate a filing that emits an empty <transactionShares><value/></transactionShares>.
    const nonDerivTxn = doc.nonDerivativeTable!.nonDerivativeTransaction![0];
    nonDerivTxn.transactionAmounts!.transactionShares!.value = "";
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const txns = await repo.getTransactions(accession);
    const nonDeriv = txns.find((t) => !t.is_derivative)!;
    expect(nonDeriv.shares).toBeNull();
    // A populated sibling field still coerces to its real number.
    expect(nonDeriv.price_per_share).toBe(1.405);
  });

  it("stores null (not 0) for a whitespace-only transactionShares element", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    const nonDerivTxn = doc.nonDerivativeTable!.nonDerivativeTransaction![0];
    nonDerivTxn.transactionAmounts!.transactionShares!.value = "   ";
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const txns = await repo.getTransactions(accession);
    const nonDeriv = txns.find((t) => !t.is_derivative)!;
    expect(nonDeriv.shares).toBeNull();
    expect(nonDeriv.price_per_share).toBe(1.405);
  });

  it("stores null (not 0) for an empty transactionPricePerShare element", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    const nonDerivTxn = doc.nonDerivativeTable!.nonDerivativeTransaction![0];
    nonDerivTxn.transactionAmounts!.transactionPricePerShare!.value = "";
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const txns = await repo.getTransactions(accession);
    const nonDeriv = txns.find((t) => !t.is_derivative)!;
    expect(nonDeriv.price_per_share).toBeNull();
    expect(nonDeriv.shares).toBe(177936);
  });

  it("stores null (not 0) for an empty sharesOwnedFollowingTransaction on a holding", async () => {
    const accession = "0000950103-26-007758";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-3-a", "000095010326007758-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_3.parse("3/A", xml);
    const nonDerivHold = doc.nonDerivativeTable!.nonDerivativeHolding![0];
    nonDerivHold.postTransactionAmounts!.sharesOwnedFollowingTransaction!.value = "";
    await processOwnershipForm({
      cik: 1122411,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "3/A",
      doc,
    });

    const holdings = await repo.getHoldings(accession);
    const nonDeriv = holdings.find((h) => !h.is_derivative)!;
    expect(nonDeriv.shares_owned_following).toBeNull();
  });

  it("stores null (not 0) for an empty derivative conversionOrExercisePrice", async () => {
    const accession = "0000950103-26-007758";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-3-a", "000095010326007758-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_3.parse("3/A", xml);
    const derivHold = doc.derivativeTable!.derivativeHolding![0];
    derivHold.conversionOrExercisePrice!.value = "";
    await processOwnershipForm({
      cik: 1122411,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "3/A",
      doc,
    });

    const holdings = await repo.getHoldings(accession);
    const deriv = holdings.filter((h) => h.is_derivative);
    expect(deriv[0].conversion_or_exercise_price).toBeNull();
    // The other derivative holding still carries its real price.
    expect(deriv[1].conversion_or_exercise_price).not.toBeNull();
  });

  it("preserves null issuer CIK on reporting-owner observations (S-MAIN-01)", async () => {
    // Two unrelated Form 4 filings whose XML omits issuer.issuerCik (or carries
    // an unparseable value) must NOT collapse two reporting owners that happen
    // to share a name into one canonical person. The observation must carry
    // source_filing_issuer_cik=null instead of the raw 0 sentinel that
    // PersonResolver's name-fallback key would conflate across filers.
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const docA = await Form_4.parse("4", xml);
    const docB = await Form_4.parse("4", xml);

    // Strip the issuer CIK on both filings (different accessions). Use a
    // distinct reporting-owner name so we can find it back later.
    const SHARED_NAME = "Smith John A";
    docA.issuer!.issuerCik = undefined;
    docB.issuer!.issuerCik = undefined;
    // Rewrite each filing's first reporting owner to the same name with no CIK
    // so the resolver hits the name-fallback path (not the CIK fast-path).
    docA.reportingOwner![0].reportingOwnerId!.rptOwnerName = { value: SHARED_NAME };
    docA.reportingOwner![0].reportingOwnerId!.rptOwnerCik = undefined;
    docB.reportingOwner![0].reportingOwnerId!.rptOwnerName = { value: SHARED_NAME };
    docB.reportingOwner![0].reportingOwnerId!.rptOwnerCik = undefined;

    const accessionA = "0001493152-26-025476";
    const accessionB = "0001493152-26-099999";

    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accessionA,
      filing_date: "2026-05-27",
      primary_doc: "a.xml",
      form: "4",
      doc: docA,
    });
    await processOwnershipForm({
      cik: 9999999,
      file_number: "",
      accession_number: accessionB,
      filing_date: "2026-05-27",
      primary_doc: "b.xml",
      form: "4",
      doc: docB,
    });

    const obsA = (await new PersonObservationRepo().listByAccession(accessionA)).find(
      (p) => p.last_name === SHARED_NAME
    );
    const obsB = (await new PersonObservationRepo().listByAccession(accessionB)).find(
      (p) => p.last_name === SHARED_NAME
    );
    expect(obsA).toBeDefined();
    expect(obsB).toBeDefined();
    // The fix: source_filing_issuer_cik is null, not 0.
    expect(obsA!.source_filing_issuer_cik).toBeNull();
    expect(obsB!.source_filing_issuer_cik).toBeNull();
  });

  it("stores null (not 0) for an empty underlyingSecurityShares on a derivative transaction", async () => {
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    const derivTxn = doc.derivativeTable!.derivativeTransaction![0];
    derivTxn.underlyingSecurity!.underlyingSecurityShares!.value = "";
    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const txns = await repo.getTransactions(accession);
    const deriv = txns.find((t) => t.is_derivative)!;
    expect(deriv.underlying_security_shares).toBeNull();
    // A populated sibling field still coerces to its real number.
    expect(deriv.conversion_or_exercise_price).toBe(1.28);
  });

  it("keeps a reporting owner whose foreign address has no city", async () => {
    // EDGAR codes UK/HK/BVI in stateOrCountry (X0/K3/D8) with a null city.
    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    const addr = doc.reportingOwner![0]!.reportingOwnerAddress!;
    addr.rptOwnerCity = undefined;
    addr.rptOwnerState = undefined;
    addr.rptOwnerNonUSAddressFlag = "true";
    addr.rptOwnerCountry = "X0";

    await processOwnershipForm({
      cik: 1828673,
      file_number: "",
      accession_number: accession,
      filing_date: "2026-05-27",
      primary_doc: "x.xml",
      form: "4",
      doc,
    });

    const persons = (await new PersonObservationRepo().listByAccession(accession)).map(
      (p) => p.last_name
    );
    expect(persons).toContain("GARRETT SCOTT T");
    const owner = (await new PersonObservationRepo().listByAccession(accession)).find(
      (p) => p.last_name === "GARRETT SCOTT T"
    );
    expect(owner?.raw_address_id).toBeTruthy();
    const saved = await globalServiceRegistry
      .get(ADDRESS_REPOSITORY_TOKEN)
      .get({ address_hash_id: owner!.raw_address_id! });
    expect(saved?.country_code).toBe("GB");
    expect(saved?.city).toBe("UNITED KINGDOM");
  });

  it("propagates a real address-store failure instead of swallowing it", async () => {
    const addrStore = globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN);
    const originalPut = addrStore.put.bind(addrStore);
    addrStore.put = (async () => {
      throw new Error("db down");
    }) as typeof addrStore.put;

    const accession = "0001493152-26-025476";
    const xml = readFileSync(
      join(__dirname, "mock_data", "form-4", "000149315226025476-primary_doc.xml"),
      "utf-8"
    );
    const doc = await Form_4.parse("4", xml);
    try {
      await expect(
        processOwnershipForm({
          cik: 1828673,
          file_number: "",
          accession_number: accession,
          filing_date: "2026-05-27",
          primary_doc: "x.xml",
          form: "4",
          doc,
        })
      ).rejects.toThrow("db down");
    } finally {
      addrStore.put = originalPut;
    }
  });
});
