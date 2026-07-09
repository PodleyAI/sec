/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { PersonObservationRepo } from "../../../../storage/observation/PersonObservationRepo";
import { birthYearFromAge, processFormS1 } from "../Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

const MGMT_SENTENCE = "John Doe, age 55, has served as our Chief Executive Officer since 2019.";
const BODY = [
  `<h1>MANAGEMENT</h1><p>${MGMT_SENTENCE}</p>`,
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>x</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>x</p>",
].join("");

function runArgs(cik: number, accession: string, sic: number | null) {
  return {
    cik,
    file_number: "333-1",
    accession_number: accession,
    filing_date: "2026-01-01",
    primary_doc: `${accession}.txt`,
    form: "S-1",
    formS1: {
      header: { sic, sicDescription: null, cik: null, companyName: "OpCo Inc", filingDate: null },
      html: BODY,
    } as never,
    model: fakeS1Model(),
  };
}

describe("birthYearFromAge", () => {
  it("derives birth year from a plausible age relative to the filing year", () => {
    expect(birthYearFromAge(55, "2026-01-01")).toBe(1971);
    expect(birthYearFromAge(40, "2020-06-30")).toBe(1980);
  });
  it("returns null for missing / implausible age or bad filing date", () => {
    expect(birthYearFromAge(null, "2026-01-01")).toBeNull();
    expect(birthYearFromAge(5, "2026-01-01")).toBeNull();
    expect(birthYearFromAge(200, "2026-01-01")).toBeNull();
    expect(birthYearFromAge(55, "not-a-date")).toBeNull();
  });
});

describe("Leadership bio + birth_year end-to-end", () => {
  let unregister: (() => void) | undefined;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists birth_year (from age) and bio on the management observation", async () => {
    // Non-SPAC S-1 → no profile section; call order is management, ownership, related.
    ({ unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "John Doe",
            title: "Chief Executive Officer",
            relationship: null,
            age: 55,
            bio: "Has served as our CEO since 2019 and previously led two public companies.",
            confidence: 0.95,
            source_span: "John Doe, age 55, has served as our Chief Executive Officer",
          },
        ],
      },
      { owners: [] },
      { parties: [] },
    ]));

    await processFormS1(runArgs(900001, "0000000000-26-000801", 3571));

    const rows = await new PersonObservationRepo().listByAccession("0000000000-26-000801");
    const john = rows.find((r) => r.last_name === "Doe");
    expect(john).toBeDefined();
    expect(john!.title).toBe("Chief Executive Officer");
    expect(john!.birth_year).toBe(1971); // 2026 - 55
    expect(john!.bio).toContain("served as our CEO since 2019");
  });
});
