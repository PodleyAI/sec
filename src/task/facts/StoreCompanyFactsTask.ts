//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskAbortedError, TaskError } from "@podley/task-graph";
import { TObject, Type } from "@sinclair/typebox";
import { Factoid } from "../../sec/facts/CompanyFacts";
import { query_run } from "../../util/db";
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

  public static inputSchema(): TObject {
    return FetchCompanyFactsTask.outputSchema();
  }

  public static outputSchema(): TObject {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: StoreCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<StoreCompanyFactsTaskOutput> {
    const factsArray: Factoid[] = input.facts.filter((f) => !!f);
    if (!factsArray) throw new TaskError("No facts data to store");

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
        .map((fact) => {
          return {
            $cik: fact.cik,
            $grouping: fact.grouping,
            $name: fact.name,
            $filed_date: fact.filed_date,
            $form: fact.form,
            $val_unit: fact.val_unit,
            $frame: fact.frame || null,
            $accession_number: fact.accession_number,
            $start_date: fact.start_date || null,
            $end_date: fact.end_date || null,
            $val: fact.val,
            $fy: fact.fy,
            $fp: fact.fp,
          };
        });
      query_run(
        `INSERT OR REPLACE INTO company_facts(cik,grouping,name,filed_date,form,val_unit,frame,accession_number,start_date,end_date,val,fy,fp)
          VALUES($cik,$grouping,$name,$filed_date,$form,$val_unit,$frame,$accession_number,$start_date,$end_date,$val,$fy,$fp)`,
        batch
      );
      const newProgress = Math.round((i / batches) * 100);
      if (newProgress > progress) {
        // round numbers, so max 100 times
        context.updateProgress(newProgress);
        progress = newProgress;
      }
    }
    if (input.date) {
      query_run(
        `INSERT OR REPLACE INTO processed_facts(cik,last_processed)
        VALUES($cik,$last_processed)`,
        {
          $cik: input.cik,
          $last_processed: input.date,
        }
      );
    }
    return { success: true };
  }
}
