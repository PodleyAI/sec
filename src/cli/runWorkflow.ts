/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { withCli } from "@workglow/cli";
import { OutputTask, Workflow, type DataPorts, type ITask } from "workglow";
import { isJsonOutput } from "./isJsonOutput";

/**
 * Runs one or more tasks as a single task graph through the CLI workflow
 * renderer. Tasks are piped in order into a {@link Workflow} terminated by an
 * {@link OutputTask} sink. On a TTY the run renders live per-task progress
 * (`renderWorkflowRun` from `@workglow/cli`); when piped or captured it runs
 * plainly with identical results. The sink's collected output — the final
 * task's output ports — is returned so commands can render tables/JSON from
 * structured results without reaching into the graph.
 *
 * Piping connects ALL output ports of each task to the next task by name, and
 * a matching name overrides the downstream task's `defaults`. Multi-task
 * pipelines must therefore keep upstream output port names disjoint from
 * downstream input ports unless the hand-off is intended.
 *
 * Tasks should report EXPECTED user-errors as output ports (e.g. an `error`
 * string) rather than throwing: on a TTY the workflow renderer intercepts a
 * thrown error with `process.exit(1)`, bypassing the calling command's error
 * handling and the CLI's teardown; only unexpected failures should throw.
 */
export async function runWorkflowCli<T>(
  tasks: readonly ITask[],
  input?: Record<string, unknown>,
  buildAfter?: (wf: Workflow) => void
): Promise<T> {
  const wf = new Workflow();
  const sink = new OutputTask();
  for (const task of tasks) {
    wf.pipe(task as ITask<DataPorts, DataPorts>);
  }
  // `buildAfter` lets a caller splice loop/branch nodes (e.g. a `.forEach()`
  // fan-out) into the graph AFTER the flat task list and BEFORE the sink — so
  // those nodes are first-class members of the graph the CLI renderer
  // subscribes to (live per-iteration progress), rather than buried inside a
  // task's private nested Workflow. Omit it and behaviour is identical to the
  // original flat pipe-through.
  buildAfter?.(wf);
  wf.pipe(sink as ITask<DataPorts, DataPorts>);
  // Use the interactive Ink renderer only on a real TTY. When stdout is
  // redirected (e.g. `update forms … --shard 1/6 > shard1.log 2>&1 &`), the Ink
  // UI would write control codes into a logfile AND, worse, grab raw-mode on
  // the terminal — a backgrounded process cannot own the TTY, so it is stopped
  // by SIGTTIN and the run dies immediately. In that case run plainly; progress
  // is monitored out-of-band (DB counts / logs) for batch/background shards.
  const interactive = !isJsonOutput() && Boolean(process.stdout.isTTY);
  if (interactive) {
    await withCli(wf).run(input);
  } else {
    await wf.run(input);
  }
  return sink.runOutputData as T;
}
