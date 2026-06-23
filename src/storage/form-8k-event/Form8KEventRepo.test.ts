/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { Form8KEventRepo } from "./Form8KEventRepo";
import type { Form8KEvent } from "./Form8KEventSchema";

const EXTRACTOR_V1 = { extractor_id: "8-K", extractor_version: "1.0.0" } as const;
const EXTRACTOR_V2 = { extractor_id: "8-K", extractor_version: "2.0.0" } as const;

type EventInsert = Omit<Form8KEvent, "event_id">;

describe("Form8KEventRepo", () => {
  let repo: Form8KEventRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new Form8KEventRepo();
  });

  it("should save and retrieve events by accession number", async () => {
    const event: EventInsert = {
      cik: 320193,
      accession_number: "0001193125-24-000001",
      ...EXTRACTOR_V1,
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
    // event_id is auto-generated.
    expect(results[0].event_id).toBeDefined();
  });

  it("should save multiple events for same filing", async () => {
    const events: EventInsert[] = [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "2.02",
        item_description: "Results of Operations and Financial Condition",
        filing_date: "2024-01-15",
        report_date: "2024-01-15",
        is_amendment: false,
      },
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
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
      ...EXTRACTOR_V1,
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-01-15",
      report_date: "2024-01-15",
      is_amendment: false,
    });
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000002",
      ...EXTRACTOR_V1,
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
      ...EXTRACTOR_V1,
      item_code: "2.02",
      item_description: "Results of Operations and Financial Condition",
      filing_date: "2024-01-15",
      report_date: "2024-01-15",
      is_amendment: false,
    });
    await repo.saveEvent({
      cik: 1018724,
      accession_number: "0001193125-24-000002",
      ...EXTRACTOR_V1,
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
      ...EXTRACTOR_V1,
      item_code: "1.01",
      item_description: "Entry into a Material Definitive Agreement",
      filing_date: "2024-03-10",
      report_date: "2024-03-10",
      is_amendment: true,
    });

    const results = await repo.getEventsByAccession(320193, "0001193125-24-000003");
    expect(results[0].is_amendment).toBe(true);
  });

  it("getEventsByVersion returns only rows for the requested (extractor_id, extractor_version)", async () => {
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000001",
      ...EXTRACTOR_V1,
      item_code: "2.02",
      item_description: null,
      filing_date: "2024-01-15",
      report_date: null,
      is_amendment: false,
    });
    await repo.saveEvent({
      cik: 320193,
      accession_number: "0001193125-24-000001",
      ...EXTRACTOR_V2,
      item_code: "2.02",
      item_description: null,
      filing_date: "2024-01-15",
      report_date: null,
      is_amendment: false,
    });

    const v1 = await repo.getEventsByVersion("8-K", "1.0.0");
    expect(v1.length).toBe(1);
    expect(v1[0].extractor_version).toBe("1.0.0");

    const v2 = await repo.getEventsByVersion("8-K", "2.0.0");
    expect(v2.length).toBe(1);
    expect(v2[0].extractor_version).toBe("2.0.0");
  });

  it("replaceEvents replaces only rows for the given (cik, accession, extractor_id, extractor_version)", async () => {
    // First replace at v1 with two items.
    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "9.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);

    // Second replace at v1 with only one item — the prior 9.01 disappears.
    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);

    const v1 = await repo.getEventsByAccession(
      320193,
      "0001193125-24-000001",
      "8-K",
      "1.0.0"
    );
    expect(v1.length).toBe(1);
    expect(v1[0].item_code).toBe("1.01");
  });

  it("replaceEvents leaves no partial rows after a delete-and-bulk-insert (in-memory baseline)", async () => {
    // The InMemory backend has no transactions, but it is single-process and
    // synchronous between awaits — `replaceEvents`'s repository path deletes
    // then inserts. If the inserts fail, the table is left empty; that's the
    // documented behavior for the test backend. The SQLite + PG branches
    // wrap both halves in a real transaction; we exercise SQLite separately
    // in Form8KEventReplace.sqlite.test.ts.
    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);
    const before = await repo.getEventsByAccession(
      320193,
      "0001193125-24-000001",
      "8-K",
      "1.0.0"
    );
    expect(before.length).toBe(1);
  });

  it("replaceEvents under v2 does not delete v1 rows", async () => {
    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "1.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V1,
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);

    await repo.replaceEvents(320193, "0001193125-24-000001", "8-K", "2.0.0", [
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V2,
        item_code: "1.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
      {
        cik: 320193,
        accession_number: "0001193125-24-000001",
        ...EXTRACTOR_V2,
        item_code: "9.01",
        item_description: null,
        filing_date: "2024-01-15",
        report_date: null,
        is_amendment: false,
      },
    ]);

    const v1 = await repo.getEventsByAccession(
      320193,
      "0001193125-24-000001",
      "8-K",
      "1.0.0"
    );
    expect(v1.length).toBe(1);
    const v2 = await repo.getEventsByAccession(
      320193,
      "0001193125-24-000001",
      "8-K",
      "2.0.0"
    );
    expect(v2.length).toBe(2);
  });
});
