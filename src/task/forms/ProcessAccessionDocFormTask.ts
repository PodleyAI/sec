/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import {
  FetchUrlTaskOutput,
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskError,
  Workflow,
} from "workglow";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import { processForm1A } from "../../sec/forms/exempt-offerings/Form_1_A.storage";
import { processForm1K } from "../../sec/forms/exempt-offerings/Form_1_K.storage";
import { processForm1Z } from "../../sec/forms/exempt-offerings/Form_1_Z.storage";
import { processFormC } from "../../sec/forms/exempt-offerings/Form_C.storage";
import { processFormD } from "../../sec/forms/exempt-offerings/Form_D.storage";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

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

    const extractorId = formToExtractorId(form);
    if (!extractorId) {
      throw new TaskError(`No extractor registered for form '${form}'`);
    }

    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const currentVersion = await versionRegistry.getCurrent("extractor", extractorId);
    if (!currentVersion) {
      throw new TaskError(
        `No current version for extractor '${extractorId}'. Did you run bootstrapExtractorVersions()?`
      );
    }
    const extractorVersion = currentVersion.semver;

    const runRepo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );

    const wf = context.own(new Workflow());

    wf.pipe(
      new SecFetchAccessionDocTask({
        cik: cik!,
        accessionNumber: accessionNumber,
        fileName: fileName!,
      }),
      async function processForm(fetchOutput: FetchUrlTaskOutput) {
        const { text } = fetchOutput;
        const formCls = ALL_FORMS_MAP.get(form!);
        if (!formCls) throw new TaskError("Form not found");

        try {
          const parsed = await formCls.parse(form!, text!);
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
              await processFormD({ ...storageArgs, formD: parsed });
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
              await processFormC({ ...storageArgs, formC: parsed });
              break;
            case "1-A":
            case "1-A/A":
              await processForm1A({ ...storageArgs, form1A: parsed });
              break;
            case "1-K":
            case "1-K/A":
              await processForm1K({ ...storageArgs, form1K: parsed });
              break;
            case "1-Z":
            case "1-Z/A":
              await processForm1Z({ ...storageArgs, form1Z: parsed });
              break;
            default:
              throw new TaskError(`Form '${form}' has no storage handler`);
          }

          await runRepo.recordRun({
            cik: cik! as unknown as number,
            accession_number: accessionNumber,
            form: form!,
            extractor_id: extractorId,
            extractor_version: extractorVersion,
            slot_at_run: "current",
            success: true,
            error: null,
          });
          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await runRepo.recordRun({
            cik: cik! as unknown as number,
            accession_number: accessionNumber,
            form: form!,
            extractor_id: extractorId,
            extractor_version: extractorVersion,
            slot_at_run: "current",
            success: false,
            error: message.slice(0, 4096),
          });
          throw err;
        }
      }
    );

    await wf.run();
    return { success: true };
  }
}
