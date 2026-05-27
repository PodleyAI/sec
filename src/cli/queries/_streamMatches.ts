/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage, SearchCriteria } from "workglow";

// PageCursor isn't re-exported from the `workglow` facade in 0.3.0, so we
// infer the cursor type from the return shape of queryPage() instead of
// importing it.
type CursorOf<Entity> = Awaited<ReturnType<ITabularStorage<any, any, Entity>["queryPage"]>>["nextCursor"];

/**
 * Soft cap on streamed substring/prefix matches before we stop counting.
 *
 * Single source of truth shared by `collectPage` (this module) and
 * `queryCiks` (CikQuery.ts) so the two streaming query surfaces report
 * `totalApprox` with identical semantics. Stops the empty-needle /
 * pathologically-broad-needle case from walking the entire ~1M-row table
 * and exhausting memory, while leaving plenty of headroom for a normal
 * `offset + limit` of a few hundred.
 */
export const MAX_FUZZY_MATCHES = 1000;

/**
 * Iterates `repo.queryPage(criteria, ...)` cursor-by-cursor, yielding each
 * row that satisfies `predicate`. Memory is bounded to one page; total
 * iteration is bounded by the matching row count, not the table size.
 *
 * Built for query UIs that need substring filters (`name ILIKE '%foo%'`,
 * which workglow's `SearchCriteria` does not support) on top of
 * equality/range filters that DO push down to the database.
 */
export async function* streamMatchingRows<Entity>(
  repo: ITabularStorage<any, any, Entity>,
  criteria: SearchCriteria<Entity>,
  predicate: (row: Entity) => boolean,
  pageSize: number = 1000
): AsyncGenerator<Entity, void, undefined> {
  let cursor: CursorOf<Entity> | undefined;
  do {
    const page = await repo.queryPage(criteria, { limit: pageSize, cursor });
    for (const row of page.items) {
      if (predicate(row)) yield row;
    }
    // Termination contract: stop on empty page even if nextCursor is set,
    // otherwise a concurrent delete could spin the loop.
    if (page.items.length === 0) break;
    cursor = page.nextCursor;
  } while (cursor);
}

/**
 * Collects an async iterable into the slice `[offset, offset + limit)`
 * while counting EVERY match (not just the ones that land in the window).
 *
 * Counting all matches makes `total` a meaningful number rather than a
 * constant equal to the page end: it is the number of matches observed up
 * to `maxScan`. Memory stays O(limit) — only rows inside the requested
 * window are retained; everything before `offset` and after
 * `offset + limit` is counted then discarded.
 *
 * Stops early when the running match count reaches `maxScan`
 * (`exhausted: false` — more matches may exist beyond the cap) or when the
 * iterator drains (`exhausted: true` — `total` is exact).
 *
 * Callers fold this into a `totalApprox` so the UI can render "≥ N" when
 * the cap fired, instead of pretending to know the exact match count.
 *
 * @param maxScan Soft cap on matches counted; defaults to the shared
 * `MAX_FUZZY_MATCHES`.
 * @returns `total` — matches counted up to `maxScan`. `exhausted` —
 * `false` if the cap stopped us (more may exist), `true` if the iterator
 * drained (in which case `total` is exact).
 */
export async function collectPage<T>(
  iter: AsyncIterable<T>,
  offset: number,
  limit: number,
  maxScan: number = MAX_FUZZY_MATCHES
): Promise<{ rows: T[]; total: number; exhausted: boolean }> {
  const windowEnd = offset + limit;
  const window: T[] = [];
  let matched = 0;
  for await (const row of iter) {
    // Retain only rows in [offset, offset + limit) — O(limit) memory.
    if (matched >= offset && matched < windowEnd) {
      window.push(row);
    }
    matched++;
    if (matched >= maxScan) {
      // Hit the soft cap: there may be more matches we never counted.
      return { rows: window, total: matched, exhausted: false };
    }
  }
  // Iterator drained: `matched` is the exact total.
  return { rows: window, total: matched, exhausted: true };
}
