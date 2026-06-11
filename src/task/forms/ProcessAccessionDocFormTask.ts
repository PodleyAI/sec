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
import { processOwnershipForm } from "../../sec/forms/insider-trading/OwnershipDocument.storage";
import { processForm144 } from "../../sec/forms/insider-trading/Form_144.storage";
import { processFormS1 } from "../../sec/forms/registration-statements/Form_S_1.storage";
import { processForm424 } from "../../sec/forms/registration-statements/Form_424.storage";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

/**
 * Registration prospectus forms whose body is fetched as the full submission
 * .txt — Form.parse() needs the <SEC-HEADER> and sibling <DOCUMENT> blocks
 * (XBRL instance, EX-FILING FEES exhibit), not just the primary document.
 */
const REGISTRATION_PROSPECTUS_FORMS = new Set([
  "S-1",
  "S-1/A",
  "S-1MEF",
  "DRS",
  "DRS/A",
  "F-1",
  "F-1/A",
  "F-1MEF",
  "424A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
]);

/** Full-submission text filename, e.g. 0001193125-21-066104 -> 0001193125-21-066104.txt */
function fullSubmissionFileName(accessionNumber: string): string {
  return `${accessionNumber}.txt`;
}

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

  /**
   * Fetches the primary document body. Isolated as a protected seam so the
   * fetch-failure path is unit-testable without the network (tests override it).
   */
  protected async runFetch(
    cik: number,
    accessionNumber: string,
    fileName: string,
    context: IExecuteContext
  ): Promise<string> {
    const wf = context.own(new Workflow());
    let text: string | undefined;
    wf.pipe(
      new SecFetchAccessionDocTask({ cik, accessionNumber, fileName }),
      async function capture(fetchOutput: FetchUrlTaskOutput) {
        text = fetchOutput.text ?? undefined;
        return { success: true };
      }
    );
    await wf.run();
    if (!text) {
      throw new TaskError(`Fetch returned no text for ${cik}/${accessionNumber}/${fileName}`);
    }
    return text;
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

    // Registration prospectus forms (S-1 / DRS family) are fetched as the full
    // submission .txt so Form.parse() can read the <SEC-HEADER> and select the
    // primary <DOCUMENT>. Other forms keep their primary-doc fetch.
    if (REGISTRATION_PROSPECTUS_FORMS.has(form)) {
      fileName = fullSubmissionFileName(accessionNumber);
    }

    const extractorId = formToExtractorId(form);
    if (!extractorId) {
      throw new TaskError(`No extractor registered for form '${form}'`);
    }

    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const activeSlot = await getActiveSlot(versionRegistry, "extractor", extractorId);
    if (!activeSlot) {
      throw new TaskError(
        `No active slot for extractor '${extractorId}'. Run 'sec db setup' to bootstrap.`
      );
    }
    const extractorVersion = activeSlot.semver;
    const slotAtRun = activeSlot.slot;

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

    const deadLetters = new ExtractionDeadLetterRepo();

    const recordRunFailed = async (message: string): Promise<void> => {
      try {
        await runRepo.recordRun({
          cik: cik!,
          accession_number: accessionNumber,
          form: form!,
          extractor_id: extractorId,
          extractor_version: extractorVersion,
          slot_at_run: slotAtRun,
          success: false,
          error: message.slice(0, 4096),
        });
      } catch (recordErr) {
        console.error(
          `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${extractorId}:${extractorVersion}:`,
          recordErr
        );
      }
    };

    const recordDeadLetterSafe = async (reason_code: string, detail: string): Promise<void> => {
      try {
        await deadLetters.record({
          extractor_id: extractorId,
          accession_number: accessionNumber,
          section_name: "",
          reason_code,
          detail,
          failed_extractor_version: extractorVersion,
          source_run_id: null,
        });
      } catch (dlErr) {
        console.error(
          `Failed to record dead-letter ${reason_code} for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
      }
    };

    // --- Domain 1: primary-document resolution (filing-level) ---
    if (!fileName) {
      const detail = `No primary document for filing ${accessionNumber}`;
      await recordDeadLetterSafe("PRIMARY_DOC_UNRESOLVED", detail);
      await recordRunFailed(`PRIMARY_DOC_UNRESOLVED: ${detail}`);
      return { success: false };
    }

    // --- Domain 2: body fetch (filing-level) ---
    let text: string;
    try {
      text = await this.runFetch(cik!, accessionNumber, fileName, context);
    } catch (fetchErr) {
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await recordDeadLetterSafe("FETCH_ERROR", message.slice(0, 1024));
      await recordRunFailed(`FETCH_ERROR: ${message}`);
      return { success: false };
    }

    // --- Domain 3: parse + store (hard error -> record + rethrow, unchanged) ---
    let parseError: unknown = undefined;
    try {
      const formCls = ALL_FORMS_MAP.get(form!);
      if (!formCls) throw new TaskError(`Form '${form}' not found in ALL_FORMS_MAP`);
      const parsed = await formCls.parse(form!, text);
      const storageArgs = {
        cik: cik!,
        file_number: file_number ?? "",
        accession_number: accessionNumber,
        filing_date: filing_date ?? "",
        primary_doc: fileName,
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
        case "3":
        case "3/A":
        case "4":
        case "4/A":
        case "5":
        case "5/A":
          await processOwnershipForm({ ...storageArgs, form: form!, doc: parsed });
          break;
        case "144":
        case "144/A":
          await processForm144({ ...storageArgs, form: form!, doc: parsed });
          break;
        case "S-1":
        case "S-1/A":
        case "S-1MEF":
        case "DRS":
        case "DRS/A":
        case "F-1":
        case "F-1/A":
        case "F-1MEF":
          await processFormS1({ ...storageArgs, form: form!, formS1: parsed });
          break;
        case "424A":
        case "424B1":
        case "424B2":
        case "424B3":
        case "424B4":
        case "424B5":
        case "424B7":
          await processForm424({ ...storageArgs, form: form!, form424: parsed });
          break;
        default:
          throw new TaskError(`Form '${form}' has no storage handler`);
      }
    } catch (err) {
      parseError = err;
    }

    if (parseError === undefined) {
      // A filing that previously failed at the fetch layer (a filing-level
      // dead-letter, section_name "") and now succeeds end to end should have
      // that pending entry cleared, so the version-gated retry sweep doesn't
      // reprocess it after a bump. No-op when no such entry exists; best-effort
      // like recordRun so a storage hiccup can't mask the successful outcome.
      try {
        await deadLetters.markResolved(extractorId, accessionNumber, "");
      } catch (dlErr) {
        console.error(
          `Failed to resolve filing-level dead-letter for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
      }
      try {
        await runRepo.recordRun({
          cik: cik!,
          accession_number: accessionNumber,
          form: form!,
          extractor_id: extractorId,
          extractor_version: extractorVersion,
          slot_at_run: slotAtRun,
          success: true,
          error: null,
        });
      } catch (recordErr) {
        console.error(
          `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${extractorId}:${extractorVersion}:`,
          recordErr
        );
      }
      return { success: true };
    }

    const message = parseError instanceof Error ? parseError.message : String(parseError);
    await recordRunFailed(message);
    throw parseError;
  }
}
