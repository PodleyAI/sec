/**
 * Minimal cooperative async mutex.
 *
 * Serializes `lock(fn)` calls so that the inner async function runs to
 * completion before the next queued one starts. Used by
 * `PersonResolver` / `CompanyResolver` to serialise the per-key
 * find-or-create critical section: two concurrent `resolve()` calls
 * mapping to the same `(resolver_version, key_kind, key_value)` would
 * both observe "no canonical row", both mint a fresh UUID, and both
 * insert — producing two distinct canonical ids for what should have
 * been the same entity. The resolvers keep one `AsyncMutex` per key
 * (refcounted, evicted at zero) so only one find-or-create runs per
 * key at a time within the process.
 *
 * The queue swallows rejections (`next.then(() => {}, () => {})`) so
 * that one failing critical section does not poison every subsequent
 * `lock()` call — each caller still observes its own rejection through
 * the `next` promise that `lock()` returns.
 *
 * Single-process only: multi-process callers (workers, separate `sec`
 * invocations) still need a backend-level UNIQUE constraint to be
 * race-free, since this mutex is invisible across processes.
 */
export class AsyncMutex {
  private _queue: Promise<unknown> = Promise.resolve();

  lock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._queue.then(fn);
    this._queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}
