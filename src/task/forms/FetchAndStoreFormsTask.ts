/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskError, Workflow } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
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
    success: Type.Boolean({ title: "Successful" }),
  });

type FetchAndStoreFormsTaskOutput = Static<ReturnType<typeof FetchAndStoreFormsTaskOutputSchema>>;

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

    if (filings.length > 0) {
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
        fileName: filings.map((f) => f.primary_doc.replaceAll(/^(xsl[^\/]+\/)/g, "")),
      });
    }
    return { success: true };
  }
}
