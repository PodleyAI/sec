/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { IExecuteContext, Task, TaskAbortedError, TaskError } from "workglow";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";

export type StoreSubmissionSicTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionSicTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company sic
 */
export class StoreSubmissionSicTask extends Task<
  StoreSubmissionSicTaskInput,
  StoreSubmissionSicTaskOutput
> {
  static readonly type = "StoreSubmissionSicTask";
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
    input: StoreSubmissionSicTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionSicTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");

    const { sic, sicDescription } = submission;
    if (sic && sicDescription) {
      const sicCode = Number(sic);
      const submissionRepo = new EntityRepo();
      await submissionRepo.saveSicCode(sicCode, sicDescription);
    } else {
      return { success: false };
    }

    return { success: true };
  }
}
