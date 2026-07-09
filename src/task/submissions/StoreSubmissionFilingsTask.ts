/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import {
  IExecuteContext,
  objectOfArraysAsArrayOfObjects,
  sleep,
  Task,
  TaskAbortedError,
  TaskError,
} from "workglow";
import { Filings } from "../../sec/submissions/EnititySubmissionSchema";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { Filing } from "../../storage/filing/FilingSchema";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";

export type StoreSubmissionFilingsTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionFilingsTaskOutput = {
  success: boolean;
};

export class StoreSubmissionFilingsTask extends Task<
  StoreSubmissionFilingsTaskInput,
  StoreSubmissionFilingsTaskOutput
> {
  static readonly type = "StoreSubmissionFilingsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema() {
    return FetchSubmissionsTask.outputSchema();
  }

  static outputSchema() {
    return Type.Object({
      success: Type.Boolean({ title: "Successful" }),
    });
  }

  async execute(
    input: StoreSubmissionFilingsTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionFilingsTaskOutput> {
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");
    const cik = submission.cik;

    let filings_array: Filings;
    if (Array.isArray(input.filings)) {
      filings_array = input.filings[0];
      for (let i = 1; i < input.filings.length; i++) {
        const filing = input.filings[i];
        // for each property, if it's an array, merge the arrays
        for (const key of Object.keys(filing)) {
          // @ts-ignore
          filings_array[key] = filings_array[key].concat(filing[key]);
        }
      }
    } else {
      filings_array = input.filings;
    }
    // `objectOfArraysAsArrayOfObjects` returns a Proxy that only intercepts the
    // array methods it explicitly implements (`map`, `filter`, iteration, …).
    // `slice` is *not* one of them, so native `Array.prototype.slice` runs
    // against the proxy, sees no own indices via `HasProperty`, and yields a
    // fully sparse array — the holes later spread to `undefined` rows in
    // `putBulk`. Materialize to a real array via the supported `map` first,
    // then slice/batch that concrete array.
    const allRows: Filing[] = objectOfArraysAsArrayOfObjects(filings_array).map((filing) => ({
      cik,
      accession_number: filing.accessionNumber,
      filing_date: filing.filingDate,
      report_date: filing.reportDate || null,
      acceptance_date: filing.acceptanceDateTime,
      form: filing.form || null,
      file_number: filing.fileNumber || null,
      film_number: filing.filmNumber || null,
      primary_doc: filing.primaryDocument,
      primary_doc_description: filing.primaryDocDescription || null,
      size: filing.size || null,
      is_xbrl: filing.isXBRL || null,
      is_inline_xbrl: filing.isInlineXBRL || null,
      items: filing.items || null,
      act: filing.act || null,
    }));
    const entityRepo = new EntityRepo();

    // Companies with many filings emit thousands of rows per submission.
    // Per-row `put()` was O(N) round-trips and dominated ingest time on
    // Postgres. Chunked putBulk amortises the round-trip and the workglow
    // event emit overhead.
    const BATCH_SIZE = 500;
    let progress = 0;
    for (let start = 0; start < allRows.length; start += BATCH_SIZE) {
      if (context.signal.aborted) {
        throw new TaskAbortedError();
      }
      const batch: Filing[] = allRows.slice(start, start + BATCH_SIZE);
      await entityRepo.saveFilingsBulk(batch);

      const newProgress = Math.round(((start + batch.length) / allRows.length) * 10) * 10;
      if (newProgress > progress) {
        context.updateProgress(newProgress);
        progress = newProgress;
        await sleep(0);
      }
    }

    return { success: true };
  }
}
