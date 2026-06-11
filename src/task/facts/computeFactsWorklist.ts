/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProcessedFacts } from "../../storage/processing/ProcessedFactsSchema";

export interface FactsWorkItem {
  readonly cik: number;
  readonly last_update: string;
}

export interface FactsWorklist {
  /** Previously processed CIKs with newer filings (fetched at low concurrency). */
  readonly needsUpdating: FactsWorkItem[];
  /** Never-processed CIKs (fetched at higher concurrency). */
  readonly needsProcessing: FactsWorkItem[];
  /** Previously failed CIKs selected by `retryFailed`; `last_update` is the retry date. */
  readonly needsRetrying: FactsWorkItem[];
}

/**
 * Splits the CIK universe into the three facts work lanes. Retry selection is
 * driven by `processed_facts.success === false` (NO_XBRL_FACTS rows are
 * successes and never retried) and uses `retryDate` as the cache-busting date.
 */
export function computeFactsWorklist(
  allCikUpdates: ReadonlyArray<FactsWorkItem>,
  processedMap: ReadonlyMap<number, ProcessedFacts>,
  options: { readonly force: boolean; readonly retryFailed: boolean; readonly retryDate: string }
): FactsWorklist {
  const needsUpdating: FactsWorkItem[] = [];
  const needsProcessing: FactsWorkItem[] = [];
  const needsRetrying: FactsWorkItem[] = [];

  if (options.force) {
    for (const clu of allCikUpdates) {
      needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
    }
    return { needsUpdating, needsProcessing, needsRetrying };
  }

  const selected = new Set<number>();
  for (const clu of allCikUpdates) {
    const pf = processedMap.get(clu.cik);
    if (!pf) {
      needsProcessing.push({ cik: clu.cik, last_update: clu.last_update });
      selected.add(clu.cik);
    } else if (clu.last_update > pf.last_processed) {
      needsUpdating.push({ cik: clu.cik, last_update: clu.last_update });
      selected.add(clu.cik);
    }
  }

  if (options.retryFailed) {
    for (const pf of processedMap.values()) {
      if (!pf.success && !selected.has(pf.cik)) {
        needsRetrying.push({ cik: pf.cik, last_update: options.retryDate });
      }
    }
  }

  return { needsUpdating, needsProcessing, needsRetrying };
}
