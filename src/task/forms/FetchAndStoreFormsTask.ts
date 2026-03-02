/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskError, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Static, Type } from "typebox";
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

export class FetchAndStoreFormsTask extends Task<
  FetchAndStoreFormsTaskInput,
  FetchAndStoreFormsTaskOutput
> {
  static readonly type = "FetchAndStoreFormsTask";
  static readonly category = "SEC";
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
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 5 });
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
