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
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { StoreSubmissionContactInfoTask } from "./StoreSubmissionContactInfoTask";
import { StoreSubmissionEntityTask } from "./StoreSubmissionEntityTask";
import { StoreSubmissionFilingsTask } from "./StoreSubmissionFilingsTask";
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
        new StoreSubmissionContactInfoTask({ defaults: input }),
        new StoreSubmissionTickersTask({ defaults: input }),
        new StoreSubmissionFilingsTask({ defaults: input }),
      ]),
      async function updateProcessing() {
        await processUpdateProcessing(cik, true);
        return { success: true };
      }
    );
    await workflow.run();
    return { success: true };
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
