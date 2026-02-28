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
  form: string[];
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

    // Get all filings matching requested forms
    const allFilings: Filing[] = [];
    for (const form of input.form) {
      const filings = await filingRepo.search({ form });
      if (filings) allFilings.push(...filings);
    }

    // Get all processed filings and build a set of processed keys
    const allProcessed = (await processedFilingsRepo.getAll()) ?? [];
    const processedSet = new Set<string>();
    for (const pf of allProcessed) {
      processedSet.add(`${pf.cik}:${pf.accession_number}`);
    }

    // Filter to unprocessed filings
    const missingForms = allFilings.filter(
      (f) => f.form && formSet.has(f.form) && !processedSet.has(`${f.cik}:${f.accession_number}`)
    );

    if (missingForms.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10 });
      loop.pipe(new ProcessAccessionDocFormTask());
      loop.endMap();
      await wf.run({
        accessionNumber: missingForms.map((f) => f.accession_number),
        cik: missingForms.map((f) => f.cik),
        form: missingForms.map((f) => f.form!),
      });
    }
    return { success: true };
  }
}
