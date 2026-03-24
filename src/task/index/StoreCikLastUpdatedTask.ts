/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import {
  DataPortSchemaObject,
  globalServiceRegistry,
  IExecuteContext,
  sleep,
  Task,
  TaskAbortedError,
} from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { TypeSecDate, YYYYdMMdDD } from "../../util/parseDate";

export type StoreCikLastUpdatedTaskOutput = {
  success: boolean;
};

export type StoreCikLastUpdatedTaskInput = {
  updateList: [cik: number, last_known_update: YYYYdMMdDD][];
};

/**
 * Task for storing company facts
 */
export class StoreCikLastUpdatedTask extends Task<
  StoreCikLastUpdatedTaskInput,
  StoreCikLastUpdatedTaskOutput
> {
  static readonly type = "StoreCikLastUpdatedTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      updateList: Type.Array(Type.Tuple([TypeSecCik(), TypeSecDate()])),
    }) as DataPortSchemaObject;
  }

  public static outputSchema() {
    return Type.Object({ success: Type.Boolean() }) as DataPortSchemaObject;
  }

  async execute(
    input: StoreCikLastUpdatedTaskInput,
    context: IExecuteContext
  ): Promise<StoreCikLastUpdatedTaskOutput> {
    const updateList = input.updateList.filter(Boolean);
    if (!updateList || updateList.length === 0) return { success: false };

    const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);

    const length = updateList.length;
    let progress = 0;
    let index = 0;
    const batchSize = 1000;
    const batches = Math.ceil(length / batchSize);
    for (let i = 0; i < batches; i++) {
      if (context.signal?.aborted) {
        throw new TaskAbortedError();
      }
      const batch = updateList
        .slice(i * batchSize, (i + 1) * batchSize)
        .filter(Boolean)
        .map(([cik, last_known_update]) => ({
          cik,
          last_update: last_known_update,
        }));

      await cikLastUpdateRepo.putBulk(batch);
      const newProgress = Math.round((index++ / length) * 1000) / 10;
      if (newProgress > progress) {
        context.updateProgress(newProgress);
        progress = newProgress;
        await sleep(0);
      }
    }
    return { success: true };
  }
}
