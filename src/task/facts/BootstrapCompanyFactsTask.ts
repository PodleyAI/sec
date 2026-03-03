/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type BootstrapCompanyFactsTaskInput = {};

export type BootstrapCompanyFactsTaskOutput = {
  success: boolean;
};

const CIK_FILE_PATTERN = /^CIK(\d{10})\.json$/;

/**
 * Task for bootstrapping company facts from pre-downloaded CIK files in SEC_RAW_DATA_FOLDER/companyfacts/
 */
export class BootstrapCompanyFactsTask extends Task<
  BootstrapCompanyFactsTaskInput,
  BootstrapCompanyFactsTaskOutput
> {
  static readonly type = "BootstrapCompanyFactsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: BootstrapCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapCompanyFactsTaskOutput> {
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const companyfactsDir = resolve(rawDataFolder, "companyfacts");

    const files = await readdir(companyfactsDir);
    const ciks: number[] = [];
    for (const file of files) {
      const match = CIK_FILE_PATTERN.exec(file);
      if (match) {
        ciks.push(parseInt(match[1], 10));
      }
    }

    const processedFactsRepo = globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);
    const allProcessedFacts = (await processedFactsRepo.getAll()) ?? [];
    const processedSet = new Set<number>();
    for (const pf of allProcessedFacts) {
      processedSet.add(pf.cik);
    }

    const unprocessedCiks = ciks.filter((cik) => !processedSet.has(cik));

    if (unprocessedCiks.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 2 });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: unprocessedCiks,
        date: todayYYYYdMMdDD(),
      });
    }

    return { success: true };
  }
}
