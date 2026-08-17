/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { registerFakeStructuredProvider } from "../../sec/forms/registration-statements/s1/testing/fakeStructuredProvider";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

// Management-only prospectus: every other section is genuinely absent
// (SECTION_NOT_FOUND, which does not block the reap gate), so a run where
// Management succeeds is fully clean — isolating the version-change gate
// from the blocking-section-failure gate covered by reapgate.test.ts.
const MGMT_ONLY_HTML =
  "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT>" +
  "<h1>MANAGEMENT</h1><p>Jane Roe — Director</p><h1>LEGAL MATTERS</h1><p>x</p>" +
  "</TEXT></DOCUMENT>";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000456";
const FILE_NAME = ACCESSION + ".txt";
// An observation row from the "prior run" that this run's (fewer) LLM output
// does not re-observe — the reap gate's target.
const PHANTOM_INDEX = 99;
const OLD_CREATED_AT = "2020-01-01T00:00:00.000Z";

let rawRoot: string | undefined;
let cleanup: (() => void) | undefined;

function seedFetchCache(folder: string, html: string): void {
  const relative = `accessiondocs/${CIK.toString().padStart(10, "0")}/${ACCESSION.replaceAll(
    "-",
    ""
  )}-${FILE_NAME}`;
  const filePath = path.join(folder, relative);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, html, "utf-8");
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
    extractor_id: "S-1",
    extractor_version: "1.0.0",
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
    extractor_id: "S-1",
    extractor_version: version,
    slot_at_run: "current",
    success: true,
    outcome: "success",
    error: null,
  });
}

/** Bump the S-1 extractor's active "current" slot to a new version. */
async function bumpActiveVersion(version: string): Promise<void> {
  const registry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  await registry.putSlot({
    component_kind: "extractor",
    component_id: "S-1",
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
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-reapversiongate-"));
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
    await getGlobalModelRepository().removeModel("fake-s1-model");
    delete process.env.SEC_S1_MODEL;
    resetDependencyInjectionsForTesting();
  });

  it("does NOT reap prior observations when re-run happens at the SAME extractor version", async () => {
    // Simulates `sec fetch form <cik> S-1` re-processing a filing that was
    // already successfully extracted at the currently-active version. A
    // prior run recorded N observations (represented here by the seeded
    // phantom); this run's mocked LLM returns FEWER entities (pure sampling
    // variance, not a real re-extraction) and must not hard-delete the
    // observation that didn't reappear.
    await seedFiling();
    seedFetchCache(rawRoot!, MGMT_ONLY_HTML);
    await seedPriorRunAtVersion("1.0.0"); // matches the bootstrapped active "current" slot
    const phantomId = await seedPhantomObservation();

    const { unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe — Director",
          },
        ],
      },
    ]);
    cleanup = unregister;

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
    seedFetchCache(rawRoot!, MGMT_ONLY_HTML);
    await seedPriorRunAtVersion("1.0.0");
    await bumpActiveVersion("1.1.0"); // true version bump since the prior run
    const phantomId = await seedPhantomObservation();

    const { unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe — Director",
          },
        ],
      },
    ]);
    cleanup = unregister;

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    // A genuine version bump happened: stale rows are superseded and reaped.
    const reaped = await new CompanyObservationRepo().getById(phantomId);
    expect(reaped).toBeUndefined();
  });
});
