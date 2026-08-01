/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
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
  static readonly title = "Update submissions for all CIKs";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      force: Type.Optional(Type.Boolean()),
    });
  }

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
      // Stream rather than getAll() — production has hundreds of
      // thousands of processed-submission rows. We need both cik and
      // last_processed for the freshness comparison, so we keep them in
      // a Map but build it page-by-page rather than materialising every
      // row up front.
      const processedMap = new Map<number, ProcessedSubmissions>();
      for await (const ps of processedSubmissionsRepo.records(5000)) {
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

    if (isDryRun()) {
      if (input.force) {
        console.log(`Would update ${needsUpdating.length} submissions (force — reprocessing all)`);
      } else {
        console.log(
          `Would update ${needsUpdating.length} changed and ${needsInitialProcessing.length} new submissions`
        );
      }
      return { success: true };
    }

    if (needsUpdating.length) {
      const wf = context.own(new Workflow(), {
        title: `Update changed submissions (${needsUpdating.length} CIKs)`,
      });
      const loop = wf.map({ concurrencyLimit: 1, maxIterations: needsUpdating.length });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: needsUpdating.map((r) => r.cik),
        date: needsUpdating.map((r) => r.last_update),
      });
    }

    if (needsInitialProcessing.length) {
      const wf = context.own(new Workflow(), {
        title: `Process new submissions (${needsInitialProcessing.length} CIKs)`,
      });
      const loop = wf.map({ concurrencyLimit: 2, maxIterations: needsInitialProcessing.length });
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
