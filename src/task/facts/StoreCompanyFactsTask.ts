/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { Factoid } from "../../sec/facts/CompanyFacts";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { FetchCompanyFactsTask, FetchCompanyFactsTaskOutput } from "./FetchCompanyFactsTask";

export type StoreCompanyFactsTaskInput = FetchCompanyFactsTaskOutput;

export type StoreCompanyFactsTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company facts
 */
export class StoreCompanyFactsTask extends Task<
  StoreCompanyFactsTaskInput,
  StoreCompanyFactsTaskOutput
> {
  static readonly type = "StoreCompanyFactsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static inputSchema() {
    return FetchCompanyFactsTask.outputSchema();
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: StoreCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<StoreCompanyFactsTaskOutput> {
    const factsArray: Factoid[] = input.facts.filter((f) => !!f);

    const companyFactsRepo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);

    if (factsArray.length === 0) {
      return { success: true };
    }

    let progress = 0;
    const batchSize = 1000;
    const batches = Math.ceil(factsArray.length / batchSize);
    for (let i = 0; i < batches; i++) {
      if (context.signal?.aborted) {
        throw new TaskAbortedError();
      }
      const batch = factsArray
        .slice(i * batchSize, (i + 1) * batchSize)
        .filter(Boolean)
        .map((fact) => ({
          cik: fact.cik,
          grouping: fact.grouping,
          name: fact.name,
          filed_date: fact.filed_date,
          form: fact.form,
          val_unit: fact.val_unit,
          frame: fact.frame || null,
          accession_number: fact.accession_number,
          start_date: fact.start_date || null,
          end_date: fact.end_date || null,
          val: fact.val,
          // `fy`/`fp` are primary-key columns and must be non-null. EDGAR
          // reports null for period-agnostic facts (e.g. DEF 14A
          // pay-vs-performance figures); coalesce to stable sentinels so the
          // key is deterministic and replays stay idempotent.
          fy: fact.fy ?? 0,
          fp: fact.fp ?? "",
        }));
      await companyFactsRepo.putBulk(batch);
      const newProgress = Math.round((i / batches) * 100);
      if (newProgress > progress) {
        // round numbers, so max 100 times
        context.updateProgress(newProgress);
        progress = newProgress;
      }
    }
    return { success: true };
  }
}
