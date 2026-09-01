/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IExecuteContext } from "workglow";
import { globalServiceRegistry } from "workglow";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  clearFormExtractorsForTesting,
  registerFormExtractor,
} from "../../sec/forms/formExtractors";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/** The form's extractor, and the narrative pass it runs behind a gate. */
const EIGHT_K_ID = "synth-8k";
const GATED_ID = "synth-gated";
const ACTIVE_VERSION = "1.0.0";

class CapturingTask extends ProcessAccessionDocFormTask {
  public readonly fetched: string[] = [];

  protected override async runFetch(
    _cik: number,
    _accessionNumber: string,
    fileName: string,
    _context: IExecuteContext
  ): Promise<string> {
    this.fetched.push(fileName);
    return "<SEC-HEADER></SEC-HEADER>";
  }
}

/** What the extractor was handed to read, one entry per store. */
interface ExtractorCapture {
  readonly seen: Array<string | undefined>;
}

/**
 * An 8-K extractor shaped like the one the driver runs in production: it wants
 * the whole submission fetched for EVERY filing of the form, and it reads those
 * exhibits only for an admitted filer carrying a redemption or letter-of-intent
 * item. Its gated pass records an `extractor_runs` row under an id of its own,
 * which is what makes "the gate was closed" observable as an absent row rather
 * than only as an absent argument.
 *
 * The real predicate asks a lifecycle table this package no longer holds, so
 * the filer half is a plain set here. What is under test is the DISPATCHER —
 * which file it fetches, what it hands a `store`, and what it records — and
 * that is unchanged by how the extractor decides.
 */
function registerScriptedExtractor(): ExtractorCapture {
  const seen: Array<string | undefined> = [];
  registerFormExtractor<string>({
    id: EIGHT_K_ID,
    forms: ["8-K", "8-K/A"],
    needsFullSubmission: true,
    readsFullSubmission: async ({ cik, items }) => {
      if (cik === undefined) return false;
      if (!hasRedemptionTriggerItem(items) && !hasLoiTriggerItem(items)) return false;
      return admittedCiks.has(cik);
    },
    parse: async (_form, text) => text,
    store: async (args) => {
      seen.push(args.fullSubmissionText);
      // The narrative pass runs on the exhibits or not at all, so a closed gate
      // leaves it with no run of its own to record.
      if (args.fullSubmissionText === undefined) return;
      const slot = await getActiveSlot(
        new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)),
        "extractor",
        GATED_ID
      );
      await new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      ).recordRun({
        cik: args.cik,
        accession_number: args.accession_number,
        form: args.form,
        extractor_id: GATED_ID,
        extractor_version: slot?.semver ?? ACTIVE_VERSION,
        slot_at_run: slot?.slot ?? "current",
        success: true,
        error: null,
      });
    },
  });
  return { seen };
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

/** The filers the scripted extractor's own gate admits. */
const admittedCiks = new Set<number>();

function admitCik(cik: number): void {
  admittedCiks.add(cik);
}

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly primary_doc: string;
  readonly items: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: opts.primary_doc,
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-19",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items,
    act: null,
  } as never);
}

/** Registry and version state a case needs, restored afterwards. */
async function installScriptedExtractor(): Promise<ExtractorCapture> {
  admittedCiks.clear();
  clearFormExtractorsForTesting();
  await seedExtractorVersion(EIGHT_K_ID, ACTIVE_VERSION);
  await seedExtractorVersion(GATED_ID, ACTIVE_VERSION);
  return registerScriptedExtractor();
}

function restoreShippedExtractors(): void {
  // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
}

/**
 * The 8-K fetch policy and the narrative-pass gate, which used to be one flag.
 *
 * Fetching the whole submission is unconditional for 8-K; handing its EX-99
 * exhibits to a narrative pass is still gated, on a trigger item and on a filer
 * the extractor's own gate admits. Pinning both halves together is the point —
 * a single flag is how "fetch more" and "feed the model more" became impossible
 * to do separately.
 */
describe("ProcessAccessionDocFormTask 8-K fetch policy and narrative-pass gate", () => {
  let capture: ExtractorCapture | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    capture = await installScriptedExtractor();
  });

  afterEach(() => {
    capture = undefined;
    restoreShippedExtractors();
    resetDependencyInjectionsForTesting();
  });

  it("fetches the full .txt for an admitted filer's trigger-item 8-K and feeds it to the extractor", async () => {
    const accession = "0000000000-26-000007";
    admitCik(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07,9.01",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain(`${accession}.txt`);
    expect(capture?.seen).toEqual(["<SEC-HEADER></SEC-HEADER>"]);
  });

  // The two below are the pair the split exists for: the fetch widened for
  // every 8-K, and what the extractor reads did not move with it.
  it("fetches the full .txt for a non-trigger item without feeding it to the extractor", async () => {
    const accession = "0000000000-26-000008";
    admitCik(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "2.02",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain(`${accession}.txt`);
    expect(task.fetched).not.toContain("primary.htm");
    expect(capture?.seen).toEqual([undefined]);
  });

  it("fetches the full .txt for an unadmitted CIK without feeding it to the extractor", async () => {
    // The two halves of the split, in one filing. It has a trigger item and a
    // filer the gate does not admit: the fetch is unconditional so the exhibits
    // reach disk, and the gate is unchanged so nothing reaches the gated pass.
    const accession = "0000000000-26-000010";
    await seedFiling({
      cik: 99,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain(`${accession}.txt`);
    expect(task.fetched).not.toContain("primary.htm");
    expect(capture?.seen).toEqual([undefined]);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect(await runRepo.findRun(99, accession, GATED_ID, ACTIVE_VERSION)).toBeUndefined();
  });
});

describe("ProcessAccessionDocFormTask 8-K extractor_runs recording", () => {
  const FULL_TXT =
    "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000050\n</SEC-HEADER>\n" +
    "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Vote results.</p>\n</TEXT>\n</DOCUMENT>\n" +
    "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
    "<p>Holders of 1,234,567 shares elected to redeem for $12,400,000.</p>\n" +
    "</TEXT>\n</DOCUMENT>\n";

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    await installScriptedExtractor();
  });

  afterEach(() => {
    restoreShippedExtractors();
    resetDependencyInjectionsForTesting();
  });

  class FixedBodyTask extends ProcessAccessionDocFormTask {
    constructor(private readonly bodyText: string) {
      super();
    }
    protected override async runFetch(
      _cik: number,
      _accessionNumber: string,
      _fileName: string,
      _context: IExecuteContext
    ): Promise<string> {
      return this.bodyText;
    }
  }

  it("records a successful run for the extractor and for its gated pass after a clean run", async () => {
    const cik = 50;
    const accession = "0000000000-26-000050";

    admitCik(cik);
    await seedFiling({
      cik,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });

    const result = await new FixedBodyTask(FULL_TXT).run({ accessionNumber: accession });
    expect((result as { success: boolean }).success).toBe(true);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    // The gated pass ran on the exhibits and recorded its own row.
    const gated = await runRepo.findRun(cik, accession, GATED_ID, ACTIVE_VERSION);
    expect(gated?.success).toBe(true);
    expect(gated?.error).toBeNull();
    // And the driver recorded one for the extractor it dispatched through.
    const dispatched = await runRepo.findRun(cik, accession, EIGHT_K_ID, ACTIVE_VERSION);
    expect(dispatched?.success).toBe(true);
    expect(dispatched?.error).toBeNull();
  });

  // The three below pin the run row's account of WHAT the extractor was handed,
  // which is the only place that fact survives the dispatch. Two 8-Ks of the
  // same admitted filer, differing only in their item codes, produce classifications
  // of different worth: one made over the EX-99 exhibits and one made over four
  // sentences pointing at them. Without this column a stored answer carrying no
  // merger detail cannot be told from a filing that genuinely had none, and a
  // later pass run with the exhibits would disagree with nothing recording why.
  it("records that the dispatched extractor read the full submission when the gate opened", async () => {
    const cik = 51;
    const accession = "0000000000-26-000051";

    admitCik(cik);
    await seedFiling({
      cik,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });

    await new FixedBodyTask(FULL_TXT).run({ accessionNumber: accession });

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const dispatched = await runRepo.findRun(cik, accession, EIGHT_K_ID, ACTIVE_VERSION);
    expect(dispatched?.read_full_submission).toBe(true);
  });

  it("records that it did not, for a filing whose items never open the gate", async () => {
    // Same admitted filer and the same bytes on disk — only the item codes differ,
    // and 2.02 is not a trigger item.
    const cik = 52;
    const accession = "0000000000-26-000052";

    admitCik(cik);
    await seedFiling({
      cik,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "2.02",
    });

    await new FixedBodyTask(FULL_TXT).run({ accessionNumber: accession });

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const dispatched = await runRepo.findRun(cik, accession, EIGHT_K_ID, ACTIVE_VERSION);
    expect(dispatched?.read_full_submission).toBe(false);
    expect(dispatched?.read_full_submission).not.toBeNull();
  });

  it("leaves the verdict null for a run recorded by a caller that does not state it", async () => {
    // The gated pass writes its own row from inside the extractor's `store`,
    // through the same call shape every writer used before the column existed.
    // Null is what such a row must report: nobody wrote the answer down, which
    // is not the same fact as the extractor having read the primary document
    // alone.
    const cik = 53;
    const accession = "0000000000-26-000053";

    admitCik(cik);
    await seedFiling({
      cik,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });

    await new FixedBodyTask(FULL_TXT).run({ accessionNumber: accession });

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const gated = await runRepo.findRun(cik, accession, GATED_ID, ACTIVE_VERSION);
    expect(gated).toBeDefined();
    expect(gated?.read_full_submission).toBeNull();
  });
});
