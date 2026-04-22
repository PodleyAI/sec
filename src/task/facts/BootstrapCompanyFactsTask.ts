/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type BootstrapCompanyFactsTaskInput = {
  readonly force?: boolean;
};

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
    input: BootstrapCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapCompanyFactsTaskOutput> {
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const companyfactsDir = resolve(rawDataFolder, "companyfacts");

    let files: string[];
    try {
      files = await readdir(companyfactsDir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        if (isDryRun()) {
          console.log(
            `Would bootstrap CIK company facts after bulk data populates ${companyfactsDir}`
          );
          return { success: true };
        }
        throw new Error(
          `Company facts directory not found: ${companyfactsDir}. Run bootstrap (with download) or \`bootstrap download facts\` first.`
        );
      }
      throw e;
    }

    const ciks: number[] = [];
    for (const file of files) {
      const match = CIK_FILE_PATTERN.exec(file);
      if (match) {
        ciks.push(parseInt(match[1], 10));
      }
    }

    let ciksToProcess: number[];

    if (input.force) {
      ciksToProcess = ciks;
    } else {
      const processedFactsRepo = globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);
      const allProcessedFacts = (await processedFactsRepo.getAll()) ?? [];
      const processedSet = new Set<number>();
      for (const pf of allProcessedFacts) {
        processedSet.add(pf.cik);
      }
      ciksToProcess = ciks.filter((cik) => !processedSet.has(cik));
    }

    if (isDryRun()) {
      const label = input.force ? "all" : "unprocessed";
      console.log(
        `Would bootstrap ${ciksToProcess.length} ${label} CIK company facts (${ciks.length} total)`
      );
      return { success: true };
    }

    if (ciksToProcess.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 2, maxIterations: ciksToProcess.length });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: ciksToProcess,
        date: todayYYYYdMMdDD(),
      });
    }

    return { success: true };
  }
}
