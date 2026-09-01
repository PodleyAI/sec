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
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
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

/** The only extractor registered for the form while a case runs. */
const EXTRACTOR_ID = "synthetic";
const ACTIVE_VERSION = "1.0.0";
/** The version the filing's prior run carried, so this run is a genuine bump. */
const PRIOR_VERSION = "0.9.0";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000123";
const FILE_NAME = ACCESSION + ".txt";
const BODY = "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT><p>A prospectus.</p></TEXT></DOCUMENT>";

/** The index this run re-observes, so a reap that ran can be told from one that wiped. */
const FRESH_INDEX = 0;
// An observation row for this filing+extractor that the current run does NOT
// re-observe (high index, old timestamp) — the reaper's target.
const PHANTOM_INDEX = 99;
const OLD_CREATED_AT = "2020-01-01T00:00:00.000Z";

/** A section outcome the extractor reports without throwing, as `sectionRunner` does. */
interface SectionOutcome {
  readonly section: string;
  readonly reason: string;
}

/**
 * An extractor that persists one company observation and then dead-letters the
 * sections the case scripts, exactly as a section pass that yielded no rows
 * does: the filing still stores, and the driver reads those entries back to
 * decide whether reaping this filing's unrefreshed rows is safe.
 */
function registerScriptedExtractor(sectionFailures: readonly SectionOutcome[]): void {
  registerFormExtractor<string>({
    id: EXTRACTOR_ID,
    forms: ["S-1", "S-1/A"],
    parse: async (_form, text) => text,
    store: async (args) => {
      await new CompanyObservationRepo().upsertByNaturalKey({
        accession_number: args.accession_number,
        extractor_id: args.extractor_id,
        extractor_version: args.extractor_version,
        observation_index: FRESH_INDEX,
        cik: args.cik,
        name: "Observed Holdings LLC",
        normalized_name: "observed holdings llc",
        created_at: new Date().toISOString(),
      });
      const deadLetters = new ExtractionDeadLetterRepo();
      for (const failure of sectionFailures) {
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

/**
 * Record a completed prior run at a version other than the active one, so the
 * reap gate's `versionChanged` half is satisfied in every case here and the
 * blocking-section-failure half is the only thing left that can suppress a
 * reap. The same-version half is covered by
 * ProcessAccessionDocFormTask.reapVersionGate.test.ts.
 */
async function seedPriorRun(): Promise<void> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await runRepo.recordRun({
    cik: CIK,
    accession_number: ACCESSION,
    form: "S-1",
    extractor_id: EXTRACTOR_ID,
    extractor_version: PRIOR_VERSION,
    slot_at_run: "current",
    success: true,
    outcome: "success",
    error: null,
  });
}

/** Insert a stale phantom company observation the reaper would delete. */
async function seedPhantomObservation(): Promise<number> {
  const obs = await new CompanyObservationRepo().upsertByNaturalKey({
    accession_number: ACCESSION,
    extractor_id: EXTRACTOR_ID,
    extractor_version: ACTIVE_VERSION,
    observation_index: PHANTOM_INDEX,
    cik: 9999999,
    name: "Phantom Holdings LLC",
    normalized_name: "phantom holdings llc",
    created_at: OLD_CREATED_AT,
  });
  return obs.observation_id;
}

describe("ProcessAccessionDocFormTask reap gate on section failure", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    clearFormExtractorsForTesting();
    await seedExtractorVersion(ACTIVE_VERSION);
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-reapgate-"));
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

  it("keeps prior observations when a section dead-letters MODEL_INVALID_OUTPUT this run", async () => {
    registerScriptedExtractor([{ section: "management", reason: "MODEL_INVALID_OUTPUT" }]);
    await seedFiling();
    seedFetchCache(rawRoot!);
    await seedPriorRun();
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    // The filing still succeeds end-to-end: section failures degrade, not abort.
    expect((result as { success: boolean }).success).toBe(true);

    // A section transiently failed this run.
    const pending = await new ExtractionDeadLetterRepo().listPending(EXTRACTOR_ID);
    expect(
      pending.some(
        (d) => d.accession_number === ACCESSION && d.reason_code === "MODEL_INVALID_OUTPUT"
      )
    ).toBe(true);

    // The gate suppressed the reap: the stale phantom survives rather than being
    // destroyed as collateral of a transient failure.
    const survivor = await new CompanyObservationRepo().getById(phantomId);
    expect(survivor).toBeDefined();
  });

  it("keeps prior observations when a section dead-letters MODEL_EMPTY this run", async () => {
    // A present section whose model returns no rows records MODEL_EMPTY (not
    // MODEL_INVALID_OUTPUT) — the case the first cut of the gate missed.
    registerScriptedExtractor([{ section: "ownership", reason: "MODEL_EMPTY" }]);
    await seedFiling();
    seedFetchCache(rawRoot!);
    await seedPriorRun();
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    const pending = await new ExtractionDeadLetterRepo().listPending(EXTRACTOR_ID);
    expect(
      pending.some((d) => d.accession_number === ACCESSION && d.reason_code === "MODEL_EMPTY")
    ).toBe(true);

    // The widened gate suppresses the reap for MODEL_EMPTY too.
    const survivor = await new CompanyObservationRepo().getById(phantomId);
    expect(survivor).toBeDefined();
  });

  it("still reaps stale observations on a fully clean run (no blocking failure)", async () => {
    // The two entries a clean run may legitimately leave behind: a section
    // genuinely absent from the filing, and a `-partial` marker from a section
    // that DID persist its verified rows. Neither says a section wrote nothing,
    // so neither may pin the reaper.
    registerScriptedExtractor([
      { section: "ownership", reason: "SECTION_NOT_FOUND" },
      { section: "management-partial", reason: "UNVERIFIED_SOURCE_SPAN" },
    ]);
    await seedFiling();
    seedFetchCache(rawRoot!);
    await seedPriorRun();
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    // No blocking failure this run.
    const pending = await new ExtractionDeadLetterRepo().listPending(EXTRACTOR_ID);
    expect(
      pending.some(
        (d) =>
          d.accession_number === ACCESSION &&
          d.reason_code !== "SECTION_NOT_FOUND" &&
          !d.section_name.endsWith("-partial")
      )
    ).toBe(false);

    // The reaper runs and removes the stale phantom …
    const reaped = await new CompanyObservationRepo().getById(phantomId);
    expect(reaped).toBeUndefined();
    // … and only it: what this run re-observed is not collateral.
    const refreshed = await new CompanyObservationRepo().getByNaturalKey(
      ACCESSION,
      EXTRACTOR_ID,
      FRESH_INDEX
    );
    expect(refreshed).toBeDefined();
  });
});
