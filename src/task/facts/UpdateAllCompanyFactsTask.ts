/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, pipe, Task, Workflow } from "@workglow/task-graph";
import { TObject, Type } from "typebox";
import { query_all, query_run } from "../../util/db";
import { parseDate } from "../../util/parseDate";
import { FetchCompanyFactsTask } from "./FetchCompanyFactsTask";
import { StoreCompanyFactsTask } from "./StoreCompanyFactsTask";

export type UpdateAllCompanyFactsTaskInput = {};

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
    const needsUpating = query_all<{
      cik: string;
      last_update: string;
      last_processed: string;
    }>(`
      SELECT cik_last_update.cik, cik_last_update.last_update, processed_facts.last_processed FROM cik_last_update
        JOIN processed_facts
          ON cik_last_update.cik = processed_facts.cik
        WHERE cik_last_update.last_update > processed_facts.last_processed
        ORDER BY cik_last_update.last_update DESC`);
    const needsUpatingCount = needsUpating?.length ?? 0;

    const needsProcessing = query_all<{
      cik: string;
      last_update: string;
      last_processed: string;
    }>(`
      SELECT cik_last_update.cik, cik_last_update.last_update, processed_facts.last_processed FROM cik_last_update
        LEFT JOIN processed_facts
          ON cik_last_update.cik = processed_facts.cik
        WHERE processed_facts.last_processed IS NULL
        ORDER BY cik_last_update.last_update DESC`);
    const needsProcessingCount = needsProcessing?.length ?? 0;

    if (needsUpatingCount) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 1 });
      loop.pipe(fetchAndStoreFacts);
      loop.endMap();
      await wf.run({
        cik: needsUpating.map((r) => r.cik),
        date: needsUpating.map((r) => r.last_update),
      });
    }

    if (needsProcessingCount) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10 });
      loop.pipe(fetchAndStoreFacts);
      loop.endMap();
      await wf.run({
        cik: needsProcessing.map((r) => r.cik),
        date: needsProcessing.map((r) => r.last_update),
      });
    }

    return { success: true };
  }
}

async function fetchAndStoreFacts(
  input: { cik: string; date: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  const pipeline = ctx.own(pipe([new FetchCompanyFactsTask(), new StoreCompanyFactsTask()]));
  try {
    await pipeline.run({ cik: parseInt(input.cik), date: input.date });
  } catch (e) {
    const { year, month, day } = parseDate(input.date);
    query_run(
      `INSERT OR REPLACE INTO processed_facts(cik,last_processed)
        VALUES($cik,$last_processed)`,
      {
        $cik: input.cik,
        $last_processed: `${year + 1}-${month}-${day}`,
      }
    );
  }
  return { success: true };
}
