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
    const { needsUpdating, needsInitialProcessing } = await selectSubmissionsToRefresh(
      input.force === true
    );

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

export interface SubmissionRefreshSelection {
  /** CIKs EDGAR has published for since we last processed them. */
  readonly needsUpdating: readonly { cik: number; last_update: string }[];
  /** CIKs with a watermark but no processed-submissions row at all. */
  readonly needsInitialProcessing: readonly { cik: number; last_update: string }[];
}

/**
 * The freshness rule `update submissions` applies: a CIK is refetched when
 * `cik_last_update.last_update > processed_submissions.last_processed`.
 *
 * Extracted from `execute` so the dry-run counts and the real run derive from
 * one function — a report that re-implements the selection can disagree with
 * what the command then does.
 */
export async function selectSubmissionsToRefresh(
  force: boolean
): Promise<SubmissionRefreshSelection> {
  const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
  const processedSubmissionsRepo = globalServiceRegistry.get(
    PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN
  );

  // getAll() rather than query({}, …): the tabular backend rejects an empty
  // criteria object ("Query criteria must not be empty. Use getAll()"), which
  // is exactly the all-rows read we want here.
  const allCikUpdates =
    (await cikLastUpdateRepo.getAll({
      orderBy: [{ column: "last_update", direction: "DESC" }],
    })) ?? [];

  const needsUpdating: { cik: number; last_update: string }[] = [];
  const needsInitialProcessing: { cik: number; last_update: string }[] = [];

  if (force) {
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

  return { needsUpdating, needsInitialProcessing };
}
