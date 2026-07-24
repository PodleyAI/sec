/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RateLimiter } from "workglow";

// Kept in its own module (not SecJobQueue) so SecFetchJob can trigger a
// cluster cooldown without importing the queue module, avoiding an import
// cycle (SecJobQueue imports SecFetchJob to construct the server).
let sharedLimiter: RateLimiter | undefined;

/** Cluster cooldown applied on an EDGAR 429 when no Retry-After is supplied. */
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 600_000;

/** Registered by {@link getSecJobQueue} once the shared limiter is built. */
export function setSecFetchLimiter(limiter: RateLimiter): void {
  sharedLimiter = limiter;
}

/**
 * On an EDGAR 429, pause the ENTIRE fetch cluster — every shard process — for a
 * cooldown by pushing the rate limiter's cluster-visible next-available-time
 * into the future (via the shared `rate_limit_next_available` table). Without
 * this, each of the up-to-(N shards × concurrency) in-flight jobs retries on
 * its own — a thundering herd that keeps EDGAR's IP block alive. Honors a
 * server-provided Retry-After when present; otherwise a fixed default, clamped
 * to a sane range. Best-effort and idempotent: near-simultaneous callers all
 * write ~the same instant (last-writer-wins). Returns the applied cooldown (ms)
 * so the caller can sleep its own in-flight retry for the same duration.
 */
export async function signalSecFetchThrottle(retryAfterMs?: number): Promise<number> {
  // Honor a server-provided Retry-After exactly (0 is valid — "retry now" — and
  // must NOT be floored); fall back to the default only when EDGAR gives no
  // guidance (our observed 429s carry no Retry-After). Cap at MAX so a bogus
  // header can't wedge the whole cluster.
  const cooldown = Math.min(
    MAX_COOLDOWN_MS,
    retryAfterMs !== undefined ? Math.max(0, retryAfterMs) : DEFAULT_COOLDOWN_MS
  );
  if (sharedLimiter && cooldown > 0) {
    try {
      await sharedLimiter.setNextAvailableTime(new Date(Date.now() + cooldown));
    } catch {
      // Best-effort: a cooldown-write failure must not mask the fetch error
      // that triggered it. The per-job sleep below still applies locally.
    }
  }
  return cooldown;
}
