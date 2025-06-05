//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskError, Workflow } from "@podley/task-graph";
import { Static, TObject, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { query_all } from "../../util/db";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";
import { sleep } from "@podley/util";

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

  public static inputSchema(): TObject {
    return FetchAndStoreFormsTaskInputSchema();
  }

  static outputSchema(): TObject {
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

    const wf = context.own(new Workflow());
    for (const filing of filings) {
      console.error(filing);
      await sleep(0);
      wf.pipe(
        new ProcessAccessionDocFormTask({
          cik: cik,
          form: form,
          accessionNumber: filing.accession_number,
          fileName: filing.primary_doc.replaceAll("xslFormDX01/", ""),
        })
      );
    }
    const result = await wf.run();
    return { success: true };
  }
}
