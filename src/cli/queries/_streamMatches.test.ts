/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ITabularStorage } from "workglow";
import { collectPage, MAX_FUZZY_MATCHES, streamMatchingRows } from "./_streamMatches";

async function* gen(count: number): AsyncGenerator<number, void, undefined> {
  for (let i = 0; i < count; i++) yield i;
}

describe("collectPage", () => {
  it("counts the FULL match set when it drains below the cap", async () => {
    // 50 matches, window is [10, 15). total must be the full count (50),
    // not offset+limit (15).
    const result = await collectPage(gen(50), 10, 5, 1000);
    expect(result.total).toBe(50);
    expect(result.exhausted).toBe(true);
    expect(result.rows).toEqual([10, 11, 12, 13, 14]);
  });

  it("reports total === maxScan and exhausted false when the cap fires", async () => {
    // 500 matches available, cap at 100. We stop counting at the cap and
    // signal that more may exist.
    const result = await collectPage(gen(500), 0, 5, 100);
    expect(result.total).toBe(100);
    expect(result.exhausted).toBe(false);
    expect(result.rows).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns empty rows but the exact total when offset is past the match set", async () => {
    const result = await collectPage(gen(8), 20, 5, 1000);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(8);
    expect(result.exhausted).toBe(true);
  });

  it("handles an empty iterator: total 0, exhausted true", async () => {
    const result = await collectPage(gen(0), 0, 5, 1000);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.exhausted).toBe(true);
  });

  it("keeps the window O(limit) even when far more matches precede it", async () => {
    const result = await collectPage(gen(800), 100, 3, 1000);
    expect(result.rows).toEqual([100, 101, 102]);
    expect(result.total).toBe(800);
    expect(result.exhausted).toBe(true);
  });

  it("defaults maxScan to the shared MAX_FUZZY_MATCHES cap", async () => {
    const result = await collectPage(gen(MAX_FUZZY_MATCHES + 500), 0, 2);
    expect(result.total).toBe(MAX_FUZZY_MATCHES);
    expect(result.exhausted).toBe(false);
    expect(result.rows).toEqual([0, 1]);
  });
});

/**
 * The row shape this suite pages.
 *
 * Not a bare `number`: `streamMatchingRows` keys its criteria off the entity,
 * and `SearchCriteria` is a homomorphic mapped type — over a primitive it
 * collapses back to that primitive, leaving nowhere to put even the empty
 * criteria every one of these cases passes.
 */
interface Row {
  readonly id: number;
}

/**
 * A repo whose `queryPage` pages an array by keyset, encoding the position as
 * the index after the last row returned — the same shape as a real opaque
 * cursor, small enough to assert on.
 *
 * Only `queryPage` is reached, so the rest of the storage surface is cast past
 * rather than stood up; building it would say nothing about the paging here.
 */
function pagedRepo(
  ids: readonly number[],
  pageCalls: string[] = []
): ITabularStorage<any, any, Row> {
  const rows: readonly Row[] = ids.map((id) => ({ id }));
  return {
    queryPage: async (
      _criteria: unknown,
      request: { limit: number; cursor?: string }
    ): Promise<{ items: Row[]; nextCursor: string | undefined }> => {
      pageCalls.push(request.cursor ?? "<start>");
      const from = request.cursor === undefined ? 0 : Number(request.cursor);
      const items = rows.slice(from, from + request.limit);
      const end = from + items.length;
      return { items, nextCursor: end >= rows.length ? undefined : String(end) };
    },
  } as unknown as ITabularStorage<any, any, Row>;
}

describe("streamMatchingRows", () => {
  it("pages through the whole set, yielding only predicate survivors", async () => {
    const seen: number[] = [];
    for await (const row of streamMatchingRows(
      pagedRepo([1, 2, 3, 4, 5]),
      {},
      (r) => r.id % 2 === 1,
      2
    )) {
      seen.push(row.id);
    }
    expect(seen).toEqual([1, 3, 5]);
  });

  it("resumes nothing and re-reads nothing: each page is requested once", async () => {
    const calls: string[] = [];
    const seen: number[] = [];
    for await (const row of streamMatchingRows(
      pagedRepo([1, 2, 3, 4, 5], calls),
      {},
      () => true,
      2
    )) {
      seen.push(row.id);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual(["<start>", "2", "4"]);
  });

  it("terminates on an empty page that still advertises a cursor", async () => {
    // The termination contract, and the case it exists for: a concurrent delete
    // can empty a page while the backend keeps handing back a position. Breaking
    // on `!cursor` alone would spin here forever.
    const calls: string[] = [];
    const repo = {
      queryPage: async (_criteria: unknown, request: { limit: number; cursor?: string }) => {
        calls.push(request.cursor ?? "<start>");
        return { items: [], nextCursor: "always-more" };
      },
    } as unknown as ITabularStorage<any, any, Row>;
    const seen: number[] = [];
    for await (const row of streamMatchingRows(repo, {}, () => true, 2)) seen.push(row.id);
    expect(seen).toEqual([]);
    expect(calls).toEqual(["<start>"]);
  });

  it("keeps going past a page whose rows all fail the predicate", async () => {
    const seen: number[] = [];
    for await (const row of streamMatchingRows(pagedRepo([1, 2, 3, 4]), {}, (r) => r.id > 3, 2)) {
      seen.push(row.id);
    }
    expect(seen).toEqual([4]);
  });
});
