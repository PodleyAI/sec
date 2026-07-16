/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { withCli } from "@workglow/cli";
import { OutputTask, Workflow, type DataPorts, type ITask } from "workglow";

/**
 * Runs one or more tasks as a single task graph through the CLI workflow
 * renderer. Tasks are piped in order into a {@link Workflow} terminated by an
 * {@link OutputTask} sink. On a TTY the run renders live per-task progress
 * (`renderWorkflowRun` from `@workglow/cli`); when piped or captured it runs
 * plainly with identical results. The sink's collected output — the final
 * task's output ports — is returned so commands can render tables/JSON from
 * structured results without reaching into the graph.
 */
export async function runWorkflowCli<T>(
  tasks: readonly ITask[],
  input?: Record<string, unknown>
): Promise<T> {
  const wf = new Workflow();
  const sink = new OutputTask();
  for (const task of [...tasks, sink]) {
    wf.pipe(task as ITask<DataPorts, DataPorts>);
  }
  await withCli(wf).run(input);
  return sink.runOutputData as T;
}
