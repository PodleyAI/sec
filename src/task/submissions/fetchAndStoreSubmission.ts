/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, pipe } from "@workglow/task-graph";
import { processUpdateProcessing } from "./StoreSubmissionsTask";
import { FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { StoreSubmissionsTask } from "./StoreSubmissionsTask";

export async function fetchAndStoreSubmission(
  input: { cik: number; date?: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  const pipeline = ctx.own(pipe([new FetchSubmissionsTask(), new StoreSubmissionsTask()]));
  try {
    await pipeline.run(input);
  } catch (e) {
    await processUpdateProcessing(input.cik, false);
  }
  // Per-item failures are recorded above; the map task itself always succeeds
  return { success: true };
}
