//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskError, Workflow } from "@podley/task-graph";
import { Static, TObject, Type } from "@sinclair/typebox";
import { query_get, query_run } from "../../util/db";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";
import { TypeSecCik } from "../../types/CompanySubmission";
import { FetchTaskOutput } from "@podley/tasks";
import { ALL_FORMS_MAP } from "../../forms/all-forms";

const ProcessAccessionDocFormTaskInputSchema = () =>
  Type.Object({
    accessionNumber: Type.String({
      title: "Accession Doc",
      description: "The accession doc to process",
    }),
    cik: Type.Optional(TypeSecCik()),
    fileName: Type.Optional(
      Type.String({
        title: "File Name",
        description: "The name of the document to fetch if not the default",
      })
    ),
    form: Type.Optional(
      Type.String({
        title: "Form",
        description: "The form to process",
      })
    ),
  });

export type ProcessAccessionDocFormTaskInput = Static<
  ReturnType<typeof ProcessAccessionDocFormTaskInputSchema>
>;

const ProcessAccessionDocFormTaskOutputSchema = () =>
  Type.Object({
    success: Type.Boolean({ title: "Successful" }),
  });

type ProcessAccessionDocFormTaskOutput = Static<
  ReturnType<typeof ProcessAccessionDocFormTaskOutputSchema>
>;

export class ProcessAccessionDocFormTask extends Task<
  ProcessAccessionDocFormTaskInput,
  ProcessAccessionDocFormTaskOutput
> {
  static readonly type = "ProcessAccessionDocFormTask";
  static readonly category = "SEC";
  static readonly cacheable = true;

  public static inputSchema(): TObject {
    return ProcessAccessionDocFormTaskInputSchema();
  }

  static outputSchema(): TObject {
    return ProcessAccessionDocFormTaskOutputSchema();
  }

  async execute(
    input: ProcessAccessionDocFormTaskInput,
    context: IExecuteContext
  ): Promise<ProcessAccessionDocFormTaskOutput> {
    const { accessionNumber } = input;
    if (!accessionNumber) throw new TaskError("Invalid input");
    let { cik, form, fileName } = input;

    if (!input.cik || !input.form || !input.fileName) {
      const sql = `SELECT cik, primary_doc, form FROM filings WHERE accession_number = $accession_number`;
      const filing = query_get<{
        cik: number;
        primary_doc: string;
        form: string;
      }>(sql, { $accession_number: accessionNumber });
      if (!filing) throw new TaskError("Filing not found");
      ({ cik, form } = filing);
      fileName = fileName ?? filing.primary_doc;
    }

    const wf = context.own(new Workflow());

    wf.pipe(
      new SecFetchAccessionDocTask({
        cik: cik!,
        accessionNumber: accessionNumber,
        fileName: fileName!,
      }),
      async function processForm(input: FetchTaskOutput) {
        const { text } = input;
        const formCls = ALL_FORMS_MAP.get(form!);
        if (!formCls) throw new TaskError("Form not found");
        const result = await formCls.parse(text!);
        return { result };
      }
      // async function storeProcessedFiling() {
      //   const sql = `INSERT INTO processed_filings (cik, form, accession_number) VALUES ($cik, $form, $accession_number)`;
      //   query_run(sql, {
      //     $cik: cik!,
      //     $form: form!,
      //     $accession_number: accessionNumber,
      //   });
      //   return { success: true };
      // }
    );

    const result = await wf.run();
    console.log(result);
    return { success: true };
  }
}
