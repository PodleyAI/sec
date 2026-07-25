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
 * Builds the forms sweep: a `while` loop whose body is the batch producer
 * followed by a `.forEach()` fan-out over the batch it just emitted.
 *
 * The producer used to sit in the flat task list and compute the entire
 * worklist once, before the first filing was fetched. It now runs once per
 * `while` iteration and yields a bounded batch, so memory is capped by the
 * batch rather than the corpus and work starts immediately. Pass the result to
 * `runWorkflowCli`'s `buildAfter` and leave the producer out of the task list —
 * it belongs to the loop body, not the graph ahead of it.
 *
 * The loop condition closes over the producer instance instead of reading a
 * chained output port. The body's merged output is the fan-out's, not the
 * producer's, so a resume key routed through ports would arrive stale on the
 * next iteration and the loop would never advance. `maxIterations` is
 * "unbounded" because the batch count is only known at run time; the producer's
 * `exhausted` flag is the real terminator.
 *
 * The fan-out auto-connects the producer's `accessionNumber` / `cik` / `form` /
 * `fileName` array ports by name and runs one
 * {@link ProcessAccessionDocFormTask} per filing, up to
 * {@link FORMS_SWEEP_CONCURRENCY_LIMIT} concurrently. Results are discarded
 * (`forEach`), so no per-iteration output accumulates.
 *
 * Both loop nodes live in the OUTER workflow rather than a task-private nested
 * one, so they stay first-class nodes in the graph the CLI renderer subscribes
 * to and the sweep still shows live per-worker iteration rows.
 */
export function formsSweepLoop(producer: ComputeFormsWorklistTask): (wf: Workflow) => void {
  return (wf: Workflow) => {
    const batches = wf.while({
      condition: () => !producer.exhausted,
      maxIterations: "unbounded",
    });
    batches.pipe(producer as ITask<DataPorts, DataPorts>);
    const fanOut = batches.forEach({ concurrencyLimit: FORMS_SWEEP_CONCURRENCY_LIMIT });
    fanOut.pipe(new ProcessAccessionDocFormTask() as ITask<DataPorts, DataPorts>);
    fanOut.endForEach();
    batches.endWhile();
  };
}
