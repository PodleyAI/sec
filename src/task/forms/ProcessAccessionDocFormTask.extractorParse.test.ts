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
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1018724;
const ACCESSION = "0000000000-26-000200";

/** A real committed Form D that parses AND stores end to end. */
const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

async function seedFiling(): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
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

class FixedFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    return GOOD_FORM_D;
  }
}

describe("ProcessAccessionDocFormTask wires a registered extractor's own `parse`", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    // Start this file's registry from sec's real registrations (already
    // present from other modules' import-time calls) rather than assuming
    // that state — clearing and re-registering is what makes the test
    // independent of import order across the whole suite.
    clearFormExtractorsForTesting();
    registerSecFormExtractors();
  });

  afterEach(() => {
    clearFormExtractorsForTesting();
    resetDependencyInjectionsForTesting();
  });

  it("runs the extra extractor's own parse on the raw fetched text, not the shared parse", async () => {
    const parseCalls: Array<{ form: string; text: string }> = [];
    const storeCalls: unknown[] = [];

    // A second extractor on form D, sharing D's version slot (same `id`) but
    // keyed distinctly in the registry (its own `section`) — the shape one
    // extra pass over the same filing takes once a form carries two.
    registerFormExtractor<{ readonly marker: string }>({
      id: "D",
      section: "side-channel",
      forms: ["D", "D/A"],
      parse: async (form, text) => {
        parseCalls.push({ form, text });
        return { marker: `own-parse:${text.length}` };
      },
      store: async ({ parsed }) => {
        storeCalls.push(parsed);
      },
    });

    await seedFiling();

    const result = await new FixedFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    // Called exactly once, with the form and the verbatim fetched body — not
    // the driver's own `Form_D.parse` output the sibling "D" extractor uses.
    expect(parseCalls).toEqual([{ form: "D", text: GOOD_FORM_D }]);
    expect(storeCalls).toEqual([{ marker: `own-parse:${GOOD_FORM_D.length}` }]);
  });
});
