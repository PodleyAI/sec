/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { closeIdlePgConnections } from "../util/pg";

/**
 * How many status-rail reads are in flight.
 *
 * The console polls every widget in parallel. Closing after the first one
 * returns would drop backends the others are still using; this counter waits
 * until the whole poll is done.
 */
let inFlight = 0;

/**
 * Runs a status-rail read and, once every concurrent read in this poll has
 * finished, disconnects the idle Postgres clients it opened.
 */
export async function closeAfterStats<T>(read: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await read();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) await closeIdlePgConnections();
  }
}

export function resetCloseAfterStatsForTesting(): void {
  inFlight = 0;
}
