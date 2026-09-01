/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * The driver over a registration-family filing, end to end: the cached body it
 * serves, the extractor it reaches, and what it writes to the run ledger and
 * the dead-letter table afterwards.
 *
 * The extractor is registered here rather than being one this package ships.
 * What is under test belongs to the driver, and an extractor whose outcome the
 * case SCRIPTS — the observations it persists, the sections it dead-letters
 * without throwing — is what keeps these assertions about the driver instead of
 * about some extractor's answer to a document.
 */

/** The only extractor registered for the form while a case runs. */
const EXTRACTOR_ID = "synthetic";
const ACTIVE_VERSION = "1.0.0";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000099";
// The registration-prospectus family is fetched as the full submission .txt.
const FILE_NAME = ACCESSION + ".txt";
const BODY = "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT><p>A prospectus.</p></TEXT></DOCUMENT>";

/** What the extractor does when the driver reaches it. */
interface ExtractorScript {
  /** Company observations it persists, as a section pass that found rows does. */
  readonly observes: readonly number[];
  /**
   * Sections it dead-letters WITHOUT throwing, which is how `sectionRunner`
   * reports a section that yielded nothing: the filing still stores, and the
   * driver reads the entry back to classify the run.
   */
  readonly sectionFailures: readonly { readonly section: string; readonly reason: string }[];
}

/** The bodies the extractor was handed, in store order. */
interface ExtractorCapture {
  readonly bodies: string[];
}

function registerScriptedExtractor(script: ExtractorScript): ExtractorCapture {
  const bodies: string[] = [];
  registerFormExtractor<string>({
    id: EXTRACTOR_ID,
    forms: ["S-1", "S-1/A"],
    // Its own reading of the fetched body, so nothing here depends on which
    // parser class the form registers.
    parse: async (_form, text) => text,
    store: async (args) => {
      bodies.push(args.text);
      const observations = new CompanyObservationRepo();
      for (const index of script.observes) {
        await observations.upsertByNaturalKey({
          accession_number: args.accession_number,
          extractor_id: args.extractor_id,
          extractor_version: args.extractor_version,
          observation_index: index,
          cik: args.cik,
          name: `Observed Holdings ${index}`,
          normalized_name: `observed holdings ${index}`,
          created_at: new Date().toISOString(),
        });
      }
      const deadLetters = new ExtractionDeadLetterRepo();
      for (const failure of script.sectionFailures) {
        await deadLetters.record({
          extractor_id: args.extractor_id,
          accession_number: args.accession_number,
          section_name: failure.section,
          reason_code: failure.reason,
          detail: null,
          failed_extractor_version: args.extractor_version,
          source_run_id: null,
        });
      }
    },
  });
  return { bodies };
}

/** Gives the extractor id a `current` slot, as `db setup` does for shipped ids. */
async function seedExtractorVersion(semver: string): Promise<void> {
  await new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)).putSlot({
    component_kind: "extractor",
    component_id: EXTRACTOR_ID,
    slot: "current",
    semver,
    bump_type: null,
    started_at: "2026-01-01T00:00:00.000Z",
    coverage_complete: true,
    target_count: null,
  });
}

let rawRoot: string | undefined;

/** Seeds the file-output cache so the body is served from disk, not the network. */
function seedFetchCache(folder: string): void {
  const relative = `accessiondocs/${CIK.toString().padStart(10, "0")}/${ACCESSION.replaceAll(
    "-",
    ""
  )}-${FILE_NAME}`;
  const filePath = path.join(folder, relative);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, BODY, "utf-8");
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

describe("ProcessAccessionDocFormTask (registration filing end-to-end)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();

    // From here the form carries exactly one extractor, the one each case
    // registers, so what the driver does is not entangled with what a shipped
    // extractor would have made of the same filing.
    clearFormExtractorsForTesting();
    await seedExtractorVersion(ACTIVE_VERSION);

    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-s1-task-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
    resetDependencyInjectionsForTesting();
  });

  it("dispatches the filing to the form's extractor and records a partial run when sections dead-letter", async () => {
    const capture = registerScriptedExtractor({
      observes: [0],
      sectionFailures: [
        { section: "ownership", reason: "MODEL_EMPTY" },
        { section: "related-party", reason: "MODEL_EMPTY" },
      ],
    });

    await seedFiling();
    seedFetchCache(rawRoot!);

    await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });

    // The cached body reached the extractor: the driver served it off disk
    // rather than through the rate-limited fetch queue.
    expect(capture.bodies).toEqual([BODY]);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, EXTRACTOR_ID, ACTIVE_VERSION);
    expect(run).toBeDefined();
    // Two sections dead-lettered MODEL_EMPTY, so the run is "partial" rather
    // than fully successful — coverage-as-success would let the worklist skip
    // work the dead-letter scan says is unfinished.
    expect(run?.outcome).toBe("partial");
    expect(run?.success).toBe(false);

    // And what the extractor persisted is there: the dispatch really ran.
    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => c.cik === CIK)).toBe(true);
  });

  it("clears a prior filing-level dead-letter when a re-run succeeds", async () => {
    registerScriptedExtractor({
      observes: [],
      sectionFailures: [{ section: "ownership", reason: "MODEL_EMPTY" }],
    });

    // Simulate an earlier fetch-layer failure for this filing.
    await new ExtractionDeadLetterRepo().record({
      extractor_id: EXTRACTOR_ID,
      accession_number: ACCESSION,
      section_name: "",
      reason_code: "FETCH_ERROR",
      detail: "earlier transient failure",
      failed_extractor_version: ACTIVE_VERSION,
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

    const deadLetters = new ExtractionDeadLetterRepo();
    expect((await deadLetters.get(EXTRACTOR_ID, ACCESSION, ""))?.status).toBe("resolved");
    // Only the filing-level entry is cleared. This run dead-lettered a section
    // of its own, and resolving that one would hide a failure nothing fixed.
    expect((await deadLetters.get(EXTRACTOR_ID, ACCESSION, "ownership"))?.status).toBe("pending");
  });
});
