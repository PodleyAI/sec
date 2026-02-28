/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskError, Workflow } from "@workglow/task-graph";
import { Static, TObject, Type } from "typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { query_all } from "../../util/db";
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
    let sql;
    let filings: {
      cik: number;
      accession_number: string;
      primary_doc: string;
    }[] = [];

    if (docid) {
      sql = `SELECT cik, accession_number, primary_doc FROM filings WHERE cik = $cik AND form = $form AND accession_number = $docid`;
      filings = query_all<{
        cik: number;
        accession_number: string;
        primary_doc: string;
      }>(sql, { $cik: cik, $form: form, $docid: docid });
    } else {
      sql = `SELECT cik, accession_number, primary_doc FROM filings WHERE cik = $cik AND form = $form`;
      filings = query_all<{
        cik: number;
        accession_number: string;
        primary_doc: string;
      }>(sql, { $cik: cik, $form: form });
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
