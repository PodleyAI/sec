/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { REGA_OFFERING_EVENT_REPOSITORY_TOKEN } from "../../../storage/reg-a/RegAOfferingEventSchema";
import { processRegAOfferingEvent } from "./RegAOfferingEvent.storage";

const repo = () => globalServiceRegistry.get(REGA_OFFERING_EVENT_REPOSITORY_TOKEN);

describe("processRegAOfferingEvent", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("records a supplement against the offering it amends", async () => {
    // The `024-` file number is the whole point: it is what joins a supplement
    // back to the offering line, and EDGAR supplies it on 100% of these filings
    // without the document being read.
    await processRegAOfferingEvent({
      cik: 1748441,
      accession_number: "0001493152-26-038483",
      form: "253G2",
      filing_date: "2026-06-30",
      file_number: "024-12709",
    });
    const [row] = (await repo().query({ accession_number: "0001493152-26-038483" })) ?? [];
    expect(row.event_type).toBe("circular_supplement");
    expect(row.file_number).toBe("024-12709");
    expect(row.form).toBe("253G2");
    expect(row.filing_date).toBe("2026-06-30");
  });

  it("records the two withdrawal kinds distinctly", async () => {
    await processRegAOfferingEvent({
      cik: 1,
      accession_number: "a",
      form: "1-A-W",
      filing_date: "2026-01-01",
      file_number: "024-1",
    });
    await processRegAOfferingEvent({
      cik: 2,
      accession_number: "b",
      form: "1-Z-W",
      filing_date: "2026-01-02",
      file_number: null,
    });
    expect(((await repo().query({ accession_number: "a" })) ?? [])[0].event_type).toBe(
      "offering_withdrawn"
    );
    expect(((await repo().query({ accession_number: "b" })) ?? [])[0].event_type).toBe(
      "exit_report_withdrawn"
    );
  });

  it("stores a missing file number as null rather than empty text", async () => {
    // Only the 1-Z-W family lacks one — it withdraws an exit report, so it
    // files under the reporting number or none at all.
    await processRegAOfferingEvent({
      cik: 3,
      accession_number: "c",
      form: "1-Z-W",
      filing_date: "2026-01-03",
      file_number: "   ",
    });
    expect(((await repo().query({ accession_number: "c" })) ?? [])[0].file_number).toBeNull();
  });

  it("is idempotent on replay", async () => {
    const args = {
      cik: 4,
      accession_number: "d",
      form: "253G1" as const,
      filing_date: "2026-01-04",
      file_number: "024-4",
    };
    await processRegAOfferingEvent(args);
    await processRegAOfferingEvent(args);
    expect((await repo().query({ accession_number: "d" })) ?? []).toHaveLength(1);
  });

  it("throws on a form it has no event type for", async () => {
    // A wiring error, not a property of the filing: no retry fixes it, and a
    // default would bury it under plausible-looking rows.
    await expect(
      processRegAOfferingEvent({
        cik: 5,
        accession_number: "e",
        form: "1-K",
        filing_date: "2026-01-05",
        file_number: "024-5",
      })
    ).rejects.toThrow(/no Reg A offering event type/i);
  });
});
