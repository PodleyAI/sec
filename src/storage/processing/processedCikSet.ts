/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";

/**
 * Streams a `processed_*` repository and returns the set of `cik` values whose
 * last processing **succeeded**. Peak memory is bounded to `pageSize` rows +
 * the final set (~24 bytes/entry — ~25 MB for a 1M-CIK corpus).
 *
 * Used by `BootstrapSubmissionsTask` and `BootstrapCompanyFactsTask` to compute
 * the unprocessed-CIK set difference. Failure rows (`success: false`, e.g. a
 * transient FETCH_ERROR / STORE_ERROR) are excluded so a flaky pass is retried
 * on the next non-`--force` bootstrap instead of being skipped forever.
 */
export async function streamProcessedCikSet<T extends { cik: number; success: boolean }>(
  repo: Pick<ITabularStorage<any, any, T>, "records">,
  pageSize: number = 5000
): Promise<Set<number>> {
  const seen = new Set<number>();
  for await (const row of repo.records(pageSize)) {
    if (row.success) seen.add(row.cik);
  }
  return seen;
}
