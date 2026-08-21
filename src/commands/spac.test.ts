/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runSpacTimelineIssuers } from "../cli/sync/runSpacTimelineIssuers";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import type { ProcessSpacTimelineTaskOutput } from "../task/spac/ProcessSpacTimelineTask";
import {
  assembleSpacReport,
  formatSpacProcessDeadLetterHint,
  formatSpacProcessSummary,
  spacProcessFailureCount,
  spacProcessRows,
} from "./spac";

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
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

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
        partial: [0, 0, 0],
        failed: [0, 0, 0],
        nonfatal: [0, 0, 0],
        triage: [0, 0, 0],
        skipped: [0, 0, 0],
        triageExtractors: ["", "", ""],
        firstDate: ["2021-01-01", "", "2022-01-01"],
        lastDate: ["2021-12-31", "", "2022-06-30"],
        error: ["", "", "filing store unavailable"],
      })
    ).toEqual([
      {
        cik: 11,
        matched: 5,
        processed: 5,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "2021-01-01",
        lastDate: "2021-12-31",
        error: "",
      },
      {
        cik: 22,
        matched: 0,
        processed: 0,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "",
        lastDate: "",
        error: "",
      },
      {
        cik: 33,
        matched: 2,
        processed: 0,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "2022-01-01",
        lastDate: "2022-06-30",
        error: "filing store unavailable",
      },
    ]);
  });

  it.each([
    ["a single issuer", [4440]],
    ["several issuers", [4441, 4442, 4443]],
  ])(
    "renders what the real %s fan-out actually merges to",
    async (_label, ciks: readonly number[]) => {
      // The shape `spacProcessRows` consumes is produced by `runSpacTimelineIssuers`,
      // not asserted anywhere else — so run the same graph `sec spac process` and
      // `sync spacs --step process` build. Notably a ONE-iteration map still
      // merges to a one-element array per port rather than a bare scalar.
      const rows = await runSpacTimelineIssuers({
        ciks,
        concurrency: ciks.length,
      });

      expect(rows.map((row) => row.cik)).toEqual([...ciks]);
      // None of these CIKs has a filing, so every issuer reports an empty
      // timeline — the point here is the shape and the per-issuer labelling.
      expect(rows).toEqual(
        ciks.map((cik) => ({
          cik,
          matched: 0,
          processed: 0,
          partial: 0,
          failed: 0,
          nonfatal: 0,
          triage: 0,
          skipped: 0,
          triageExtractors: "",
          firstDate: "",
          lastDate: "",
          error: "",
        }))
      );
    }
  );
});

describe("formatSpacProcessSummary", () => {
  it("keeps a clean run as CIK: N/N filings (from → to)", () => {
    expect(
      formatSpacProcessSummary({
        cik: 1822912,
        matched: 52,
        processed: 52,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "2020-09-23",
        lastDate: "2023-10-03",
        error: "",
      })
    ).toBe("1822912: 52/52 filings (2020-09-23 \u2192 2023-10-03)");
  });

  it("names partial filings and pending triage so a degraded replay cannot read as 52/52", () => {
    expect(
      formatSpacProcessSummary({
        cik: 1822912,
        matched: 52,
        processed: 51,
        partial: 1,
        failed: 0,
        nonfatal: 0,
        triage: 11,
        skipped: 0,
        triageExtractors: "S-1,424",
        firstDate: "2020-09-23",
        lastDate: "2023-10-03",
        error: "",
      })
    ).toBe(
      "1822912: 51/52 filings (2020-09-23 \u2192 2023-10-03); 1 partial; 11 section(s) pending triage"
    );
  });

  it("dry-run names the timeline rather than 0/N failed", () => {
    expect(
      formatSpacProcessSummary(
        {
          cik: 1822912,
          matched: 52,
          processed: 0,
          partial: 0,
          failed: 0,
          nonfatal: 0,
          triage: 0,
          skipped: 0,
          triageExtractors: "",
          firstDate: "2020-09-23",
          lastDate: "2023-10-03",
          error: "",
        },
        { dryRun: true }
      )
    ).toBe("1822912: would replay 52 filings (2020-09-23 \u2192 2023-10-03)");
  });

  it("dry-run names reused filings when the skip set is non-empty", () => {
    expect(
      formatSpacProcessSummary(
        {
          cik: 1800001,
          matched: 52,
          processed: 0,
          partial: 0,
          failed: 0,
          nonfatal: 0,
          triage: 0,
          skipped: 40,
          triageExtractors: "",
          firstDate: "2021-01-04",
          lastDate: "2024-06-01",
          error: "",
        },
        { dryRun: true }
      )
    ).toBe("1800001: would replay 12/52 filings (40 reused) (2021-01-04 \u2192 2024-06-01)");
  });

  it("dry-run names a full force as rebuild, not replay", () => {
    expect(
      formatSpacProcessSummary(
        {
          cik: 1800001,
          matched: 52,
          processed: 0,
          partial: 0,
          failed: 0,
          nonfatal: 0,
          triage: 0,
          skipped: 0,
          triageExtractors: "",
          firstDate: "2021-01-04",
          lastDate: "2024-06-01",
          error: "",
        },
        { dryRun: true, rebuild: true }
      )
    ).toBe("1800001: would rebuild 52 filings (2021-01-04 \u2192 2024-06-01)");
  });

  it("names reused filings on a live incremental run", () => {
    expect(
      formatSpacProcessSummary({
        cik: 1800001,
        matched: 52,
        processed: 52,
        partial: 0,
        failed: 0,
        nonfatal: 0,
        triage: 0,
        skipped: 40,
        triageExtractors: "",
        firstDate: "2021-01-04",
        lastDate: "2024-06-01",
        error: "",
      })
    ).toBe("1800001: 12/52 filings (40 reused) (2021-01-04 \u2192 2024-06-01)");
  });

  it("names ownership-form misses as nonfatal so they cannot read as failed", () => {
    expect(
      formatSpacProcessSummary({
        cik: 1822912,
        matched: 52,
        processed: 50,
        partial: 0,
        failed: 0,
        nonfatal: 2,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "2020-09-23",
        lastDate: "2023-10-03",
        error: "",
      })
    ).toBe("1822912: 50/52 filings (2020-09-23 \u2192 2023-10-03); 2 nonfatal");
  });
});

describe("formatSpacProcessDeadLetterHint", () => {
  it("names each extractor that dead-lettered as a copy-pasteable inspect command", () => {
    // `sec spac process` walks every form on the issuer, so a placeholder
    // `<extractor-id>` left the operator guessing which of S-1 / 424 /
    // redemption / loi / merger-proxy actually wrote the pending entries.
    expect(formatSpacProcessDeadLetterHint("424,S-1,redemption", "partial")).toBe(
      "Some sections did not extract. Inspect them with: " +
        "sec extractor dead-letters 424; " +
        "sec extractor dead-letters S-1; " +
        "sec extractor dead-letters redemption"
    );
  });

  it("uses the same inspect commands when only dropped-row triage remains", () => {
    expect(formatSpacProcessDeadLetterHint("S-1", "dropped")).toBe(
      "Some rows were dropped from otherwise-successful sections. Inspect: " +
        "sec extractor dead-letters S-1"
    );
  });
});

describe("spacProcessFailureCount", () => {
  const row = (p: Partial<ProcessSpacTimelineTaskOutput>): ProcessSpacTimelineTaskOutput => ({
    cik: 1,
    matched: 52,
    processed: 52,
    partial: 0,
    failed: 0,
    nonfatal: 0,
    triage: 0,
    skipped: 0,
    triageExtractors: "",
    firstDate: "2020-09-23",
    lastDate: "2023-10-03",
    error: "",
    ...p,
  });

  it("does not count a partial-only issuer", () => {
    // A partial run is the documented NORMAL outcome when one AI section
    // dead-letters, so counting it made a non-zero exit the default for
    // essentially every real SPAC.
    expect(spacProcessFailureCount([row({ partial: 1, processed: 51 })])).toBe(0);
  });

  it("does not count a nonfatal-only issuer", () => {
    expect(spacProcessFailureCount([row({ nonfatal: 3, processed: 49 })])).toBe(0);
  });

  it("counts an issuer with failed filings", () => {
    expect(spacProcessFailureCount([row({ failed: 2, processed: 50 })])).toBe(1);
  });

  it("counts an issuer whose replay errored", () => {
    expect(spacProcessFailureCount([row({ error: "boom" })])).toBe(1);
  });

  it("counts a failed issuer once and excludes the partial ones", () => {
    expect(
      spacProcessFailureCount([
        row({ cik: 1, partial: 3 }),
        row({ cik: 2, failed: 1 }),
        row({ cik: 3 }),
      ])
    ).toBe(1);
  });

  it("counts an issuer that is both partial and failed only once", () => {
    expect(spacProcessFailureCount([row({ partial: 2, failed: 1 })])).toBe(1);
  });
});
