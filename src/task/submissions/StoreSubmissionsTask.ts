/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import {
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskError,
  Workflow,
  globalServiceRegistry,
  parallel,
} from "workglow";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { StoreSubmissionContactInfoTask } from "./StoreSubmissionContactInfoTask";
import { StoreSubmissionEntityTask } from "./StoreSubmissionEntityTask";
import { StoreSubmissionFilingsTask } from "./StoreSubmissionFilingsTask";
import { StoreSubmissionNameHistoryTask } from "./StoreSubmissionNameHistoryTask";
import { StoreSubmissionSicTask } from "./StoreSubmissionSicTask";
import { StoreSubmissionTickersTask } from "./StoreSubmissionTickersTask";

export type StoreSubmissionsTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionsTaskOutput = {
  success: boolean;
};

export class StoreSubmissionsTask extends Task<
  StoreSubmissionsTaskInput,
  StoreSubmissionsTaskOutput
> {
  static readonly type = "StoreSubmissionsTask";
  static readonly category = "SEC";
  static readonly title = "Store company submissions";
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
    input: StoreSubmissionsTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionsTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (!submission) throw new TaskError("No submission data");
    const cik = submission.cik;

    const workflow = context.own(new Workflow(), { title: `Store submission ${cik}` });
    workflow.pipe(
      parallel([
        new StoreSubmissionSicTask({ defaults: input }),
        new StoreSubmissionEntityTask({ defaults: input }),
        new StoreSubmissionNameHistoryTask({ defaults: input }),
        new StoreSubmissionContactInfoTask({ defaults: input }),
        new StoreSubmissionTickersTask({ defaults: input }),
        new StoreSubmissionFilingsTask({ defaults: input }),
      ]),
      async function updateProcessing() {
        await recordCikLastUpdate(cik, input.filings);
        await processUpdateProcessing(cik, true);
        return { success: true };
      }
    );
    await workflow.run();
    return { success: true };
  }
}

/**
 * Records the CIK's newest filing date as the `cik_last_update` watermark.
 *
 * `cik_last_update` is the DEMAND side of the incremental refresh: it says when
 * EDGAR last published something for this filer, and `update submissions` /
 * `update facts` select on `cik_last_update.last_update >
 * processed_submissions.last_processed`. Until now the only thing that ever
 * wrote it was `StoreCikLastUpdatedTask`, wired solely into `sync` — so a
 * database built by `bootstrap` had an EMPTY watermark, and both incremental
 * commands selected nothing at all. That is not a hypothetical: this deployment
 * ingested 27M filings and carried 0 rows here.
 *
 * The submissions payload already carries the answer, so bootstrap can close its
 * own loop instead of leaving it to a command nobody had run.
 *
 * The two dates are deliberately NOT the same quantity, and the comparison only
 * works because they aren't: `last_update` is a FILING date (2026-07-31) while
 * `last_processed` is a PROCESSING date (today). Right after an ingest the
 * filing date is necessarily the older of the two, so nothing re-selects; when
 * EDGAR publishes again, the daily index pushes `last_update` past the stored
 * `last_processed` and the CIK is picked up exactly once.
 *
 * Best-effort: a watermark failure must not fail a submission whose entity,
 * filings and tickers all stored. The next index run rewrites it anyway.
 */
async function recordCikLastUpdate(
  cik: number,
  filings: { filingDate?: string[] } | undefined
): Promise<void> {
  // Read `input.filings`, not `submission.filings`: FetchSubmissionsTask splits
  // them apart (`const { filings, ...submission } = edgarJson`) and hands the
  // `recent` block over separately, so the submission object carries no filing
  // dates at all.
  const dates = filings?.filingDate;
  if (!dates || dates.length === 0) return;
  // ISO dates compare lexically, so a plain max avoids parsing 1000+ strings
  // per CIK. `recent` is ordered newest-first in practice but that is EDGAR's
  // convention, not a guarantee, so scan rather than take [0].
  let newest = "";
  for (const d of dates) {
    if (typeof d === "string" && d > newest) newest = d;
  }
  if (!newest) return;
  try {
    await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).put({
      cik,
      last_update: newest,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to record cik_last_update for CIK ${cik}: ${message}`);
  }
}

export async function processUpdateProcessing(cik: number, success: boolean): Promise<void> {
  const processedSubmissionsRepo = globalServiceRegistry.get(
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN
  );
  await processedSubmissionsRepo.put({
    cik,
    last_processed: todayYYYYdMMdDD(),
    success,
  });
}
