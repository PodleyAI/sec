/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import { formHasExtractor } from "../../sec/forms/formExtractors";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { cachedAccessionDocPath } from "../../util/accessionDocPath";
import { ParseFilingDocumentTask } from "./ParseFilingDocumentTask";

/**
 * The parse a maintainer can still reach for a form nothing here reads.
 *
 * Every processing path refuses or skips such a form, which is right, and would
 * leave whoever is changing the parser with no way to see its output at all.
 * This is that way — and it is only defensible while it writes nothing, so the
 * absence is asserted here rather than assumed.
 */

const CIK = 1018724;
const ACCESSION = "0000000000-26-000301";
const PROXY_FORM = "DEFM14A";
const DOC_NAME = "primary_doc.htm";

const PROXY_DOC = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/proxies-information-statements/mock_data/merger-proxy/defm14a_sample.txt"
  ),
  "utf-8"
);

let rawRoot: string | undefined;

async function seedFiling(form: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: ACCESSION,
    form,
    primary_doc: DOC_NAME,
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

/** Puts a document where the fetch cache would have left it. */
function cacheDoc(body: string): void {
  const fullPath = cachedAccessionDocPath(rawRoot!, CIK, ACCESSION, DOC_NAME)!;
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, "utf-8");
}

/** Every row of the two ledgers a processing run would have written. */
async function ledgerRows(): Promise<{ runs: unknown[]; deadLetters: unknown[] }> {
  const runs =
    (await globalServiceRegistry
      .get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      .query({ accession_number: ACCESSION } as never)) ?? [];
  const deadLetters =
    (await globalServiceRegistry
      .get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN)
      .query({ accession_number: ACCESSION } as never)) ?? [];
  return { runs: [...runs], deadLetters: [...deadLetters] };
}

describe("ParseFilingDocumentTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-parse-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    resetDependencyInjectionsForTesting();
  });

  it("parses a form nothing here extracts, and writes nothing doing it", async () => {
    await seedFiling(PROXY_FORM);
    cacheDoc(PROXY_DOC);
    expect(formHasExtractor(PROXY_FORM)).toBe(false);

    const out = await new ParseFilingDocumentTask().run({ accessionNumber: ACCESSION });

    expect(out.ok).toBe(true);
    expect(out.error).toBe("");
    expect(out.form).toBe(PROXY_FORM);
    expect(out.docFile).toBe(DOC_NAME);
    expect(out.parsed).toBeDefined();
    // Said out loud, so the output cannot be mistaken for a pipeline result.
    expect(out.hasExtractor).toBe(false);

    // The property that makes this safe to ship: a parse that records nothing
    // cannot become an untracked processing path, and cannot make a filing look
    // done to the anti-joins that decide what gets swept.
    expect(await ledgerRows()).toEqual({ runs: [], deadLetters: [] });
  });

  it("says so, and still writes nothing, when the document is not cached", async () => {
    await seedFiling(PROXY_FORM);

    const out = await new ParseFilingDocumentTask().run({ accessionNumber: ACCESSION });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Nothing cached/);
    // Never fetches: an inspection tool that reaches EDGAR is a fetch path.
    expect(out.error).toMatch(/never fetches/);
    expect(await ledgerRows()).toEqual({ runs: [], deadLetters: [] });
  });

  it("surfaces a parser throw rather than swallowing it", async () => {
    // The interesting case while developing a parser, so it is reported as its
    // own outcome and carries the parser's own message.
    const THROWING_FORM = "ZZ-THROWS";
    class ThrowingForm {
      static async parse(): Promise<unknown> {
        throw new Error("Maximum nested tags exceeded");
      }
    }
    const formMap = ALL_FORMS_MAP as Map<string, unknown>;
    formMap.set(THROWING_FORM, ThrowingForm);
    try {
      await seedFiling(THROWING_FORM);
      cacheDoc("<html></html>");

      const out = await new ParseFilingDocumentTask().run({ accessionNumber: ACCESSION });

      expect(out.ok).toBe(false);
      expect(out.error).toBe("Parse threw: Maximum nested tags exceeded");
      expect(out.docFile).toBe(DOC_NAME);
      expect(await ledgerRows()).toEqual({ runs: [], deadLetters: [] });
    } finally {
      formMap.delete(THROWING_FORM);
    }
  });

  it("distinguishes a parser that returned nothing from one that is absent", async () => {
    const EMPTY_FORM = "ZZ-EMPTY";
    class EmptyForm {
      static async parse(): Promise<unknown> {
        return undefined;
      }
    }
    const formMap = ALL_FORMS_MAP as Map<string, unknown>;
    formMap.set(EMPTY_FORM, EmptyForm);
    try {
      await seedFiling(EMPTY_FORM);
      cacheDoc("<html></html>");
      expect((await new ParseFilingDocumentTask().run({ accessionNumber: ACCESSION })).error).toBe(
        `Parser returned nothing for '${DOC_NAME}'`
      );
    } finally {
      formMap.delete(EMPTY_FORM);
    }

    // A form the catalogue describes but does not parse is a different answer.
    await seedFiling("DRSLTR");
    cacheDoc("<html></html>");
    const out = await new ParseFilingDocumentTask().run({ accessionNumber: ACCESSION });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("No parser for form 'DRSLTR'");
  });
});
