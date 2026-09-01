/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/** The only extractor registered for the form while a case runs. */
const EXTRACTOR_ID = "synthetic";
const ACTIVE_VERSION = "1.0.0";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000456";
const FILE_NAME = ACCESSION + ".txt";
const BODY = "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT><p>A prospectus.</p></TEXT></DOCUMENT>";

/** The index this run re-observes, which no reap may touch. */
const FRESH_INDEX = 0;
// An observation row from the "prior run" that this run does not re-observe —
// the reap gate's target.
const PHANTOM_INDEX = 99;
const OLD_CREATED_AT = "2020-01-01T00:00:00.000Z";

/**
 * An extractor whose run is fully clean: it persists one observation and
 * dead-letters nothing, so the blocking-section-failure half of the reap gate
 * (covered by ProcessAccessionDocFormTask.reapgate.test.ts) never fires and the
 * version half is what these cases isolate.
 */
function registerScriptedExtractor(): void {
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
    },
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

/** Insert a stale phantom company observation the reaper would (conditionally) delete. */
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

/** Record a completed prior run at the given version, simulating an earlier extraction. */
async function seedPriorRunAtVersion(version: string): Promise<void> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await runRepo.recordRun({
    cik: CIK,
    accession_number: ACCESSION,
    form: "S-1",
    extractor_id: EXTRACTOR_ID,
    extractor_version: version,
    slot_at_run: "current",
    success: true,
    outcome: "success",
    error: null,
  });
}

/** Set the extractor's active `current` slot, as `db setup` and a bump ceremony do. */
async function setActiveVersion(version: string): Promise<void> {
  const registry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  await registry.putSlot({
    component_kind: "extractor",
    component_id: EXTRACTOR_ID,
    slot: "current",
    semver: version,
    bump_type: null,
    started_at: new Date().toISOString(),
    coverage_complete: true,
    target_count: null,
  });
}

describe("ProcessAccessionDocFormTask reap gate on same-version re-run", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    clearFormExtractorsForTesting();
    registerScriptedExtractor();
    await setActiveVersion(ACTIVE_VERSION);
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-reapversiongate-"));
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

  it("does NOT reap prior observations when re-run happens at the SAME extractor version", async () => {
    // Simulates `sec fetch form <cik> S-1` re-processing a filing that was
    // already successfully extracted at the currently-active version. A prior
    // run recorded N observations (represented here by the seeded phantom);
    // this run observes FEWER — pure sampling variance, not a real
    // re-extraction — and must not hard-delete the row that didn't reappear.
    await seedFiling();
    seedFetchCache(rawRoot!);
    await seedPriorRunAtVersion(ACTIVE_VERSION);
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    // No version change happened, so the reap must be suppressed: the
    // phantom observation from the "prior run" survives.
    const survivor = await new CompanyObservationRepo().getById(phantomId);
    expect(survivor).toBeDefined();
  });

  it("DOES reap stale observations when re-run happens after a real version bump", async () => {
    await seedFiling();
    seedFetchCache(rawRoot!);
    await seedPriorRunAtVersion(ACTIVE_VERSION);
    await setActiveVersion("1.1.0"); // true version bump since the prior run
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    // A genuine version bump happened: stale rows are superseded and reaped …
    const reaped = await new CompanyObservationRepo().getById(phantomId);
    expect(reaped).toBeUndefined();
    // … while what this run re-observed stays.
    const refreshed = await new CompanyObservationRepo().getByNaturalKey(
      ACCESSION,
      EXTRACTOR_ID,
      FRESH_INDEX
    );
    expect(refreshed).toBeDefined();
  });
});
