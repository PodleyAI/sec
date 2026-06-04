/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
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
    await seedFiling("S-1", null);

    const result = await new ProcessAccessionDocFormTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const dl = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "");
    expect(dl?.reason_code).toBe("PRIMARY_DOC_UNRESOLVED");
    expect(dl?.status).toBe("pending");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "S-1", "1.0.0");
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
    expect(dl?.detail).toContain("simulated network failure");

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "S-1", "1.0.0");
    expect(run?.success).toBe(false);
  });

  it("rethrows (does not dead-letter) when parse/store fails after a successful fetch", async () => {
    await seedFiling("D", "primary_doc.xml");

    class BadParseTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        return "<edgarSubmission><unclosed>"; // malformed XML → Form D parse throws
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
});
