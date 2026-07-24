/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000150";

let rawRoot: string | undefined;

async function seedFiling(form: string, primaryDoc: string | null): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: ACCESSION,
    form,
    primary_doc: primaryDoc,
    file_number: "333-1",
    filing_date: "2026-01-02",
    acceptance_date: "2026-01-02T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

describe("ProcessAccessionDocFormTask fetch-layer dead-lettering", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-dlq-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    resetDependencyInjectionsForTesting();
  });

  it("records PRIMARY_DOC_UNRESOLVED and a failed run when no primary doc exists", async () => {
    // Use a non-registration form (D) for PRIMARY_DOC_UNRESOLVED — registration
    // prospectus forms (S-1 / DRS family) always derive the filename from the
    // accession number and never trigger this path.
    await seedFiling("D", null);

    const result = await new ProcessAccessionDocFormTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("D", ACCESSION, "");
    expect(dl?.reason_code).toBe("PRIMARY_DOC_UNRESOLVED");
    expect(dl?.status).toBe("pending");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "D", "1.0.0");
    expect(run?.success).toBe(false);
  });

  it("records FETCH_ERROR and a failed run when the body fetch throws", async () => {
    await seedFiling("S-1", "s1.htm");

    class ThrowingFetchTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        throw new Error("simulated network failure");
      }
    }

    const result = await new ThrowingFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "");
    expect(dl?.reason_code).toBe("FETCH_ERROR");
    expect(dl?.status).toBe("pending");
    expect(dl?.detail).toContain("simulated network failure");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "S-1", "1.0.0");
    expect(run?.success).toBe(false);
  });

  it("rethrows (does not dead-letter) when parse/store fails after a successful fetch", async () => {
    await seedFiling("D", "primary_doc.xml");

    class BadParseTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        // fast-xml-parser leniently accepts this; the throw originates in the
        // Domain 3 storage step (processFormD dereferencing issuer.entityName on
        // undefined), exercising the parse/store-rethrow path — not the fetch path
        // (runFetch is overridden to return successfully here).
        return "<edgarSubmission><unclosed>";
      }
    }

    await expect(new BadParseTask().run({ accessionNumber: ACCESSION })).rejects.toBeDefined();

    // No filing-level dead-letter is written on the parse path.
    const dl = await new ExtractionDeadLetterRepo().get("D", ACCESSION, "");
    expect(dl).toBeUndefined();

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "D", "1.0.0");
    expect(run?.success).toBe(false);
  });

  it("dead-letters a legacy non-XML ownership filing as PARSE_ERROR instead of throwing", async () => {
    // Pre-2003-06-30 ownership forms were filed as narrative HTML/text; the
    // XML parser finds no <ownershipDocument> root and parse yields undefined.
    // That must contain as a filing-level PARSE_ERROR (version-gated retry),
    // not crash the sweep on `doc.issuer` of undefined.
    await seedFiling("3", "bbobeckform3.htm");

    class LegacyHtmlFetchTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        return "<html><body><p>FORM 3 — U.S. SECURITIES AND EXCHANGE COMMISSION</p></body></html>";
      }
    }

    const result = await new LegacyHtmlFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("3", ACCESSION, "");
    expect(dl?.reason_code).toBe("PARSE_ERROR");
    expect(dl?.status).toBe("pending");
    expect(dl?.detail).toContain("not the expected XML format");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "3", "1.0.0");
    expect(run?.success).toBe(false);
    expect(run?.error).toContain("PARSE_ERROR");
  });

  it("dead-letters a parse-phase throw as PARSE_ERROR instead of crashing the sweep", async () => {
    // Some legacy HTML filings nest tables past fast-xml-parser's depth limit
    // ("Maximum nested tags exceeded"). A parse throw reflects the filing's
    // own bytes, so it contains as PARSE_ERROR; only store-phase throws
    // remain hard errors.
    await seedFiling("3", "deepform3.htm");

    class DeepNestingFetchTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        const depth = 600;
        return "<b>".repeat(depth) + "x" + "</b>".repeat(depth);
      }
    }

    const result = await new DeepNestingFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("3", ACCESSION, "");
    expect(dl?.reason_code).toBe("PARSE_ERROR");
    expect(dl?.detail).toContain("Parse failed");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "3", "1.0.0");
    expect(run?.success).toBe(false);
  });

  it("dead-letters a registration form with no primary doc as FETCH_ERROR (not PRIMARY_DOC_UNRESOLVED)", async () => {
    // Registration prospectus forms always derive the fetch filename from the
    // accession (<accession>.txt), so a null primary_doc never reaches the
    // PRIMARY_DOC_UNRESOLVED guard — a failed .txt fetch surfaces as FETCH_ERROR.
    await seedFiling("S-1", null);

    class ThrowingFetchTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        throw new Error("no full-submission .txt");
      }
    }

    const result = await new ThrowingFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "");
    expect(dl?.reason_code).toBe("FETCH_ERROR");
  });
});
