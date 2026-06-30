/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncMutex } from "./AsyncMutex";

/**
 * A per-key {@link AsyncMutex}. `lock(key, fn)` serialises `fn` against other
 * `lock` calls with the SAME key while letting different keys run concurrently —
 * the building block for an atomic read-modify-write of a mutable "current" row
 * keyed by `(cik, file_number)` / portal CIK / etc.
 *
 * Each key's mutex is created on first use, refcounted, and evicted at zero so
 * the map stays bounded under a long-lived process. This generalises the
 * hand-rolled `withCikLock` in {@link SpacReportWriter} and the resolvers'
 * per-key mutex into one reusable primitive.
 *
 * Single-process only: like {@link AsyncMutex} it is invisible across processes,
 * so multi-process callers still need a backend UNIQUE constraint / append-only
 * PK for race-freedom.
 */
export class KeyedMutex<K> {
  private readonly entries = new Map<K, { mutex: AsyncMutex; refs: number }>();

  lock<T>(key: K, fn: () => Promise<T>): Promise<T> {
    let entry = this.entries.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    const held = entry;
    return held.mutex.lock(fn).finally(() => {
      held.refs -= 1;
      // Same-identity check guards against a caller recreating the entry between
      // the decrement and the delete.
      if (held.refs === 0 && this.entries.get(key) === held) {
        this.entries.delete(key);
      }
    });
  }

  /** Number of live (refcounted) keys — for tests asserting eviction. */
  get size(): number {
    return this.entries.size;
  }
}
