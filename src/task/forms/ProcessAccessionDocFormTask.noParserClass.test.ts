/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, OutputTask, Workflow, type DataPorts, type ITask } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { formsSweepLoop } from "./formsSweep";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * A form symbol this package catalogues no parser class for — the shape a form
 * served entirely by a downstream package takes. Deliberately absent from
 * `ALL_FORMS_MAP`, which each test asserts before relying on it.
 */
const OWN_PARSE_FORM = "ZZ-OWN-PARSE";
const OWN_PARSE_ID = "zz-own-parse";

/** The same, for an extractor that brings NO parse of its own. */
const SHARED_PARSE_FORM = "ZZ-SHARED-PARSE";
const SHARED_PARSE_ID = "zz-shared-parse";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000400";

/** A real committed Form D — the fetched body, whoever ends up parsing it. */
const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

async function seedFiling(cik: number, accession: string, form: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik,
    accession_number: accession,
    form,
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

class FixedFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    return GOOD_FORM_D;
  }
}

describe("ProcessAccessionDocFormTask on a form with no parser class", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    // Start from sec's real registrations rather than assuming that state, so
    // these tests are independent of import order across the suite.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
    await seedExtractorVersion(OWN_PARSE_ID, "1.0.0");
    await seedExtractorVersion(SHARED_PARSE_ID, "1.0.0");
  });

  afterEach(() => {
    clearFormExtractorsForTesting();
    resetDependencyInjectionsForTesting();
  });

  it("dispatches a form whose only extractor brings its own parse", async () => {
    // The premise: nothing in this package can parse this form.
    expect(ALL_FORMS_MAP.get(OWN_PARSE_FORM)).toBeUndefined();

    const storeCalls: unknown[] = [];
    registerFormExtractor<{ readonly marker: string }>({
      id: OWN_PARSE_ID,
      forms: [OWN_PARSE_FORM],
      parse: async (_form, text) => ({ marker: `own-parse:${text.length}` }),
      store: async ({ parsed }) => {
        storeCalls.push(parsed);
      },
    });

    await seedFiling(CIK, ACCESSION, OWN_PARSE_FORM);

    const result = await new FixedFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    // The store saw its OWN extractor's parse of the fetched body — a shared
    // parse that does not exist was neither needed nor missed.
    expect(storeCalls).toEqual([{ marker: `own-parse:${GOOD_FORM_D.length}` }]);
  });

  it("dead-letters only the filing whose extractor needed the missing parse", async () => {
    expect(ALL_FORMS_MAP.get(SHARED_PARSE_FORM)).toBeUndefined();
    expect(ALL_FORMS_MAP.get(OWN_PARSE_FORM)).toBeUndefined();

    const badAccession = "0000000001-26-000401";
    const goodAccession = "0000000002-26-000402";

    let badStores = 0;
    // No `parse` of its own, so this extractor reads the form's shared parse —
    // and the form has no class to supply one.
    registerFormExtractor<unknown>({
      id: SHARED_PARSE_ID,
      forms: [SHARED_PARSE_FORM],
      store: async () => {
        badStores++;
      },
    });
    const goodStores: unknown[] = [];
    registerFormExtractor<{ readonly marker: string }>({
      id: OWN_PARSE_ID,
      forms: [OWN_PARSE_FORM],
      parse: async () => ({ marker: "own-parse" }),
      store: async ({ parsed }) => {
        goodStores.push(parsed);
      },
    });

    await seedFiling(111, badAccession, SHARED_PARSE_FORM);
    await seedFiling(222, goodAccession, OWN_PARSE_FORM);

    // Neither form is ranked for sweep order, so the worklist keeps the
    // requested order — which is what makes the second filing genuinely LATER
    // than the one that cannot be parsed, rather than merely a sibling.
    const worklist = await new ComputeFormsWorklistTask({
      defaults: { form: [SHARED_PARSE_FORM, OWN_PARSE_FORM] },
    }).run({});
    expect(worklist.accessionNumber).toEqual([badAccession, goodAccession]);

    // formsSweepLoop constructs the production task itself, so the fetch seam
    // is stubbed on the prototype rather than by subclassing — the graph under
    // test stays the real one.
    const proto = ProcessAccessionDocFormTask.prototype as unknown as {
      runFetch: () => Promise<string>;
    };
    const realRunFetch = proto.runFetch;
    proto.runFetch = async () => GOOD_FORM_D;

    try {
      const wf = new Workflow();
      // The filing that cannot be parsed is dispatched first; the one after it
      // is what an uncontained throw used to lose.
      formsSweepLoop(
        new ComputeFormsWorklistTask({
          defaults: { form: [SHARED_PARSE_FORM, OWN_PARSE_FORM] },
        })
      )(wf);
      wf.pipe(new OutputTask() as ITask<DataPorts, DataPorts>);

      await expect(wf.run({})).resolves.toBeDefined();
    } finally {
      proto.runFetch = realRunFetch;
    }

    const deadLetters = new ExtractionDeadLetterRepo();
    expect((await deadLetters.get(SHARED_PARSE_ID, badAccession, ""))?.reason_code).toBe(
      "PARSE_ERROR"
    );
    expect(badStores).toBe(0);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect((await runRepo.findRun(111, badAccession, SHARED_PARSE_ID, "1.0.0"))?.success).toBe(
      false
    );
    // The later filing in the same sweep still ran end to end.
    expect((await runRepo.findRun(222, goodAccession, OWN_PARSE_ID, "1.0.0"))?.success).toBe(true);
    expect(goodStores).toEqual([{ marker: "own-parse" }]);
  });
});
