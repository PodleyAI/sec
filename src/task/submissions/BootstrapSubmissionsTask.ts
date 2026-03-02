/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, Workflow } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { Type } from "typebox";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { fetchAndStoreSubmission } from "./fetchAndStoreSubmission";

export type BootstrapSubmissionsTaskInput = {};

export type BootstrapSubmissionsTaskOutput = {
  success: boolean;
};

const CIK_FILE_PATTERN = /^CIK(\d{10})\.json$/;

/**
 * Task for bootstrapping submissions from pre-downloaded CIK files in SEC_RAW_DATA_FOLDER/submissions/
 */
export class BootstrapSubmissionsTask extends Task<
  BootstrapSubmissionsTaskInput,
  BootstrapSubmissionsTaskOutput
> {
  static readonly type = "BootstrapSubmissionsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: BootstrapSubmissionsTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapSubmissionsTaskOutput> {
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const submissionsDir = resolve(rawDataFolder, "submissions");

    const files = await readdir(submissionsDir);
    const ciks: number[] = [];
    for (const file of files) {
      const match = CIK_FILE_PATTERN.exec(file);
      if (match) {
        ciks.push(parseInt(match[1], 10));
      }
    }

    const processedSubmissionsRepo = globalServiceRegistry.get(
      PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN
    );
    const allProcessedSubmissions = (await processedSubmissionsRepo.getAll()) ?? [];
    const processedSet = new Set<number>();
    for (const ps of allProcessedSubmissions) {
      processedSet.add(ps.cik);
    }

    const unprocessedCiks = ciks.filter((cik) => !processedSet.has(cik));

    if (unprocessedCiks.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 2 });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: unprocessedCiks,
      });
    }

    return { success: true };
  }
}
