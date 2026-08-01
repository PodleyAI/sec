/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, TaskAbortedError, pipe } from "workglow";
import { FetchSubmissionsTask } from "./FetchSubmissionsTask";
import { processUpdateProcessing, StoreSubmissionsTask } from "./StoreSubmissionsTask";

export async function fetchAndStoreSubmission(
  input: { cik: number; date?: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  const pipeline = ctx.own(pipe([new FetchSubmissionsTask(), new StoreSubmissionsTask()]), {
    title: `CIK ${input.cik}`,
  });
  try {
    await pipeline.run(input);
  } catch (e) {
    // A cancellation is not a per-CIK failure: propagate it so the map stops,
    // and do NOT record a spurious failure row that would mislabel the
    // interrupted CIK (and re-fetch it forever). Mirrors the facts sibling.
    if (e instanceof TaskAbortedError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to fetch/store submission for CIK ${input.cik}: ${message}`);
    await processUpdateProcessing(input.cik, false);
  }
  // Per-item failures are recorded above; the map task itself always succeeds
  return { success: true };
}
