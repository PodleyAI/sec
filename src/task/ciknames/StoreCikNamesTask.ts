/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskAbortedError } from "@workglow/task-graph";
import { FetchAllCikNamesTask, FetchAllCikNamesTaskOutput } from "./FetchAllCikNamesTask";
import { Type } from "typebox";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { DataPortSchemaObject } from "@workglow/util/schema";

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

  public static inputSchema() {
    return FetchAllCikNamesTask.inputSchema() as DataPortSchemaObject;
  }

  public static outputSchema() {
    return Type.Object({ success: Type.Boolean() }) as DataPortSchemaObject;
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
