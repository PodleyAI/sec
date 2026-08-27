/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  type ExtractorRun,
} from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000300";

/**
 * A second extractor over Form D under an id of its own — the shape a form
 * takes once it carries two questions with independent version slots, and the
 * shape no `form -> id` map can describe.
 */
const SIDE_ID = "d-side-pass";

/** A real committed Form D that parses AND stores end to end. */
const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

async function seedFiling(): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: ACCESSION,
    form: "D",
    primary_doc: "primary_doc.xml",
    file_number: "021-1",
    filing_date: "2026-01-05",
    acceptance_date: "2026-01-05T00:00:00.000Z",
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

/** Gives an extractor id a `current` slot, as `db setup` does for the shipped ids. */
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

async function runsForFiling(): Promise<ExtractorRun[]> {
  return (
    (await globalServiceRegistry
      .get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      .query({ cik: CIK, accession_number: ACCESSION })) ?? []
  );
}

class FixedFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    return GOOD_FORM_D;
  }
}

describe("ProcessAccessionDocFormTask keys what it writes by the extractor that ran", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    // Start this file's registry from sec's real registrations rather than
    // assuming that state, so the test is independent of import order across
    // the suite.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
    await seedExtractorVersion(SIDE_ID, "2.5.0");
    await seedFiling();
  });

  afterEach(() => {
    clearFormExtractorsForTesting();
    resetDependencyInjectionsForTesting();
  });

  it("records one run row per extractor, each under its own id and version", async () => {
    registerFormExtractor<unknown>({
      id: SIDE_ID,
      forms: ["D", "D/A"],
      store: async () => {},
    });

    const result = await new FixedFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const rows = await runsForFiling();
    const byId = new Map(rows.map((r) => [r.extractor_id, r]));
    expect([...byId.keys()].sort()).toEqual(["D", SIDE_ID].sort());
    // Each row carries ITS OWN extractor's active version, never the sibling's.
    expect(byId.get(SIDE_ID)!.extractor_version).toBe("2.5.0");
    expect(byId.get("D")!.extractor_version).not.toBe("2.5.0");
    expect(byId.get("D")!.outcome).toBe("success");
    expect(byId.get(SIDE_ID)!.outcome).toBe("success");
  });

  it("dead-letters the extractor that threw, not the sibling that had already stored", async () => {
    registerFormExtractor<unknown>({
      id: SIDE_ID,
      forms: ["D", "D/A"],
      store: async () => {
        throw new Error("side pass exploded");
      },
    });

    const result = await new FixedFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    const deadLetters = new ExtractionDeadLetterRepo();
    const side = await deadLetters.get(SIDE_ID, ACCESSION, "");
    expect(side?.reason_code).toBe("STORE_ERROR");
    expect(side?.failed_extractor_version).toBe("2.5.0");
    expect(side?.detail).toContain("side pass exploded");

    // The shipped `D` extractor stored this filing before its sibling threw. A
    // filing-level id would have stamped the failure on it, dead-lettering and
    // version-gating work that actually succeeded.
    expect(await deadLetters.get("D", ACCESSION, "")).toBeFalsy();

    const rows = await runsForFiling();
    expect(rows.map((r) => r.extractor_id)).toEqual([SIDE_ID]);
    expect(rows[0]!.success).toBe(false);
  });

  it("fails every extractor of the form when the filing never reached the dispatch", async () => {
    registerFormExtractor<unknown>({
      id: SIDE_ID,
      forms: ["D", "D/A"],
      store: async () => {},
    });

    class FailingFetchTask extends ProcessAccessionDocFormTask {
      protected override async runFetch(): Promise<string> {
        throw new Error("edgar unreachable");
      }
    }

    const result = await new FailingFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(false);

    // No extractor ran, so each of them owes this filing a run and each is
    // entitled to a dead letter of its own — under its own version.
    const deadLetters = new ExtractionDeadLetterRepo();
    expect((await deadLetters.get("D", ACCESSION, ""))?.reason_code).toBe("FETCH_ERROR");
    expect((await deadLetters.get(SIDE_ID, ACCESSION, ""))?.reason_code).toBe("FETCH_ERROR");
    expect((await deadLetters.get(SIDE_ID, ACCESSION, ""))?.failed_extractor_version).toBe("2.5.0");

    const rows = await runsForFiling();
    expect(rows.map((r) => r.extractor_id).sort()).toEqual(["D", SIDE_ID].sort());
    expect(rows.every((r) => r.success === false)).toBe(true);
  });
});
