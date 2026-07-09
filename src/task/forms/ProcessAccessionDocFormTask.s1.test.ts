/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { registerFakeStructuredProvider } from "../../sec/forms/registration-statements/s1/testing/fakeStructuredProvider";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

// Mirror the section structure of Form_S_1.storage.test.ts so the heuristic
// segmenter finds Management / Principal and Selling Stockholders / Certain
// Relationships sections and the 3 scripted payloads below line up by call order.
const SECTION_HTML = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1>",
  "<table><tr><td>ACME Fund</td><td>1,000,000</td><td>12.5%</td></tr></table>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<p>We pay rent to an entity controlled by our CEO.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

// Wrap in a DOCUMENT envelope so parseRegistrationSubmission selects the S-1 body.
const HTML = "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT>" + SECTION_HTML + "</TEXT></DOCUMENT>";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000099";
// The task now fetches <accession>.txt for registration prospectus forms.
const FILE_NAME = ACCESSION + ".txt";

let rawRoot: string | undefined;
let cleanup: (() => void) | undefined;

/** Seeds the file-output cache so SecFetchAccessionDocTask never hits the network. */
function seedFetchCache(folder: string): void {
  const relative = `accessiondocs/${CIK.toString().padStart(10, "0")}/${ACCESSION.replaceAll(
    "-",
    ""
  )}-${FILE_NAME}`;
  const filePath = path.join(folder, relative);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, HTML, "utf-8");
}

async function seedFiling(): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: ACCESSION,
    form: "S-1",
    primary_doc: FILE_NAME,
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

describe("ProcessAccessionDocFormTask (S-1 end-to-end)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();

    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-s1-task-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
    process.env.SEC_S1_MODEL = "fake-s1-model";

    await getGlobalModelRepository().addModel({
      model_id: "fake-s1-model",
      capabilities: ["text.generation", "json-mode"],
      title: "Fake",
      description: "Fake",
      provider: "fake-structured",
      provider_config: {},
      metadata: {},
    } as any);
  });

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    // The global ModelRepository is not cleared by resetDependencyInjectionsForTesting,
    // so remove the fake model or the next test's addModel() throws "already exists".
    await getGlobalModelRepository().removeModel("fake-s1-model");
    delete process.env.SEC_S1_MODEL;
    resetDependencyInjectionsForTesting();
  });

  it("dispatches an S-1 filing to processFormS1 and records a partial run when some sections dead-letter", async () => {
    const { unregister } = registerFakeStructuredProvider([
      // management
      {
        people: [
          {
            full_name: "Jane Roe",
            title: "Director",
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe — Director",
          },
        ],
      },
      // ownership
      { owners: [] },
      // related party
      { parties: [] },
    ]);
    cleanup = unregister;

    await seedFiling();
    seedFetchCache(rawRoot!);

    await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "S-1", "1.0.0");
    expect(run).toBeDefined();
    // ownership / related-party returned empty arrays so they dead-letter
    // MODEL_EMPTY; the run is therefore "partial" rather than fully successful.
    expect(run?.outcome).toBe("partial");
    expect(run?.success).toBe(false);

    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => c.cik === CIK)).toBe(true);
  });

  it("clears a prior filing-level dead-letter when a re-run succeeds", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    // Simulate an earlier fetch-layer failure for this filing.
    await new ExtractionDeadLetterRepo().record({
      extractor_id: "S-1",
      accession_number: ACCESSION,
      section_name: "",
      reason_code: "FETCH_ERROR",
      detail: "earlier transient failure",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    await seedFiling();
    seedFetchCache(rawRoot!);

    await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });

    const dl = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "");
    expect(dl?.status).toBe("resolved");
  });
});
