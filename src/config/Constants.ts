/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SEC fair-access policy requires a User-Agent in the form
 *   "Sample Company Name AdminContact@samplecompany.com"
 * EDGAR has been observed to 403 on RFC-5322 angle-bracket forms.
 * Override at runtime via the SEC_USER_AGENT environment variable so each
 * deployer identifies themselves rather than masquerading as the default.
 */
const DEFAULT_SEC_USER_AGENT = "PodleyAI SEC Job Queue sroussey@gmail.com";
export const SecUserAgent = process.env.SEC_USER_AGENT?.trim() || DEFAULT_SEC_USER_AGENT;
export const SecJobQueueName = "sec_job_queue";

/**
 * Steady-state SEC fetch cap in requests/second, shared across ALL processes
 * via the cluster rate limiter. Held at 4 — deliberately below EDGAR's
 * documented 10 req/s ceiling — so startup bursts and clock skew across shards
 * don't trip a ~10-minute IP block; a real 429 escalates to the cluster
 * cooldown. Override DOWN via SEC_FETCH_MAX_PER_SEC (1–8); the ceiling is
 * clamped to 8 so we stay consistently under EDGAR's limit and a stray higher
 * value can't push us to the edge.
 */
export const SecFetchMaxPerSec = ((): number => {
  const raw = process.env.SEC_FETCH_MAX_PER_SEC?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 4;
  return parsed >= 1 && parsed <= 8 ? parsed : 8;
})();

/**
 * Ceiling on SEC fetches IN FLIGHT at once, per process.
 *
 * {@link SecFetchMaxPerSec} caps how many fetches may START each second; it
 * does not cap how many are still running. The queue worker dispatches each
 * claimed job in the background and immediately loops for the next, and the
 * rate limiter's window is pruned by AGE rather than by completion, so a slot
 * frees one second after a fetch begins no matter how long it takes. In-flight
 * work is therefore `rate x latency`: while EDGAR is healthy (sub-second) that
 * is ~4, but a slow spell serving multi-MB full-submission `.txt` documents at
 * 30s each admits ~240 concurrent requests.
 *
 * Each in-flight fetch holds roughly two file descriptors, and the pool only
 * releases them after an idle period, so that pile-up is what exhausts the
 * process's descriptor table — reliably on macOS, whose default `ulimit -n` of
 * 256 is crossed at ~128 concurrent fetches. The failure is not a leak: at a
 * fixed concurrency the descriptor count is flat and returns to baseline once
 * the pool goes idle. It is the unbounded PEAK that has to be capped.
 *
 * 4 matches {@link SecFetchMaxPerSec} so a process cannot hold more in-flight
 * fetches than it is allowed to start in a second. Retries go back through the
 * queue (Concurrency + EvenlySpaced + cluster RateLimiter), so they cannot
 * bypass that cap. At 4 starts/second the cap is reached as soon as a fetch
 * averages over one second. Override via SEC_FETCH_MAX_CONCURRENT, clamped to
 * 1..64 — an unclamped override would restore the unbounded behavior this
 * constant exists to prevent, and 64 in-flight (~128 descriptors) still fits
 * inside the smallest default limit.
 */
export const SecFetchMaxConcurrent = ((): number => {
  const raw = process.env.SEC_FETCH_MAX_CONCURRENT?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 4;
  return Math.min(64, Math.max(1, parsed || 4));
})();

/**
 * Page-cache ceiling, in MEGABYTES, for the one SQLite connection every sec
 * table shares (`getDb()` — `createStorage` hands it to every
 * `SqliteTabularStorage`). Override via SEC_SQLITE_CACHE_MB, clamped to
 * 2..4096.
 *
 * Stated in MB because `PRAGMA cache_size` is stated in PAGES when its
 * argument is positive and in KiB when it is negative, and the two read
 * identically at the call site. The previous `cache_size = 1000000` was the
 * positive form: one million pages at the 4 KiB `page_size` these databases
 * use is a **~4 GB** ceiling on a cache that fills as the sweep touches pages
 * and never shrinks. A long forms sweep therefore looks like a slow leak —
 * RSS climbing for hours while the JS heap stays flat — because the growth is
 * in the pager, not the heap. Measured scanning a 271 MB database: +31 MB RSS
 * at the old setting versus +3 MB at 2 MB of cache, with the gap bounded only
 * by `min(database size, ceiling)`.
 *
 * 256 MB keeps the hot b-tree interior pages of the tables a sweep hammers
 * (`filings`, `extractor_runs`) resident, which is where the cache earns its
 * keep; the leaf pages of a multi-GB scan are read once and evicting them
 * costs nothing. Raise it on a machine with memory to spare.
 *
 * `temp_store = MEMORY` is deliberately left alone: it holds transient sort
 * and temp-index b-trees for the duration of one statement, so it is a
 * per-query peak rather than a monotonically growing cache, and moving it to
 * disk would slow every ORDER BY in the CLI for a bound this pragma does not
 * actually provide.
 */
export const SecSqliteCacheMb = ((): number => {
  const raw = process.env.SEC_SQLITE_CACHE_MB?.trim();
  const parsed = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 256;
  return Math.min(4096, Math.max(2, parsed || 256));
})();
