/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reads the console makes on its own account, rather than as part of a run.
 *
 * Both surfaces that need them fire on their own clock — a picker answers a
 * keystroke, the status rail re-reads every 15 seconds — and both want the same
 * numbers, so they are cached for a few seconds. The alternative is a database
 * query per keypress against a table nobody is writing to between them.
 */

const CACHE_TTL_MS = 10_000;

interface CacheEntry<T> {
  readonly at: number;
  readonly value: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Memoizes a read for {@link CACHE_TTL_MS}.
 *
 * The PROMISE is cached, not its result, so a burst of keystrokes arriving
 * while the first read is still in flight shares that read instead of starting
 * one each — which is the case this exists for. A rejection is evicted so a
 * transient failure is not remembered for the rest of the window.
 */
export function cachedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = read();
  cache.set(key, { at: now, value });
  void value.catch(() => cache.delete(key));
  return value;
}

export function resetSecWebReadsForTesting(): void {
  cache.clear();
}
