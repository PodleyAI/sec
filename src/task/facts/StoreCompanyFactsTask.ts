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
 * Coalesces a nullable EDGAR fiscal-year into a NOT-NULL primary-key value.
 * Prefer the reported `fy` verbatim; when EDGAR reports it null (period-
 * agnostic facts like DEF 14A pay-vs-performance), derive it from the
 * first four characters of `end_date` so multiple facts with the same
 * (cik, grouping, name, accession_number, val_unit, val) but distinct
 * `end_date`s stay distinct in the primary key. Only when both `fy` and
 * `end_date` are absent — or the derived year isn't a finite number — do
 * we fall back to the deterministic `0` sentinel (still idempotent for
 * replays; only period-agnostic rows without any end date collide).
 */
export function coalesceFy(fy: number | null, end_date: string | null): number {
  if (fy != null) return fy;
  if (end_date == null) return 0;
  const year = Number(end_date.slice(0, 4));
  return Number.isFinite(year) ? year : 0;
}

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
          // pay-vs-performance figures); coalesceFy derives a stable sentinel
          // from end_date (falling back to 0) so distinct period-agnostic
          // facts don't collide on fy=0, and replays stay idempotent.
          fy: coalesceFy(fact.fy, fact.end_date),
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
