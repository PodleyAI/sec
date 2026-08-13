/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ProcessSpacTimelineTask } from "./ProcessSpacTimelineTask";

const CIK = 1800001;

const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

/**
 * Seeds one filing. `primaryDoc` null is the no-primary-document case, which
 * dead-letters PRIMARY_DOC_UNRESOLVED and reports `success: false` without
 * touching the network.
 */
async function seedFiling(
  accession: string,
  form: string,
  filingDate: string,
  primaryDoc: string | null = null
): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: accession,
    form,
    primary_doc: primaryDoc,
    file_number: "333-1",
    filing_date: filingDate,
    acceptance_date: `${filingDate}T00:00:00.000Z`,
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

/**
 * Writes a filing's document into the on-disk accession-doc cache, so the
 * replay's fetch stage is served from disk and the filing processes for real
 * with no network. Mirrors `SecFetchAccessionDocTask.inputToFileName`:
 * `accessiondocs/<0-padded cik>/<accession w/o dashes>-<fileName>`.
 */
function cacheDoc(accession: string, fileName: string, body: string): void {
  const dir = path.join(rawRoot!, "accessiondocs", String(CIK).padStart(10, "0"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${accession.replace(/-/g, "")}-${fileName}`), body);
}

let rawRoot: string | undefined;

describe("ProcessSpacTimelineTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-spac-timeline-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    vi.restoreAllMocks();
    resetDependencyInjectionsForTesting();
  });

  it("counts only filings that actually succeeded, not the whole timeline", async () => {
    // `ProcessAccessionDocFormTask` contains its own failures and reports them
    // on a `success` port rather than throwing, so returning `timeline.length`
    // as `processed` printed "2/2 filings" for an issuer whose every filing
    // dead-lettered. The operator's one summary line said the replay worked.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.processed).toBe(0);
    expect(out.cik).toBe(CIK);
    expect(out.error).toBe("");
    expect(out.firstDate).toBe("2021-01-04");
    expect(out.lastDate).toBe("2021-02-04");
  });

  it("counts a filing that did succeed, so the count is not merely always zero", async () => {
    // The all-failing case above passes just as well against a `processed` that
    // is hard-wired to 0, or against a `success` column read under the wrong
    // shape. Only a real success separates "counts what succeeded" from
    // "counts nothing" — so process one filing for real off the on-disk cache
    // and one with no primary document, and require the count to land at 1.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04", "primary_doc.xml");
    cacheDoc("0000000000-26-000001", "primary_doc.xml", GOOD_FORM_D);
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.processed).toBe(1);
    expect(out.error).toBe("");
  });

  it("reports an issuer-level failure on the error port instead of throwing", async () => {
    // The isolation the batch depends on. Thrown from a task, this reached the
    // CLI workflow renderer, which answers a thrown error with
    // `process.exit(1)` — killing the whole batch on one bad issuer, which is
    // precisely what running issuers independently was meant to prevent.
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    vi.spyOn(repo, "query").mockRejectedValue(new Error("filing store unavailable"));

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.cik).toBe(CIK);
    expect(out.error).toContain("filing store unavailable");
    expect(out.matched).toBe(0);
    expect(out.processed).toBe(0);
  });

  it("echoes the cik so a fan-out's result columns are self-labelling", async () => {
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });
    // No filings at all is still an answer about THIS issuer.
    expect(out).toMatchObject({ cik: CIK, matched: 0, processed: 0, error: "" });
  });
});
