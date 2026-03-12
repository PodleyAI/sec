/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import {
  CIK_LAST_UPDATE_REPOSITORY_TOKEN,
} from "../../storage/processing/CikLastUpdateSchema";
import {
  PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN,
  type ProcessedSubmissions,
} from "../../storage/processing/ProcessedSubmissionsSchema";
import { fetchAndStoreSubmission } from "./fetchAndStoreSubmission";

export type UpdateAllSubmissionsTaskInput = {
  readonly force?: boolean;
};

export type UpdateAllSubmissionsTaskOutput = {
  success: boolean;
};

/**
 * Task for fetching and storing submissions for all CIKs that need updating
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
    const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const processedSubmissionsRepo = globalServiceRegistry.get(
      PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN
    );

    const allCikUpdates =
      (await cikLastUpdateRepo.query(
        {},
        { orderBy: [{ column: "last_update", direction: "DESC" }] }
      )) ?? [];

    const needsUpdating: { cik: number; last_update: string }[] = [];
    const needsInitialProcessing: { cik: number; last_update: string }[] = [];

    if (input.force) {
      for (const clu of allCikUpdates) {
        needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
      }
    } else {
      const allProcessedSubmissions = (await processedSubmissionsRepo.getAll()) ?? [];

      const processedMap = new Map<number, ProcessedSubmissions>();
      for (const ps of allProcessedSubmissions) {
        processedMap.set(ps.cik, ps);
      }

      for (const clu of allCikUpdates) {
        const ps = processedMap.get(clu.cik);
        if (!ps) {
          needsInitialProcessing.push({ cik: clu.cik, last_update: clu.last_update });
        } else if (clu.last_update > ps.last_processed) {
          needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
        }
      }
    }

    if (needsUpdating.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 1 });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: needsUpdating.map((r) => r.cik),
        date: needsUpdating.map((r) => r.last_update),
      });
    }

    if (needsInitialProcessing.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 2 });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: needsInitialProcessing.map((r) => r.cik),
        date: needsInitialProcessing.map((r) => r.last_update),
      });
    }

    return { success: true };
  }
}
