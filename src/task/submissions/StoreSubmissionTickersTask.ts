//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskAbortedError, TaskError } from "@podley/task-graph";
import { TObject, Type } from "@sinclair/typebox";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";
export type StoreSubmissionTickersTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionTickersTaskOutput = {
  success: boolean;
};

export class StoreSubmissionTickersTask extends Task<
  StoreSubmissionTickersTaskInput,
  StoreSubmissionTickersTaskOutput
> {
  static readonly type = "StoreSubmissionTickersTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema(): TObject {
    return FetchSubmissionsTask.outputSchema();
  }

  static outputSchema(): TObject {
    return Type.Object({
      success: Type.Boolean({ title: "Successful" }),
    });
  }

  async execute(
    input: StoreSubmissionTickersTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionTickersTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");
    const cik = submission.cik;

    const { tickers, exchanges } = submission;
    if (tickers && exchanges) {
      for (const i in tickers) {
        const ticker = tickers[i];
        const exchange = exchanges[i];
        if (!ticker || !exchange) continue;
        const submissionRepo = new EntityRepo();
        await submissionRepo.saveEntityTicker({ cik, ticker, exchange });
      }
    }

    return { success: true };
  }
}
