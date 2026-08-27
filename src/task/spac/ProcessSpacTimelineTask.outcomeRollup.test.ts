/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";
import { ProcessSpacTimelineTask } from "./ProcessSpacTimelineTask";

const CIK = 1800002;

/** A de-SPAC `S-4`: a registration statement AND the merger proxy for one vote. */
const S4 = "S-4";
/** A form whose every extractor is off the timeline's critical path. */
const OWNERSHIP_ONLY = "X-ROLLUP-OWNERSHIP";
/** A form carrying one nonfatal extractor and one that is not. */
const MIXED = "X-ROLLUP-MIXED";

const noopStore = async (): Promise<void> => {};

/**
 * Every registration is keyed `(id, section)`, so widening a shipped id onto a
 * new form adds a key rather than replacing the shipped one — registering
 * `merger-proxy` or `3` bare here would silently take `DEF 14A` and Form 3
 * filings with it.
 */
beforeAll(() => {
  registerFormExtractor({ id: "S-4", forms: [S4], store: noopStore });
  registerFormExtractor({ id: "merger-proxy", section: "de-spac", forms: [S4], store: noopStore });
  registerFormExtractor({ id: "3", section: "rollup", forms: [OWNERSHIP_ONLY], store: noopStore });
  registerFormExtractor({ id: "4", section: "rollup", forms: [OWNERSHIP_ONLY], store: noopStore });
  registerFormExtractor({ id: "3", section: "mixed", forms: [MIXED], store: noopStore });
  registerFormExtractor({ id: "S-4", section: "mixed", forms: [MIXED], store: noopStore });
});

async function seedFiling(accession: string, form: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: accession,
    form,
    primary_doc: "doc.htm",
    file_number: "333-1",
    filing_date: "2021-02-04",
    acceptance_date: "2021-02-04T00:00:00.000Z",
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

async function seedSuccessfulRun(
  accession: string,
  form: string,
  extractor_id: string
): Promise<void> {
  await new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)).recordRun({
    cik: CIK,
    accession_number: accession,
    form,
    extractor_id,
    extractor_version: "1.0.0",
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

/** Gives an extractor id a `current` slot, as `db setup` does for the shipped ids. */
async function seedExtractorVersion(id: string): Promise<void> {
  await new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)).putSlot({
    component_kind: "extractor",
    component_id: id,
    slot: "current",
    semver: "1.0.0",
    bump_type: null,
    started_at: "2021-01-01T00:00:00.000Z",
    coverage_complete: true,
    target_count: null,
  });
}

let rawRoot: string | undefined;

describe("ProcessSpacTimelineTask rolls a filing's outcome up across its extractors", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-rollup-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
    await seedExtractorVersion("S-4");
    // Nothing here is about what the replay does; the counts are read back from
    // `extractor_runs`, so the processor is stubbed and the seeded rows are the
    // only input.
    vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute").mockResolvedValue({ success: true });
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    vi.restoreAllMocks();
    resetDependencyInjectionsForTesting();
  });

  it("counts a filing every one of its extractors succeeded on as processed", async () => {
    // `S-4` is a form the registry knows and the shipped 1:1 map has no entry
    // for. Deriving one id from the form symbol answered `undefined` and
    // counted a fully-extracted filing as `failed` — a wrong number in the one
    // line an operator reads, produced by a map lookup rather than by anything
    // that happened to the filing.
    await seedFiling("0000000000-26-000001", S4);
    await seedSuccessfulRun("0000000000-26-000001", S4, "S-4");
    await seedSuccessfulRun("0000000000-26-000001", S4, "merger-proxy");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(1);
    expect(out.processed).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.nonfatal).toBe(0);
  });

  it("counts the filing failed while one of its extractors still owes a run", async () => {
    await seedFiling("0000000000-26-000001", S4);
    await seedSuccessfulRun("0000000000-26-000001", S4, "S-4");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(1);
    expect(out.processed).toBe(0);
    expect(out.failed).toBe(1);
  });

  it("counts a filing nonfatal only when every failing extractor is nonfatal", async () => {
    await seedFiling("0000000000-26-000001", OWNERSHIP_ONLY);

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(1);
    expect(out.nonfatal).toBe(1);
    expect(out.failed).toBe(0);
  });

  it("counts the filing failed when only some of its failing extractors are nonfatal", async () => {
    await seedFiling("0000000000-26-000001", MIXED);

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.nonfatal).toBe(0);
  });
});
