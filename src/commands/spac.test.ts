/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { DataPorts, ITask } from "workglow";
import { runWorkflowCli } from "../cli/runWorkflow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";
import { ProcessSpacTimelineTask } from "../task/spac/ProcessSpacTimelineTask";
import { assembleSpacReport, formatSpacProcessSummary, spacProcessRows } from "./spac";

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
        triage: [0, 0, 0],
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
        triage: 0,
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
        triage: 0,
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
        triage: 0,
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
      // The shape `spacProcessRows` consumes is produced by `runWorkflowCli`,
      // not asserted anywhere else — so build the graph `sec spac process`
      // builds and read the sink. Notably a ONE-iteration map still merges to a
      // one-element array per port rather than a bare scalar, which is the
      // commonest invocation and was previously assumed to be the other way.
      const merged = await runWorkflowCli<Record<string, unknown>>([], { cik: [...ciks] }, (wf) => {
        const loop = wf.map({
          concurrencyLimit: ciks.length,
          maxIterations: ciks.length,
          preserveOrder: true,
        });
        loop.pipe(new ProcessSpacTimelineTask() as ITask<DataPorts, DataPorts>);
        loop.endMap();
      });

      expect(merged.cik).toEqual([...ciks]);
      // None of these CIKs has a filing, so every issuer reports an empty
      // timeline — the point here is the shape and the per-issuer labelling.
      expect(spacProcessRows(merged as never)).toEqual(
        ciks.map((cik) => ({
          cik,
          matched: 0,
          processed: 0,
          partial: 0,
          failed: 0,
          triage: 0,
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
        triage: 0,
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
        triage: 11,
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
          triage: 0,
          firstDate: "2020-09-23",
          lastDate: "2023-10-03",
          error: "",
        },
        { dryRun: true }
      )
    ).toBe("1822912: would replay 52 filings (2020-09-23 \u2192 2023-10-03)");
  });
});
