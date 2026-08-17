/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { RegAFinancialLineRepo } from "../../../storage/reg-a/RegAFinancialLineRepo";
import type { RegAFinancialLine } from "../../../storage/reg-a/RegAFinancialLineSchema";
import { Form_1_K } from "./Form_1_K";
import { processForm1K } from "./Form_1_K.storage";
import { Form_1_SA } from "./Form_1_SA";
import { processForm1SA } from "./Form_1_SA.storage";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "mock_data", "rega-financials", name), "utf-8");

const wrapDocument = (type: string, fileName: string, body: string): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>2\n<FILENAME>${fileName}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

const SUBMISSION_1K =
  `<SEC-DOCUMENT>\n<SEC-HEADER>\n</SEC-HEADER>\n` +
  fixture("1k-cover-1800055-000121390024095260.sgml") +
  wrapDocument(
    "PART II",
    "ea0219991-1k_caltier.htm",
    fixture("1k-partii-1800055-000121390024095260.htm")
  ) +
  `</SEC-DOCUMENT>`;

const SUBMISSION_1SA =
  `<SEC-DOCUMENT>\n<SEC-HEADER>\n</SEC-HEADER>\n` +
  wrapDocument("1-SA", "tm2425224d1_1sa.htm", fixture("1sa-1838432-000110465924104481.htm")) +
  `</SEC-DOCUMENT>`;

const findLine = (
  rows: RegAFinancialLine[],
  kind: string,
  label: string,
  column: number
): RegAFinancialLine | undefined =>
  rows.find((r) => r.statement_kind === kind && r.label === label && r.column_index === column);

describe("Reg A financial statement storage", () => {
  let repo: RegAFinancialLineRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new RegAFinancialLineRepo();
  });

  it("stores a 1-K's PART II figures alongside its cover data", async () => {
    // The end-to-end shape of the change: ONE submission, fetched once, yielding
    // both the cover the extractor always read and the statements it never could.
    const parsed = await Form_1_K.parse("1-K", SUBMISSION_1K);
    await processForm1K({
      cik: 1800055,
      file_number: "024-11274",
      accession_number: "0001213900-24-095260",
      filing_date: "2024-04-30",
      primary_doc: "primary_doc.xml",
      form: "1-K",
      form1K: parsed,
    });

    const rows = await repo.queryByAccession("0001213900-24-095260");
    expect(rows.length).toBeGreaterThan(100);

    const totalAssets = findLine(rows, "balance_sheet", "Total assets", 0);
    expect(totalAssets?.value).toBe(1491657);
    expect(totalAssets?.period).toBe("2023");
    expect(totalAssets?.cik).toBe(1800055);
    expect(totalAssets?.form).toBe("1-K");
    expect(totalAssets?.filing_date).toBe("2024-04-30");
    expect(findLine(rows, "balance_sheet", "Total assets", 1)?.value).toBe(1038273);

    // A 1-K is an audited annual report; a 1-SA is not. The flag has to
    // distinguish them or the two are indistinguishable once stored.
    expect(totalAssets?.unaudited).toBe(false);

    // Losses keep their sign through the whole pipeline — the failure mode that
    // would otherwise be invisible in the database.
    expect(findLine(rows, "operations", "Net loss", 0)?.value).toBe(-1017930);
  });

  it("stores a 1-SA's figures and marks them unaudited", async () => {
    const parsed = await Form_1_SA.parse("1-SA", SUBMISSION_1SA);
    await processForm1SA({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: parsed,
    });

    const rows = await repo.queryByAccession("0001104659-24-104481");
    expect(rows.length).toBeGreaterThan(50);

    const totalAssets = findLine(rows, "balance_sheet", "Total Assets", 0);
    expect(totalAssets?.value).toBe(2212204);
    expect(totalAssets?.period).toBe("June 30, 2024");
    expect(totalAssets?.column_label).toBe("June 30, 2024");
    expect(totalAssets?.unaudited).toBe(true);
    expect(rows.every((r) => r.unaudited)).toBe(true);
  });

  it("is idempotent — re-processing a filing does not duplicate or grow it", async () => {
    const parsed = await Form_1_SA.parse("1-SA", SUBMISSION_1SA);
    const args = {
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: parsed,
    };
    await processForm1SA(args);
    const first = await repo.queryByAccession("0001104659-24-104481");
    await processForm1SA(args);
    const second = await repo.queryByAccession("0001104659-24-104481");
    expect(second.length).toBe(first.length);
  });

  it("removes the stale tail when a re-extract yields fewer rows", async () => {
    // Rows are keyed by POSITION, so a parser change that emits fewer lines
    // would otherwise leave orphans at the higher indices reading as real
    // disclosure.
    const parsed = await Form_1_SA.parse("1-SA", SUBMISSION_1SA);
    await processForm1SA({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: parsed,
    });
    expect((await repo.queryByAccession("0001104659-24-104481")).length).toBeGreaterThan(50);

    const shortened = {
      statements: [
        {
          ...parsed.statements[0],
          rows: parsed.statements[0].rows.slice(0, 2),
        },
      ],
    };
    await processForm1SA({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: shortened,
    });

    const rows = await repo.queryByAccession("0001104659-24-104481");
    expect(rows.every((r) => r.statement_kind === "balance_sheet")).toBe(true);
    expect(new Set(rows.map((r) => r.row_index))).toEqual(new Set([0, 1]));
  });

  it("refuses to wipe a filing when a parse yields nothing", async () => {
    // Every degrade path returns an empty result — a scanned-PDF report, a
    // filing incorporating its financials by reference, a parser regression —
    // and any of those would otherwise silently delete real figures.
    const parsed = await Form_1_SA.parse("1-SA", SUBMISSION_1SA);
    await processForm1SA({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: parsed,
    });
    const before = (await repo.queryByAccession("0001104659-24-104481")).length;

    await processForm1SA({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      form1SA: { statements: [] },
    });

    expect((await repo.queryByAccession("0001104659-24-104481")).length).toBe(before);
  });

  it("scopes a re-extract to its own filing", async () => {
    const sa = await Form_1_SA.parse("1-SA", SUBMISSION_1SA);
    for (const accession of ["0001104659-24-104481", "0001104659-24-999999"]) {
      await processForm1SA({
        cik: 1838432,
        accession_number: accession,
        form: "1-SA",
        filing_date: "2024-09-27",
        form1SA: sa,
      });
    }
    const otherBefore = (await repo.queryByAccession("0001104659-24-999999")).length;

    await repo.clearForAccession("0001104659-24-104481");

    expect(await repo.queryByAccession("0001104659-24-104481")).toEqual([]);
    expect((await repo.queryByAccession("0001104659-24-999999")).length).toBe(otherBefore);
  });
});
