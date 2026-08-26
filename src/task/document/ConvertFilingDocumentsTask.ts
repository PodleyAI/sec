/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { IExecuteContext, Task, TaskAbortedError } from "workglow";
import { ConvertFilingDocumentTask } from "./ConvertFilingDocumentTask";
import { FILING_CONVERTER_VERSION } from "./convertFilingDocument";
import { CONVERTIBLE_FORMS, selectFilingsToConvert } from "./selectFilingsToConvert";

export type ConvertFilingDocumentsTaskInput = {
  /** Which forms to convert. Defaults to {@link CONVERTIBLE_FORMS}. */
  readonly forms?: string[] | undefined;
  readonly since?: string | undefined;
  readonly cik?: number | undefined;
  readonly limit?: number | undefined;
  /** Re-convert filings already stored at the current converter version. */
  readonly force?: boolean | undefined;
};

export type ConvertFilingDocumentsTaskOutput = {
  readonly success: boolean;
  readonly selected: number;
  readonly converted: number;
  readonly skipped: number;
  readonly sections: number;
};

/** Default ceiling on one sweep. A backfill is many runs, not one enormous one. */
export const DEFAULT_CONVERT_LIMIT = 500;

/**
 * Convert the filings that have no markdown at the current converter version.
 *
 * Resumable by construction: selection is an anti-join against what is already
 * stored, so re-running picks up where an interrupted run stopped and adding a
 * form to {@link CONVERTIBLE_FORMS} converts only the newly eligible filings.
 *
 * One unconvertible filing does not stop the sweep — a filing that names no
 * document, or whose HTML yields no sections, is counted as skipped and the run
 * continues. Cancellation is re-thrown rather than swallowed, so an interrupted
 * sweep is distinguishable from one that finished with nothing to do.
 */
export class ConvertFilingDocumentsTask extends Task<
  ConvertFilingDocumentsTaskInput,
  ConvertFilingDocumentsTaskOutput
> {
  static readonly type = "ConvertFilingDocumentsTask";
  static readonly category = "SEC";
  static readonly title = "Convert filings to markdown";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      forms: Type.Optional(Type.Array(Type.String())),
      since: Type.Optional(Type.String()),
      cik: Type.Optional(Type.Integer()),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      selected: Type.Integer(),
      converted: Type.Integer(),
      skipped: Type.Integer(),
      sections: Type.Integer(),
    });
  }

  async execute(
    input: ConvertFilingDocumentsTaskInput,
    context: IExecuteContext
  ): Promise<ConvertFilingDocumentsTaskOutput> {
    const filings = await selectFilingsToConvert({
      forms: input.forms && input.forms.length > 0 ? input.forms : CONVERTIBLE_FORMS,
      since: input.since,
      cik: input.cik,
      limit: input.limit ?? DEFAULT_CONVERT_LIMIT,
      force: input.force === true,
      converterVersion: FILING_CONVERTER_VERSION,
    });

    let converted = 0;
    let skipped = 0;
    let sections = 0;

    for (const [index, filing] of filings.entries()) {
      if (context.signal?.aborted) throw new TaskAbortedError();
      const task = context.own(
        new ConvertFilingDocumentTask({
          defaults: {
            cik: filing.cik,
            accessionNumber: filing.accession_number,
            form: filing.form ?? undefined,
            filingDate: filing.filing_date,
            primaryDoc: filing.primary_doc ?? undefined,
          },
          title: `Convert ${filing.form ?? "filing"} ${filing.accession_number}`,
        })
      );
      try {
        const result = await task.run();
        if (result.success) {
          converted += 1;
          sections += result.sections;
        } else {
          skipped += 1;
        }
      } catch (err) {
        // Cancellation belongs to the run, not to the filing: swallowing it here
        // would let a Ctrl-C look like a corpus of unconvertible filings.
        if (err instanceof TaskAbortedError || context.signal?.aborted) throw err;
        skipped += 1;
      } finally {
        context.disown(task);
      }
      context.updateProgress(
        Math.floor(((index + 1) / Math.max(filings.length, 1)) * 100),
        `${index + 1}/${filings.length} filings`
      );
    }

    return { success: skipped === 0, selected: filings.length, converted, skipped, sections };
  }
}
