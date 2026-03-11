/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import {
  FILING_REPOSITORY_TOKEN,
  type Filing,
} from "../../storage/filing/FilingSchema";
import {
  PROCESSED_FILINGS_REPOSITORY_TOKEN,
} from "../../storage/processing/ProcessedFilingsSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

export type UpdateAllFormsTaskInput = {
  readonly form: string[];
  readonly force?: boolean;
};

export type UpdateAllFormsTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company forms of a given type
 */
export class UpdateAllFormsTask extends Task<UpdateAllFormsTaskInput, UpdateAllFormsTaskOutput> {
  static readonly type = "UpdateAllFormsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: UpdateAllFormsTaskInput,
    context: IExecuteContext
  ): Promise<UpdateAllFormsTaskOutput> {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const processedFilingsRepo = globalServiceRegistry.get(PROCESSED_FILINGS_REPOSITORY_TOKEN);

    const formSet = new Set(input.form);

    const formsToProcess: Filing[] = [];

    if (input.force) {
      // Reprocess all filings for requested forms
      for (const form of formSet) {
        const filings = await filingRepo.query({ form });
        if (filings) {
          for (const f of filings) {
            formsToProcess.push(f);
          }
        }
      }
    } else {
      // Build a set of already-processed (cik:accession_number) keys per form
      const processedSet = new Set<string>();
      for (const form of formSet) {
        const processed = await processedFilingsRepo.query({ form });
        if (processed) {
          for (const pf of processed) {
            processedSet.add(`${pf.cik}:${pf.accession_number}`);
          }
        }
      }

      // Query filings per form and collect only unprocessed ones
      for (const form of formSet) {
        const filings = await filingRepo.query({ form });
        if (filings) {
          for (const f of filings) {
            if (!processedSet.has(`${f.cik}:${f.accession_number}`)) {
              formsToProcess.push(f);
            }
          }
        }
      }
    }

    if (formsToProcess.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10 });
      loop.pipe(new ProcessAccessionDocFormTask());
      loop.endMap();
      await wf.run({
        accessionNumber: formsToProcess.map((f) => f.accession_number),
        cik: formsToProcess.map((f) => f.cik),
        form: formsToProcess.map((f) => f.form!),
        fileName: formsToProcess.map((f) => f.primary_doc.replaceAll(/^(xsl[^\/]+\/)/g, "")),
      });
    }
    return { success: true };
  }
}
