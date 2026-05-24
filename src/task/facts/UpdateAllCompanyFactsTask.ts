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
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type UpdateAllCompanyFactsTaskInput = {
  readonly force?: boolean;
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

    const needsUpdating: { cik: number; last_update: string }[] = [];
    const needsProcessing: { cik: number; last_update: string }[] = [];

    if (input.force) {
      for (const clu of allCikUpdates) {
        needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
      }
    } else {
      // Stream rather than getAll() — see UpdateAllSubmissionsTask for the
      // same pattern. We need both cik and last_processed for freshness,
      // so a Map built page-by-page is unavoidable but the intermediate
      // row materialisation isn't.
      const processedMap = new Map<number, ProcessedFacts>();
      for await (const pf of processedFactsRepo.records(5000)) {
        processedMap.set(pf.cik, pf);
      }

      for (const clu of allCikUpdates) {
        const pf = processedMap.get(clu.cik);
        if (!pf) {
          needsProcessing.push({ cik: clu.cik, last_update: clu.last_update });
        } else if (clu.last_update > pf.last_processed) {
          needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
        }
      }
    }

    if (isDryRun()) {
      if (input.force) {
        console.log(
          `Would update ${needsUpdating.length} company facts (force — reprocessing all)`
        );
      } else {
        console.log(
          `Would update ${needsUpdating.length} changed and ${needsProcessing.length} new company facts`
        );
      }
      return { success: true };
    }

    if (needsUpdating.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 1, maxIterations: needsUpdating.length });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: needsUpdating.map((r) => r.cik),
        date: needsUpdating.map((r) => r.last_update),
      });
    }

    if (needsProcessing.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10, maxIterations: needsProcessing.length });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: needsProcessing.map((r) => r.cik),
        date: needsProcessing.map((r) => r.last_update),
      });
    }

    return { success: true };
  }
}
