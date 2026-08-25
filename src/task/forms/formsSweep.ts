/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPorts, ITask, Workflow } from "workglow";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * Number of filings processed concurrently by ONE forms-sweep process (also the
 * number of live iteration rows its CLI shows at once). Horizontal scale now
 * comes from running multiple sharded processes (`--shard i/N`) across cores —
 * each pins ~1 core since JS execution is single-threaded — so per-process
 * concurrency stays modest at 10. That keeps DB-pool pressure sane under a
 * multi-shard launch (N processes × the ~10-connection pool) and matches the
 * fetch queue's 10 req/sec ceiling, above which extra workers only ever wait.
 */
export const FORMS_SWEEP_CONCURRENCY_LIMIT = 10;

/** Horizontal fan-out: `{ index, count }` selects one shard of the worklist. */
export interface FormsShard {
  readonly index: number;
  readonly count: number;
}

/**
 * The producer task for a forms sweep. Emits the index-aligned worklist arrays
 * that {@link formsSweepLoop} fans out. Pass this as the last task in a
 * command's task list, then hand {@link formsSweepLoop} to `runWorkflowCli`'s
 * `buildAfter` hook. When `shard` is supplied (count > 1), this producer emits
 * only the filings hashing into `shard.index`, so N processes each with a
 * distinct index cover the worklist disjointly.
 */
export function newFormsWorklistTask(
  form?: string[],
  shard?: FormsShard,
  ciks?: number[],
  filedOnOrAfter?: string
): ComputeFormsWorklistTask {
  return new ComputeFormsWorklistTask({
    defaults: {
      form,
      shardIndex: shard?.index,
      shardCount: shard?.count,
      ciks,
      filedOnOrAfter,
    },
  });
}

/**
 * Parses a `--shard i/N` CLI value into a 0-based {@link FormsShard}. Accepts
 * 1-based user input (`1/6`..`6/6`) and converts to 0-based internally.
 * Returns undefined for a missing/blank value (no sharding).
 */
export function parseShardOption(value: string | undefined): FormsShard | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!m) {
    throw new Error(`Invalid --shard "${value}": expected the form i/N (1-based), e.g. 1/6.`);
  }
  const oneBasedIndex = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1 || oneBasedIndex < 1 || oneBasedIndex > count) {
    throw new Error(`Invalid --shard "${value}": need 1 <= i <= N and N >= 1.`);
  }
  return { index: oneBasedIndex - 1, count };
}

/**
 * Builds the forms sweep: the producer, then a `.forEach()` fan-out over the
 * worklist it emitted.
 *
 * The producer computes the full worklist in one run — four scalar arrays
 * whose shared length is the sweep's N — so the fan-out is `Map i/N` rather
 * than a `while` over fixed-size batches. Pass the result to
 * `runWorkflowCli`'s `buildAfter` and leave the producer out of the task
 * list: both nodes live in the OUTER workflow so they stay first-class in
 * the graph the CLI renderer subscribes to.
 *
 * The fan-out auto-connects the producer's `accessionNumber` / `cik` / `form` /
 * `fileName` array ports by name and runs one
 * {@link ProcessAccessionDocFormTask} per filing, up to
 * {@link FORMS_SWEEP_CONCURRENCY_LIMIT} concurrently. Results are discarded
 * (`forEach`), so no per-iteration output accumulates.
 */
export function formsSweepLoop(producer: ComputeFormsWorklistTask): (wf: Workflow) => void {
  return (wf: Workflow) => {
    wf.pipe(producer as ITask<DataPorts, DataPorts>);
    const fanOut = wf.forEach({ concurrencyLimit: FORMS_SWEEP_CONCURRENCY_LIMIT });
    fanOut.pipe(new ProcessAccessionDocFormTask() as ITask<DataPorts, DataPorts>);
    fanOut.endForEach();
  };
}
