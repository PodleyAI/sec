/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { Form8KEventRepo } from "./Form8KEventRepo";
import { Form8KEvent } from "./Form8KEventSchema";

describe("Form8KEventRepo", () => {
  let repo: Form8KEventRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new Form8KEventRepo();
  });

  it("should save and retrieve events by accession number", async () => {
    const event: Form8KEvent = {
      cik: 320193,
      accession_number: "0001193125-24-000001",
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-01-15",
      report_date: "2024-01-15",
      is_amendment: false,
    };

    await repo.saveEvent(event);
    const results = await repo.getEventsByAccession(320193, "0001193125-24-000001");
    expect(results.length).toBe(1);
    expect(results[0].item_code).toBe("2.02");
    expect(results[0].item_description).toBe("Results of Operations and Financial Condition");
    expect(results[0].is_amendment).toBe(false);
  });

  it("should save multiple events for same filing", async () => {
    const events: Form8KEvent[] = [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        item_code: "2.02",
        item_description: "Results of Operations and Financial Condition",
        filing_date: "2024-01-15",
        report_date: "2024-01-15",
        is_amendment: false,
      },
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        item_code: "9.01",
        item_description: "Financial Statements and Exhibits",
        filing_date: "2024-01-15",
        report_date: "2024-01-15",
        is_amendment: false,
      },
    ];

    for (const event of events) {
      await repo.saveEvent(event);
    }

    const results = await repo.getEventsByAccession(320193, "0001193125-24-000001");
    expect(results.length).toBe(2);
  });

  it("should retrieve events by CIK", async () => {
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000001",
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-01-15",
      report_date: "2024-01-15",
      is_amendment: false,
    });
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000002",
      item_code: "5.02",
      item_description:
        "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers: Compensatory Arrangements of Certain Officers",
      filing_date: "2024-02-20",
      report_date: "2024-02-20",
      is_amendment: false,
    });

    const results = await repo.getEventsByCik(320193);
    expect(results.length).toBe(2);
  });

  it("should retrieve events by item code", async () => {
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000001",
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-01-15",
      report_date: "2024-01-15",
      is_amendment: false,
    });
    await repo.saveEvent({
      cik: 1018724,
      accession_number: "0001193125-24-000002",
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-02-20",
      report_date: "2024-02-20",
      is_amendment: false,
    });

    const results = await repo.getEventsByItemCode("2.02");
    expect(results.length).toBe(2);
  });

  it("should handle amendment flag correctly", async () => {
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000003",
      item_code: "1.01",
      item_description: "Entry into a Material Definitive Agreement",
      filing_date: "2024-03-10",
      report_date: "2024-03-10",
      is_amendment: true,
    });

    const results = await repo.getEventsByAccession(320193, "0001193125-24-000003");
    expect(results[0].is_amendment).toBe(true);
  });
});
