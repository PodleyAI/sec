/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AiProvider,
  getAiProviderRegistry,
  getGlobalModelRepository,
  globalServiceRegistry,
} from "workglow";
import type { AiProviderRunFn, Capability, ModelConfig } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { registerFakeStructuredProvider } from "../../sec/forms/registration-statements/s1/testing/fakeStructuredProvider";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

// Full prospectus: Management / Ownership / Related-party sections all present,
// so an empty model response per section dead-letters MODEL_EMPTY (not absent).
const SECTION_HTML = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1>",
  "<table><tr><td>ACME Fund</td><td>1,000,000</td><td>12.5%</td></tr></table>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<p>We pay rent to an entity controlled by our CEO.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");
const HTML = "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT>" + SECTION_HTML + "</TEXT></DOCUMENT>";

// Management-only prospectus: every other section is genuinely absent
// (SECTION_NOT_FOUND, which does not block the reap), so a run where Management
// succeeds is fully clean.
const MGMT_ONLY_HTML =
  "<DOCUMENT><TYPE>S-1<SEQUENCE>1<TEXT>" +
  "<h1>MANAGEMENT</h1><p>Jane Roe — Director</p><h1>LEGAL MATTERS</h1><p>x</p>" +
  "</TEXT></DOCUMENT>";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000123";
const FILE_NAME = ACCESSION + ".txt";
// An observation row for this filing+extractor that the current run does NOT
// re-observe (high index, old timestamp) — the reaper's target.
const PHANTOM_INDEX = 99;
const OLD_CREATED_AT = "2020-01-01T00:00:00.000Z";

const JSON_MODE = ["text.generation", "json-mode"] as const satisfies Capability[];

class ThrowingStructuredProvider extends AiProvider {
  override readonly name = "fake-structured";
  override readonly displayName = "Throwing Structured";
  override readonly isLocal = true;
  override readonly supportsBrowser = false;
  override readonly supportsServer = false;
}

/**
 * A provider whose every section generation throws — the transient-failure case
 * sectionRunner swallows into a `MODEL_INVALID_OUTPUT` dead-letter without
 * aborting the filing.
 */
function registerThrowingProvider(): { unregister: () => void } {
  const runFn: AiProviderRunFn<any, any, ModelConfig> = async () => {
    throw new Error("simulated transient model failure");
  };
  const registry = getAiProviderRegistry();
  registry.registerProvider(new ThrowingStructuredProvider([{ serves: JSON_MODE, runFn }]));
  registry.registerRunFn("fake-structured", { serves: JSON_MODE, runFn });
  return { unregister: () => registry.unregisterProvider("fake-structured") };
}

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

/**
 * Seed a prior extractor_runs row at a different version than the active
 * "1.0.0" slot bootstrapConfigComponentVersions seeds, so the reap gate's
 * `versionChanged` check is satisfied for tests exercising the reap path
 * itself (as opposed to the same-version re-run gate, covered separately in
 * ProcessAccessionDocFormTask.reapVersionGate.test.ts).
 */
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

/** Insert a stale phantom company observation the reaper would delete. */
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

describe("ProcessAccessionDocFormTask reap gate on transient section failure", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-reapgate-"));
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

  it("keeps prior observations when a section dead-letters MODEL_INVALID_OUTPUT this run", async () => {
    cleanup = registerThrowingProvider().unregister;
    await seedFiling();
    seedFetchCache(rawRoot!, HTML);
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
    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
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
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;
    await seedFiling();
    seedFetchCache(rawRoot!, HTML);
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(
      pending.some((d) => d.accession_number === ACCESSION && d.reason_code === "MODEL_EMPTY")
    ).toBe(true);

    // The widened gate suppresses the reap for MODEL_EMPTY too.
    const survivor = await new CompanyObservationRepo().getById(phantomId);
    expect(survivor).toBeDefined();
  });

  it("still reaps stale observations on a fully clean run (no blocking failure)", async () => {
    // Management persists a confident person (success -> markResolved); every
    // other section is absent (SECTION_NOT_FOUND), which does not block. So no
    // blocking dead-letter is recorded and the reaper runs — but only because
    // this run is at a genuinely different version than its predecessor (see
    // seedPriorRunAtVersion); a same-version re-run would suppress the reap
    // (ProcessAccessionDocFormTask.reapVersionGate.test.ts).
    await seedPriorRunAtVersion("0.9.0");
    const { unregister } = registerFakeStructuredProvider([
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
    ]);
    cleanup = unregister;
    await seedFiling();
    seedFetchCache(rawRoot!, MGMT_ONLY_HTML);
    const phantomId = await seedPhantomObservation();

    const result = await new ProcessAccessionDocFormTask().run({
      accessionNumber: ACCESSION,
      cik: CIK,
      form: "S-1",
      fileName: FILE_NAME,
    });
    expect((result as { success: boolean }).success).toBe(true);

    // No blocking failure this run.
    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(
      pending.some(
        (d) =>
          d.accession_number === ACCESSION &&
          d.reason_code !== "SECTION_NOT_FOUND" &&
          !d.section_name.endsWith("-partial")
      )
    ).toBe(false);

    // The reaper runs and removes the stale phantom.
    const reaped = await new CompanyObservationRepo().getById(phantomId);
    expect(reaped).toBeUndefined();
  });
});
