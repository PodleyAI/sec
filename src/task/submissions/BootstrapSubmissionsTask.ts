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
import { streamProcessedCikSet } from "../../storage/processing/processedCikSet";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { fetchAndStoreSubmission } from "./fetchAndStoreSubmission";

export type BootstrapSubmissionsTaskInput = {
  readonly force?: boolean;
};

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
  static readonly title = "Ingest bulk submissions";
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
    input: BootstrapSubmissionsTaskInput,
    context: IExecuteContext
  ): Promise<BootstrapSubmissionsTaskOutput> {
    const rawDataFolder = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const submissionsDir = resolve(rawDataFolder, "submissions");

    let files: string[];
    try {
      files = await readdir(submissionsDir);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        if (isDryRun()) {
          console.log(
            `Would bootstrap CIK submissions after bulk data populates ${submissionsDir}`
          );
          return { success: true };
        }
        throw new Error(
          `Submissions directory not found: ${submissionsDir}. Run bootstrap (with download) or \`bootstrap download submissions\` first.`
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
      // Stream the cik column rather than getAll() — production has
      // hundreds of thousands to millions of processed CIK rows, and
      // getAll() materialises every column for every row only to throw
      // most of it away.
      const processedSubmissionsRepo = globalServiceRegistry.get(
        PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN
      );
      const processedSet = await streamProcessedCikSet(processedSubmissionsRepo);
      ciksToProcess = ciks.filter((cik) => !processedSet.has(cik));
    }

    if (isDryRun()) {
      const label = input.force ? "all" : "unprocessed";
      console.log(
        `Would bootstrap ${ciksToProcess.length} ${label} CIK submissions (${ciks.length} total)`
      );
      return { success: true };
    }

    if (ciksToProcess.length) {
      const wf = context.own(new Workflow(), {
        title: `Ingest submissions for ${ciksToProcess.length} CIKs`,
      });
      const loop = wf.map({ concurrencyLimit: 2, maxIterations: ciksToProcess.length });
      loop.pipe(fetchAndStoreSubmission);
      loop.endMap();
      await wf.run({
        cik: ciksToProcess,
      });
    }

    return { success: true };
  }
}
