/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "workglow";

/**
 * Wraps an eval task's execute context for one (model, fixture/section) run.
 *
 * The wrapper keeps `own` (and the registry / abort signal) pointing at the real
 * context, so each extraction's generation task is registered on the running
 * task's subgraph and inherits its cancellation. Only `updateProgress` is
 * rewritten: a generation task reports 0–100 *within its own call*, which — if
 * forwarded verbatim — would overwrite the sweep's `done/total` percentage and
 * make the CLI bar swing back and forth every fixture. Instead the sweep's own
 * percentage is held fixed for the duration of the run and the subtask's phase
 * text is appended to the label, so the row reads
 * `model — fixture · Generating`.
 */
export function sweepStepContext(
  context: IExecuteContext | undefined,
  percent: number,
  label: string
): IExecuteContext | undefined {
  if (!context) return undefined;
  return {
    ...context,
    updateProgress: async (_progress: number | undefined, message?: string) =>
      context.updateProgress(percent, message ? `${label} · ${message}` : label),
  };
}
