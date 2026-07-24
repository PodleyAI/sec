/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPorts, ITask, Workflow } from "workglow";
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

/**
 * Number of filings processed concurrently by the forms sweep. Also the number
 * of live iteration rows the CLI shows at once. Bounded well under the fetch
 * queue's own 10 req/sec limiter — extra workers past that just wait on cached
 * hits or CPU/AI extraction, which are not queue-limited.
 */
export const FORMS_SWEEP_CONCURRENCY_LIMIT = 20;

/**
 * The producer task for a forms sweep. Emits the index-aligned worklist arrays
 * that {@link addFormsSweepLoop} fans out. Pass this as the last task in a
 * command's task list, then hand {@link addFormsSweepLoop} to `runWorkflowCli`'s
 * `buildAfter` hook.
 */
export function newFormsWorklistTask(form?: string[]): ComputeFormsWorklistTask {
  return new ComputeFormsWorklistTask({ defaults: { form } });
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
