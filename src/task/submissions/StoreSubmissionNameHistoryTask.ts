/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import {
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskError,
} from "workglow";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { buildNameHistoryRows, writeNameHistoryRows } from "./nameHistoryRows";

export type StoreSubmissionNameHistoryTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionNameHistoryTaskOutput = {
  success: boolean;
};

/**
 * Stores an entity's name timeline from the submission's `formerNames`.
 *
 * `StoreSubmissionEntityTask` only ever writes the *current* name, so without
 * this a renamed company — every de-SPAC, among others — loses the name it
 * filed under. Runs alongside the other per-submission writers, so a bootstrap
 * populates `entities_history` in the same pass and needs no follow-up
 * `bootstrap name-history` repair.
 *
 * A company that never renamed produces no rows, so the common case costs one
 * array check and no write.
 */
export class StoreSubmissionNameHistoryTask extends Task<
  StoreSubmissionNameHistoryTaskInput,
  StoreSubmissionNameHistoryTaskOutput
> {
  static readonly type = "StoreSubmissionNameHistoryTask";
  static readonly category = "SEC";
  static readonly title = "Store submission name history";
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
    input: StoreSubmissionNameHistoryTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionNameHistoryTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");

    const rows = buildNameHistoryRows(submission.cik, submission);
    if (rows.length === 0) return { success: true };

    const repo = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    await writeNameHistoryRows(repo, submission.cik, rows);

    return { success: true };
  }
}
