/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTaskQueueRegistry } from "workglow";

import { closeDb } from "../util/db";
import { closePgPool } from "../util/pg";
import { terminateWorkers } from "../util/workers";

/**
 * Tear down process-wide resources the CLI opened. Safe to call more than
 * once: `closePgPool` is a no-op after the first successful end.
 */
export async function shutdownCliResources(): Promise<void> {
  const cleanups = await Promise.allSettled([
    getTaskQueueRegistry().stopQueues(),
    Promise.resolve().then(() => closeDb()),
    closePgPool(),
    // Terminate worker-backed AI providers (local models) so the process exits
    // instead of hanging on live worker threads until their idle timeout.
    terminateWorkers(),
  ]);
  for (const result of cleanups) {
    if (result.status === "rejected") {
      console.error("Cleanup error:", result.reason);
    }
  }
}
