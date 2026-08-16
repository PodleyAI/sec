/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { Form_1_A } from "./Form_1_A";
import { processForm1A } from "./Form_1_A.storage";

/**
 * An equity block that discloses nothing must not become a row.
 *
 * The substance test has to ask whether each field is MEANINGFUL, not merely
 * present. Form 1-A's CUSIP field is fixed-width, so a filer with no CUSIP pads
 * it — `000000000`, `000000N/A`, `00000None` — and a plain non-empty check reads
 * that padding as a disclosure. It produced 9,621 rows (31% of the table) shaped
 * `debt / N/A / 0 / N/A`, which render as blank lines on the public Reg A page.
 *
 * The opposite error matters just as much, and is why the predicate is not
 * simply "skip anything unnamed": 316 blocks leave the name blank while
 * reporting real share counts, the largest 7,318,625,597. Those are
 * disclosures, and an earlier fix that keyed on the name alone dropped them.
 */
describe("equity classes with no disclosure are not stored", () => {
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    regARepo = new RegAOfferingRepo();
  });

  const mockDir = join(__dirname, "mock_data", "form-1-a");

  const isFiller = (v: string | null | undefined, extra: RegExp | null = null): boolean => {
    if (v == null) return true;
    const t = v.trim().toUpperCase();
    if (["", "N/A", "NA", "NONE", "NO", "0", "-", "--"].includes(t)) return true;
    return extra ? extra.test(t) : false;
  };

  it("stores no all-placeholder row across the whole fixture corpus", async () => {
    const files = readdirSync(mockDir).filter((f) => f.endsWith(".xml"));
    expect(files.length).toBeGreaterThan(0);

    let checked = 0;
    for (const file of files) {
      const form1A = await Form_1_A.parse("1-A", readFileSync(join(mockDir, file), "utf-8"));
      if (form1A.formData.employeesInfo.length === 0) continue;
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-99999";
      const accessionNumber = `s-${file.slice(0, 18)}`;

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: file,
        form1A,
      });

      for (const row of await regARepo.getEquityClassesByFiling(cik, fileNumber, accessionNumber)) {
        const empty =
          row.class_name === "N/A" &&
          (row.outstanding ?? 0) === 0 &&
          // all-zero padding is filler too, which a bare non-empty test misses
          isFiller(row.cusip, /^0+$|N\/A|NONE/) &&
          isFiller(row.publicly_traded);

        expect(
          empty,
          `${file} stored an empty class: ${row.equity_type} / ${row.class_name} / ` +
            `${row.outstanding} / ${row.cusip} / ${row.publicly_traded}`
        ).toBe(false);
      }
      checked++;
    }
    expect(checked, "no fixture was processed").toBeGreaterThan(0);
  });

  it("keeps an unnamed class that reports real shares", async () => {
    const files = readdirSync(mockDir).filter((f) => f.endsWith(".xml"));
    let found = 0;
    for (const file of files) {
      const form1A = await Form_1_A.parse("1-A", readFileSync(join(mockDir, file), "utf-8"));
      if (form1A.formData.employeesInfo.length === 0) continue;
      if (form1A.formData.commonEquity.every((e) => (e.outstandingCommonEquity ?? 0) === 0)) continue;

      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-99998";
      const accessionNumber = `k-${file.slice(0, 18)}`;
      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: file,
        form1A,
      });

      const stored = await regARepo.getEquityClassesByFiling(cik, fileNumber, accessionNumber);
      expect(
        stored.filter((r) => r.equity_type === "common" && (r.outstanding ?? 0) > 0).length,
        `${file} dropped a common class that reports shares`
      ).toBeGreaterThan(0);
      found++;
      if (found >= 5) break;
    }
    expect(found, "no fixture declares outstanding common equity").toBeGreaterThan(0);
  });
});
