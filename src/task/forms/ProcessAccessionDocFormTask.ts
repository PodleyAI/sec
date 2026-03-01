/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskError, Workflow } from "@workglow/task-graph";
import { FetchUrlTaskOutput } from "@workglow/tasks";
import { globalServiceRegistry } from "@workglow/util";
import { Static, Type } from "typebox";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { PROCESSED_FILINGS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFilingsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";
import { processFormD } from "../../sec/forms/exempt-offerings/Form_D.storage";
import { processFormC } from "../../sec/forms/exempt-offerings/Form_C.storage";
import { processForm1A } from "../../sec/forms/exempt-offerings/Form_1_A.storage";
import { processForm1K } from "../../sec/forms/exempt-offerings/Form_1_K.storage";
import { processForm1Z } from "../../sec/forms/exempt-offerings/Form_1_Z.storage";

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

  public static inputSchema() {
    return ProcessAccessionDocFormTaskInputSchema();
  }

  static outputSchema() {
    return ProcessAccessionDocFormTaskOutputSchema();
  }

  async execute(
    input: ProcessAccessionDocFormTaskInput,
    context: IExecuteContext
  ): Promise<ProcessAccessionDocFormTaskOutput> {
    const { accessionNumber } = input;
    if (!accessionNumber) throw new TaskError("Invalid input");
    let cik = input.cik;
    let form = input.form;
    let fileName = input.fileName;
    let filing_date: string | null | undefined;
    let file_number: string | null | undefined;

    if (!cik || !form || !fileName) {
      const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
      const filings = await filingRepo.query({ accession_number: accessionNumber });
      const filing = filings?.[0];
      if (!filing) throw new TaskError("Filing not found");
      cik = filing.cik;
      form = filing.form ?? undefined;
      filing_date = filing.filing_date;
      file_number = filing.file_number;
      fileName = fileName ?? filing.primary_doc;
    }

    if (!form) {
      throw new TaskError(`Filing ${accessionNumber} has no form type`);
    }

    const processedFilingsRepo = globalServiceRegistry.get(PROCESSED_FILINGS_REPOSITORY_TOKEN);

    const wf = context.own(new Workflow());

    wf.pipe(
      new SecFetchAccessionDocTask({
        cik: cik!,
        accessionNumber: accessionNumber,
        fileName: fileName!,
      }),
      async function processForm(input: FetchUrlTaskOutput) {
        const { text } = input;
        const formCls = ALL_FORMS_MAP.get(form!);
        if (!formCls) throw new TaskError("Form not found");
        const result = await formCls.parse(form!, text!);

        const storageArgs = {
          cik: cik!,
          file_number: file_number ?? "",
          accession_number: accessionNumber,
          filing_date: filing_date ?? "",
          primary_doc: fileName!,
        };

        switch (form) {
          case "D":
          case "D/A":
            await processFormD({ ...storageArgs, formD: result });
            break;
          case "C":
          case "C/A":
          case "C-W":
          case "C-U":
          case "C-U-W":
          case "C/A-W":
          case "C-AR":
          case "C-AR-W":
          case "C-AR/A":
          case "C-AR/A-W":
          case "C-TR":
          case "C-TR-W":
            await processFormC({ ...storageArgs, formC: result });
            break;
          case "1-A":
          case "1-A/A":
            await processForm1A({ ...storageArgs, form1A: result });
            break;
          case "1-K":
          case "1-K/A":
            await processForm1K({ ...storageArgs, form1K: result });
            break;
          case "1-Z":
          case "1-Z/A":
            await processForm1Z({ ...storageArgs, form1Z: result });
            break;
        }

        return { result };
      },
      async function storeProcessedFiling() {
        await processedFilingsRepo.put({
          cik: cik!,
          form: form!,
          accession_number: accessionNumber,
          last_processed: todayYYYYdMMdDD(),
          success: true,
        });
        return { success: true };
      }
    );

    const result = await wf.run();
    console.log(result);
    return { success: true };
  }
}
