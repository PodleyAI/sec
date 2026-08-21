/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type DataPorts, type ITask } from "workglow";
import {
  ProcessSpacTimelineTask,
  type ProcessSpacTimelineTaskOutput,
} from "../../task/spac/ProcessSpacTimelineTask";
import { runWorkflowCli } from "../runWorkflow";

/**
 * How many ISSUERS one `spac process` / `sync spacs --step process` process
 * replays at once. Filings within an issuer stay serial — that ordering is
 * what makes the timeline correct.
 */
export const DEFAULT_SPAC_ISSUER_CONCURRENCY = 3;

/**
 * The issuer fan-out's merged output: one column per
 * {@link ProcessSpacTimelineTask} output port, index-aligned across columns.
 */
export type SpacProcessColumns = {
  readonly [K in keyof ProcessSpacTimelineTaskOutput]?: ReadonlyArray<
    ProcessSpacTimelineTaskOutput[K]
  >;
};

/**
 * Transposes the fan-out's column arrays back into one row per issuer.
 *
 * The map merges each output port into an array across iterations — always an
 * array, including for the one-issuer run that is the commonest invocation, so
 * there is no scalar shape to unwrap. `cik` is echoed by the task rather than
 * zipped from the input list, so a row can never be reported under the wrong
 * issuer.
 */
export function spacProcessRows(
  columns: SpacProcessColumns
): readonly ProcessSpacTimelineTaskOutput[] {
  const column = <K extends keyof ProcessSpacTimelineTaskOutput>(
    key: K
  ): ReadonlyArray<ProcessSpacTimelineTaskOutput[K] | undefined> => columns[key] ?? [];
  const ciks = column("cik");
  const matched = column("matched");
  const processed = column("processed");
  const partial = column("partial");
  const failed = column("failed");
  const nonfatal = column("nonfatal");
  const triage = column("triage");
  const skipped = column("skipped");
  const triageExtractors = column("triageExtractors");
  const firstDate = column("firstDate");
  const lastDate = column("lastDate");
  const error = column("error");
  const rows: ProcessSpacTimelineTaskOutput[] = [];
  for (let i = 0; i < ciks.length; i++) {
    const cik = ciks[i];
    if (cik === undefined) continue;
    rows.push({
      cik,
      matched: matched[i] ?? 0,
      processed: processed[i] ?? 0,
      partial: partial[i] ?? 0,
      failed: failed[i] ?? 0,
      nonfatal: nonfatal[i] ?? 0,
      triage: triage[i] ?? 0,
      skipped: skipped[i] ?? 0,
      triageExtractors: triageExtractors[i] ?? "",
      firstDate: firstDate[i] ?? "",
      lastDate: lastDate[i] ?? "",
      error: error[i] ?? "",
    });
  }
  return rows;
}

/**
 * Replay each issuer's filings in filing-date order. Issuers run in parallel
 * up to `concurrency`; one issuer's filings always run serially.
 */
export async function runSpacTimelineIssuers(args: {
  readonly ciks: readonly number[];
  readonly concurrency: number;
  readonly filedOnOrAfter?: string | undefined;
  readonly force?: string | undefined;
}): Promise<readonly ProcessSpacTimelineTaskOutput[]> {
  if (args.ciks.length === 0) return [];
  const results = await runWorkflowCli<SpacProcessColumns>([], { cik: [...args.ciks] }, (wf) => {
    const loop = wf.map({
      concurrencyLimit: Math.min(Math.max(1, args.concurrency), args.ciks.length),
      maxIterations: args.ciks.length,
      preserveOrder: true,
    });
    loop.pipe(
      new ProcessSpacTimelineTask({
        defaults: {
          ...(args.force !== undefined ? { force: args.force } : {}),
          ...(args.filedOnOrAfter !== undefined ? { filedOnOrAfter: args.filedOnOrAfter } : {}),
        },
      }) as ITask<DataPorts, DataPorts>
    );
    loop.endMap();
  });
  return spacProcessRows(results);
}
