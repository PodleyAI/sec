//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskAbortedError } from "@podley/task-graph";
import { query_run } from "../../util/db";
import { FetchAllCikNamesTask, FetchAllCikNamesTaskOutput } from "./FetchAllCikNamesTask";
import { TObject, Type } from "@sinclair/typebox";
import { EntityRepo } from "../../storage/entity/EntityRepo";

export type StoreCikNamesTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company facts
 */
export class StoreCikNamesTask extends Task<FetchAllCikNamesTaskOutput, StoreCikNamesTaskOutput> {
  static readonly type = "StoreCikNamesTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static inputSchema(): TObject {
    return FetchAllCikNamesTask.inputSchema();
  }

  public static outputSchema(): TObject {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: FetchAllCikNamesTaskOutput,
    context: IExecuteContext
  ): Promise<StoreCikNamesTaskOutput> {
    const cikList: { cik: number; name: string }[] = input.cikList;
    if (!cikList) return { success: false };

    const estimatedFacts = cikList.length;
    let progress = 0;
    let index = 0;
    for (const { cik, name } of cikList) {
      if (context.signal?.aborted) {
        throw new TaskAbortedError();
      }
      const entityRepo = new EntityRepo();
      await entityRepo.saveCikName(cik, name);

      const newProgress = Math.round((index++ / estimatedFacts) * 100);
      if (newProgress > progress) {
        // round numbers, so max 100 times
        context.updateProgress(newProgress, `cik: ${cik}`);
        progress = newProgress;
      }
    }
    return { success: true };
  }
}
