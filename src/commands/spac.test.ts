/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import { assembleSpacReport, spacProcessRows } from "./spac";

describe("assembleSpacReport", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("assembles row + events for a populated SPAC", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 99,
      accession_number: "reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: null,
      spac_name: "Test SPAC",
      spac_sic: 6770,
    });
    const report = await assembleSpacReport(99);
    expect(report.spac?.spac_name).toBe("Test SPAC");
    expect(report.events.length).toBe(1);
    expect(report.sponsorCount).toBe(0);
  });
});

describe("spacProcessRows", () => {
  it("transposes the fan-out's column arrays into one row per issuer", () => {
    // `sec spac process A B C` runs one map over all three issuers, and the
    // sink merges each output port into an index-aligned column. Rendering
    // reads rows, so the columns have to be zipped back — and `cik` comes from
    // the task's own echoed port, never from the input list, so a row can never
    // be printed under the wrong issuer.
    expect(
      spacProcessRows({
        cik: [11, 22, 33],
        matched: [5, 0, 2],
        processed: [5, 0, 0],
        firstDate: ["2021-01-01", "", "2022-01-01"],
        lastDate: ["2021-12-31", "", "2022-06-30"],
        error: ["", "", "filing store unavailable"],
      })
    ).toEqual([
      {
        cik: 11,
        matched: 5,
        processed: 5,
        firstDate: "2021-01-01",
        lastDate: "2021-12-31",
        error: "",
      },
      { cik: 22, matched: 0, processed: 0, firstDate: "", lastDate: "", error: "" },
      {
        cik: 33,
        matched: 2,
        processed: 0,
        firstDate: "2022-01-01",
        lastDate: "2022-06-30",
        error: "filing store unavailable",
      },
    ]);
  });

  it("renders a single-issuer run, whose ports merge to scalars rather than arrays", () => {
    // A one-iteration map does not produce one-element arrays; the merge
    // collapses each port to a bare value. `sec spac process 1234567` is the
    // single most common invocation, so the scalar shape has to render.
    expect(
      spacProcessRows({
        cik: 1234567,
        matched: 58,
        processed: 0,
        firstDate: "2020-01-01",
        lastDate: "2023-01-01",
        error: "",
      })
    ).toEqual([
      {
        cik: 1234567,
        matched: 58,
        processed: 0,
        firstDate: "2020-01-01",
        lastDate: "2023-01-01",
        error: "",
      },
    ]);
  });
});
