/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { scanSpacCandidates } from "./spacCandidateScan";

describe("scanSpacCandidates backend dispatch", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("uses the in-memory repositories even when SEC_DB_* names a SQLite database", async () => {
    // `resetDependencyInjectionsForTesting` is what registers the in-memory
    // repositories; the beforeEach already ran it.
    await setupAllDatabases();

    await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put({
      cik: 1,
      name: "Alpha Acquisition Corp",
      type: null,
      sic: 6770,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
    });
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 1,
      accession_number: "0000000000-21-000001",
      filing_date: "2021-01-05",
      report_date: null,
      acceptance_date: "2021-01-05T00:00:00.000Z",
      form: "S-1",
      file_number: null,
      film_number: null,
      items: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      primary_doc: "alpha-s1.htm",
      primary_doc_description: null,
      act: null,
    });

    // Only NOW bind the production SQLite config, pointing at a directory that
    // does not exist. A backend probe that reads SEC_DB_* alone would select the
    // SQLite fast path and either throw out of getDb() or scan an empty file;
    // the in-memory repositories are what actually hold the seeded rows.
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, "/nonexistent/sec-scan-guard");
    globalServiceRegistry.registerInstance(SEC_DB_NAME, "edgar");

    const facts = await scanSpacCandidates();

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      cik: 1,
      name: "Alpha Acquisition Corp",
      current_sic: 6770,
      first_reg_form: "S-1",
      first_reg_date: "2021-01-05",
    });
  });
});
