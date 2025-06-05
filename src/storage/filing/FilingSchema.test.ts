//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, it, expect, beforeEach } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { EntityRepo } from "../entity/EntityRepo";
import { Filing, FilingSchema } from "./FilingSchema";

describe("FilingSchema", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("should validate a valid filing object", () => {
    const validFiling: Filing = {
      cik: 1234567,
      accession_number: "0001234567-23-000001",
      filing_date: "2023-01-15",
      report_date: "2022-12-31",
      acceptance_date: "2023-01-15T16:30:00-05:00",
      form: "10-K",
      file_number: "001-12345",
      film_number: "23001234",
      primary_doc: "form10k.htm",
      primary_doc_description: "FORM 10-K",
      size: 1048576,
      is_xbrl: true,
      is_inline_xbrl: false,
      items: "Items 1-4",
      act: "34",
    };

    const isValid = Value.Check(FilingSchema, validFiling);
    expect(isValid).toBe(true);
  });

  it("should validate a filing with nullable fields as null", () => {
    const filingWithNulls: Filing = {
      cik: 1234567,
      accession_number: "0001234567-23-000001",
      filing_date: "2023-01-15",
      report_date: null,
      acceptance_date: "2023-01-15T16:30:00-05:00",
      form: null,
      file_number: null,
      film_number: null,
      primary_doc: "form10k.htm",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    };

    const isValid = Value.Check(FilingSchema, filingWithNulls);
    expect(isValid).toBe(true);
  });

  it("should save and retrieve a filing using EntityRepo", async () => {
    const entityRepo = new EntityRepo();

    const filing: Filing = {
      cik: 1234567,
      accession_number: "0001234567-23-000001",
      filing_date: "2023-01-15",
      report_date: "2022-12-31",
      acceptance_date: "2023-01-15T16:30:00-05:00",
      form: "10-K",
      file_number: "001-12345",
      film_number: "23001234",
      primary_doc: "form10k.htm",
      primary_doc_description: "FORM 10-K",
      size: 1048576,
      is_xbrl: true,
      is_inline_xbrl: false,
      items: "Items 1-4",
      act: "34",
    };

    // Save the filing
    await entityRepo.saveFiling(filing);

    // Retrieve the filing
    const retrievedFiling = await entityRepo.getFiling(filing.cik, filing.accession_number);

    expect(retrievedFiling).toEqual(filing);
  });

  it("should search filings by CIK", async () => {
    const entityRepo = new EntityRepo();
    const cik = 1234567;

    const filing1: Filing = {
      cik,
      accession_number: "0001234567-23-000001",
      filing_date: "2023-01-15",
      report_date: null,
      acceptance_date: "2023-01-15T16:30:00-05:00",
      form: "10-K",
      file_number: null,
      film_number: null,
      primary_doc: "form10k.htm",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    };

    const filing2: Filing = {
      cik,
      accession_number: "0001234567-23-000002",
      filing_date: "2023-03-15",
      report_date: null,
      acceptance_date: "2023-03-15T16:30:00-05:00",
      form: "10-Q",
      file_number: null,
      film_number: null,
      primary_doc: "form10q.htm",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    };

    // Save both filings
    await entityRepo.saveFiling(filing1);
    await entityRepo.saveFiling(filing2);

    // Search filings by CIK
    const filings = await entityRepo.getFilings(cik);

    expect(filings).toHaveLength(2);
    expect(filings).toContainEqual(filing1);
    expect(filings).toContainEqual(filing2);
  });

  it("should search filings by form type", async () => {
    const entityRepo = new EntityRepo();
    const cik = 1234567;

    const filing10K: Filing = {
      cik,
      accession_number: "0001234567-23-000001",
      filing_date: "2023-01-15",
      report_date: null,
      acceptance_date: "2023-01-15T16:30:00-05:00",
      form: "10-K",
      file_number: null,
      film_number: null,
      primary_doc: "form10k.htm",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    };

    const filing10Q: Filing = {
      cik,
      accession_number: "0001234567-23-000002",
      filing_date: "2023-03-15",
      report_date: null,
      acceptance_date: "2023-03-15T16:30:00-05:00",
      form: "10-Q",
      file_number: null,
      film_number: null,
      primary_doc: "form10q.htm",
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    };

    // Save both filings
    await entityRepo.saveFiling(filing10K);
    await entityRepo.saveFiling(filing10Q);

    // Search filings by form type
    const tenKFilings = await entityRepo.getFilingsByForm(cik, "10-K");
    const tenQFilings = await entityRepo.getFilingsByForm(cik, "10-Q");

    expect(tenKFilings).toHaveLength(1);
    expect(tenKFilings[0]).toEqual(filing10K);

    expect(tenQFilings).toHaveLength(1);
    expect(tenQFilings[0]).toEqual(filing10Q);
  });
});
