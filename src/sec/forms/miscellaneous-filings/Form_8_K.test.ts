/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { Form_8_K } from "./Form_8_K";
import { processForm8K } from "./Form_8_K.storage";
import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";

describe("Form_8_K", () => {
  let eventRepo: Form8KEventRepo;
  let personRepo: PersonRepo;
  let companyRepo: CompanyRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    eventRepo = new Form8KEventRepo();
    personRepo = new PersonRepo();
    companyRepo = new CompanyRepo();
  });

  describe("parsing", () => {
    it("should parse XML 8-K primary documents", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000001-primary_doc.xml"),
        "utf-8"
      );

      const form8K = await Form_8_K.parse("8-K", xmlContent);

      expect(form8K.submissionType).toBe("8-K");
      expect(form8K.formData?.periodOfReport).toBe("2024-01-15");
      expect(form8K.formData?.items?.item).toEqual(["2.02", "9.01"]);
      expect(form8K.formData?.signatureBlock?.signature).toBeDefined();
    });

    it("should parse 8-K/A amendments", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000003-primary_doc.xml"),
        "utf-8"
      );

      const form8K = await Form_8_K.parse("8-K/A", xmlContent);

      expect(form8K.submissionType).toBe("8-K/A");
      expect(form8K.formData?.items?.item).toEqual(["1.01"]);
    });

    it("should handle HTML primary documents gracefully", async () => {
      const htmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000004-primary_doc.htm"),
        "utf-8"
      );

      const form8K = await Form_8_K.parse("8-K", htmlContent);

      // HTML docs return a minimal empty result
      expect(form8K).toEqual({});
    });

    it("should reject invalid form types", async () => {
      expect(Form_8_K.parse("10-K" as any, "<xml/>")).rejects.toThrow("Invalid form");
    });
  });

  describe("storage", () => {
    it("should store 8-K events from XML with items", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000001-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", xmlContent);

      await processForm8K({
        cik: 320193,
        accession_number: "000119312524000001",
        filing_date: "2024-01-15",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2024-01-15",
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(320193, "000119312524000001");
      expect(events.length).toBe(2);

      const item202 = events.find((e) => e.item_code === "2.02");
      expect(item202).toBeDefined();
      expect(item202?.item_description).toBe("Results of Operations and Financial Condition");
      expect(item202?.is_amendment).toBe(false);
      expect(item202?.report_date).toBe("2024-01-15");

      const item901 = events.find((e) => e.item_code === "9.01");
      expect(item901).toBeDefined();
      expect(item901?.item_description).toBe("Financial Statements and Exhibits");
    });

    it("should store 8-K events from filing metadata when primary doc is HTML", async () => {
      const htmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000004-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", htmlContent);

      await processForm8K({
        cik: 320193,
        accession_number: "000119312524000004",
        filing_date: "2024-01-30",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2024-01-30",
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(320193, "000119312524000004");
      expect(events.length).toBe(2);
      expect(events.map((e) => e.item_code).sort()).toEqual(["2.02", "9.01"]);
    });

    it("should mark amendments correctly", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000003-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K/A", xmlContent);

      await processForm8K({
        cik: 789019,
        accession_number: "000119312524000003",
        filing_date: "2024-03-10",
        form: "8-K/A",
        items: "1.01",
        report_date: "2024-03-10",
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(789019, "000119312524000003");
      expect(events.length).toBe(1);
      expect(events[0].is_amendment).toBe(true);
      expect(events[0].item_code).toBe("1.01");
      expect(events[0].item_description).toBe("Entry into a Material Definitive Agreement");
    });

    it("should store signatures from XML", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000001-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", xmlContent);

      await processForm8K({
        cik: 320193,
        accession_number: "000119312524000001",
        filing_date: "2024-01-15",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2024-01-15",
        form8K,
      });

      // Verify the signer was stored as a person
      const allPersons = await personRepo.personRepository.getAll();
      const johnSmith = allPersons?.find(
        (person) => person.first === "John" && person.last === "Smith"
      );
      expect(johnSmith).toBeDefined();

      // Verify signature relationship
      const personRelations = await personRepo.personEntityJunctionRepository.query({
        cik: 320193,
        relation_name: "form-8k:signature",
      });
      expect(personRelations?.length || 0).toBe(1);
      expect(personRelations?.[0]?.titles).toContain("Chief Financial Officer");
    });

    it("should store multiple signatures", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000002-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", xmlContent);

      await processForm8K({
        cik: 1018724,
        accession_number: "000119312524000002",
        filing_date: "2024-02-20",
        form: "8-K",
        items: "5.02,5.03,9.01",
        report_date: "2024-02-20",
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(1018724, "000119312524000002");
      expect(events.length).toBe(3);

      const allPersons = await personRepo.personRepository.getAll();
      expect(allPersons?.length || 0).toBe(2);

      const janeDoe = allPersons?.find(
        (person) => person.first === "Jane" && person.last === "Doe"
      );
      expect(janeDoe).toBeDefined();

      const robertJohnson = allPersons?.find(
        (person) => person.first === "Robert" && person.last === "Johnson"
      );
      expect(robertJohnson).toBeDefined();
    });

    it("should store company signers correctly", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000003-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K/A", xmlContent);

      await processForm8K({
        cik: 789019,
        accession_number: "000119312524000003",
        filing_date: "2024-03-10",
        form: "8-K/A",
        items: "1.01",
        report_date: "2024-03-10",
        form8K,
      });

      // "Acme Corp LLC" should be stored as a company, not a person
      const allCompanies = await companyRepo.companyRepository.getAll();
      const acmeCorp = allCompanies?.find((company) =>
        company.company_name.includes("Acme Corp")
      );
      expect(acmeCorp).toBeDefined();

      const companyRelations = await companyRepo.companyEntityJunctionRepository.query({
        cik: 789019,
        relation_name: "form-8k:signature",
      });
      expect(companyRelations?.length || 0).toBe(1);
    });

    it("should merge items from filing metadata and XML", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312524000001-primary_doc.xml"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", xmlContent);

      // Filing metadata has an extra item not in XML
      await processForm8K({
        cik: 320193,
        accession_number: "000119312524000001",
        filing_date: "2024-01-15",
        form: "8-K",
        items: "2.02,9.01,7.01",
        report_date: "2024-01-15",
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(320193, "000119312524000001");
      expect(events.length).toBe(3);
      expect(events.map((e) => e.item_code).sort()).toEqual(["2.02", "7.01", "9.01"]);
    });

    it("should handle null items gracefully", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html><body>empty</body></html>");

      await processForm8K({
        cik: 320193,
        accession_number: "000119312524000099",
        filing_date: "2024-01-15",
        form: "8-K",
        items: null,
        report_date: null,
        form8K,
      });

      const events = await eventRepo.getEventsByAccession(320193, "000119312524000099");
      expect(events.length).toBe(0);
    });
  });
});
