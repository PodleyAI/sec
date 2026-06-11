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
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  type ProcessedFacts,
} from "../../storage/processing/ProcessedFactsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { computeFactsWorklist, type FactsWorkItem } from "./computeFactsWorklist";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type UpdateAllCompanyFactsTaskInput = {
  readonly force?: boolean;
  readonly retryFailed?: boolean;
};

export type UpdateAllCompanyFactsTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company facts
 */
export class UpdateAllCompanyFactsTask extends Task<
  UpdateAllCompanyFactsTaskInput,
  UpdateAllCompanyFactsTaskOutput
> {
  static readonly type = "UpdateAllCompanyFactsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: UpdateAllCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<UpdateAllCompanyFactsTaskOutput> {
    const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const processedFactsRepo = globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);

    const allCikUpdates =
      (await cikLastUpdateRepo.query(
        {},
        { orderBy: [{ column: "last_update", direction: "DESC" }] }
      )) ?? [];

    // Stream rather than getAll() — see UpdateAllSubmissionsTask for the
    // same pattern. We need both cik and last_processed for freshness,
    // so a Map built page-by-page is unavoidable but the intermediate
    // row materialisation isn't.
    const processedMap = new Map<number, ProcessedFacts>();
    if (!input.force) {
      for await (const pf of processedFactsRepo.records(5000)) {
        processedMap.set(pf.cik, pf);
      }
    }

    const { needsUpdating, needsProcessing, needsRetrying } = computeFactsWorklist(
      allCikUpdates,
      processedMap,
      {
        force: input.force ?? false,
        retryFailed: input.retryFailed ?? false,
        retryDate: todayYYYYdMMdDD(),
      }
    );

    if (isDryRun()) {
      if (input.force) {
        console.log(
          `Would update ${needsUpdating.length} company facts (force — reprocessing all)`
        );
      } else {
        const retrySuffix = input.retryFailed
          ? `, retrying ${needsRetrying.length} previously failed,`
          : "";
        console.log(
          `Would update ${needsUpdating.length} changed${retrySuffix} and ${needsProcessing.length} new company facts`
        );
      }
      return { success: true };
    }

    const runLane = async (items: FactsWorkItem[], concurrencyLimit: number): Promise<void> => {
      if (!items.length) return;
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit, maxIterations: items.length });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: items.map((r) => r.cik),
        date: items.map((r) => r.last_update),
      });
    };

    await runLane(needsUpdating, 1);
    await runLane(needsRetrying, 1);
    await runLane(needsProcessing, 10);

    return { success: true };
  }
}
