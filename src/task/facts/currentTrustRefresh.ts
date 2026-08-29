/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifting a periodic report's trust balance onto a lifecycle row.
 *
 * Which XBRL concept, taxonomy and period wins is a judgement about a lifecycle
 * model rather than about company facts, so it is contributed by whichever
 * package owns that model — along with the row it writes. This package holds
 * only the `company_facts` rows such a reading starts from, and knows only that
 * something may want to be told when a CIK's facts have just been refreshed.
 */
export interface CurrentTrustRefresh {
  /** Whether a refresh would change the row, without writing (dry run). */
  readonly wouldRefresh: (cik: number) => Promise<boolean>;
  /** Apply the refresh; answers whether the row changed. */
  readonly refresh: (cik: number) => Promise<boolean>;
}

/**
 * The contributed refresh, or undefined when nothing registered one.
 *
 * One rather than a keyed set: there is one question here, and a package with
 * two sources of a trust balance composes them in the one it registers.
 */
let registered: CurrentTrustRefresh | undefined;

/**
 * Contribute the reading that turns a CIK's company facts into a current trust
 * balance.
 *
 * Registering one is the only signal this package has that a deployment has
 * such a reading at all. Without it the facts sweep does not reach for one —
 * it does not call and swallow, it does not call. Idempotent; the last
 * registration stands.
 */
export function registerCurrentTrustRefresh(refresh: CurrentTrustRefresh): void {
  registered = refresh;
}

/** Test hook: forget the contributed refresh. */
export function clearCurrentTrustRefreshForTesting(): void {
  registered = undefined;
}

/** The contributed refresh, or undefined when none was contributed. */
export function currentTrustRefresh(): CurrentTrustRefresh | undefined {
  return registered;
}
