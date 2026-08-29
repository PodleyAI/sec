/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
  type FormExtractorStoreReport,
} from "../../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  GATE_VERDICTS,
  isGateDecline,
} from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/** The known-SPAC-gated extractor, and an ungated one over the same form. */
const GATED_ID = "synth-deregistration";
const UNGATED_ID = "synth-metadata";
const FORM = "15-12G";
const ACTIVE_VERSION = "1.0.0";

/** Accessions the gated handler actually wrote its work for, one per store. */
interface HandlerCapture {
  readonly wrote: string[];
}

/**
 * Two extractors over one form, shaped like the pair the driver runs in
 * production: one whose handler is gated on a `spac` row it did not write, and
 * one with no gate at all. Both work from the submissions metadata alone, so
 * nothing is fetched and the run rows are the only output.
 *
 * The gated one is the defect in miniature — it returns early having written
 * nothing, and the driver records a SUCCESSFUL run for it either way.
 */
function registerScriptedExtractors(): HandlerCapture {
  const wrote: string[] = [];
  registerFormExtractor<unknown>({
    id: GATED_ID,
    forms: [FORM],
    needsDocument: false,
    store: async ({ cik, accession_number }): Promise<FormExtractorStoreReport> => {
      if ((await new SpacRepo().getSpac(cik)) === undefined) {
        return { gate: GATE_VERDICTS.noSpacRow };
      }
      wrote.push(accession_number);
      return { gate: GATE_VERDICTS.admitted };
    },
  });
  registerFormExtractor<unknown>({
    id: UNGATED_ID,
    forms: [FORM],
    needsDocument: false,
    store: async () => {
      // No gate to report on, so it reports nothing.
    },
  });
  return { wrote };
}

/** Gives an extractor id a `current` slot, as `db setup` does for shipped ids. */
async function seedExtractorVersion(id: string, semver: string): Promise<void> {
  await new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)).putSlot({
    component_kind: "extractor",
    component_id: id,
    slot: "current",
    semver,
    bump_type: null,
    started_at: "2026-01-01T00:00:00.000Z",
    coverage_complete: true,
    target_count: null,
  });
}

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2025-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Gate SPAC Inc.",
    spac_sic: 6770,
  });
}

async function seedFiling(cik: number, accession_number: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number,
    form: FORM,
    primary_doc: "",
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-19",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

function runRepo(): ExtractorRunRepo {
  return new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
}

/**
 * The run ledger's account of WHY an extractor wrote nothing.
 *
 * A known-SPAC-gated handler that finds no row returns early and is still
 * recorded successful, because a recorded successful run is what stops a filing
 * being re-selected. Until the gate's verdict was written down, that row was
 * indistinguishable from one whose handler examined the filing and had nothing
 * to say — and the only thing able to tell them apart was an inference over the
 * absence of downstream artifacts, which no new column can apply retroactively.
 */
describe("ProcessAccessionDocFormTask gate-verdict recording", () => {
  let capture: HandlerCapture | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    clearFormExtractorsForTesting();
    await seedExtractorVersion(GATED_ID, ACTIVE_VERSION);
    await seedExtractorVersion(UNGATED_ID, ACTIVE_VERSION);
    capture = registerScriptedExtractors();
  });

  afterEach(() => {
    capture = undefined;
    // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
    resetDependencyInjectionsForTesting();
  });

  it("records the declining verdict on the successful run of a gated handler that declined", async () => {
    const cik = 811;
    const accession = "0000000000-26-000811";
    await seedFiling(cik, accession);

    const result = await new ProcessAccessionDocFormTask().run({ accessionNumber: accession });
    expect((result as { success: boolean }).success).toBe(true);
    expect(capture?.wrote).toEqual([]);

    const row = await runRepo().findRun(cik, accession, GATED_ID, ACTIVE_VERSION);
    // The premise: the row that stops this filing being re-selected is a
    // success row, and it always was.
    expect(row?.success).toBe(true);
    expect(row?.outcome).toBe("success");
    // What is new is that it now says why it wrote nothing.
    expect(row?.gate_verdict).toBe(GATE_VERDICTS.noSpacRow);
    expect(isGateDecline(row?.gate_verdict)).toBe(true);
  });

  it("does not record a decline when the gate admitted the filing and the handler wrote", async () => {
    const cik = 812;
    const accession = "0000000000-26-000812";
    await seedSpac(cik);
    await seedFiling(cik, accession);

    await new ProcessAccessionDocFormTask().run({ accessionNumber: accession });
    expect(capture?.wrote).toEqual([accession]);

    const row = await runRepo().findRun(cik, accession, GATED_ID, ACTIVE_VERSION);
    expect(row?.success).toBe(true);
    expect(row?.gate_verdict).toBe(GATE_VERDICTS.admitted);
    expect(row?.gate_verdict).not.toBe(GATE_VERDICTS.noSpacRow);
    expect(isGateDecline(row?.gate_verdict)).toBe(false);
  });

  it("leaves the verdict null for an extractor that has no gate to report on", async () => {
    // Null is NOT RECORDED. An extractor with no gate says nothing, and its row
    // must not claim to have been admitted any more than it may claim to have
    // been turned away.
    const cik = 813;
    const accession = "0000000000-26-000813";
    await seedSpac(cik);
    await seedFiling(cik, accession);

    await new ProcessAccessionDocFormTask().run({ accessionNumber: accession });

    const row = await runRepo().findRun(cik, accession, UNGATED_ID, ACTIVE_VERSION);
    expect(row).toBeDefined();
    expect(row?.success).toBe(true);
    expect(row?.gate_verdict).toBeNull();
    expect(row?.gate_verdict).not.toBe(GATE_VERDICTS.admitted);
    expect(isGateDecline(row?.gate_verdict)).toBe(false);
  });
});
