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
 * Collects an async iterable into the slice `[offset, offset + limit)`.
 *
 * Returns `exhausted: true` only if the iterator drained — otherwise the
 * caller observed exactly `offset + limit` matches and there may be more.
 * Callers fold this into a `totalApprox` so the UI can render "≥ N"
 * instead of pretending to know the exact match count.
 */
export async function collectPage<T>(
  iter: AsyncIterable<T>,
  offset: number,
  limit: number
): Promise<{ rows: T[]; total: number; exhausted: boolean }> {
  const target = offset + limit;
  const collected: T[] = [];
  for await (const row of iter) {
    collected.push(row);
    if (collected.length >= target) {
      return { rows: collected.slice(offset, target), total: target, exhausted: false };
    }
  }
  return { rows: collected.slice(offset), total: collected.length, exhausted: true };
}
