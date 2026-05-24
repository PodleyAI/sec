/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";

/**
 * Streams every row in a `processed_*` repository and returns the set of
 * `cik` values. Peak memory is bounded to `pageSize` rows + the final
 * set (~24 bytes/entry — ~25 MB for a 1M-CIK corpus).
 *
 * Used by `BootstrapSubmissionsTask` and `BootstrapCompanyFactsTask` to
 * compute the unprocessed-CIK set difference. The previous
 * `await repo.getAll()` materialised every row + every column into RAM
 * just to discard everything except `cik`; this avoids that intermediate.
 */
export async function streamProcessedCikSet<T extends { cik: number }>(
  repo: Pick<ITabularStorage<any, any, T>, "records">,
  pageSize: number = 5000
): Promise<Set<number>> {
  const seen = new Set<number>();
  for await (const row of repo.records(pageSize)) {
    seen.add(row.cik);
  }
  return seen;
}
