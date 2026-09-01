/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { SecCliConfigurationError } from "../../config/EnvToDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

// The store stage is reached through the form's storage module, so that module
// is the seam: a misconfigured environment surfaces from inside it (the section
// runner re-throws configuration errors rather than dead-lettering them).
vi.mock("../../sec/forms/exempt-offerings/Form_D.storage", () => ({
  processFormD: async () => {
    throw new SecCliConfigurationError('SEC_EXTRACTION_TEMPERATURE is not a number: "0,5"');
  },
}));

const CIK = 1018724;
const ACCESSION = "0000000000-26-000151";

const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

class ConfigErrorStoreTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    return GOOD_FORM_D;
  }
}

let rawRoot: string | undefined;

async function seedFiling(): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: ACCESSION,
    form: "D",
    primary_doc: "primary_doc.xml",
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

describe("ProcessAccessionDocFormTask configuration errors", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-cfg-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    resetDependencyInjectionsForTesting();
  });

  it("re-throws a SecCliConfigurationError from the store stage rather than dead-lettering it", async () => {
    // Without this escape, the section runner's re-throw only relocates the
    // problem: every filing would take a filing-level STORE_ERROR instead of a
    // per-section MODEL_INVALID_OUTPUT — equally version-gated, equally
    // unfixable by a version bump, and equally silent about the env var.
    await seedFiling();

    await expect(
      new ConfigErrorStoreTask().run({ accessionNumber: ACCESSION })
    ).rejects.toThrowError(SecCliConfigurationError);

    expect(await new ExtractionDeadLetterRepo().get("D", ACCESSION, "")).toBeFalsy();

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect(await runRepo.findRun(CIK, ACCESSION, "D", "1.0.0")).toBeUndefined();
  });
});
