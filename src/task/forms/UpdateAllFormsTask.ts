/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { TObject, Type } from "typebox";
import { query_all } from "../../util/db";
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
    const missingForms = query_all<{
      cik: string;
      form: string;
      accession_number: string;
    }>(`
      SELECT filings.cik, filings.form, filings.accession_number FROM filings left join processed_filings on filings.cik = processed_filings.cik and filings.form = processed_filings.form
        WHERE processed_filings.accession_number IS NULL
        AND filings.form IN (${input.form.map((f) => `'${f}'`).join(",")})`);

    const needsInitialProcessingCount = missingForms?.length ?? 0;

    if (needsInitialProcessingCount) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10 });
      loop.pipe(new ProcessAccessionDocFormTask());
      loop.endMap();
      await wf.run({
        accessionNumber: missingForms.map((f) => f.accession_number),
        cik: missingForms.map((f) => parseInt(f.cik)),
        form: missingForms.map((f) => f.form),
      });
    }
    return { success: true };
  }
}
