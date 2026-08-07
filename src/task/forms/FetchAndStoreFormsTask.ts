/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskError, Workflow } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { stripXslPrefix } from "../../util/accessionDocPath";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const FetchAndStoreFormsTaskInputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
    form: Type.String({
      title: "Form",
      description: "The form to fetch",
    }),
    docid: Type.Optional(
      Type.String({
        title: "Doc ID",
        description: "The accession number of the document to fetch",
      })
    ),
  });

export type FetchAndStoreFormsTaskInput = Static<
  ReturnType<typeof FetchAndStoreFormsTaskInputSchema>
>;

const FetchAndStoreFormsTaskOutputSchema = () =>
  Type.Object({
    success: Type.Boolean({
      title: "Successful",
      description:
        "True when at least one filing matched and none ended `failure`. A `partial` " +
        "filing still counts as success here — some sections landed — so callers that " +
        "care must read `partial`.",
    }),
    matched: Type.Number({
      title: "Matched",
      description: "Filings matching (cik, form[, docid]). Zero means the selector found nothing.",
    }),
    succeeded: Type.Number({ title: "Succeeded", description: "Filings with outcome `success`." }),
    partial: Type.Number({
      title: "Partial",
      description: "Filings where some sections extracted and others dead-lettered.",
    }),
    failed: Type.Number({ title: "Failed", description: "Filings with outcome `failure`." }),
    triage: Type.Number({
      title: "Triage entries",
      description:
        "Pending dead-letter entries across the processed filings. A `<section>-partial` " +
        "entry does NOT fail its filing by design — the surviving rows persist — so these " +
        "are invisible in the outcome counts even though rows were dropped.",
    }),
  });

export type FetchAndStoreFormsTaskOutput = Static<
  ReturnType<typeof FetchAndStoreFormsTaskOutputSchema>
>;

/**
 * Fetches and processes every filing matching (cik, form[, docid]).
 *
 * Intentionally bypasses the version gate: unlike the forms sweep
 * (ComputeFormsWorklistTask, which skips filings that already have a successful extractor_runs
 * row at the current version), this task unconditionally schedules
 * ProcessAccessionDocFormTask for every matching filing. The PK on
 * extractor_runs means the existing row is overwritten in place, so
 * this is safe but bypasses the "don't re-extract what's already done"
 * optimization. Used for targeted reprocessing of a single filing.
 */
export class FetchAndStoreFormsTask extends Task<
  FetchAndStoreFormsTaskInput,
  FetchAndStoreFormsTaskOutput
> {
  static readonly type = "FetchAndStoreFormsTask";
  static readonly category = "SEC";
  static readonly title = "Fetch and store forms";
  static readonly cacheable = true;

  public static inputSchema() {
    return FetchAndStoreFormsTaskInputSchema();
  }

  static outputSchema() {
    return FetchAndStoreFormsTaskOutputSchema();
  }

  async execute(
    input: FetchAndStoreFormsTaskInput,
    context: IExecuteContext
  ): Promise<FetchAndStoreFormsTaskOutput> {
    const { cik, form, docid } = input;
    if (!cik || !form) throw new TaskError("Invalid input");

    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);

    let filings: Filing[];
    if (docid) {
      filings = (await filingRepo.query({ cik, form, accession_number: docid })) ?? [];
    } else {
      filings = (await filingRepo.query({ cik, form })) ?? [];
    }

    if (filings.length === 0) {
      // A selector that matches nothing is the single most likely operator
      // mistake here (wrong form string, an accession not ingested yet), and it
      // used to return `success: true` — indistinguishable from a clean run.
      return { success: false, matched: 0, succeeded: 0, partial: 0, failed: 0, triage: 0 };
    }

    const wf = context.own(new Workflow(), {
      title: `Process ${filings.length} ${form} filings for CIK ${cik}`,
    });
    const loop = wf.map({ concurrencyLimit: 5, maxIterations: filings.length });
    loop.pipe(new ProcessAccessionDocFormTask());
    loop.endMap();
    await wf.run({
      cik: filings.map(() => cik),
      form: filings.map(() => form),
      accessionNumber: filings.map((f) => f.accession_number),
      fileName: filings.map((f) => stripXslPrefix(f.primary_doc)),
    });

    // Counts come from the persisted `extractor_runs` rows rather than the
    // sub-task's boolean, which collapses `partial` into `false` and so cannot
    // distinguish "every section dead-lettered" from "one of nine did".
    // ProcessAccessionDocFormTask contains its own failures and returns rather
    // than throwing, so without reading these back a filing whose sections all
    // dead-lettered is indistinguishable from a clean run.
    const runRepo = globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN);
    const deadLetterRepo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
    let succeeded = 0;
    let partial = 0;
    let failed = 0;
    let triage = 0;
    for (const filing of filings) {
      const runs =
        (await runRepo.query({ cik, accession_number: filing.accession_number })) ?? [];
      // Newest version wins: this task deliberately re-processes, and the PK
      // includes extractor_version, so an older attempt's row can still be here.
      const latest = runs.at(-1);
      if (latest?.outcome === "success") succeeded++;
      else if (latest?.outcome === "partial") partial++;
      else failed++;

      const pending =
        (await deadLetterRepo.query({
          accession_number: filing.accession_number,
          status: "pending",
        })) ?? [];
      triage += pending.length;
    }

    return { success: failed === 0, matched: filings.length, succeeded, partial, failed, triage };
  }
}
