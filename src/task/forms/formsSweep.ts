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
 * that {@link addFormsSweepLoop} fans out. Pass this as the last task in a
 * command's task list, then hand {@link addFormsSweepLoop} to `runWorkflowCli`'s
 * `buildAfter` hook. When `shard` is supplied (count > 1), this producer emits
 * only the filings hashing into `shard.index`, so N processes each with a
 * distinct index cover the worklist disjointly.
 */
export function newFormsWorklistTask(form?: string[], shard?: FormsShard): ComputeFormsWorklistTask {
  return new ComputeFormsWorklistTask({
    defaults: { form, shardIndex: shard?.index, shardCount: shard?.count },
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
 * Splices the forms fan-out loop onto a workflow whose current tail is a
 * {@link ComputeFormsWorklistTask}. The `.forEach()` loop node auto-connects
 * the producer's `accessionNumber` / `cik` / `form` / `fileName` array output
 * ports and runs one {@link ProcessAccessionDocFormTask} per filing, up to
 * {@link FORMS_SWEEP_CONCURRENCY_LIMIT} concurrently. `maxIterations` is left
 * to default to "unbounded" so the loop iterates the full worklist length,
 * which is only known at run time. Results are discarded (`forEach`), so no
 * per-iteration output is retained for a worklist that can be millions long.
 *
 * Because the loop is added to the OUTER workflow (not a task-private nested
 * one), it is a first-class node in the graph the CLI run renderer subscribes
 * to, so the sweep shows live per-worker iteration rows.
 */
export function addFormsSweepLoop(wf: Workflow): void {
  const loop = wf.forEach({ concurrencyLimit: FORMS_SWEEP_CONCURRENCY_LIMIT });
  loop.pipe(new ProcessAccessionDocFormTask() as ITask<DataPorts, DataPorts>);
  loop.endForEach();
}
