/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  clearFormExtractorsForTesting,
  extractorIdsForForm,
  formHandledByExtractor,
  formHasExtractor,
  formsForExtractorIds,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  type ExtractorRun,
} from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { formsForExtractor } from "./backfillDescriptors";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * One form, two extractors — everything a `Record<form, extractorId>` had no
 * slot for, asserted in one place.
 *
 * While every form has exactly one extractor this whole file describes a
 * situation that cannot arise, which is precisely why it is worth pinning: each
 * site below answered a 1:1 map plausibly and wrongly the day a second
 * extractor appeared, and none of them threw.
 *
 * The fixture is two registrations on top of the ones sec ships, each carrying
 * a `section` so it is ADDITIVE. The registry is keyed `(id, section)`, so a
 * bare re-registration under a shipped id would `set` over that key and
 * silently replace the shipped extractor instead of joining it.
 */
const SECOND_ID = "d-milestone";
const SECOND_SECTION = "milestone";
/** A real EDGAR form symbol no extractor sec ships handles. */
const NOVEL_FORM = "8-K12B";
/** A second section under the SHIPPED `D` id, reaching a form `D` never listed. */
const SEAM_SECTION = "novel-form";

const CIK = 1018724;
const D_ACCESSION = "0000000000-26-000700";
const C_ACCESSION = "0000000000-26-000701";
const UNHANDLED_ACCESSION = "0000000000-26-000702";

/** A real committed Form D that parses AND stores end to end. */
const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

const noopStore = async (): Promise<void> => {};

class FixedFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    return GOOD_FORM_D;
  }
}

async function seedFiling(accession_number: string, form: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number,
    form,
    primary_doc: "primary_doc.xml",
    file_number: "021-1",
    filing_date: "2026-02-11",
    acceptance_date: "2026-02-11T00:00:00.000Z",
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

function versionRegistry(): VersionRegistry {
  return new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
}

function runRepo(): ExtractorRunRepo {
  return new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
}

async function activeVersion(extractorId: string): Promise<string> {
  const slot = await getActiveSlot(versionRegistry(), "extractor", extractorId);
  expect(slot, `no active slot for '${extractorId}'`).toBeDefined();
  return slot!.semver;
}

async function runsFor(accession_number: string): Promise<ExtractorRun[]> {
  return (
    (await globalServiceRegistry
      .get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      .query({ cik: CIK, accession_number })) ?? []
  );
}

/** The accessions a worklist run selects, for the given form filter. */
async function worklistAccessions(form: string[]): Promise<string[]> {
  const out = await new ComputeFormsWorklistTask({ defaults: {} }).run({ form });
  return [...out.accessionNumber];
}

beforeAll(() => {
  // Register sec's own extractors FIRST so the once-per-generation guard is
  // armed: the `registerSecFormExtractors()` that `setupAllDatabases` makes is
  // then a no-op and cannot replace the two registrations below.
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
  registerFormExtractor({
    id: SECOND_ID,
    section: SECOND_SECTION,
    forms: ["D", "D/A"],
    store: noopStore,
  });
  registerFormExtractor({
    id: "D",
    section: SEAM_SECTION,
    forms: [NOVEL_FORM],
    store: noopStore,
  });
});

afterAll(() => {
  // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});

describe("a form carrying two extractors", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    // Seeds `component_versions` from the registry — the two registrations
    // above included — so this runs AFTER them, as a downstream package's
    // `bootstrapSecRuntime()` would.
    await setupAllDatabases();
  });

  it("gives each extractor its own run row, and neither the other's", async () => {
    await seedFiling(D_ACCESSION, "D");

    const result = await new FixedFetchTask().run({ accessionNumber: D_ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const byId = new Map((await runsFor(D_ACCESSION)).map((r) => [r.extractor_id, r]));
    expect([...byId.keys()].sort()).toEqual(["D", SECOND_ID].sort());
    // Each row is stamped with ITS OWN extractor's active version and id. A
    // filing-level id re-derived from the form symbol would give one of them
    // the other's, and the anti-join reads exactly this pair.
    expect(byId.get("D")!.extractor_version).toBe(await activeVersion("D"));
    expect(byId.get(SECOND_ID)!.extractor_version).toBe(await activeVersion(SECOND_ID));
    expect(byId.get("D")!.form).toBe("D");
    expect(byId.get(SECOND_ID)!.form).toBe("D");
  });

  it("keeps selecting the filing until BOTH extractors have succeeded", async () => {
    await seedFiling(D_ACCESSION, "D");

    // Nothing has run: the filing is owed to both.
    expect(await worklistAccessions(["D"])).toEqual([D_ACCESSION]);

    await new FixedFetchTask().run({ accessionNumber: D_ACCESSION });
    expect(await worklistAccessions(["D"])).toEqual([]);

    // Drop only the SECOND extractor's row. The shipped one's success is
    // untouched, and the filing is still owed — a gate that answered for one
    // arbitrary member of the set would call this done.
    const secondVersion = await activeVersion(SECOND_ID);
    expect(await runRepo().deleteForExtractorVersion(SECOND_ID, secondVersion)).toBe(1);
    expect(await worklistAccessions(["D"])).toEqual([D_ACCESSION]);

    // Symmetrically: restore the second, drop the shipped one. Neither
    // extractor is the one the answer comes from.
    await runRepo().recordRun({
      cik: CIK,
      accession_number: D_ACCESSION,
      form: "D",
      extractor_id: SECOND_ID,
      extractor_version: secondVersion,
      slot_at_run: "current",
      success: true,
      error: null,
    });
    expect(await worklistAccessions(["D"])).toEqual([]);
    await runRepo().deleteForExtractorVersion("D", await activeVersion("D"));
    expect(await worklistAccessions(["D"])).toEqual([D_ACCESSION]);
  });

  it("answers existence and membership over the set, not one arbitrary member", () => {
    // Both ids handle Form D, and neither is privileged by being first.
    expect(extractorIdsForForm("D")).toContain("D");
    expect(extractorIdsForForm("D")).toContain(SECOND_ID);
    expect(formHandledByExtractor("D", "D"), "D is handled by the shipped id").toBe(true);
    expect(formHandledByExtractor("D", SECOND_ID), "D is handled by the second id").toBe(true);
    expect(formHandledByExtractor("D", "S-1"), "D is not handled by S-1").toBe(false);

    // A form only a sectioned registration claims still exists, and the id it
    // widens is the one the section was registered under — not the key.
    expect(formHasExtractor(NOVEL_FORM), `${NOVEL_FORM} has an extractor`).toBe(true);
    expect(extractorIdsForForm(NOVEL_FORM)).toEqual(["D"]);
    expect(formHandledByExtractor(NOVEL_FORM, "D"), `${NOVEL_FORM} widens the D id`).toBe(true);
    expect(
      formHandledByExtractor(NOVEL_FORM, `D:${SEAM_SECTION}`),
      "a sectioned registry key is not an extractor id"
    ).toBe(false);

    // And the reverse direction: naming an id reaches every form any of its
    // sections registered, which is what a backfill's candidate set is.
    expect(formsForExtractorIds([SECOND_ID]).sort()).toEqual(["D", "D/A"]);
    expect(formsForExtractor("D")).toContain(NOVEL_FORM);
    expect(formsForExtractor("D")).toContain("D");
  });

  it("does not widen the sweep to the whole corpus", async () => {
    await seedFiling(D_ACCESSION, "D");
    await seedFiling(C_ACCESSION, "C");
    await seedFiling(UNHANDLED_ACCESSION, "10-K");

    // The Form C filing is finished: its only extractor has a successful run.
    await runRepo().recordRun({
      cik: CIK,
      accession_number: C_ACCESSION,
      form: "C",
      extractor_id: "C",
      extractor_version: await activeVersion("C"),
      slot_at_run: "current",
      success: true,
      error: null,
    });

    // A default (every registered form) sweep. Form D is owed work because its
    // SECOND extractor has none — and that is the only filing that comes back.
    // A gate that re-selected on "some extractor of some form is unprocessed"
    // would re-dispatch the finished Form C and re-pay its extraction.
    expect(await worklistAccessions([])).toEqual([D_ACCESSION]);

    // 10-K has no registered extractor, so no sweep reaches it at all.
    expect(formHasExtractor("10-K")).toBe(false);
  });

  it("holds a version slot for both, including one registered only through the seam", async () => {
    const reg = versionRegistry();

    // `SECOND_ID` appears in no list this package declares; `db setup` learned
    // it from the registry alone. Without a slot the worklist skips its form
    // entirely and nothing it writes can ever be version-gated.
    expect((await reg.getCurrent("extractor", SECOND_ID))?.semver).toBe("1.0.0");
    expect((await reg.getCurrent("extractor", "D"))?.semver).toBe("1.0.0");
    expect((await getActiveSlot(reg, "extractor", SECOND_ID))?.slot).toBe("current");

    // Slots are keyed by ID, never by the `id:section` registry key. A seeder
    // that confused the two would mint an unreachable slot and leave the real
    // lookup unresolved.
    expect(await reg.getCurrent("extractor", `${SECOND_ID}:${SECOND_SECTION}`)).toBeUndefined();
    expect(await reg.getCurrent("extractor", `D:${SEAM_SECTION}`)).toBeUndefined();
  });
});
