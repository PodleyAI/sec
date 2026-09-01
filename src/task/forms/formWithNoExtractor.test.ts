/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { resetNoExtractorWarningsForTesting } from "../../sec/forms/parserOnlyForms";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { runExtractorBackfill } from "./BackfillExtractorTask";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * A form NAMED and a form ENCOUNTERED are different things, and both
 * directions are pinned here so neither can be collapsed into the other.
 *
 * Being told to process a form this deployment cannot read is a refusal: the
 * operator asked for something specific, and quietly doing the rest of the
 * request is how a command reports success over work it never attempted. Merely
 * MEETING such a form on a sweep that asked for something else is a skip with a
 * warning: nothing is fetched, parsed, dispatched, recorded or dead-lettered,
 * and the filings around it are still processed.
 *
 * Collapsing the two either way is a real failure. Skipping a named form makes
 * `sync forms --types DEFM14A` a no-op that exits 0; refusing an encountered one
 * makes a single proxy on a SPAC's timeline abort the whole issuer.
 */

const CIK = 1018724;
const PROXY_FORM = "DEF 14A";
const PROXY_A = "0000000000-26-000201";
const PROXY_B = "0000000000-26-000202";
const FORM_D_ACCESSION = "0000000000-26-000203";

/** A real committed Form D that parses AND stores end to end. */
const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

/** Fetches nothing over the network; a proxy must never reach this at all. */
class StubbedFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(
    _cik: number,
    _accessionNumber: string,
    _fileName: string
  ): Promise<string> {
    return GOOD_FORM_D;
  }
}

async function seedFiling(accession: string, form: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: accession,
    form,
    primary_doc: "primary_doc.xml",
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

describe("a form named with no extractor in this deployment", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    resetNoExtractorWarningsForTesting();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("is refused, naming the form and who supplies its extractor", async () => {
    await expect(
      new ComputeFormsWorklistTask({ defaults: {} }).run({ form: [PROXY_FORM] })
    ).rejects.toThrowError(/DEF 14A.*merger-proxy.*consumer package/s);
  });

  it("is refused even alongside forms this deployment can read", async () => {
    // Narrowing the request to the readable part would sweep Form D and report
    // done, with the proxy the operator asked about silently absent.
    await expect(
      new ComputeFormsWorklistTask({ defaults: {} }).run({ form: ["D", PROXY_FORM] })
    ).rejects.toThrowError(/DEF 14A/);
  });

  it("refuses a backfill of the extractor itself rather than sweeping nothing", async () => {
    // `extractor backfill merger-proxy` selects no filing here, and a run that
    // read nothing and returned `selected: 0` is indistinguishable from a
    // corpus with nothing left owing.
    await expect(
      runExtractorBackfill({
        extractorId: "merger-proxy",
        force: false,
        dryRun: true,
        processFiling: async () => {
          throw new Error("must not process anything");
        },
      })
    ).rejects.toThrowError(/registers no extractor under that id/);
  });

  it("still backfills an extractor this deployment does ship", async () => {
    // The refusal is about an absent extractor, never about an empty result: a
    // registered extractor with nothing owing is a legitimate answer.
    const out = await runExtractorBackfill({
      extractorId: "D",
      force: false,
      dryRun: true,
      processFiling: async () => {
        throw new Error("dry run processes nothing");
      },
    });
    expect(out.selected).toBe(0);
  });
});

describe("a form a sweep merely encountered", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    resetNoExtractorWarningsForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDependencyInjectionsForTesting();
  });

  it("is skipped and warned about once, and the rest of the run still happens", async () => {
    await seedFiling(PROXY_A, PROXY_FORM);
    await seedFiling(PROXY_B, PROXY_FORM);
    await seedFiling(FORM_D_ACCESSION, "D");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const task = new StubbedFetchTask();
    for (const accession of [PROXY_A, PROXY_B, FORM_D_ACCESSION]) {
      const result = await task.run({ accessionNumber: accession });
      expect((result as { success: boolean }).success, accession).toBe(true);
    }

    // Once per form per run, not once per filing: a sweep meets a form it
    // cannot read once for every filing of it, and thousands of identical
    // lines is a warning nobody reads.
    const lines = warn.mock.calls.map((call) => String(call[0]));
    const skipLines = lines.filter((line) => line.includes(PROXY_FORM));
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0]).toMatch(/merger-proxy.*consumer package/);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const deadLetters = new ExtractionDeadLetterRepo();

    // The skipped filings recorded nothing at all — no run row to make them
    // look processed, no dead letter to be retried forever.
    for (const accession of [PROXY_A, PROXY_B]) {
      const runs =
        (await globalServiceRegistry
          .get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
          .query({ accession_number: accession } as never)) ?? [];
      expect(runs, accession).toEqual([]);
      expect(await deadLetters.get("merger-proxy", accession, ""), accession).toBeFalsy();
    }

    // And the work the run could do was done: the skip is a skip, not an abort.
    const run = await runRepo.findRun(CIK, FORM_D_ACCESSION, "D", "1.0.0");
    expect(run?.success).toBe(true);
  });
});
