/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import {
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  type ProcessedFacts,
} from "../../storage/processing/ProcessedFactsSchema";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export interface UpdateAllCompanyFactsTaskInput {
  readonly force?: boolean;
}

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
      const allProcessedFacts = (await processedFactsRepo.getAll()) ?? [];

      const processedMap = new Map<number, ProcessedFacts>();
      for (const pf of allProcessedFacts) {
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

    if (needsUpdating.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 1 });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: needsUpdating.map((r) => r.cik),
        date: needsUpdating.map((r) => r.last_update),
      });
    }

    if (needsProcessing.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10 });
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
