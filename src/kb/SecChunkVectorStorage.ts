/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TypedArray } from "workglow";
import {
  ChunkVectorPrimaryKey,
  ChunkVectorStorageSchema,
  cosineSimilarity,
  SqliteVectorStorage,
} from "workglow";

type ChunkStore = SqliteVectorStorage<
  typeof ChunkVectorStorageSchema,
  typeof ChunkVectorPrimaryKey
>;

/**
 * The knowledge base's chunk store, with a working similarity search.
 *
 * Upstream's `similaritySearch` reads rows through `getAll()` and then runs its
 * own `deserializeVector` over the vector column — but `getAll()` has already
 * turned that column into a `Float32Array`, so the JSON parse throws on every
 * row and every search fails with "Unable to parse JSON string". Storage,
 * dimension validation and every other operation on the class are correct; it
 * is one double conversion in one method.
 *
 * Patched on the instance rather than by subclassing: the class's generics are
 * deep enough that a narrowing override cannot be typed without restating them,
 * and this is a stopgap, not a design. Delete it when `@workglow/sqlite` ships
 * the fix — `getSecKnowledgeBase` is its only caller.
 */
export function withWorkingSimilaritySearch(store: ChunkStore): ChunkStore {
  const search = async (
    query: TypedArray,
    options: { topK?: number; scoreThreshold?: number } = {}
  ): Promise<Record<string, unknown>[]> => {
    const { topK = 10, scoreThreshold = 0 } = options;
    const rows = (await store.getAll()) ?? [];
    const scored: { row: Record<string, unknown>; score: number }[] = [];
    for (const row of rows as unknown as Record<string, unknown>[]) {
      const raw = row.vector;
      // Both spellings, so this keeps working whether or not `getAll()` is the
      // one converting. Assuming exactly one of them is what broke upstream.
      const vector =
        typeof raw === "string"
          ? new Float32Array(JSON.parse(raw) as number[])
          : (raw as TypedArray);
      const score = cosineSimilarity(query, vector);
      if (score < scoreThreshold) continue;
      scored.push({ row, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((hit) => ({ ...hit.row, score: hit.score }));
  };
  // Assigned through `unknown`: the method's declared return type restates the
  // chunk schema, and the patch's job is to be the same function with one
  // conversion removed, not to re-derive that type.
  (store as unknown as { similaritySearch: typeof search }).similaritySearch = search;
  return store;
}
