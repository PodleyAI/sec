/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, pipe, Task, Workflow } from "@workglow/task-graph";
import { TObject, Type } from "typebox";
import { processUpdateProcessing } from "./StoreSubmissionsTask";
import { query_all } from "../../util/db";
import { FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { StoreSubmissionsTask } from "./StoreSubmissionsTask";

export type UpdateAllSubmissionsTaskInput = {};

export type UpdateAllSubmissionsTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company facts
 */
export class UpdateAllSubmissionsTask extends Task<
  UpdateAllSubmissionsTaskInput,
  UpdateAllSubmissionsTaskOutput
> {
  static readonly type = "UpdateAllSubmissionsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: UpdateAllSubmissionsTaskInput,
    context: IExecuteContext
  ): Promise<UpdateAllSubmissionsTaskOutput> {
    const needsUpating = query_all<{
      cik: string;
      last_update: string;
      last_processed: string;
    }>(`
      SELECT cik_last_update.cik, cik_last_update.last_update, processed_submissions.last_processed FROM cik_last_update
        JOIN processed_submissions
          ON cik_last_update.cik = processed_submissions.cik
        WHERE cik_last_update.last_update > processed_submissions.last_processed
        ORDER BY cik_last_update.last_update DESC`);
    const needsUpatingCount = needsUpating?.length ?? 0;

    const needsInitialProcessing = query_all<{
      cik: string;
      last_update: string;
      last_processed: string;
    }>(`
      SELECT cik_last_update.cik, cik_last_update.last_update, processed_submissions.last_processed FROM cik_last_update
        LEFT JOIN processed_submissions
          ON cik_last_update.cik = processed_submissions.cik
        WHERE processed_submissions.last_processed IS NULL
        ORDER BY cik_last_update.last_update DESC`);
    const needsInitialProcessingCount = needsInitialProcessing?.length ?? 0;

    if (needsUpatingCount) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 1 });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: needsUpating.map((r) => parseInt(r.cik)),
        date: needsUpating.map((r) => r.last_update),
      });
    }

    if (needsInitialProcessingCount) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 2 });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: needsInitialProcessing.map((r) => parseInt(r.cik)),
        date: needsInitialProcessing.map((r) => r.last_update),
      });
    }

    return { success: true };
  }
}

async function fetchAndStoreSubmission(
  input: { cik: number; date: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  const pipeline = ctx.own(pipe([new FetchSubmissionsTask(), new StoreSubmissionsTask()]));
  try {
    await pipeline.run(input);
  } catch (e) {
    processUpdateProcessing(input.cik, false);
  }
  return { success: true };
}
