/**
 * Minimal cooperative async mutex.
 *
 * Serializes `lock(fn)` calls so that the inner async function runs to
 * completion before the next queued one starts. Used to close a TOCTOU
 * window in observation-repo INSERT paths where two concurrent
 * `upsertByNaturalKey` calls would both read `size()` before either
 * `put()`, then assign the same `observation_id` to two different
 * natural keys.
 *
 * The queue swallows rejections (`next.then(() => {}, () => {})`) so
 * that one failing critical section does not poison every subsequent
 * `lock()` call — each caller still observes its own rejection through
 * the `next` promise that `lock()` returns.
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
