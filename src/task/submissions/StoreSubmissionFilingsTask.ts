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
    const filings = objectOfArraysAsArrayOfObjects(filings_array);
    let index = 0;
    let progress = 0;
    const entityRepo = new EntityRepo();
    for (const filing of filings) {
      if (context.signal.aborted) {
        throw new TaskAbortedError();
      }
      const newProgress = Math.round((index++ / filings.length) * 10) * 10; // much faster than if we give up time for ui
      if (newProgress > progress) {
        context.updateProgress(newProgress);
        progress = newProgress;
        await sleep(0);
      }

      // Transform the Filing from API format to database schema format
      const filingData: Filing = {
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
      };
      await entityRepo.saveFiling(filingData);
    }

    return { success: true };
  }
}
